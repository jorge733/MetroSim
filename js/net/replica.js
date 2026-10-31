/* ==========================================================================
   MetroSim — Multijugador · replica.js
   El estado de una línea en datos simples, para mandarlo por la red, y cómo
   se aplica en el motor de otro jugador. Lógica pura: sin navegador ni
   Three.js (se prueba en Node).

   Quién manda en qué:
     · El ANFITRIÓN (Centro de Control) corre el motor que vale: horarios,
       trenes automáticos, señales, incidentes y órdenes del PCC.
     · Cada CONDUCTOR corre su propio motor completo (para dibujar estaciones,
       viajeros y pantallas sin esperar a la red), pero es una RÉPLICA: los
       trenes automáticos y los de otros conductores se corrigen con el
       estado del anfitrión (lineSnapshot → applySnapshot), y los incidentes
       llegan del anfitrión (engine.replica apaga los suyos).
     · El tren del conductor lo simula su propio computador (sin retardo en
       el mando) y el anfitrión copia su estado (ownState → applyOwnState).
   ========================================================================== */

import { makeTrip } from "../engine/schedule.js";

/** Envíos por segundo: estado de la línea (anfitrión) y del tren propio (conductor). */
export const SNAP_HZ = 5, OWN_HZ = 10;
/** Error de posición (m) desde el que se salta directo en vez de corregir de a poco. */
const SNAP_JUMP = 25;
/** Parte del error que se corrige en cada estado recibido. */
const BLEND = 0.35;
/** Estados seguidos en que un tren tiene que faltar (o sobrar) antes de quitarlo (o crearlo). */
const MISSING_LIMIT = 3, SPAWN_DELAY = 2;

/** Campos del conductor automático (AutoDriver) que se copian tal cual. */
const ATO_FIELDS = ["state", "targetIndex", "held", "heldUntil", "holdFor", "holdUntil", "arrivedAt", "evacuateAt", "evacuating",
  "outOfService", "doorFault", "regulateUntil", "hurry", "sightUntil", "lineStop", "backing"];

const r2 = (x) => Math.round(x * 100) / 100;

/* ----- Anfitrión → conductores ----- */

/**
 * Estado de los trenes, señales averiadas y limitaciones de una línea.
 * @param {import("../engine/engine.js").MetroEngine} engine
 * @param {string} lineId
 */
export function lineSnapshot(engine, lineId) {
  const ls = engine.line(lineId);
  const units = ls.trains.map(u => {
    const s = u.sim;
    const rec = {
      i: u.id, r: u.route.id, p: r2(s.position), v: r2(s.velocity), a: r2(s.accel), ad: s.autoDemand,
      n: s.notch, rv: s.reverser, ds: s.doorState, dp: r2(s.doorProgress), l: Math.round(u.load || 0), d: Math.round(u.delay || 0),
    };
    if (u.crossing) rec.x = 1;                      // maniobra de retorno: cruzando el cambio de vía
    if (u.ato) {
      const o = {};
      for (const k of ATO_FIELDS) o[k] = u.ato[k];
      rec.o = o;
    }
    // Tren de un conductor: lo necesario para crearlo en los demás (su servicio puede no estar en el horario)
    if (u.remote || u.isPlayer) rec.h = { name: u.remote?.name ?? "PCC", dep: u.trip.departure, ex: u.trip.express ?? null };
    return rec;
  });
  return { t: engine.time, line: lineId, u: units, ...infraState(ls) };
}

/** Señales averiadas (y a quién se autorizó a rebasarlas) y limitaciones temporales de una línea. */
function infraState(ls) {
  const f = [], z = [];
  for (const route of ls.routes) {
    for (const s of ls.signals.get(route.id).signals) if (s.fault) f.push({ r: route.id, s: s.id });
    for (const zone of route.restrictions) z.push(zoneData(route, zone));
  }
  return { f, z };
}

/** Limitación temporal en datos simples (con una clave para reconocerla en el otro motor). */
export function zoneData(route, zone) {
  zone.key ??= `${route.id}:${Math.round(zone.from)}:${zone.kmh}`;
  return { r: route.id, k: zone.key, from: zone.from, to: zone.to, kmh: zone.kmh, label: zone.label };
}

