/* ==========================================================================
   MetroSim — Motor · network.js
   La RED de Metro: qué líneas existen y cómo se conectan.

   Cada línea tiene sus estaciones en sus propias coordenadas (la primera en
   z = 0 y avanza hacia −Z). El motor simula todas las líneas a la vez con el
   mismo reloj; el dibujo 3D, por ahora, solo muestra la Línea 3.

   Combinaciones: dos líneas se conectan en las estaciones con el mismo
   nombre (por ejemplo Ñuñoa, L3 ⇄ L6). Por ahí pasa gente de una línea a
   la otra (transbordos), así que lo que pasa en una afecta a la otra.

   Las distancias de la L6 son APROXIMADAS; el orden, los nombres y las
   combinaciones son reales.
   ========================================================================== */

import { STATIONS, LINE, WORLD_SPEED_LIMITS, LINE_COLORS } from "../config.js";

/** Convierte una lista { name, short, gap, combos } en estaciones con z, índice e id. */
function buildStations(data, lineId) {
  let acc = 0;
  return data.map((s, index) => {
    acc += s.gap;
    return {
      ...s,
      id: `${lineId}-` + s.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-"),
      index,
      combos: s.combos || [],
      z: -acc,
      km: acc / 1000,
    };
  });
}

/* ---------- Línea 3 (la que se dibuja: usa las estaciones de config.js) ---------- */
export const L3 = {
  id: "3",
  name: LINE.name,
  color: LINE.color,
  stations: STATIONS,
  speedLimits: WORLD_SPEED_LIMITS,
  routeIds: ["A", "B"],                 // ids históricos de los sentidos de la L3
  tripPrefix: ["L3", "L3V"],
  signalPrefix: ["1", "2"],             // señales 1xx (vía 1) y 2xx (vía 2)
  scheduleOffset: 0,                    // desfase de su malla respecto a la de referencia
};

/* ---------- Línea 6 (simulada sin dibujo): Cerrillos → Los Leones ---------- */
const L6_DATA = [
  { name: "CERRILLOS",                    short: "CERRILLOS",        gap: 0 },
  { name: "LO VALLEDOR",                  short: "LO VALLEDOR",      gap: 1900 },
  { name: "PRESIDENTE PEDRO AGUIRRE CERDA", short: "P. A. CERDA",    gap: 1500 },
  { name: "FRANKLIN",                     short: "FRANKLIN",         gap: 2400, combos: ["2"] },
  { name: "BIO BÍO",                      short: "BIO BÍO",          gap: 950 },
  { name: "ÑUBLE",                        short: "ÑUBLE",            gap: 1150, combos: ["5"] },
  { name: "ESTADIO NACIONAL",             short: "E. NACIONAL",      gap: 1600 },
  { name: "ÑUÑOA",                        short: "ÑUÑOA",            gap: 1200, combos: ["3"] },
  { name: "INÉS DE SUÁREZ",               short: "I. DE SUÁREZ",     gap: 1450 },
  { name: "LOS LEONES",                   short: "LOS LEONES",       gap: 1700, combos: ["1"] },
];

export const L6 = {
  id: "6",
  name: "LÍNEA 6",
  color: LINE_COLORS["6"],
  stations: buildStations(L6_DATA, "6"),
  speedLimits: [],
  routeIds: ["6A", "6B"],
  tripPrefix: ["L6", "L6V"],
  signalPrefix: ["61", "62"],
  scheduleOffset: 75,                   // sus trenes salen 75 s después que los de la L3
};

/** Todas las líneas de la red. La primera es la que se dibuja y se juega. */
export const LINES = [L3, L6];

/** Línea por id ("3", "6"). */
export const lineById = (id) => LINES.find(l => l.id === id) || null;

/**
 * Estaciones de combinación entre líneas simuladas:
 * [{ name, a: { line, station }, b: { line, station } }]
 */
export const TRANSFERS = [];
for (let i = 0; i < LINES.length; i++) {
  for (let j = i + 1; j < LINES.length; j++) {
    for (const sa of LINES[i].stations) {
      const sb = LINES[j].stations.find(s => s.name === sa.name);
      if (sb) TRANSFERS.push({ name: sa.name, a: { line: LINES[i], station: sa }, b: { line: LINES[j], station: sb } });
    }
  }
}

/** Estación de otra línea con la que se combina (o null). */
export function transferOf(line, station, otherLine) {
  const t = TRANSFERS.find(t =>
    (t.a.line === line && t.a.station === station && t.b.line === otherLine) ||
    (t.b.line === line && t.b.station === station && t.a.line === otherLine));
  if (!t) return null;
  return t.a.line === line ? t.b.station : t.a.station;
}
