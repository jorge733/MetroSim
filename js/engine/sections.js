/* ==========================================================================
   MetroSim — Motor · sections.js
   1.5 · Tramos de la vía: TÚNEL, TRINCHERA o VIADUCTO.

   No todo el Metro de Santiago es subterráneo:
     · L4: viaducto de ~7 km sobre el bandejón central de Vicuña Mackenna
       (de Vicuña Mackenna a Protectora de la Infancia) y trinchera abierta
       en Américo Vespucio (Los Presidentes … Macul);
     · L4A: trinchera en el bandejón de Américo Vespucio Sur;
     · L5: viaducto en Vicuña Mackenna (Rodrigo de Araya … Bellavista de La
       Florida) y en Pudahuel/Maipú (Pudahuel … Del Sol);
     · L2: trinchera junto a la autopista Central (El Llano … Lo Ovalle).
   (Tramos APROXIMADOS; ver network.js → sections de cada línea.)

   Cada línea declara qué estaciones están en viaducto o en trinchera; el
   resto es subterráneo. Entre dos estaciones de distinto tipo la vía hace
   la transición a mitad de camino: de un viaducto a un túnel se baja
   primero a una trinchera (rampa) y luego se entra al túnel por un portal.

   Al aire libre el tren ve el cielo, la lluvia moja el riel (weather.js) y
   el perfil cambia: las estaciones en viaducto quedan ~9 m sobre la calle
   y las de trinchera ~7 m bajo ella (profile.js).
   Lógica pura (sin Three.js).
   ========================================================================== */

import { CONFIG } from "../config.js";

/** Tipos de tramo. */
export const SECTION_LABEL = { tunel: "túnel", trinchera: "trinchera", viaducto: "viaducto" };

/** Tipo de cada estación de la línea ("tunel" si no está en ningún tramo declarado). */
function stationLevels(line) {
  const levels = line.stations.map(() => "tunel");
  for (const s of line.sections || []) {
    const a = line.stations.findIndex(st => st.name === s.from), b = line.stations.findIndex(st => st.name === s.to);
    if (a < 0 || b < 0) continue;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) levels[i] = s.type;
  }
  return levels;
}

/**
 * Tramos de una línea en coordenadas del mundo.
 * @returns {{ spans: Array<{zA:number, zB:number, type:string}>, levels: string[], typeAt(z):string, exposedAt(z):boolean }}
 *          spans ordenados de mayor a menor z (zA > zB), contiguos
 */
export function buildSections(line) {
  const st = line.stations, S = CONFIG.station;
  const levels = stationLevels(line);
  const cuts = [];                                    // [z, tipo desde ahí hacia −Z]
  cuts.push([Infinity, levels[0]]);
  for (let i = 0; i < st.length - 1; i++) {
    const ta = levels[i], tb = levels[i + 1];
    if (ta === tb) continue;
    const zA = st[i].z + S.hallZ0, zB = st[i + 1].z + S.hallZ1;   // fin del vestíbulo de A, inicio del de B
    const at = (f) => zA - (zA - zB) * f;
    if (ta === "viaducto" && tb === "tunel") { cuts.push([at(0.35), "trinchera"], [at(0.5), "tunel"]); }
    else if (ta === "tunel" && tb === "viaducto") { cuts.push([at(0.5), "trinchera"], [at(0.65), "viaducto"]); }
    else cuts.push([at(0.5), tb]);
  }
  const spans = [];
  for (let k = 0; k < cuts.length; k++) {
    const zA = cuts[k][0], zB = k + 1 < cuts.length ? cuts[k + 1][0] : -Infinity;
    spans.push({ zA, zB, type: cuts[k][1] });
  }

  function typeAt(z) {
    for (const s of spans) if (z <= s.zA && z > s.zB) return s.type;
    return spans.at(-1).type;
  }

  return {
    spans,
    levels,
    typeAt,
    exposedAt: (z) => typeAt(z) !== "tunel",
    /** ¿Tiene la línea algún tramo al aire libre? */
    hasExposed: spans.some(s => s.type !== "tunel"),
  };
}