/**
 * Aplica el estado del anfitrión a la línea de un motor réplica.
 * @param {import("../engine/engine.js").MetroEngine} engine
 * @param {object} snap   lineSnapshot del anfitrión
 * @param {object} opts
 * @param {number} opts.lag   segundos que lleva de viaje (se extrapola la posición)
 * @param {object|null} opts.own  tren de este jugador (no se toca)
 * @param {(kind:string, data:object)=>void} [opts.onInfra]  señal o limitación que empieza o termina
 */
export function applySnapshot(engine, snap, { lag = 0, own = null, onInfra = () => {} } = {}) {
  const ls = engine.line(snap.line);
  const traffic = ls.traffic;
  const seen = new Set();
  for (const rec of snap.u) {
    if (own && rec.i === own.id) { seen.add(own); continue; }
    let u = traffic.units.find(x => x.id === rec.i);
    if (!u) {
      // Un tren que aquí no existe: se crea si sigue faltando (las maniobras de retorno pueden ir desfasadas un instante)
      const wait = (ls.pendingSpawn ??= new Map());
      const n = (wait.get(rec.i) || 0) + 1;
      wait.set(rec.i, n);
      if (n < SPAWN_DELAY) continue;
      wait.delete(rec.i);
      u = spawn(ls, rec);
      if (!u) continue;
    }
    seen.add(u);
    u.missing = 0;
    applyUnit(u, rec, lag);
  }
  ls.pendingSpawn?.forEach((_, id) => { if (!snap.u.some(r => r.i === id)) ls.pendingSpawn.delete(id); });
  for (const u of [...traffic.units]) {
    if (seen.has(u) || u === own) continue;
    u.missing = (u.missing || 0) + 1;
    if (u.missing >= MISSING_LIMIT) traffic.removeUnit(u);
  }
  applyInfra(ls, snap, onInfra);
}

/** Crea en la réplica un tren que existe en el anfitrión. */
function spawn(ls, rec) {
  const route = ls.routes.find(r => r.id === rec.r);
  if (!route) return null;
  const trip = ls.timetables.get(route.id).trips.find(t => t.id === rec.i) || (rec.h ? makeTrip(route, rec.h.dep, rec.h.ex) : null);
  if (!trip) return null;
  const u = ls.traffic.createUnit(trip, { start: rec.p });
  if (!rec.o) { u.ato = null; u.puppet = true; }     // otro conductor: se mueve solo con su estado
  if (rec.h) u.remote = { name: rec.h.name };
  return u;
}

function applyUnit(u, rec, lag) {
  const sim = u.sim;
  // Coordenadas de ruta: el tren avanza hacia −Z (velocidad positiva = avanza)
  const target = rec.p - rec.v * lag;
  const err = target - sim.position;
  sim.position = Math.abs(err) > SNAP_JUMP ? target : sim.position + err * BLEND;
  sim.velocity = rec.v;
  sim.accel = rec.a;
  sim.notch = rec.n;
  sim.reverser = rec.rv;
  sim.doorState = rec.ds;
  if (rec.x) u.crossing = true;                    // (deja de cruzar sola en traffic.update al pasar las agujas)
  sim.doorProgress = rec.dp;
  u.load = rec.l;
  u.delay = rec.d;
  if (u.ato && rec.o) {
    Object.assign(u.ato, rec.o);
    sim.autoDemand = rec.ad;
  } else if (u.puppet) sim.autoDemand = null;
}

