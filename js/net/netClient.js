/* ==========================================================================
   MetroSim — Multijugador · netClient.js
   Conductor en la sala de un Centro de Control.

     · Se une con el código de la sala y recibe su servicio, la hora y el
       estado de la red del anfitrión (welcome).
     · Su motor es una RÉPLICA (engine.replica): los trenes automáticos, las
       señales averiadas y las limitaciones se corrigen con lo que manda el
       anfitrión, y el reloj sigue al del anfitrión.
     · Manda el estado de su tren OWN_HZ veces por segundo.
     · Radio del PCC: retener (la tracción queda bloqueada en el andén hasta
       que el PCC libere o se cumpla el tiempo), liberar, y autorizar el paso
       por una señal averiada en marcha a la vista.
     · Si se corta la conexión se sigue jugando solo: los demás trenes pasan a
       ser automáticos y vuelven los incidentes propios.
   ========================================================================== */

import { joinRoom } from "./transport.js";
import { NET_VERSION } from "./netHost.js";
import { applySnapshot, ownState, handOverToAto, tripFrom, OWN_HZ } from "./replica.js";
import { spokenTrain, spokenSignal } from "../roles/driverSafety.js";
import { spokenName } from "../config.js";

/** Segundos sin noticias del anfitrión antes de darlo por perdido. */
const SILENCE = 15;
const HOLD_LOCK = "retenido por el PCC · espera su autorización por radio";
/** Marcha a la vista autorizada por el PCC ante una señal averiada (km/h). */
const FAULT_KMH = 25;

/**
 * Se une a una sala como conductor.
 * @returns {Promise<NetClient>}  ya con su servicio asignado
 */
export async function joinDriverRoom(code, { name, line, dir }) {
  const link = await joinRoom(code);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { link.close(); reject(new Error("El Centro de Control no respondió")); }, 10000);
    const sentAt = performance.now();
    link.onmessage = (m) => {
      if (m?.type === "reject") { clearTimeout(timer); link.close(); reject(new Error(m.text)); }
      if (m?.type !== "welcome") return;
      clearTimeout(timer);
      resolve(new NetClient(link, code, m, (performance.now() - sentAt) / 1000));
    };
    link.onclose = () => { clearTimeout(timer); reject(new Error("Se cortó la conexión con la sala")); };
    link.send({ type: "hello", v: NET_VERSION, name, line, dir });
  });
}

export class NetClient {
  constructor(link, code, welcome, rtt) {
    this.link = link;
    this.code = code;
    this.welcome = welcome;
    this.rtt = Math.min(rtt, 1);
    this.sync = { t: welcome.time + this.rtt / 2, at: performance.now() };
    this.connected = true;
    this.game = null;
    this.hold = null;
    this.sendT = 0;
    this.pingT = 0;
    this.seen = this.frameAt = performance.now();
    this.turns = new Map();
    this.turnReq = 0;
    link.onmessage = (m) => { this.seen = performance.now(); this.receive(m); };
    link.onclose = () => this.lost("Se cortó la conexión con el Centro de Control");
  }

  /** Hora del motor del anfitrión, estimada ahora. */
  hostTime() { return this.sync.t + (performance.now() - this.sync.at) / 1000; }

  /** Servicio asignado por el PCC, en el motor de este jugador. */
  trip(engine) { return tripFrom(engine, this.welcome.trip); }

  /**
   * Engancha la sala a la partida ya construida.
   * @param {object} game
   * @param {object} ui  { notify(text, level, ms), radio(speech, text, level), badge: HTMLElement }
   */
  attach(game, ui) {
    this.game = game;
    this.ui = ui;
    this.renderBadge();                    // el estado de la línea se aplica con el próximo que llegue (≤ 0,2 s)
  }

  receive(m) {
    switch (m?.type) {
      case "snap": {
        this.sync = { t: m.snap.t + this.rtt / 2, at: performance.now() };
        this.lastSnap = m.snap;
        if (this.game && !this.game.warming && !this.turning) this.applySnap(m.snap);
        return;
      }
      case "inc": return this.incident(m);
      case "cmd": if (this.game) this.game.engine.command(m.c, m.p); return;
      case "radio": return this.radio(m);
      case "trip": this.turns.get(m.req)?.(m.trip); this.turns.delete(m.req); return;
      case "pong":
        this.rtt = this.rtt * 0.7 + Math.min(1, (performance.now() - m.c) / 1000) * 0.3;
        return this.renderBadge();
      case "close": return this.lost(m.text || "El Centro de Control cerró la sala");
    }
  }

  applySnap(snap) {
    const engine = this.game.engine;
    applySnapshot(engine, snap, {
      lag: Math.max(-0.5, Math.min(1, engine.time - snap.t)), own: this.game.player,
      onInfra: (kind, d) => this.infra(kind, d),
    });
    // El reloj sigue al del anfitrión (syncWithLocalTime recupera si se queda atrás)
    this.game.realClock = { epoch: performance.now(), clock: snap.t + this.rtt / 2 };
  }

