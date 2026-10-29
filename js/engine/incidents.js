/* ==========================================================================
   MetroSim — Motor · incidents.js
   Incidentes aleatorios de la operación (uno por línea).

   Tipos:
     doorObstruction   un viajero bloquea una puerta mientras se cierran:
                       las puertas se reabren. El tren automático vuelve a
                       cerrar solo; el jugador debe cerrar otra vez (D).
     speedRestriction  limitación temporal de velocidad (trabajos o
                       inspección de vía) en un tramo, durante varios minutos.
                       Todos los trenes la respetan (route.speedLimitAt).
     signalFault       falla de una señal: queda en ROJO un tiempo. Los
                       trenes esperan ante ella; rebasarla es una falta.
     lineStop          (1.3) un tren automático se detiene entre dos
                       estaciones por regulación de frecuencia, por un tren
                       detenido más adelante o por inspección de vía, y
                       reanuda la marcha a los 25–75 s.
     outOfService      (1.3) un tren automático se retira del servicio: en
                       su próxima estación bajan todos y sigue vacío hasta la
                       terminal sin admitir pasajeros.

   Modo Centro de Control (engine.pcc = { lines: Set de ids de línea, quiet }): solo
   hay incidentes en las líneas que supervisa el jugador y esperan su
   decisión (órdenes de commands.js):
     · signalFault dura varios minutos (cuadrilla de reparación): cada tren
       detenido ante la señal necesita "control.authorize" (marcha a la vista).
     · lineStop no reanuda solo hasta pasados unos minutos: "control.resume".
     · doorFault sustituye a outOfService: un tren con falla de puertas tarda
       más en cada parada hasta que se retire ("control.withdraw") o llegue a
       la terminal.

   focus: tren en el que se fija el juego (el del pasajero o el que se acerca
   a su andén). Los incidentes le tocan a él a menudo, como al del conductor.

   Avisa por el bus con "incident" { line, route, kind, phase: "start"|"end",
   text, ...datos }. No usa Three.js.
   ========================================================================== */

/** Probabilidad de puerta obstruida en cada cierre de puertas (el conductor que cierra con gente aún subiendo, mucho más). */
const DOOR_CHANCE = { player: 0.08, playerBoarding: 0.55, auto: 0.03 };
/** Minutos (de simulación) entre incidentes de vía/señal: mínimo y máximo. */
const GAP_MIN = 4 * 60, GAP_MAX = 9 * 60;
/** Segundos entre incidentes de un tren (detención en vía o retiro del servicio). */
const TRAIN_GAP_MIN = 3 * 60, TRAIN_GAP_MAX = 7 * 60;
/** Motivos de una detención en plena vía: [peso, motivo, frase de la megafonía]. */
const STOP_REASONS = [
  [0.55, "regulación de frecuencia", "nuestro tren se encuentra detenido por regulación de frecuencia"],
  [0.3, "tren detenido más adelante", "nos encontramos detenidos porque hay un tren detenido más adelante"],
  [0.15, "inspección de vía", "nos encontramos detenidos por una inspección de vía"],
];

/** Motivos de una detención en plena vía en modo Centro de Control (todos necesitan su autorización). */
const PCC_STOP_REASONS = [
  [0.4, "aviso de objeto en la vía", "nos encontramos detenidos por un aviso de objeto en la vía"],
  [0.35, "activación de alarma de pasajero", "nos encontramos detenidos porque un pasajero activó la alarma"],
  [0.25, "inspección de vía", "nos encontramos detenidos por una inspección de vía"],
];

const rand = (a, b) => a + Math.random() * (b - a);

export class IncidentManager {
  /** @param {object} lineSystem  LineSystem del motor (routes, signals, traffic, bus) */
  constructor(lineSystem, startTime) {
    this.ls = lineSystem;
    this.bus = lineSystem.bus;
    this.active = [];                // incidentes temporales en curso
    this.nextAt = startTime + rand(GAP_MIN / 2, GAP_MAX);
    this.recloses = [];              // trenes automáticos que deben volver a cerrar puertas
    this.nextTrainAt = startTime + rand(TRAIN_GAP_MIN / 2, TRAIN_GAP_MAX);
    this.focus = null;               // tren en el que se fija el juego (lo fija main.js)
    for (const r of lineSystem.routes) r.restrictions = [];   // las rutas son compartidas entre partidas
  }