/** Señales averiadas y limitaciones: deja las mismas que el anfitrión. */
function applyInfra(ls, snap, onInfra) {
  for (const route of ls.routes) {
    const faults = new Set(snap.f.filter(f => f.r === route.id).map(f => f.s));
    for (const s of ls.signals.get(route.id).signals) {
      if (!!s.fault === faults.has(s.id)) continue;
      s.fault = faults.has(s.id);
      if (!s.fault) s.permit = null;
      onInfra(s.fault ? "faultStart" : "faultEnd", { route, signal: s });
    }
    const zones = snap.z.filter(z => z.r === route.id);
    for (const zone of [...route.restrictions]) {
      if (zones.some(z => z.k === zone.key)) continue;
      route.restrictions.splice(route.restrictions.indexOf(zone), 1);
      onInfra("zoneEnd", { route, zone });
    }
    for (const z of zones) {
      if (route.restrictions.some(x => x.key === z.k)) continue;
      const zone = { from: z.from, to: z.to, kmh: z.kmh, label: z.label, key: z.k };
      route.restrictions.push(zone);
      onInfra("zoneStart", { route, zone });
    }
  }
}

/* ----- Conductor → anfitrión ----- */

/** Estado del tren propio. */
export function ownState(engine, unit) {
  const s = unit.sim;
  return {
    t: engine.time, i: unit.id, r: unit.route.id, p: r2(s.position), v: r2(s.velocity), a: r2(s.accel),
    n: s.notch, rv: s.reverser, ds: s.doorState, dp: r2(s.doorProgress), d: Math.round(unit.delay || 0),
  };
}

/** El anfitrión copia el estado del tren de un conductor (el motor lo extrapola entre mensajes). */
export function applyOwnState(unit, st, lag = 0) {
  applyUnit(unit, { ...st, l: unit.load, d: st.d }, lag);
  unit.sim.autoDemand = null;
}

/* ----- Anfitrión: servicios de los conductores ----- */

/**
 * Elige el servicio de un conductor que entra a la sala: el próximo que aún
 * no sale y que deja tiempo para cargar el juego. Lo reserva (el tráfico ya
 * no lo lanza como tren automático).
 */
export function reserveTrip(engine, route, minLead = 45) {
  const ls = engine.line(route), traffic = ls.traffic;
  const trip = ls.timetables.get(route.id).trips.find(t => !traffic.started.has(t.id) && t.departure - engine.time >= minLead)
    || makeTrip(route, Math.ceil((engine.time + minLead + 120) / 60) * 60);
  traffic.started.add(trip.id);
  return trip;
}

/**
 * Dónde aparece el tren del conductor: en el andén de origen si está libre;
 * si no, en la cochera, y entra al andén cuando la señal lo deje.
 */
export function startPoint(engine, route) {
  const busy = engine.line(route).traffic.units.some(u => u.route === route && u.sim.position > route.first.stopZ - 250);
  return busy ? route.track.depotZ : route.first;
}

/** Servicio por sus datos (del horario si está; si no, se arma igual que en el otro motor). */
export function tripFrom(engine, { id, r, dep, ex = null }) {
  const ls = [...engine.lines.values()].find(l => l.routes.some(x => x.id === r));
  if (!ls) return null;
  const route = ls.routes.find(x => x.id === r);
  return ls.timetables.get(r).trips.find(t => t.id === id) || makeTrip(route, dep, ex);
}

/** Datos de un servicio para mandarlo por la red. */
export const tripData = (trip) => ({ id: trip.id, r: trip.route.id, dep: trip.departure, ex: trip.express ?? null });

/**
 * El conductor se fue de la sala: su tren sigue como tren automático hasta
 * su próxima parada (o se retira si ya terminó su recorrido).
 */
export function handOverToAto(engine, unit) {
  const traffic = engine.line(unit.route).traffic;
  if (!traffic.units.includes(unit)) return;
  unit.remote = null;
  unit.isPlayer = false;
  const sim = unit.sim, last = unit.route.stations.length - 1;
  const docked = sim.isStopped ? sim.dockedStation() : null;
  const next = sim.nextStation();
  if (!docked && !next) { traffic.removeUnit(unit); return; }       // en la cola de maniobras: a cocheras
  unit.ato = traffic.makeDriver(unit, docked ? docked.index : next.index);
  if (docked) {
    // Detenido en un andén: parada normal desde ahora
    unit.ato.arrivedAt = engine.time;
    unit.ato.state = docked.index === last ? "retire" : sim.doorState === "closed" ? "ready" : "dwell";
    if (sim.doorState === "closing") unit.ato.state = "closing";
  }
}
