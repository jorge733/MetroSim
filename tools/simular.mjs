/* ==========================================================================
   MetroSim — tools/simular.mjs
   Ejecuta el Motor MetroSim SIN navegador ni gráficos (Node 22 o superior)
   e imprime el estado de toda la red (L3 y L6) cada cierto tiempo.

   Uso (desde la carpeta del proyecto):
     node tools/simular.mjs                 08:00 → 10:00, informe cada 15 min
     node tools/simular.mjs 09:30 5         hasta las 09:30, informe cada 5 min
     node tools/simular.mjs 09:00 10 "ÑUÑOA"
                                            pantallas de andén de otra estación
                                            (de todas las líneas que pasan por ella;
                                            por defecto, UNIVERSIDAD DE CHILE)
     node tools/simular.mjs 10:00 15 "UNIVERSIDAD DE CHILE" sin-regulacion
                                            sin regulación automática de intervalos
     node tools/simular.mjs 10:00 15 "ÑUÑOA" con-regulacion sabado
                                            tipo de día: laboral (por defecto), sabado o domingo

   Si esto funciona, el "cerebro" del Metro es independiente del dibujo 3D.
   ========================================================================== */

import { CONFIG } from "../js/config.js";
import { MetroEngine } from "../js/engine/engine.js";
import { formatClock } from "../js/engine/format.js";

const [untilArg = "10:00", everyArg = "15", stationArg = "UNIVERSIDAD DE CHILE", regArg = "", dayArg = "laboral"] = process.argv.slice(2);
CONFIG.dayType = ["laboral", "sabado", "domingo"].includes(dayArg) ? dayArg : "laboral";
const [hh, mm] = untilArg.split(":").map(Number);
const until = hh * 3600 + (mm || 0) * 60;
const every = Number(everyArg) * 60;

const started = Date.now();
const engine = new MetroEngine({ startTime: CONFIG.startTime - 45 * 60 });
if (regArg === "sin-regulacion") engine.command("control.regulation", { on: false });

/** Líneas que pasan por una estación (por nombre): [{ ls, st }]. */
function linesAt(name) {
  return [...engine.lines.values()]
    .map(ls => ({ ls, st: ls.line.stations.find(s => s.name === name) }))
    .filter(x => x.st);
}

/** Lo que mostrarían las pantallas de los andenes de una estación (llegadas por posición real). */
function screens(name) {
  const lines = [`  Pantallas de ${name}:`];
  for (const { ls, st } of linesAt(name)) {
    for (const route of ls.routes) {
      const next = engine.arrivalsAt(st, route).slice(0, 3).map(a => {
        if (a.here) return `${a.id} en andén`;
        const delay = Math.round(a.delay);
        const tag = Math.abs(delay) <= CONFIG.schedule.punctualWindow ? "" : ` (${delay > 0 ? "+" : "−"}${Math.abs(delay)} s)`;
        return `${a.id} ${formatClock(a.at)}${tag}`;
      });
      const waiting = Math.round(ls.passengers.waitingAt(st, route.side));
      lines.push(`    L${ls.line.id} dir. ${route.last.name.padEnd(26)} ${String(waiting).padStart(3)} esperando · ${next.join(" · ") || "sin trenes previstos"}`);
    }
  }
  if (lines.length === 1) lines.push("    (estación desconocida)");
  return lines.join("\n");
}

// Cambios de estado de los trenes (bus del motor): se cuentan para el resumen final
const changes = {};
engine.bus.on("train:state", ({ to }) => (changes[to] = (changes[to] || 0) + 1));

// Servicio previo (igual que el juego): la red ya tiene trenes a las 08:00
engine.runUntil(CONFIG.startTime);
console.log(engine.report() + "\n" + screens(stationArg) + "\n");

// Avance con el mismo paso fijo que usa el juego
for (let next = CONFIG.startTime + every; next <= until; next += every) {
  while (engine.time < next) engine.step();
  console.log(engine.report() + "\n" + screens(stationArg) + "\n");
}

// Resumen por línea
for (const ls of engine.lines.values()) {
  const t = ls.passengers.totals, rg = ls.regulator.stats;
  console.log(`${ls.line.name}: ${Math.round(t.boarded)} subidas · ${Math.round(t.alighted)} bajadas · ${Math.round(t.transferIn)} llegan por transbordo · regulación ${ls.regulator.enabled ? "activa" : "desactivada"} (${rg.holds} retenciones, ${Math.round(rg.holdSeconds)} s)`);
}
for (const { ls, st } of linesAt(stationArg)) {
  for (const route of ls.routes) {
    const rs = route.stationOf(st);
    const q = ls.regulator.regularity(route.id, rs.index);
    if (q) console.log(`Intervalos en ${stationArg} (L${ls.line.id} dir. ${route.last.name}): medio ${Math.round(q.mean)} s · desviación ${Math.round(q.sd)} s · mín ${Math.round(q.min)} s · máx ${Math.round(q.max)} s`);
  }
}
console.log("Cambios de estado: " + Object.entries(changes).map(([k, n]) => `${k} ${n}`).join(" · "));
const simulated = (until - CONFIG.startTime + 45 * 60) / 60;
console.log(`Simulados ${Math.round(simulated)} min de servicio en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