  /** Modo Centro de Control: { lines } o null. */
  get pcc() { return this.ls.engine?.pcc ?? null; }

  update(dt, clock) {
    this.doors(clock);
    // Fin de los incidentes temporales
    for (const inc of [...this.active]) {
      if (!this.ended(inc, clock)) continue;
      if (inc.kind === "speedRestriction") inc.route.restrictions.splice(inc.route.restrictions.indexOf(inc.zone), 1);
      if (inc.kind === "signalFault") { inc.signal.fault = false; inc.signal.permit = null; }
      if (inc.kind === "doorFault" && inc.unit.ato === inc.ato) inc.ato.doorFault = false;
      this.active.splice(this.active.indexOf(inc), 1);
      this.emit(inc, "end", inc.kind === "speedRestriction" ? `Fin de la limitación temporal de velocidad (${inc.zone.label})`
        : inc.kind === "signalFault" ? `Señal S${inc.signal.id} reparada · circulación normal`
        : inc.kind === "lineStop" ? `${inc.unit.id} reanuda la marcha`
        : inc.kind === "doorFault" ? (inc.ato.outOfService ? `${inc.unit.id} retirado del servicio · va vacío a la terminal` : `${inc.unit.id} terminó su recorrido · pasa a mantenimiento`)
        : `${inc.unit.id} llegó a la terminal vacío`, { unit: inc.unit, signal: inc.signal ?? null });
    }
    // Centro de Control: solo hay incidentes en las líneas que supervisa el jugador (y ninguno al azar durante el tutorial)
    const pcc = this.pcc;
    if (pcc && (!pcc.lines.has(this.ls.line.id) || pcc.quiet)) return;
    // Nuevo incidente
    if (clock >= this.nextAt) {
      this.nextAt = clock + rand(GAP_MIN, GAP_MAX);
      if (this.active.length < 2) (Math.random() < 0.55 ? this.startRestriction(clock) : this.startSignalFault(clock));
    }
    if (clock >= this.nextTrainAt) {
      this.nextTrainAt = clock + rand(TRAIN_GAP_MIN, TRAIN_GAP_MAX);
      if (Math.random() < 0.7) this.startLineStop(clock);
      else if (pcc) { if (!this.active.some(i => i.kind === "doorFault")) this.startDoorFault(clock); }
      else if (!this.active.some(i => i.kind === "outOfService")) this.startOutOfService(clock);
    }
  }

  /** ¿Terminó este incidente? */
  ended(inc, clock) {
    const alive = this.ls.traffic.units.includes(inc.unit);
    switch (inc.kind) {
      case "lineStop": return clock >= inc.until || !alive || !inc.unit.ato?.lineStop;   // el PCC puede autorizar antes
      case "outOfService": return clock >= inc.until && !(alive && inc.unit.ato?.evacuateAt != null);   // dura hasta la terminal
      case "doorFault": {
        const ato = inc.ato;
        return !alive || inc.unit.ato !== ato || (ato.outOfService && !ato.evacuating) || ato.state === "retire" || ato.state === "retired";
      }
      default: return clock >= inc.until;
    }
  }

  /**
   * Provoca un incidente ahora (tutorial del Centro de Control).
   * @param {"signalFault"|"lineStop"|"doorFault"} kind
   * @param {object} [unit]  tren afectado (o el que tendrá la señal averiada por delante)
   * @returns {boolean} si se pudo crear
   */
  force(kind, unit = null, clock = this.ls.time) {
    const n = this.active.length;
    if (kind === "signalFault") this.startSignalFault(clock, unit);
    else if (kind === "lineStop") this.startLineStop(clock, unit);
    else if (kind === "doorFault") this.startDoorFault(clock, unit);
    return this.active.length > n;
  }

