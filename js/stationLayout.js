/* ==========================================================================
   MetroSim — stationLayout.js
   Mobiliario fijo de los andenes, en un solo lugar para que el dibujo
   (world.js), el pasajero (walker.js) y los viajeros (people.js) usen
   exactamente las mismas posiciones: nadie atraviesa columnas ni bancos.

   Cotas z relativas al centro de la estación; x en valor absoluto (cada
   andén es el espejo del otro).
   ========================================================================== */

import { CONFIG } from "./config.js";
import { routeForSide } from "./engine/route.js";

const MZ = CONFIG.mezzanine;

/** ¿Cae esta cota en la zona de la escalera (sin columnas ni bancos)? */
const inStairs = (off) => off > MZ.stairZ0 - 3 && off < MZ.stairZ1 + 2;

/** Columnas del andén (cada 12 m, a lo largo de los 125 m) y bancos (entre columnas). */
export const PLATFORM_COLUMNS = [];
export const PLATFORM_BENCHES = [];
for (let off = CONFIG.station.platformZ0 + 5; off <= CONFIG.station.platformZ1 - 4; off += 12) {
  if (inStairs(off)) continue;
  PLATFORM_COLUMNS.push(off);
  const bz = off + 6;
  if (bz < CONFIG.station.platformZ1 - 3 && !inStairs(bz)) PLATFORM_BENCHES.push(bz);
}

export const COLUMN_X = 6.0, COLUMN_HALF = 0.21;
export const BENCH_X = 7.95, BENCH_HALF_DEPTH = 0.23, BENCH_HALF_LEN = 0.9;

/** Pantallas de próximo tren: entre columnas y lejos de los carteles de dirección. */
export const PID_OFFSETS = [10, -16, -40, -64];

/**
 * Pasillo libre del andén por el que caminan los viajeros: entre la línea
 * amarilla y las columnas, sin ningún objeto.
 */
export const PLATFORM_LANE_X = 4.95;

/**
 * ¿Hay un objeto sólido del andén en (x, dz)?
 * @param {number} x   coordenada x del mundo
 * @param {number} dz  z relativa al centro de la estación
 * @param {number} r   radio de la persona
 */
export function platformSolidAt(x, dz, r = 0.25) {
  const ax = Math.abs(x);
  if (Math.abs(ax - COLUMN_X) < COLUMN_HALF + r) {
    for (const c of PLATFORM_COLUMNS) if (Math.abs(dz - c) < COLUMN_HALF + r) return true;
  }
  if (ax > BENCH_X - BENCH_HALF_DEPTH - r) {
    for (const b of PLATFORM_BENCHES) if (Math.abs(dz - b) < BENCH_HALF_LEN + r) return true;
  }
  return false;
}

/**
 * Andén de solo llegada: en una terminal, el andén del sentido que termina
 * ahí. No hay servicio desde él, así que no se puede bajar a él desde la
 * mezanina (solo se sale).
 */
export function isArrivalOnly(st, side) {
  const route = routeForSide(side);
  return route.stationOf(st) === route.last;
}
