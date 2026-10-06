/* ==========================================================================
   MetroSim — Motor · schedule.js
   Horario (malla de servicio) de cada sentido de cada línea.

   · Tiempo de recorrido entre estaciones (1.1): se calcula SIMULANDO la
     marcha con la misma física (sim.js) y la misma conducción automática
     (ATO con deriva) que usan los trenes, con una carga media de viajeros
     y las pendientes reales de la vía. Así el horario es alcanzable de
     verdad. Se le suma un margen de regularidad (+4 %), como hacen los
     operadores reales para poder recuperar pequeños retrasos.
   · Intervalo entre trenes: cada línea tiene su intervalo de punta
     (network.js, derivado de su flota y su tiempo de vuelta) y se alarga
     cuando baja la demanda (valle, noche, fin de semana).
   · Horario comercial según el tipo de día (config.js → SERVICE_HOURS).
     Fuera de él el juego mantiene un servicio simbólico cada 15 min para
     que siempre se pueda jugar (en la realidad el Metro está cerrado).
   · Cada servicio (trip) tiene hora de llegada (arr) y salida (dep) en cada
     estación de su ruta (índices en el orden de la ruta).
   ========================================================================== */

import { CONFIG, demandAt, inService } from "../config.js";
import { formatClock } from "./format.js";
import { TrainSim, AutoDriver } from "./sim.js";

const MARGIN = 1.04;         // margen de regularidad (+4 %)
const FIXED = 3;             // segundos fijos por aproximación final a la marca
/** Viajeros a bordo supuestos para calcular la marcha tipo. */
const PROFILE_LOAD = 600;

/* ==========================================================================
   Marchas tipo (perfiles de velocidad simulados)
   ========================================================================== */

const PROFILES = new WeakMap();

/**
 * Marcha tipo de cada interestación de una ruta: tiempo total y puntos
 * { z, t, v } cada segundo. segs[i] = de la estación i−1 a la i (segs[0] = null).
 */
export function routeProfile(route) {
  let segs = PROFILES.get(route);
  if (segs) return segs;
  segs = [null];
  const dt = 0.25;
  for (let i = 1; i < route.stations.length; i++) {
    const sim = new TrainSim(route, () => {}, route.stations[i - 1]);
    sim.load = PROFILE_LOAD;
    const ato = new AutoDriver(sim, { targetIndex: i });
    let t = 0, nextSample = 0;
    const pts = [];
    while (ato.state === "running" && t < 1200) {
      if (t >= nextSample) { pts.push({ z: sim.position, t, v: sim.speed }); nextSample += 1; }
      ato.update(dt, 0);
      sim.update(dt);
      t += dt;
    }
    pts.push({ z: sim.position, t, v: 0 });
    const vmax = Math.max(...pts.map(p => p.v));
    segs.push({ time: t, pts, vmax, energy: sim.energy.traction - sim.energy.regen });
  }
  PROFILES.set(route, segs);
  return segs;
}

/** Tiempo de recorrido del horario (s) entre la estación i−1 y la i de una ruta. */
export function segmentRunTime(route, i) {
  return Math.round(routeProfile(route)[i].time * MARGIN + FIXED);
}

/**
 * Tiempo que le queda (s) a un tren en la coordenada z, con velocidad v, para
 * llegar parado a la estación de índice i de su ruta, según la marcha tipo.
 * Si va más lento que la marcha tipo en ese punto (detenido ante una señal,
 * limitación temporal...) se suma lo que tarda en recuperar.
 */
export function remainingRunTime(route, z, i, v = 0) {
  const seg = routeProfile(route)[i], to = route.stations[i];
  const from = route.stations[i - 1];
  if (!seg || z > from.stopZ + 1 || z < to.stopZ - 1) return travelTime(route, z, to.stopZ, v) + FIXED;
  const pts = seg.pts;
  let k = 0;
  while (k < pts.length - 1 && pts[k + 1].z > z) k++;
  const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)];
  const f = a.z === b.z ? 0 : clamp01((a.z - z) / (a.z - b.z));
  const tAt = a.t + (b.t - a.t) * f, vAt = a.v + (b.v - a.v) * f;
  const lag = Math.max(0, vAt - v) / 0.9 * 0.55;                 // recuperar la velocidad perdida
  return Math.max(0, seg.time - tAt) * MARGIN + lag + FIXED;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* ==========================================================================
   Modelo cinemático simple (para tramos fuera de las marchas tipo:
   cocheras, colas de maniobra)
   ========================================================================== */

const ACCEL = 0.8, DECEL = 0.75;

/** Velocidad de crucero (m/s) en un tramo de la ruta, respetando el límite más restrictivo. */
function cruiseSpeed(route, zFrom, zTo) {
  let kmh = CONFIG.defaultSpeedLimit;
  for (const s of route.limits) if (s.from > zTo && s.to < zFrom) kmh = Math.min(kmh, s.kmh);
  kmh = Math.min(kmh, route.speedLimitAt((zFrom + zTo) / 2));
  return (kmh - 3) / 3.6;
}