  /* ----- Puertas obstruidas ----- */
  doors(clock) {
    for (const u of this.ls.traffic.units) {
      const sim = u.sim;
      if (!sim) continue;
      if (sim.doorState !== "closing") { u.doorRolled = false; continue; }
      if (!u.doorRolled) {
        u.doorRolled = true;
        u.closedBoarding = u.isPlayer && this.ls.traffic.isBoarding(u);
        u.doorBlocked = sim.dockedStation() !== u.route.last
          && Math.random() < (u.isPlayer ? (u.closedBoarding ? DOOR_CHANCE.playerBoarding : DOOR_CHANCE.player) : DOOR_CHANCE.auto);
      }
      if (u.doorBlocked && sim.doorProgress < 0.55) {
        u.doorBlocked = false;
        sim.doorState = "opening";
        const car = 1 + Math.floor(Math.random() * 5);
        this.bus.emit("incident", {
          line: this.ls.line, route: u.route, kind: "doorObstruction", phase: "start", unit: u, car,
          text: `Puerta obstruida en el coche ${car} · reapertura automática${u.closedBoarding ? " · cerraste con pasajeros aún subiendo" : ""}${u.isPlayer ? " · vuelve a cerrar (D)" : ""}`,
        });
        if (!u.isPlayer) this.recloses.push({ unit: u, at: clock + rand(4, 8) });
      }
    }
    for (const r of [...this.recloses]) {
      if (clock < r.at) continue;
      this.recloses.splice(this.recloses.indexOf(r), 1);
      const sim = r.unit.sim;
      if (sim && (sim.doorState === "open" || sim.doorState === "opening")) sim.toggleDoors({ automatic: true });
    }
  }

  /** Tren del jugador en esta línea (para que los incidentes le toquen a él a menudo). */
  player() { return this.ls.traffic.units.find(u => u.isPlayer) || null; }

  /** Ruta y punto de referencia: delante del jugador (70 %) o al azar. */
  place(minAhead, maxAhead) {
    const p = this.player() || (this.ls.traffic.units.includes(this.focus) ? this.focus : null);
    if (p && Math.random() < 0.7) return { route: p.route, z: p.sim.position - rand(minAhead, maxAhead) };
    const route = this.ls.routes[Math.floor(Math.random() * this.ls.routes.length)];
    return { route, z: rand(route.last.stopZ + 300, route.first.stopZ - 300) };
  }

  /* ----- Limitación temporal de velocidad ----- */
  startRestriction(clock) {
    const { route, z } = this.place(700, 2500);
    if (z < route.last.stopZ + 100 || route.restrictions.length) return;
    const kmh = Math.random() < 0.5 ? 30 : 40, len = Math.round(rand(200, 400));
    const label = Math.random() < 0.5 ? "TRABAJOS EN VÍA" : "INSPECCIÓN DE VÍA";
    const zone = { from: z, to: z - len, kmh, label };
    route.restrictions.push(zone);
    const until = clock + rand(6, 12) * 60;
    const inc = { kind: "speedRestriction", route, zone, until };
    this.active.push(inc);
    const near = route.stations.find(s => s.stopZ < z) || route.last;
    this.emit(inc, "start", `Limitación temporal ${kmh} km/h por ${label.toLowerCase()} · ${len} m antes de ${near.name}`, { kmh, len, station: near });
  }

  /* ----- Falla de señal ----- */
  startSignalFault(clock, unit = null) {
    const { route, z } = unit ? { route: unit.route, z: unit.sim.position - rand(500, 900) } : this.place(500, 1800);
    const sys = this.ls.signals.get(route.id);
    const signal = sys?.nextAhead(z);
    if (!signal || signal.fault) return;
    signal.fault = true;
    // En el Centro de Control la reparación tarda más: el PCC autoriza a cada tren a pasar
    const until = clock + (this.pcc ? rand(240, 420) : rand(40, 100));
    const inc = { kind: "signalFault", route, signal, until };
    this.active.push(inc);
    const near = route.stations.find(s => s.stopZ < signal.z) || route.last;
    this.emit(inc, "start", this.pcc
      ? `Falla de señal S${signal.id} antes de ${near.name} · queda en ROJO: autoriza a cada tren a pasar en marcha a la vista`
      : `Falla de señal S${signal.id} · permanece en ROJO · espera ante ella la reparación`, { signal, station: near });
  }

