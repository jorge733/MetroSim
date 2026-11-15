/* ==========================================================================
   RedMoviSim — 1.15 · bus/busAutopilot.js
   El conductor automático del bus cuando el jugador viaja como PASAJERO.
   Maneja por la pista Solo Bus, se detiene en los paraderos donde hay gente
   esperando o alguien tocó el timbre (también el jugador), respeta los
   semáforos y abre y cierra las puertas. Sin Three.js.
   ========================================================================== */

const CRUISE = 12;          // m/s (~43 km/h): bajo el límite de 50 km/h
const PLAN_DECEL = 1.1;     // m/s² con que planifica las frenadas (suave para la gente de pie)

/**
 * Da las órdenes de un paso (sim.input y puertas).
 * @param {import("./busSim.js").BusSim} sim
 * @param {number} dt
 * @param {{hold:boolean}} o  hold: deja las puertas abiertas (el jugador se está por bajar aquí)
 */
export function autopilot(sim, dt, { hold = false } = {}) {
  const b = sim.bus, inp = sim.input;
  const ap = sim.ap ??= { doorWait: 0 };
  inp.throttle = false;
  inp.brake = false;
  if (sim.finished) return;
  const last = sim.route.stops.length - 1;

  if (b.doors !== "closed") {
    inp.brake = true;
    if (b.doors !== "open") return;
    if (sim.serving && !sim.serving.done) { ap.doorWait = 0; return; }
    ap.doorWait += dt;
    const atTerminal = (sim.serving?.index ?? sim.stopIndex) === last;
    if (atTerminal) return;                                   // en la terminal se espera a que todos bajen
    if (ap.doorWait > (hold ? 9 : 2.2)) { sim.toggleDoors(); ap.doorWait = 0; }
    return;
  }

  const st = sim.nextStop;
  let target = CRUISE;
  if (st) {
    const i = sim.stopIndex, d = st.s - b.s;
    const mustStop = sim.waiting[i] > 0 || sim.bell || i === last;
    if (mustStop) {
      if (Math.abs(d) <= 1.2 && b.v < 0.15) { sim.toggleDoors(); ap.doorWait = 0; inp.brake = true; return; }
      if (d > -0.5) target = Math.min(target, Math.sqrt(2 * PLAN_DECEL * Math.max(0, d - 0.4)));
    }
  }
  const L = sim.nextLight(100);
  if (L && L.state !== "green" && L.d > 1.5) {
    const canStop = L.d > (b.v * b.v) / (2 * 2.5);
    if (L.state === "red" || canStop) target = Math.min(target, Math.sqrt(2 * PLAN_DECEL * Math.max(0, L.d - 2.5)));
  }
  if (b.v < target - 0.4) inp.throttle = true;
  else if (b.v > target + 0.15) inp.brake = true;
  if (target < 0.05 && b.v < 0.3) inp.brake = true;
}
