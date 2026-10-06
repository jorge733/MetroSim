/* ==========================================================================
   MetroSim — Motor · profile.js
   Perfil longitudinal (cotas y pendientes) de cada línea.

   Un metro no es plano: el terreno de Santiago sube hacia la cordillera
   (de ~480 m en Quilicura o Maipú a más de 700 m en Las Condes) y, además,
   las líneas modernas se trazan en "diente de sierra": las estaciones
   quedan en lo alto y el túnel baja entre ellas. Así el tren arranca cuesta
   abajo (la gravedad ayuda a acelerar) y llega cuesta arriba (ayuda a
   frenar), lo que ahorra energía. Bajo el río Mapocho el túnel va más hondo.

   Reglas del trazado (como en la normativa ferroviaria):
     · las estaciones son horizontales (andén y vestíbulo a nivel);
     · la pendiente máxima en túnel es de 35 ‰;
     · entre estaciones se combina la diferencia de cota de las estaciones
       con una "olla" (sag) que se ajusta para no pasar del máximo.

   Las cotas son APROXIMADAS (terreno real de cada extremo y profundidad
   típica de 18–26 m); sirven para que la física tenga pendientes creíbles.
   La pendiente se siente en la física, se muestra en la DMI de la cabina y
   se VE en 3D: render/trackLift.js dobla el dibujo de la vía con estas cotas.

   Unidades: cotas en m s. n. m. del carril; pendiente como fracción (0,02 = 20 ‰),
   positiva cuesta ARRIBA en el sentido de avance.
   ========================================================================== */

import { CONFIG } from "../config.js";

/** Pendiente máxima admitida en túnel (fracción). */
export const MAX_GRADE = 0.035;
/** Zona horizontal alrededor de cada estación (m desde su centro, a cada lado). */
const FLAT_NEG = -CONFIG.station.hallZ0 + 10, FLAT_POS = CONFIG.station.hallZ1 + 10;   // lado −Z y lado +Z

/** Generador pseudoaleatorio determinista (mismo perfil en cada partida). */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Construye el perfil de una línea.
 * @param {object} line  línea de network.js (stations con z del mundo; terrain [cota inicial, cota final];
 *                       deep: { "NOMBRE A>NOMBRE B": metros extra de profundidad } para cruces de río)
 */
export function buildProfile(line) {
  const st = line.stations;
  const [e0, e1] = line.terrain || [520, 560];
  const span = st[0].z - st.at(-1).z || 1;

  // 1. Cota de carril de cada estación: terreno − profundidad (18–26 m)
  const elev = st.map(s => {
    const t = (st[0].z - s.z) / span;
    const ground = e0 + (e1 - e0) * t;
    return ground - (18 + 8 * hash(line.id + s.name));
  });

  // 2. Tramos entre estaciones: diferencia de cota acotada y "olla" central
  const segs = [];
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    const len = a.z - b.z - FLAT_NEG - FLAT_POS;                    // largo con pendiente (sin las estaciones)
    // Diferencia de cota: el perfil suavizado (smoothstep) tiene pendiente máxima 1,5·Δ/len
    const maxDelta = (MAX_GRADE * 0.75 * len) / 1.5;
    let delta = elev[i + 1] - elev[i];
    if (Math.abs(delta) > maxDelta) { delta = Math.sign(delta) * maxDelta; elev[i + 1] = elev[i] + delta; }
    // Olla: hasta 9 m (más bajo un río), sin pasar de la pendiente máxima
    const extra = line.deep?.[`${a.name}>${b.name}`] || 0;
    const room = (MAX_GRADE * len - 1.5 * Math.abs(delta)) / Math.PI;
    const sag = Math.max(0, Math.min(room, Math.min(9, len * 0.006) + extra));
    segs.push({ zStart: a.z - FLAT_NEG, zEnd: b.z + FLAT_POS, len, eA: elev[i], delta, sag });
  }

  /** Cota del carril (m) en una z del mundo de la línea. */
  function elevationAt(z) {
    if (z >= st[0].z) return elev[0];
    if (z <= st.at(-1).z) return elev.at(-1);
    // Búsqueda del tramo (las z decrecen a lo largo de la línea)
    let lo = 0, hi = st.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (st[mid].z >= z) lo = mid; else hi = mid; }
    const s = segs[lo];
    if (z >= s.zStart) return elev[lo];                            // zona plana de la estación de origen
    if (z <= s.zEnd) return elev[lo + 1];                          // zona plana de la de destino
    const u = (s.zStart - z) / s.len;
    const smooth = u * u * (3 - 2 * u);
    return s.eA + s.delta * smooth - s.sag * Math.sin(Math.PI * u) ** 2;
  }

  /** Derivada de la cota respecto de z del mundo (de/dz). */
  function slopeWorld(z) {
    return (elevationAt(z + 0.5) - elevationAt(z - 0.5));
  }

  return { elevationAt, slopeWorld, stationElevations: elev };
}