  /** Tren automático para un incidente: el que mira el juego (60 %) si sirve, o uno al azar. */
  pickUnit(ok) {
    const units = this.ls.traffic.units.filter(u => u.ato && !u.ato.outOfService && ok(u));
    if (!units.length) return null;
    if (units.includes(this.focus) && Math.random() < 0.6) return this.focus;
    return units[Math.floor(Math.random() * units.length)];
  }

  /* ----- Detención en plena vía ----- */
  startLineStop(clock, unit = null) {
    const ok = v => v.ato && v.ato.state === "running" && !v.ato.lineStop && v.sim.speed > 8 && v.sim.position - v.ato.target.stopZ > 700;
    const u = unit ? (ok(unit) ? unit : null) : this.pickUnit(ok);
    if (!u) return;
    const reasons = this.pcc ? PCC_STOP_REASONS : STOP_REASONS;
    let r = Math.random(), reason = reasons[0];
    for (const x of reasons) { if (r < x[0]) { reason = x; break; } r -= x[0]; }
    // En el Centro de Control espera tu autorización (o, si no llega, a que se resuelva solo varios minutos después)
    const until = clock + (this.pcc ? rand(180, 300) : rand(25, 75));
    u.ato.lineStop = { until, reason: reason[1], speech: reason[2] };
    const inc = { kind: "lineStop", route: u.route, unit: u, until: until + 2 };
    this.active.push(inc);
    this.emit(inc, "start", `${u.id} detenido antes de ${u.ato.target.name} por ${reason[1]}${this.pcc ? " · espera tu autorización para seguir" : ""}`, { unit: u, reason: reason[1], speech: reason[2], station: u.ato.target });
  }

  /* ----- Falla de puertas (Centro de Control) ----- */
  startDoorFault(clock, unit = null) {
    const ok = v => v.ato && !v.ato.doorFault && !v.ato.outOfService && v.ato.evacuateAt == null
      && (v.ato.state === "running" || v.ato.state === "dwell") && v.ato.targetIndex >= 1 && v.ato.targetIndex <= v.route.stations.length - 4;
    const u = unit ? (ok(unit) ? unit : null) : this.pickUnit(ok);
    if (!u) return;
    u.ato.doorFault = true;
    const car = 1 + Math.floor(Math.random() * 5);
    const inc = { kind: "doorFault", route: u.route, unit: u, ato: u.ato, until: Infinity };
    this.active.push(inc);
    this.emit(inc, "start", `Falla de puertas en el coche ${car} de ${u.id}: cada parada tarda más · decide si retirarlo del servicio`, { unit: u, car });
  }

  /* ----- Tren que se retira del servicio ----- */
  startOutOfService(clock) {
    const u = this.pickUnit(v => v.ato.state === "running" && v.ato.targetIndex >= 2
      && v.ato.targetIndex <= v.route.stations.length - 4 && v.sim.position - v.ato.target.stopZ > 300);
    if (!u) return;
    u.ato.evacuateAt = u.ato.targetIndex;
    const station = u.ato.target;
    const inc = { kind: "outOfService", route: u.route, unit: u, until: clock + 60 };
    this.active.push(inc);
    this.emit(inc, "start", `${u.id} se retira del servicio en ${station.name}: bajan todos y sigue sin pasajeros`, { unit: u, station });
  }

  emit(inc, phase, text, extra = {}) {
    this.bus.emit("incident", { line: this.ls.line, route: inc.route, kind: inc.kind, phase, text, zone: inc.zone ?? null, ...extra });
  }
}