  /** Tiempo a simular este fotograma: un poco más o menos para no separarse del reloj del anfitrión. */
  pace(realDt, time) {
    if (!this.connected) return realDt;
    const err = this.hostTime() - time;
    return realDt * Math.min(2, Math.max(0.25, 1 + err * 0.5));
  }

  /** Cada fotograma (tras la seguridad del conductor): estado propio, ping y retención. */
  update(dt) {
    const g = this.game, player = g?.player;
    if (!player || !this.connected) return;
    const now = performance.now();
    if (now - this.frameAt > 2000) this.seen = now;        // el que se congeló fue este navegador, no el anfitrión
    this.frameAt = now;
    if (now - this.seen > SILENCE * 1000) return this.lost("El Centro de Control no responde");
    this.sendT -= dt;
    if (this.sendT <= 0 && !this.turning) { this.sendT = 1 / OWN_HZ; this.link.send({ type: "st", ...ownState(g.engine, player) }); }
    this.pingT -= dt;
    if (this.pingT <= 0) { this.pingT = 2; this.link.send({ type: "ping", c: performance.now() }); }
    this.updateHold(player);
  }

  /* ----- Radio del PCC ----- */

  radio(m) {
    const player = this.game?.player;
    if (!player) return;
    const sim = player.sim, train = spokenTrain(player.id);
    const docked = sim.isStopped ? sim.dockedStation() : null;
    const station = docked || sim.nextStation();
    if (m.k === "hold") {
      this.hold = docked
        ? { station: docked.index, until: m.s ? this.game.engine.time + m.s : null }
        : { pending: true, seconds: m.s };
      this.sendHold();
      const where = station ? (docked ? `en ${spokenName(station.name)}` : `en la próxima estación, ${spokenName(station.name)}`) : "en la próxima estación";
      const time = m.s ? `durante ${m.s} segundos` : "hasta nueva orden";
      this.ui.radio(`Tren ${train}, PCC. Retenga el tren ${where}, ${time}.`,
        `retén el tren ${station ? `en ${station.name}` : "en la próxima estación"} ${m.s ? `${m.s} s` : "hasta nueva orden"} · la tracción queda bloqueada en el andén`, "warn");
    } else if (m.k === "release") {
      this.releaseHold(player);
      this.ui.radio(`Tren ${train}, PCC. Puede continuar.`, "liberado · puedes salir", "ok");
    } else if (m.k === "authorize") {
      const sys = this.game.signals.get(player.route.id);
      const s = sys?.signals.find(x => x.id === m.s);
      if (!s) return;
      s.permit = player;                                   // el tráfico no lo cuenta como rebase
      sim.restriction = { kmh: FAULT_KMH, untilZ: s.endZ, label: "MARCHA A LA VISTA" };
      this.ui.radio(`Tren ${train}, PCC. La señal ${spokenSignal(s.id)} está en falla. Autorizado a rebasarla en rojo, en marcha a la vista, máximo veinticinco kilómetros por hora, hasta la próxima señal.`,
        `señal S${s.id} en falla · autorizado a rebasarla en rojo en marcha a la vista (máx. ${FAULT_KMH} km/h)`, "warn");
    }
  }

  /** Retención del PCC: sin tracción mientras el tren esté en el andén de la retención. */
  updateHold(player) {
    const h = this.hold, sim = player.sim;
    if (!h) { if (sim.tractionLock === HOLD_LOCK) sim.tractionLock = null; return; }
    const docked = sim.isStopped ? sim.dockedStation() : null;
    if (h.pending && docked) {
      Object.assign(h, { pending: false, station: docked.index, until: h.seconds ? this.game.engine.time + h.seconds : null });
      this.sendHold();
      this.ui.notify(`📻 Retenido por el PCC en ${docked.name}${h.until ? ` durante ${h.seconds} s` : " hasta nueva orden"}`, "warn", 5000);
    }
    if (!h.pending && h.until !== null && this.game.engine.time >= h.until) {
      this.releaseHold(player, true);
      return this.ui.notify("📻 Retención cumplida · puedes salir", "ok", 4000);
    }
    const here = !h.pending && docked && docked.index === h.station;
    if (here) sim.tractionLock = HOLD_LOCK;
    else if (sim.tractionLock === HOLD_LOCK) sim.tractionLock = null;
  }

  releaseHold(player, done = false) {
    this.hold = null;
    if (player.sim.tractionLock === HOLD_LOCK) player.sim.tractionLock = null;
    this.link.send({ type: "hold", on: false, done });
  }