/**
 * Tiempo puro de marcha (s) de zFrom a zTo terminando parado,
 * empezando a velocidad v0 (m/s): acelera hasta el crucero, mantiene y frena.
 */
export function travelTime(route, zFrom, zTo, v0 = 0) {
  const d = zFrom - zTo;
  if (d <= 0) return 0;
  const v = cruiseSpeed(route, zFrom, zTo);
  v0 = Math.min(v0, v);
  const dAcc = (v * v - v0 * v0) / (2 * ACCEL), dDec = (v * v) / (2 * DECEL);
  if (d >= dAcc + dDec) return (v - v0) / ACCEL + v / DECEL + (d - dAcc - dDec) / v;
  // Tramo corto: no llega al crucero
  const vPeak = Math.sqrt((2 * d * ACCEL * DECEL + v0 * v0 * DECEL) / (ACCEL + DECEL));
  if (vPeak <= v0) return (2 * d) / Math.max(v0, 0.1);              // ya va frenando
  return (vPeak - v0) / ACCEL + vPeak / DECEL;
}

/** Tiempo de recorrido del horario (s) entre dos puntos de parada de una ruta (modelo simple). */
export function runTime(route, zFrom, zTo) {
  return Math.round(travelTime(route, zFrom, zTo, 0) * MARGIN + FIXED);
}

/* ==========================================================================
   Paradas, intervalos y servicios
   ========================================================================== */

/** Tiempo de parada previsto (s) en una estación: mínimo del ATO, puertas y más tiempo con más gente. */
function dwellTime(st, clock) {
  const busy = st.weight ?? (1 + 0.5 * st.combos.length);
  return Math.round(CONFIG.schedule.minDwell + 4 + demandAt(clock) * 9 * Math.min(busy, 1.8) + (st.combos.length ? 6 : 0));
}

/**
 * Intervalo entre trenes (s) a una hora, para una línea: el de punta con la
 * demanda más alta y más largo cuanto menor sea la demanda.
 */
export function headwayAt(clock, line = null) {
  if (!inService(clock)) return CONFIG.schedule.nightHeadway;
  const peak = line?.peakHeadway ?? CONFIG.schedule.peakHeadway;
  const d = demandAt(clock);
  const factor = d >= 0.8 ? 1 : d >= 0.55 ? 1.3 : d >= 0.35 ? 1.7 : d >= 0.2 ? 2.2 : 2.8;
  return Math.round(Math.min(peak * factor, 720) / 10) * 10;
}

/** Servicio con horas de llegada y salida en cada estación de la ruta. */
export function makeTrip(route, departure) {
  const st = route.stations;
  const arr = [], dep = [];
  arr[0] = departure - 60;
  dep[0] = departure;
  for (let i = 1; i < st.length; i++) {
    arr[i] = dep[i - 1] + segmentRunTime(route, i);
    dep[i] = arr[i] + dwellTime(st[i], arr[i]);
  }
  const hhmm = formatClock(departure).slice(0, 5).replace(":", "");
  return { id: `${route.tripPrefix}-${hhmm}`, route, departure, arr, dep, commercial: inService(departure) };
}

export class Timetable {
  /**
   * Genera los servicios del día de una ruta.
   * @param {object} route  ruta (sentido)
   * @param {number} anchor hora de salida de referencia (a partir de ella se reparte el intervalo)
   */
  constructor(route, anchor, from = 6 * 3600, to = 23 * 3600) {
    this.route = route;
    const line = route.line;
    const deps = [anchor];
    for (let t = anchor; t > from;) { t -= headwayAt(t, line); deps.unshift(t); }
    for (let t = anchor; t < to;) { t += headwayAt(t, line); deps.push(t); }
    this.trips = deps.map(d => makeTrip(route, d));
    // (dos salidas en el mismo minuto tendrían el mismo id: se distinguen con una letra)
    const seen = new Map();
    for (const t of this.trips) {
      const n = seen.get(t.id) || 0;
      seen.set(t.id, n + 1);
      if (n) t.id += String.fromCharCode(96 + n);
    }
    this.anchorTrip = this.trips.find(t => t.departure === anchor);
  }

  /** Servicios cuya entrada en servicio (salida de cocheras) cae en [t0, t1). */
  tripsStartingBetween(t0, t1) {
    return this.trips.filter(t => t.departure - 150 >= t0 && t.departure - 150 < t1);
  }

  /** Servicios futuros (no iniciados aún) que pasarán por una estación tras "clock". */
  upcomingAt(stIndex, clock, excludeIds) {
    return this.trips
      .filter(t => !excludeIds.has(t.id) && t.arr[stIndex] > clock)
      .slice(0, 3);
  }

  /** Total de minutos de recorrido de punta a punta (informativo). */
  get fullRunMinutes() {
    const t = this.trips[0];
    return Math.round((t.arr.at(-1) - t.dep[0]) / 60);
  }
}

/** Formato de retraso: "+1:05", "−0:20", "0:00". */
export function formatDelay(seconds) {
  const s = Math.round(seconds);
  const sign = s > 0 ? "+" : s < 0 ? "−" : "";
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}
