/* ==========================================================================
   MetroSim — Motor · eta.js
   Hora estimada de llegada (ETA) calculada desde la POSICIÓN REAL del tren.

   Antes el "próximo tren" se sacaba del horario más el último retraso
   conocido. Ahora se mira dónde está el tren y a qué velocidad va, y se
   suma tramo a tramo:
     · lo que le queda en la estación donde está (puertas y hora de salida),
     · el tiempo de marcha hasta cada parada, según la marcha tipo simulada
       del horario (schedule.js → remainingRunTime) desde su posición y su
       velocidad actuales,
     · la parada en cada estación intermedia (no sale antes de su hora).
   Así, si un tren se retiene en una estación o queda parado ante una señal,
   las pantallas de los andenes de más adelante lo notan enseguida.
   ========================================================================== */

import { CONFIG } from "../config.js";
import { remainingRunTime } from "./schedule.js";

/** Segundos extra por cada parada intermedia (cierre de puertas y arranque). */
const LEG_EXTRA = 2;

/**
 * Hora estimada de llegada de un tren a una parada de su ruta.
 * @param {object} u    unidad del tráfico
 * @param {object} rs   estación de la ruta del tren
 * @param {number} clock
 * @returns {number|null} hora (s desde medianoche); null si el tren ya pasó o no irá
 */
export function estimateArrival(u, rs, clock) {
  const sim = u.sim, route = u.route, trip = u.trip;
  const tol = CONFIG.station.stopTolerance;
  const ato = u.ato?.state;
  if (rs.route !== route) return null;
  if (ato === "retire" || ato === "retired") return null;           // ya terminó su recorrido
  if (sim.position < rs.stopZ - tol) return null;                    // ya pasó

  const docked = sim.isStopped ? sim.dockedStation() : null;
  if (docked === rs) return clock;                                   // está en el andén

  let t = clock;
  if (ato === "depot") t = Math.max(t, u.ato.holdUntil ?? t);        // espera su hora de entrada
  if (docked) t = departureFrom(u, docked, t);                       // le queda la parada actual

  let z = sim.position, v = docked ? 0 : sim.speed;
  for (const st of route.stations) {
    if (st.stopZ >= z - tol) continue;                               // detrás del tren
    t += remainingRunTime(route, z, st.index, v);
    if (st === rs) return t;
    t = Math.max(t + CONFIG.schedule.minDwell + CONFIG.train.doorTime + LEG_EXTRA, trip?.dep[st.index] ?? 0);
    z = st.stopZ;
    v = 0;
  }
  return null;
}

/** Hora a la que un tren estacionado saldrá de la estación. */
function departureFrom(u, st, clock) {
  const sim = u.sim, doorTime = CONFIG.train.doorTime;
  let t = clock;
  if (sim.doorState === "open" || sim.doorState === "opening") t += doorTime + 1;
  else if (sim.doorState === "closing") t += sim.doorProgress * doorTime;
  return Math.max(t, u.trip?.dep[st.index] ?? t, u.ato?.regulateUntil || t);
}
