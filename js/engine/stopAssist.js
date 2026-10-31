/* ==========================================================================
   MetroSim — Motor · stopAssist.js
   Asistente de parada: ayuda al conductor a no pasarse de la estación.

   Lógica pura (sin gráficos ni sonido). A partir del estado real del tren
   (velocidad, esfuerzo pedido, carga, pendiente y adherencia) calcula:

     · DÓNDE SE DETENDRÍA el tren si mantiene el punto de freno actual
       (integra la misma física simplificada de sim.js, con la limitación de
       jerk, la pendiente bajo el tren y el riel mojado al aire libre);
     · cuánto necesitaría con FRENO 1, 2 y 3, y qué punto conviene usar;
     · un AVISO para la DMI y el HUD:
         soon   → "prepárate": falta poco para el punto de frenado
         brake  → "FRENA": con FRENO 2 ya justo alcanzas
         more   → frenando, pero te pasarías: sube el freno
         short  → frenando de más: te quedarías antes, afloja
         ok     → la parada prevista cae en la marca
         late   → ni con FRENO 3 alcanzas: emergencia o te pasas
         passed → el testero ya rebasó la marca (fuera de tolerancia)

   No frena por el conductor ni cambia la puntuación: solo informa.
   Convención de signos como en el resto del juego: error > 0 = antes de la
   marca, error < 0 = pasado.
   ========================================================================== */

import { CONFIG, NOTCHES, NOTCH_INDEX } from "../config.js";
import { adhesionFor } from "./weather.js";
import { JERK } from "./sim.js";
import { clamp } from "./format.js";

const G = 9.81;
const DT = 0.1;                 // paso de la integración (s)
const MAX_T = 150;              // horizonte máximo (s)
/** Segundos de reacción que se suman al punto de frenado para avisar a tiempo. */
const REACTION = 2.0;
/** Antelación (s) del aviso "prepárate" respecto del punto de frenado. */
const PREPARE = 6.0;
/** Distancia máxima (m) a la marca a la que se activa el asistente (además del punto de frenado). */
const REACH = 1500;

const SERVICE = ["B1", "B2", "B3"].map(id => NOTCHES[NOTCH_INDEX[id]]);

/**
 * Distancia (m) que recorre el tren hasta detenerse si desde ahora se pide
 * una deceleración `decel` (m/s²), partiendo del esfuerzo actual (jerk).
 * @returns {number} metros (Infinity si no llega a detenerse en el horizonte)
 */
export function stoppingDistance(sim, decel, jerk = JERK) {
  let v = sim.velocity;
  if (v <= 0.01) return 0;
  const K = sim.stock, route = sim.route;
  const m = sim.mass, mEq = m * K.rotary;
  const half = CONFIG.train.length / 2;
  let a = sim.accel, x = 0, grade = sim.grade, mu = adhesionFor(K, sim.exposed);
  const target = -decel;
  for (let i = 0, n = MAX_T / DT; i < n; i++) {
    // La pendiente y el agarre cambian a lo largo del recorrido: se muestrean cada segundo
    if (i % 10 === 9) {
      const mid = sim.position - x + half;
      grade = route.gradeAt ? route.gradeAt(mid) : 0;
      mu = adhesionFor(K, !!route.exposedAt?.(mid));
    }
    a += clamp(target - a, -jerk * DT, jerk * DT);
    let traction = 0;
    if (a > 0) traction = Math.min(a * mEq, K.maxTractive, K.maxPower / Math.max(v, 0.5), mu * G * m * (K.motorCars / K.cars));
    const grip = mu * G * m, want = a < 0 ? -a * mEq : 0;
    const brake = want > grip * 1.02 ? grip * 0.92 : want;
    const resistance = K.rollingPerKg * m + K.davisB * v + K.davisC * v * v;
    const nv = v + ((traction - m * G * grade - brake - resistance) / mEq) * DT;
    if (nv <= 0) return x + (v * v / (v - nv)) * DT / 2;   // fracción del último paso hasta v = 0
    x += (v + nv) / 2 * DT;
    v = nv;
  }
  return Infinity;
}

