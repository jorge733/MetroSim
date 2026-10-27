/* ==========================================================================
   MetroSim — Motor · express.js
   1.5 · RUTA EXPRESA (líneas 2, 4 y 5).

   En hora punta de los días laborales (06:00–09:00 y 18:00–21:00) los
   trenes de estas líneas alternan dos rutas:
     · RUTA ROJA  → se detiene en las estaciones rojas y en las comunes;
     · RUTA VERDE → se detiene en las verdes y en las comunes.
   Las estaciones comunes (combinaciones, terminales y las más concurridas)
   las sirven todos los trenes. Así cada tren se salta casi la mitad de las
   paradas y el viaje largo es más rápido; a cambio, en una estación roja o
   verde pasa un tren cada dos. Fuera de esos horarios todos paran en todas.

   Los colores de cada estación están en network.js (express de cada línea).
   Lógica pura (sin Three.js).
   ========================================================================== */

import { CONFIG } from "../config.js";

/** Franjas de la Ruta Expresa (horas, días laborales). */
export const EXPRESS_HOURS = [[6, 9], [18, 21]];

/** Texto y color de cada ruta. */
export const EXPRESS_LABEL = {
  roja:  { name: "RUTA ROJA",  short: "ROJA",  color: "#d42026" },
  verde: { name: "RUTA VERDE", short: "VERDE", color: "#16a34a" },
  comun: { name: "ESTACIÓN COMÚN", short: "COMÚN", color: "#f2c230" },
};

/** ¿Funciona la Ruta Expresa a esta hora (s) en esta línea? */
export function expressActive(clock, line, dayType = CONFIG.dayType) {
  if (!line?.express || dayType !== "laboral") return false;
  const h = (clock / 3600) % 24;
  return EXPRESS_HOURS.some(([a, b]) => h >= a && h < b);
}

/** Color de una estación en la Ruta Expresa: "roja" | "verde" | "comun" (o null si la línea no tiene). */
export function stationColor(line, station) {
  const ex = line?.express;
  if (!ex) return null;
  const name = station?.name ?? station;
  if (ex.roja.includes(name)) return "roja";
  if (ex.verde.includes(name)) return "verde";
  return "comun";
}

/** ¿Un tren de esta ruta expresa ("roja" | "verde" | null) se detiene en esta estación? */
export function stopsAt(line, station, pattern) {
  if (!pattern) return true;
  const c = stationColor(line, station);
  return c === null || c === "comun" || c === pattern;
}

const SKIPS = new Map();
/**
 * Índices (de la ruta) de las estaciones que se salta un patrón expreso.
 * Nunca se salta la primera ni la última.
 */
export function skipSet(route, pattern) {
  if (!pattern) return null;
  const key = `${route.id}|${pattern}`;
  if (SKIPS.has(key)) return SKIPS.get(key);
  const set = new Set();
  route.stations.forEach((st, i) => {
    if (i > 0 && i < route.stations.length - 1 && !stopsAt(route.line, st, pattern)) set.add(i);
  });
  SKIPS.set(key, set);
  return set;
}

/** ¿Se detiene este servicio (trip) en la estación de índice i de su ruta? */
export const tripStopsAt = (trip, i) => !trip?.skip || !trip.skip.has(i);

/** Próxima parada del servicio después del índice i (o el último índice). */
export function nextStopIndex(trip, i, last) {
  let k = i + 1;
  while (k < last && !tripStopsAt(trip, k)) k++;
  return Math.min(k, last);
}