  sendHold() {
    const h = this.hold;
    this.link.send({ type: "hold", on: true, until: h.until ?? null, station: h.station ?? null, pending: !!h.pending, seconds: h.seconds ?? null });
  }

  /** ¿Está retenido ahora (para el HUD)? */
  get held() { return !!this.hold && !this.hold.pending; }

  /* ----- Incidentes del anfitrión ----- */

  incident(m) {
    const engine = this.game?.engine;
    if (!engine || this.game.warming) return;
    const ls = [...engine.lines.values()].find(l => l.routes.some(r => r.id === m.r));
    if (!ls) return;
    const route = ls.routes.find(r => r.id === m.r);
    const inc = {
      line: ls.line, route, kind: m.kind, phase: m.phase, text: m.text, zone: null, signal: null,
      unit: m.unit ? ls.trains.find(u => u.id === m.unit) ?? null : null,
      station: m.station !== null ? route.stations[m.station] : null,
      reason: m.reason, speech: m.speech, car: m.car, kmh: m.kmh, len: m.len,
    };
    if (m.kind === "speedRestriction" && m.zone) {
      let zone = route.restrictions.find(z => z.key === m.zone.k);
      if (m.phase === "start") {
        if (zone) return;                                   // ya llegó con el estado de la línea
        zone = { from: m.zone.from, to: m.zone.to, kmh: m.zone.kmh, label: m.zone.label, key: m.zone.k };
        route.restrictions.push(zone);
      } else {
        if (!zone) return;
        route.restrictions.splice(route.restrictions.indexOf(zone), 1);
      }
      inc.zone = zone;
    }
    if (m.kind === "signalFault") {
      const s = ls.signals.get(route.id).signals.find(x => x.id === m.signal);
      if (!s || !!s.fault === (m.phase === "start")) return;
      s.fault = m.phase === "start";
      if (!s.fault) s.permit = null;
      inc.signal = s;
    }
    engine.bus.emit("incident", inc);
  }

  /** Señal averiada o limitación que apareció o se fue con el estado de la línea (sin aviso propio del anfitrión). */
  infra(kind, { route, signal, zone }) {
    const engine = this.game.engine;
    const line = engine.line(route).line;
    const texts = {
      faultStart: () => `Falla de señal S${signal.id} · permanece en ROJO · espera la autorización del PCC`,
      faultEnd: () => `Señal S${signal.id} reparada · circulación normal`,
      zoneStart: () => `Limitación temporal ${zone.kmh} km/h por ${zone.label.toLowerCase()}`,
      zoneEnd: () => `Fin de la limitación temporal de velocidad (${zone.label})`,
    };
    engine.bus.emit("incident", {
      line, route, kind: zone ? "speedRestriction" : "signalFault", phase: kind.endsWith("Start") ? "start" : "end",
      text: texts[kind](), zone: zone ?? null, signal: signal ?? null,
    });
  }

  /* ----- Cambio de cabina y horario ----- */

  /** Pide al PCC el servicio de vuelta. Mientras tanto no se aplica el estado de la línea. */
  requestTurn() {
    const req = ++this.turnReq;
    this.turning = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.turns.delete(req); this.turning = false; reject(new Error("sin respuesta")); }, 5000);
      this.turns.set(req, (data) => { clearTimeout(timer); resolve(tripFrom(this.game.engine, data)); });
      this.link.send({ type: "turn", req });
    });
  }

  /** Ya se hizo el cambio de cabina en este motor. */
  turned() { this.turning = false; this.hold = null; }

  /** Embarque completo: el horario del servicio se adelanta (también en el anfitrión). */
  shift(trip, k, s) { this.link.send({ type: "shift", i: trip.id, k, s }); }

  /* ----- Fin ----- */

  /** Sin conexión: se sigue jugando solo. */
  lost(text) {
    if (!this.connected) return;
    this.connected = false;
    this.turning = false;
    this.link.close();
    const g = this.game;
    if (!g?.engine) return;
    g.engine.replica = false;                              // vuelven los incidentes propios
    for (const ls of g.engine.lines.values()) for (const u of [...ls.trains]) if (u.puppet) { u.puppet = false; handOverToAto(g.engine, u); }
    if (g.player) this.releaseHold(g.player);
    this.ui?.notify(`${text} · sigues conduciendo sin conexión`, "warn", 7000);
    this.renderBadge();
  }

  leave() {
    this.ui?.badge?.remove();
    if (!this.connected) return;
    this.link.send({ type: "bye" });
    this.connected = false;
    setTimeout(() => this.link.close(), 200);
  }

  renderBadge() {
    const el = this.ui?.badge;
    if (!el) return;
    el.classList.toggle("off", !this.connected);
    el.textContent = this.connected ? `👥 Sala ${this.code} · PCC ${Math.round(this.rtt * 1000)} ms` : `👥 Sala ${this.code} · sin conexión`;
  }
}
