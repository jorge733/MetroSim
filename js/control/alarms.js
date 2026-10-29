/* ==========================================================================
   MetroSim — Centro de Control · alarms.js
   Mesa de alarmas y nota del turno del Puesto Central de Control (PCC).

   Convierte lo que avisa el motor en ALARMAS que piden una decisión, cada
   una con sus botones (órdenes de engine/commands.js):
     · signalFault  señal averiada en rojo: autorizar a cada tren a pasar
                    en marcha a la vista ("control.authorize")
     · lineStop     tren detenido en plena vía: autorizar la reanudación
                    ("control.resume")
     · doorFault    falla de puertas: retirar del servicio ("control.withdraw")
                    o mantenerlo (cada parada tarda más)
     · delay        tren con mucho retraso: saltar su próxima parada
                    ("control.skip") o ignorar

   La nota del turno (0–100, de S a D) mide la puntualidad de las líneas
   supervisadas, lo rápido que se atienden las alarmas y los segundos que
   los trenes pasan detenidos esperando al PCC.

   No dibuja nada: controlCenter.js lo muestra. No usa Three.js.
   ========================================================================== */

import { CONFIG } from "../config.js";

/** Retraso (s) desde el que se avisa de un tren atrasado, y por debajo del cual se da por resuelto. */
const DELAY_ALARM = 300, DELAY_OK = 180;
/** Una alarma atendida en menos de estos segundos vale el máximo; después, cada vez menos. */
const QUICK = 20, SLOW = 180;
/** Segundos que una alarma resuelta sigue a la vista (con ✔). */
const KEEP_RESOLVED = 6;
/** Distancia (m) a la que se considera que un tren "va hacia" una señal averiada. */
const FAULT_REACH = 1500;

