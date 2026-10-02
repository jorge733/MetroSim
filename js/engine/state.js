/* ==========================================================================
   MetroSim — Motor · state.js
   Estado explícito de cada tren.

   El motor calcula en cada paso UN estado por tren, igual para los trenes
   automáticos y para el del jugador, a partir de lo que de verdad le pasa
   (física, puertas, señales y conducción automática). Cuando cambia, avisa
   por el bus con "train:state", y cualquiera (interfaz, sonido, Centro de
   Control futuro) puede reaccionar sin volver a deducirlo.
   ========================================================================== */

/** Estados posibles y su texto para mostrar. */
export const TRAIN_STATES = {
  depot:       "en cocheras",
  starting:    "arrancando",
  running:     "circulando",
  approaching: "aproximándose",
  signalStop:  "detenido ante señal",
  stopped:     "detenido en vía",
  dwell:       "puertas abiertas",
  closing:     "cerrando puertas",
  ready:       "listo para salir",
  held:        "retenido en estación",
  retiring:    "hacia la cola de maniobras",
  cabChange:   "cambio de cabina",
};

/** Distancia (m) a la que una señal en rojo explica que el tren esté parado. */
const SIGNAL_REACH = 80;
/** Distancia (m) a la próxima parada en la que un tren frenando "se aproxima". */
const APPROACH_REACH = 400;

/**
 * Estado actual de un tren.
 * @param {object} u  unidad del tráfico (sim, ato, route)
 * @param {import("./signals.js").SignalSystem} signals  señales de su ruta
 * @returns {keyof TRAIN_STATES}
 */
export function trainState(u, signals) {
  const sim = u.sim, ato = u.ato?.state;

  // 1. Fases que solo conoce la conducción automática
  if (ato === "depot") return "depot";
  if (ato === "retired") return "cabChange";
  if (ato === "retire") return "retiring";

  // 2. Retenido por el Centro de Control (en estación)
  if (u.ato?.held && sim.isStopped && sim.dockedStation()) return "held";

  // 3. Puertas
  if (sim.doorState === "closing") return "closing";
  if (sim.doorState !== "closed") return "dwell";

  // 4. Parado: arrancando, en estación, ante una señal o en plena vía
  if (sim.isStopped) {
    const departing = sim.accel > 0.05 || ato === "running";           // ya aplica tracción o el ATO va a arrancar
    const docked = sim.dockedStation();
    if (docked && ato === "running" && docked === u.ato.target) return "approaching";   // recién llegado, aún sin abrir
    if (docked) return departing ? "starting" : "ready";
    const sig = signals?.nextAhead(sim.position);
    if (sig && sig.aspect === "red" && sim.position - sig.z < SIGNAL_REACH) return "signalStop";
    if (u.state === "approaching" && ato === "running") return "approaching";        // ajuste final a la marca
    return departing ? "starting" : "stopped";
  }

  // 5. En movimiento
  if (u.state === "approaching" && sim.dockedStation()) return "approaching";          // últimos metros
  if (sim.speed < 3 && sim.accel > 0 && u.state !== "approaching") return "starting";
  // Aproximación: frenando hacia la próxima parada (y se mantiene hasta detenerse,
  // aunque el ATO suelte el freno un instante)
  const next = sim.nextStation();
  const near = next && sim.position - next.stopZ < APPROACH_REACH;
  if (near && (sim.isBraking || u.state === "approaching")) return "approaching";
  return "running";
}
