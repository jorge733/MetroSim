/* ==========================================================================
   MetroSim — Motor · schedule.js
   Horario (malla de servicio) de la Línea 3.

   · Tiempo de recorrido entre estaciones: estimado con un modelo cinemático
     (aceleración, crucero respetando límites, frenado) más un margen de
     regularidad, igual que hacen los operadores reales.
   · Intervalo entre trenes según la demanda: 4 min en punta, 6 min el resto.
   · Cada servicio (trip) tiene hora de llegada (arr) y salida (dep) en cada
     estación de su ruta (índices en el orden de la ruta).
   · Hay una malla por sentido. La de ida (A) está anclada a tu servicio, que
     sale de Plaza Quilicura a las 08:01:30; la de vuelta (B), desfasada 2 min.
   ========================================================================== */

import { CONFIG, demandAt } from "../config.js";
import { formatClock } from "./format.js";

const ACCEL = 0.72;          // aceleración media efectiva (m/s²)
const DECEL = 0.62;          // deceleración media de servicio (m/s²)
const MARGIN = 1.07;         // margen de regularidad (+7 %)
const FIXED = 6;             // segundos fijos por aproximación final y arranque

/** Velocidad de crucero (m/s) en un tramo de la ruta, respetando el límite más restrictivo. */
function cruiseSpeed(route, zFrom, zTo) {
  let kmh = CONFIG.defaultSpeedLimit;
  for (const s of route.limits) if (s.from > zTo && s.to < zFrom) kmh = Math.min(kmh, s.kmh);
  kmh = Math.min(kmh, route.speedLimitAt((zFrom + zTo) / 2));
  return (kmh - 4) / 3.6;
}

/**
 * Tiempo puro de marcha (s, sin márgenes) de zFrom a zTo terminando parado,
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

/** Tiempo de recorrido del horario (s) entre dos puntos de parada de una ruta. */
export function runTime(route, zFrom, zTo) {
  return Math.round(travelTime(route, zFrom, zTo, 0) * MARGIN + FIXED);
}

/** Tiempo de parada (s) en una estación según demanda y combinaciones. */
function dwellTime(st, clock) {
  const base = CONFIG.schedule.minDwell + Math.round(demandAt(clock) * 10);
  return base + (st.combos.length ? 10 : 0);
}

export function headwayAt(clock) {
  return demandAt(clock) > 0.6 ? CONFIG.schedule.peakHeadway : CONFIG.schedule.offPeakHeadway;
}

/** Servicio con horas de llegada y salida en cada estación de la ruta. */
export function makeTrip(route, departure) {
  const st = route.stations;
  const arr = [], dep = [];
  arr[0] = departure - 60;
  dep[0] = departure;
  for (let i = 1; i < st.length; i++) {
    arr[i] = dep[i - 1] + runTime(route, st[i - 1].stopZ, st[i].stopZ);
    dep[i] = arr[i] + dwellTime(st[i], arr[i]);
  }
  const hhmm = formatClock(departure).slice(0, 5).replace(":", "");
  return { id: `${route.tripPrefix}-${hhmm}`, route, departure, arr, dep };
}

export class Timetable {
  /**
   * Genera los servicios del día de una ruta.
   * @param {object} route  ruta (sentido)
   * @param {number} anchor hora de salida de referencia (a partir de ella se reparte el intervalo)
   */
  constructor(route, anchor, from = 6 * 3600, to = 23 * 3600) {
    this.route = route;
    const deps = [anchor];
    for (let t = anchor; t > from;) { t -= headwayAt(t); deps.unshift(t); }
    for (let t = anchor; t < to;) { t += headwayAt(t); deps.push(t); }
    this.trips = deps.map(d => makeTrip(route, d));
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
