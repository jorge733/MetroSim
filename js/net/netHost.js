/* ==========================================================================
   MetroSim — Multijugador · netHost.js
   Sala del Centro de Control (anfitrión): su motor es el que vale.

     · Abre la sala (código de 4 letras) y recibe a los conductores (hasta
       MAX_DRIVERS) en las líneas que supervisa.
     · A cada conductor le reserva un servicio que aún no sale, le manda el
       estado de su línea SNAP_HZ veces por segundo, los incidentes y las
       órdenes del PCC a los trenes automáticos (para que su réplica haga lo
       mismo).
     · El tren del conductor lo simula su computador: aquí se copia su estado.
     · Las órdenes del PCC a un tren con conductor van por RADIO
       (engine.remoteOrder): retener, liberar y autorizar el paso por una
       señal averiada.
     · Si un conductor se va, su tren sigue como tren automático.
   ========================================================================== */

import { CONFIG } from "../config.js";
import { WEATHER } from "../engine/weather.js";
import { oppositeRoute } from "../engine/route.js";
import { makeTrip } from "../engine/schedule.js";
import { formatClock } from "../engine/format.js";
import { hostRoom } from "./transport.js";
import { lineSnapshot, applyOwnState, reserveTrip, tripData, handOverToAto, zoneData, SNAP_HZ } from "./replica.js";

export const MAX_DRIVERS = 4;
/** Segundos sin noticias de un conductor antes de darlo por desconectado (en el celular, cambiar de app un rato no lo saca). */
const SILENCE = 30;
/** Versión del protocolo (los dos lados deben tener la misma). */
export const NET_VERSION = 1;

const ok = (text, level = "info") => ({ ok: true, text, level });
const fail = (text, level = "warn") => ({ ok: false, text, level });

export class NetHost {
  /**
   * @param {object} opts
   * @param {import("../engine/engine.js").MetroEngine} opts.engine
   * @param {() => Set<string>} opts.lines   líneas que supervisa el PCC
   * @param {(text, level, line?, trainId?) => void} opts.log  registro del PCC
   * @param {() => void} opts.onChange       cambió la lista de conductores
   */
  constructor({ engine, lines, log, onChange = () => {} }) {
    this.engine = engine;
    this.lines = lines;
    this.log = log;
    this.onChange = onChange;
    this.players = [];
    this.code = null;
    this.room = null;
    this.snapT = 0;
    this.unsub = [];
  }

  async open() {
    this.room = await hostRoom((link) => this.join(link), (online, changed) => {
      if (changed) this.log(online ? "La sala se puede encontrar otra vez" : "Sin conexión con los servidores para encontrarse: reconectando… (mientras tanto nadie nuevo puede unirse)", online ? "ok" : "warn");
      this.onChange();
    });
    this.code = this.room.code;
    this.engine.remoteOrder = (type, payload, unit) => this.order(type, payload, unit);
    const bus = this.engine.bus;
    this.unsub.push(bus.on("incident", (inc) => this.relayIncident(inc)));
    this.unsub.push(bus.on("command:result", (r) => this.relayCommand(r)));
    this.log(`Sala abierta · código ${this.code} · los conductores entran desde la portada («Unirse a una sala»)`, "ok");
    return this.code;
  }

  /** ¿Se puede encontrar la sala ahora (algún servidor para encontrarse conectado)? */
  get online() { return this.room?.online ?? false; }
  /** Estado de los servidores para encontrarse (para mostrarlo en 👥 Sala). */
  get detail() { return this.room?.detail ?? null; }
  /** Volver a anunciar la sala ahora. */
  retry() { this.room?.retry?.(); }

  /** Conductores conectados (para la interfaz del PCC). */
  get drivers() { return this.players.filter(p => p.ready); }

  join(link) {
    const p = { link, name: "Conductor", line: null, trip: null, unit: null, ready: false, seen: performance.now(), hold: null };
    this.players.push(p);
    link.onmessage = (m) => { p.seen = performance.now(); this.receive(p, m); };
    link.onclose = () => this.leave(p, "se desconectó");
  }