/** La orden que atiende cada tipo de alarma. */
const ORDERS = { signalFault: "control.authorize", lineStop: "control.resume", doorFault: "control.withdraw", delay: "control.skip" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Notas del turno según la puntuación. */
const GRADES = [[92, "S"], [82, "A"], [70, "B"], [55, "C"], [0, "D"]];
export const gradeOf = (score) => GRADES.find(([min]) => score >= min)[1];

let nextId = 1;

export class AlarmDesk {
  /**
   * @param {import("../engine/engine.js").MetroEngine} engine
   * @param {Set<string>} lines  ids de las líneas supervisadas
   * @param {object} [opts]
   * @param {(alarm) => void} [opts.onNew]  nueva alarma (sonido)
   */
  constructor(engine, lines, { onNew = () => {} } = {}) {
    this.engine = engine;
    this.lines = lines;
    this.onNew = onNew;
    this.alarms = [];            // todas las del turno (también las resueltas, para la nota)
    this.ignoredDelay = new Set();
    this.unsub = [];
    this.reset();
    const bus = engine.bus;
    this.unsub.push(bus.on("incident", (inc) => this.onIncident(inc)));
    this.unsub.push(bus.on("train:event", ({ unit, type, data }) => {
      if (type !== "arrivedStation" || !this.watches(unit) || unit.ato?.outOfService) return;
      this.stats.arrivals++;
      if (Math.abs(data.delay) <= CONFIG.schedule.punctualWindow) this.stats.punctual++;
    }));
    this.unsub.push(bus.on("command:result", ({ type, payload, result }) => {
      if (!result.ok || !type.startsWith("control.")) return;
      this.stats.orders++;
      for (const a of this.open()) {
        if (a.unit?.id === payload.trainId || (a.kind === "signalFault" && type === "control.authorize" && a.waiting?.some(t => t.id === payload.trainId))) {
          if (ORDERS[a.kind] === type) this.markActed(a);
        }
      }
    }));
  }

  /** Empieza un turno nuevo (las alarmas abiertas siguen, la nota vuelve a cero). */
  reset() {
    this.startTime = this.engine.time;
    this.stats = { arrivals: 0, punctual: 0, waitSeconds: 0, orders: 0 };
    for (const a of this.alarms) a.oldShift = true;
  }

  watches(unit) { return this.lines.has(unit.route.line.id); }
  lineSystem(id) { return this.engine.line(id); }

  /** Alarmas abiertas, de la más grave y antigua a la más leve. */
  open() { return this.alarms.filter(a => !a.resolvedAt); }

  /** Alarmas para mostrar: abiertas y las recién resueltas. */
  visible(lineId = null) {
    const now = this.engine.time;
    return this.alarms
      .filter(a => (!a.resolvedAt || now - a.resolvedAt < KEEP_RESOLVED) && (!lineId || a.line.id === lineId))
      .sort((a, b) => (!!a.resolvedAt - !!b.resolvedAt) || (rank(b) - rank(a)) || (a.since - b.since));
  }

  /** Alarma abierta de un tren (o null). */
  forTrain(unit) {
    return this.open().find(a => a.unit === unit || a.waiting?.includes(unit)) || null;
  }

  add(a) {
    const alarm = { id: nextId++, since: this.engine.time, actedAt: null, resolvedAt: null, needed: true, ...a };
    alarm.actions = () => actionsFor(alarm, this);
    this.alarms.push(alarm);
    this.onNew(alarm);
    return alarm;
  }

  markActed(a) { if (!a.actedAt) a.actedAt = this.engine.time; }
  resolve(a) { if (!a.resolvedAt) a.resolvedAt = this.engine.time; }

  /** "Mantener en servicio" / "Ignorar": la alarma se da por atendida. */
  dismiss(a) {
    this.markActed(a);
    this.resolve(a);
    if (a.kind === "delay") this.ignoredDelay.add(a.unit.id);
  }

  /** Incidentes del motor: abren o cierran alarmas. */
  onIncident(inc) {
    if (!this.lines.has(inc.line.id)) return;
    if (inc.phase === "end") {
      for (const a of this.open()) {
        if (a.kind !== inc.kind) continue;
        if (inc.kind === "signalFault" ? a.signal === inc.signal : a.unit === inc.unit) this.resolve(a);
      }
      return;
    }
    if (inc.kind === "signalFault") {
      this.add({ kind: "signalFault", level: "alert", line: inc.line, signal: inc.signal, route: inc.route, station: inc.station,
        title: `Señal S${inc.signal.id} averiada`, detail: `En rojo antes de ${inc.station?.name ?? "la estación"}. Autoriza a cada tren a pasar en marcha a la vista.`, waiting: [], needed: false });
    } else if (inc.kind === "lineStop") {
      this.add({ kind: "lineStop", level: "alert", line: inc.line, unit: inc.unit,
        title: `${inc.unit.id} detenido en la vía`, detail: `Antes de ${inc.station?.name ?? "la estación"} por ${inc.reason}. Cuando lo revises, autoriza que siga.` });
    } else if (inc.kind === "doorFault") {
      this.add({ kind: "doorFault", level: "warn", line: inc.line, unit: inc.unit,
        title: `Falla de puertas en ${inc.unit.id}`, detail: `Coche ${inc.car}: cada parada tarda ~25 s más y atrasa a los que vienen detrás. Retirarlo deja a sus pasajeros en el andén.` });
    }
  }

  /** Una vez por fotograma (dt: segundos simulados desde la última vez). */
  update(dt) {
    const now = this.engine.time;
    for (const a of this.open()) {
      if (a.unit && !this.lineSystem(a.line.id).trains.includes(a.unit)) { this.resolve(a); continue; }
      if (a.kind === "signalFault") {
        a.waiting = this.trainsBefore(a.signal, a.route);
        if (a.waiting.length) a.needed = true;
        this.stats.waitSeconds += dt * a.waiting.filter(t => t.state === "signalStop").length;
      } else if (a.kind === "lineStop") {
        if (a.unit.ato?.lineStop && a.unit.sim.isStopped && now - a.since > 15) this.stats.waitSeconds += dt;
      } else if (a.kind === "delay") {
        if (a.unit.delay < DELAY_OK) this.resolve(a);
      }
    }
    // Trenes muy atrasados (uno por tren; "Ignorar" lo silencia hasta que se recupere)
    for (const id of this.lines) {
      for (const u of this.lineSystem(id).trains) {
        if (!u.ato || u.ato.outOfService || u.arrivedIdx === null) continue;
        if (u.delay < DELAY_OK) this.ignoredDelay.delete(u.id);
        if (u.delay < DELAY_ALARM || this.ignoredDelay.has(u.id)) continue;
        if (this.open().some(a => a.unit === u)) continue;
        this.add({ kind: "delay", level: "warn", line: u.route.line, unit: u,
          title: `${u.id} con ${Math.round(u.delay / 60)} min de retraso`, detail: "Saltar su próxima parada le hace recuperar tiempo (la gente de ese andén espera el siguiente tren)." });
      }
    }
  }

  /** Trenes de una ruta que tienen por delante (a menos de 1,5 km) esta señal averiada y aún no están autorizados. */
  trainsBefore(signal, route) {
    const ls = this.lineSystem(route.line.id), sys = ls.signals.get(route.id);
    const list = [];
    for (const u of ls.trains) {
      if (u.route !== route || u.sim.position <= signal.z || u.sim.position - signal.z > FAULT_REACH) continue;
      if (signal.permit === u || u.ato?.permit === signal) continue;
      // Que no haya otra señal averiada antes (esa es la suya)
      const first = sys.nextAhead(u.sim.position);
      if (first && sys.signals.slice(first.index, signal.index).some(s => s.fault)) continue;
      list.push(u);
    }
    return list.sort((a, b) => a.sim.position - b.sim.position);
  }

  /** Nota del turno. */
  score() {
    const now = this.engine.time;
    const s = this.stats;
    const P = s.arrivals ? s.punctual / s.arrivals : 1;
    // Calidad de la atención de cada alarma del turno (0..1)
    const q = [];
    for (const a of this.alarms) {
      if (a.oldShift && a.resolvedAt) continue;
      const t0 = Math.max(a.since, this.startTime);
      if (a.actedAt) q.push(clamp(1 - (a.actedAt - t0 - QUICK) / (SLOW - QUICK), 0.25, 1));
      else if (!a.resolvedAt) { if (a.needed && now - t0 > 60) q.push(0); }   // sin atender todavía (y alguien te espera)
      else if (a.needed && a.kind !== "delay") q.push(0);                 // se resolvió sola, pero alguien te esperaba
    }
    const A = q.length ? q.reduce((x, y) => x + y, 0) / q.length : 1;
    const W = clamp(1 - s.waitSeconds / 900, 0, 1);
    const score = Math.round(100 * (0.45 * P + 0.4 * A + 0.15 * W));
    const handled = this.alarms.filter(a => a.actedAt && a.actedAt >= this.startTime).length;
    return {
      score, grade: gradeOf(score), punctuality: P, response: A, waitSeconds: s.waitSeconds,
      arrivals: s.arrivals, alarms: q.length, handled, orders: s.orders, duration: now - this.startTime,
    };
  }

  destroy() { this.unsub.forEach(f => f()); }
}

function rank(a) { return a.level === "alert" ? 2 : 1; }

/** Botones de cada alarma: { label, cmd, payload } o { label, dismiss: true }. */
function actionsFor(a, desk) {
  if (a.resolvedAt) return [];
  switch (a.kind) {
    case "signalFault": {
      const t = a.waiting?.[0];
      if (!t) return [];
      if (a.signal.occupied) return [{ label: `Cantón ocupado: espera para autorizar a ${t.id}`, disabled: true, unit: t }];
      return [{ label: `Autorizar paso a ${t.id}`, cmd: "control.authorize", payload: { trainId: t.id }, primary: true, unit: t, key: "A" }];
    }
    case "lineStop":
      return [{ label: "Autorizar que siga", cmd: "control.resume", payload: { trainId: a.unit.id }, primary: true, key: "A" }];
    case "doorFault":
      if (a.unit.ato?.evacuateAt != null) return [];
      return [
        { label: "Retirar del servicio", cmd: "control.withdraw", payload: { trainId: a.unit.id }, primary: true },
        { label: "Mantener en servicio", dismiss: true },
      ];
    case "delay":
      return [
        { label: "Saltar próxima parada", cmd: "control.skip", payload: { trainId: a.unit.id }, primary: true },
        { label: "Ignorar", dismiss: true },
      ];
  }
  return [];
}
