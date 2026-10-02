/* ==========================================================================
   MetroSim — tools/simular.mjs
   Ejecuta el Motor MetroSim SIN navegador ni gráficos (Node 22 o superior)
   e imprime el estado de la red cada cierto tiempo.

   Uso (desde la carpeta del proyecto):
     node tools/simular.mjs                 08:00 → 10:00, informe cada 15 min
     node tools/simular.mjs 09:30 5         hasta las 09:30, informe cada 5 min

   Si esto funciona, el "cerebro" del Metro es independiente del dibujo 3D.
   ========================================================================== */

import { CONFIG } from "../js/config.js";
import { MetroEngine } from "../js/engine/engine.js";

const [untilArg = "10:00", everyArg = "15"] = process.argv.slice(2);
const [hh, mm] = untilArg.split(":").map(Number);
const until = hh * 3600 + (mm || 0) * 60;
const every = Number(everyArg) * 60;

const started = Date.now();
const engine = new MetroEngine({ startTime: CONFIG.startTime - 45 * 60 });

// Servicio previo (igual que el juego): la línea ya tiene trenes a las 08:00
engine.runUntil(CONFIG.startTime);
console.log(engine.report() + "\n");

// Avance con el mismo paso fijo que usa el juego
for (let next = CONFIG.startTime + every; next <= until; next += every) {
  while (engine.time < next) engine.step();
  console.log(engine.report() + "\n");
}

const simulated = (until - CONFIG.startTime + 45 * 60) / 60;
console.log(`Simulados ${Math.round(simulated)} min de servicio en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