  receive(p, m) {
    switch (m?.type) {
      case "hello": return this.hello(p, m);
      case "st": return this.ownState(p, m);
      case "turn": return this.turn(p, m);
      case "shift": {
        const trip = p.unit?.trip;
        if (!trip || trip.id !== m.i) return;
        trip.dep[m.k] -= m.s;
        for (let j = m.k + 1; j < trip.arr.length; j++) { trip.arr[j] -= m.s; trip.dep[j] -= m.s; }
        return;
      }
      case "hold":
        p.hold = m.on ? { until: m.until ?? null, station: m.station ?? null, pending: !!m.pending, seconds: m.seconds ?? null } : null;
        if (p.unit) p.unit.remote.hold = p.hold;
        if (!m.on && m.done && p.unit) this.log(`${p.unit.id} (${p.name}) cumplió la retención y sale`, "info", p.unit.route.line, p.unit.id);
        return;
      case "ping": return p.link.send({ type: "pong", c: m.c, t: this.engine.time });
      case "bye": return this.leave(p, "salió de la sala");
    }
  }

  hello(p, m) {
    const reject = (text) => { p.link.send({ type: "reject", text }); setTimeout(() => p.link.close(), 500); };
    if (m.v !== NET_VERSION) return reject("Versión distinta del juego: actualicen los dos (recarguen la página)");
    if (this.drivers.length >= MAX_DRIVERS) return reject(`La sala está llena (máximo ${MAX_DRIVERS} conductores)`);
    const ls = this.engine.lines.get(String(m.line));
    if (!ls || !this.lines().has(ls.line.id)) {
      return reject(`Este Centro de Control supervisa ${[...this.lines()].map(id => `L${id}`).join(", ")}: elige una de esas líneas`);
    }
    const route = ls.routes[m.dir === "B" ? 1 : 0];
    p.name = String(m.name || "Conductor").trim().slice(0, 16) || "Conductor";
    p.line = ls.line.id;
    p.trip = reserveTrip(this.engine, route);
    p.ready = true;
    p.link.send({
      type: "welcome", v: NET_VERSION, time: this.engine.time,
      start: CONFIG.startTime, dep: CONFIG.schedule.playerDeparture, dayType: CONFIG.dayType,
      trip: tripData(p.trip), weather: { kind: WEATHER.kind, temp: WEATHER.temp },
    });
    this.log(`${p.name} entra a la sala: conducirá el ${p.trip.id} (sale ${clock(p.trip.departure)} de ${route.first.name})`, "ok", ls.line, p.trip.id);
    this.onChange();
  }

  /** Estado del tren de un conductor: la primera vez se crea su tren. */
  ownState(p, st) {
    if (!p.ready) return;
    if (!p.unit) {
      if (st.i !== p.trip.id) return;
      const traffic = this.engine.line(p.line).traffic;
      p.unit = traffic.createUnit(p.trip, { isPlayer: true, start: st.p });
      p.unit.remote = { name: p.name, hold: null };
      this.onChange();
    }
    if (st.i !== p.unit.id) return;                 // mensaje viejo de antes de un cambio de cabina
    applyOwnState(p.unit, st, Math.min(1, Math.max(0, this.engine.time - st.t)));
  }

  /** Cambio de cabina del conductor: el PCC le asigna el servicio de vuelta. */
  turn(p, m) {
    const u = p.unit;
    if (!u) return;
    const other = oppositeRoute(u.route);
    const traffic = this.engine.line(u.route).traffic;
    const time = this.engine.time;
    const trip = traffic.nextTripFor(other, time, 120, 1200) || makeTrip(other, Math.ceil((time + 300) / 60) * 60);
    traffic.turnback(u, trip);
    p.link.send({ type: "trip", req: m.req, trip: tripData(trip) });
    this.log(`${p.name} cambia de cabina: ahora conduce el ${trip.id} (sale ${clock(trip.departure)})`, "info", u.route.line, trip.id);
  }

  leave(p, why) {
    if (!this.players.includes(p)) return;
    this.players.splice(this.players.indexOf(p), 1);
    p.link.close();
    if (p.unit) {
      handOverToAto(this.engine, p.unit);
      this.log(`${p.name} ${why}: el ${p.unit.id} sigue como tren automático`, "warn", p.unit.route.line, p.unit.id);
    } else if (p.trip) {
      this.engine.line(p.trip.route).traffic.started.delete(p.trip.id);   // libera el servicio reservado
      if (p.ready) this.log(`${p.name} ${why}`, "warn");
    }
    this.onChange();
  }