/**
 * Estado del asistente para el tren del jugador.
 * @param {object} sim       TrainSim del jugador
 * @param {object} station   estación de la ruta en la que debe parar
 * @returns {null|{station, dist:number, predicted:number|null, need:number, recommend:string|null,
 *                 cue:string, text:string, level:string, wide:boolean}}
 */
export function stopAssist(sim, station) {
  if (!station || sim.autoDemand !== null || sim.reverser !== 1) return null;
  const tol = CONFIG.station.stopTolerance;
  const dist = sim.position - station.stopZ;             // > 0: falta para la marca
  const v = sim.velocity;
  if (v < 0.1 || dist > REACH) return null;

  // Se pasó: el testero ya está más allá de la tolerancia
  if (dist < -tol) {
    return { station, dist, predicted: null, need: 0, recommend: null, cue: "passed",
      text: `¡PASASTE LA MARCA! ${(-dist).toFixed(1)} m · detente y retrocede`, level: "alert", wide: false };
  }

  const d = SERVICE.map(n => stoppingDistance(sim, -n.accel));        // B1, B2, B3
  const [dB1, dB2, dB3] = d;
  // Fuera del alcance del asistente: aún lejos del punto de frenado
  if (dist > Math.max(450, dB2 + v * (PREPARE + 4))) return null;

  const notch = sim.notchData;
  const braking = notch.type === "brake" || notch.type === "emergency";
  const dCur = braking ? stoppingDistance(sim, -notch.accel, notch.type === "emergency" ? 4 : JERK) : null;
  const predicted = dCur === null || !isFinite(dCur) ? null : dist - dCur;
  const need = dist > 0.5 ? (v * v) / (2 * dist) : Infinity;          // deceleración media necesaria

  // Punto recomendado: el más suave que para en la marca o justo antes (apunta al centro, no al borde de la tolerancia)
  let recommend = null;
  for (let k = 0; k < SERVICE.length; k++) if (d[k] <= dist + 0.5) { recommend = SERVICE[k].id; break; }

  const label = id => NOTCHES[NOTCH_INDEX[id]].label;
  const m = x => `${Math.max(0, Math.round(x))} m`;
  let cue, text, level;
  if (dB3 > dist + tol) {
    const em = stoppingDistance(sim, -NOTCHES[NOTCH_INDEX.EM].accel, 4);
    cue = "late"; level = "alert";
    text = em <= dist + tol ? "¡NO ALCANZAS CON FRENO 3! · EMERGENCIA (Espacio)" : `¡TE PASAS! · FRENO 3 · pararás ~${m(dB3 - dist)} después`;
  } else if (!braking) {
    if (dB2 + v * REACTION >= dist) { cue = "brake"; level = "warn"; text = `¡FRENA YA! · ${label(recommend || "B2")}`; }
    else if (dB2 + v * PREPARE >= dist) { cue = "soon"; level = "info"; text = `Prepárate para frenar · punto de frenado en ${m(dist - dB2 - v * REACTION)}`; }
    else { cue = "far"; level = "info"; text = `Marca a ${m(dist)} · con FRENO 2 frenas en ${m(dB2)}`; }
  } else if (predicted !== null && predicted < -tol) {
    cue = "more"; level = "warn";
    text = `Te pasarías ${(-predicted).toFixed(0)} m · sube a ${label(recommend || "B3")}`;
  } else if (predicted !== null && predicted > Math.max(6, tol * 2) && recommend && notch.type === "brake"
             && NOTCH_INDEX[recommend] > sim.notch && dist > 8) {
    // Frenando de más, y un punto más suave también para a tiempo: aflojar (sin riesgo de pasarse)
    cue = "short"; level = "info";
    text = `Te quedarías ${predicted.toFixed(0)} m antes · afloja a ${label(recommend)}`;
  } else {
    cue = "ok"; level = "ok";
    text = predicted === null ? "Frenando" : Math.abs(predicted) <= tol ? "Parada prevista en la marca · mantén el freno" : `Parada prevista ${predicted > 0 ? `${predicted.toFixed(0)} m antes` : `${(-predicted).toFixed(0)} m pasado`}`;
  }
  return { station, dist, predicted, need, recommend, cue, text, level, wide: dist > 60, dB1, dB2, dB3 };
}
