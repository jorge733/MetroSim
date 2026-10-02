/* ==========================================================================
   MetroSim — tools/simular.mjs
   Ejecuta el Motor MetroSim SIN navegador ni gráficos (Node 22 o superior)
   e imprime el estado de la red cada cierto tiempo.

   Uso (desde la carpeta del proyecto):
     node tools/simular.mjs                 08:00 → 10:00, informe cada 15 min
     node tools/simular.mjs 09:30 5         hasta las 09:30, informe cada 5 min
     node tools/simular.mjs 09:00 10 "PLAZA EGAÑA"
                                            pantallas de andén de otra estación
                                            (por defecto, UNIVERSIDAD DE CHILE)

   Si esto funciona, el "cerebro" del Metro es independiente del dibujo 3D.
   ========================================================================== */

import { CONFIG, STATIONS } from "../js/config.js";
import { MetroEngine } from "../js/engine/engine.js";
import { ROUTES } from "../js/engine/route.js";
import { formatClock } from "../js/engine/format.js";

const [untilArg = "10:00", everyArg = "15", stationArg = "UNIVERSIDAD DE CHILE"] = process.argv.slice(2);
const [hh, mm] = untilArg.split(":").map(Number);
const until = hh * 3600 + (mm || 0) * 60;
const every = Number(everyArg) * 60;

const started = Date.now();
const engine = new MetroEngine({ startTime: CONFIG.startTime - 45 * 60 });

/** Lo que mostrarían las pantallas de los andenes de una estación (llegadas por posición real). */
function screens(name) {
  const lines = [`  Pantallas de ${name}:`];
  for (const route of ROUTES) {
    const next = engine.arrivalsAt(name, route).slice(0, 3).map(a => {
      if (a.here) return `${a.id} en andén`;
      const delay = Math.round(a.delay);
      const tag = Math.abs(delay) <= CONFIG.schedule.punctualWindow ? "" : ` (${delay > 0 ? "+" : "−"}${Math.abs(delay)} s)`;
      return `${a.id} ${formatClock(a.at)}${tag}`;
    });
    const st = STATIONS.find(s => s.name === name);
    const waiting = Math.round(engine.passengers.waitingAt(st, route.side));
    lines.push(`    Dir. ${route.last.name.padEnd(26)} ${String(waiting).padStart(3)} esperando · ${next.join(" · ") || "sin trenes previstos"}`);
  }
  return lines.join("\n");
}

// Cambios de estado de los trenes (bus del motor): se cuentan para el resumen final
const changes = {};
engine.bus.on("train:state", ({ to }) => (changes[to] = (changes[to] || 0) + 1));

// Servicio previo (igual que el juego): la línea ya tiene trenes a las 08:00
engine.runUntil(CONFIG.startTime);
console.log(engine.report() + "\n" + screens(stationArg) + "\n");

// Avance con el mismo paso fijo que usa el juego
for (let next = CONFIG.startTime + every; next <= until; next += every) {
  while (engine.time < next) engine.step();
  console.log(engine.report() + "\n" + screens(stationArg) + "\n");
}

const t = engine.passengers.totals;
console.log(`Viajeros: ${Math.round(t.boarded)} subidas · ${Math.round(t.alighted)} bajadas`);
console.log("Cambios de estado: " + Object.entries(changes).map(([k, n]) => `${k} ${n}`).join(" · "));
const simulated = (until - CONFIG.startTime + 45 * 60) / 60;
console.log(`Simulados ${Math.round(simulated)} min de servicio en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