  /** Cada fotograma: estado de las líneas a los conductores y conductores en silencio. */
  update() {
    const now = performance.now();
    if (now - (this.frameAt ?? now) > 2000) for (const p of this.players) p.seen = now;   // se congeló este navegador
    this.frameAt = now;
    for (const p of [...this.players]) if (now - p.seen > SILENCE * 1000) this.leave(p, "perdió la conexión");
    if (this.engine.time - this.snapT < 1 / SNAP_HZ && this.engine.time >= this.snapT) return;
    this.snapT = this.engine.time;
    const snaps = new Map();
    for (const p of this.drivers) {
      if (!snaps.has(p.line)) snaps.set(p.line, lineSnapshot(this.engine, p.line));
      p.link.send({ type: "snap", snap: snaps.get(p.line) });
    }
  }

  /* ----- Lo que pasa en el motor del PCC, a los conductores de esa línea ----- */

  toLine(lineId, msg) {
    for (const p of this.drivers) if (p.line === lineId) p.link.send(msg);
  }

  relayIncident(inc) {
    if (inc.kind === "doorObstruction") return;           // eso lo ve cada uno en su motor
    this.toLine(inc.line.id, {
      type: "inc", kind: inc.kind, phase: inc.phase, text: inc.text, r: inc.route?.id ?? null,
      zone: inc.zone ? zoneData(inc.route, inc.zone) : null,
      signal: inc.signal ? inc.signal.id : null,
      unit: inc.unit?.id ?? null, station: inc.station ? inc.station.index : null,
      reason: inc.reason ?? null, speech: inc.speech ?? null, car: inc.car ?? null, kmh: inc.kmh ?? null, len: inc.len ?? null,
    });
  }

  /** Órdenes cumplidas a trenes automáticos: la réplica de cada conductor hace lo mismo. */
  relayCommand({ type, payload, result }) {
    if (!result.ok || !type.startsWith("control.")) return;
    const msg = { type: "cmd", c: type, p: { ...payload, source: "red" } };
    if (type === "control.regulation") {
      for (const p of this.drivers) if (!payload.line || payload.line === p.line) p.link.send(msg);
      return;
    }
    const u = this.engine.findTrain(payload.trainId);
    if (u && !u.remote) this.toLine(u.route.line.id, msg);
  }

  /* ----- Órdenes del PCC a un tren con conductor: por radio ----- */

  order(type, payload, u) {
    const p = this.players.find(x => x.unit === u);
    if (!p) return fail(`${u.id} no responde por radio`);
    const who = `${u.id} (${p.name})`;
    const sim = u.sim;
    const station = sim.isStopped && sim.dockedStation() ? sim.dockedStation() : sim.nextStation();
    switch (type) {
      case "control.hold": {
        const s = Number(payload.seconds) > 0 ? Number(payload.seconds) : null;
        p.link.send({ type: "radio", k: "hold", s });
        p.hold = u.remote.hold = { until: null, station: station?.index ?? null, pending: true, seconds: s };
        return ok(`Radio a ${who}: retenerse en ${station?.name ?? "la próxima estación"}${s ? ` durante ${s} s` : " hasta nueva orden"}`, "warn");
      }
      case "control.release":
        if (!p.hold) return fail(`${who} no estaba retenido`, "info");
        p.link.send({ type: "radio", k: "release" });
        p.hold = u.remote.hold = null;
        return ok(`Radio a ${who}: puede salir`, "ok");
      case "control.authorize": {
        const sys = this.engine.line(u.route).signals.get(u.route.id);
        const first = sys.nextAhead(sim.position);
        const signal = first && sys.signals.slice(first.index).find(s => s.fault || sim.position - s.z > 1500);
        if (!signal?.fault) return fail(`${who} no tiene ninguna señal averiada por delante`, "info");
        if (signal.occupied) return fail(`Cantón de S${signal.id} ocupado por otro tren: espera a que lo deje libre`);
        if (signal.permit && signal.permit !== u) return fail(`S${signal.id}: ya autorizaste a ${signal.permit.id}, espera a que pase`);
        signal.permit = u;
        p.link.send({ type: "radio", k: "authorize", s: signal.id });
        return ok(`Radio a ${who}: autorizado a rebasar S${signal.id} en marcha a la vista`, "ok");
      }
      default:
        return fail(`${who} lo conduce una persona: por radio solo se le puede retener, liberar o autorizar el paso por una señal averiada`);
    }
  }

  close() {
    for (const p of [...this.players]) {
      p.link.send({ type: "close", text: "El Centro de Control cerró la sala" });
      this.leave(p, "quedó fuera: se cerró la sala");
    }
    this.unsub.forEach(f => f());
    this.unsub = [];
    this.room?.close();
    this.room = null;
    if (this.engine.remoteOrder) this.engine.remoteOrder = null;
  }
}

const clock = (t) => formatClock(t).slice(0, 5);
