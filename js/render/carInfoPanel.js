/* ==========================================================================
   MetroSim — Render · carInfoPanel.js
   Pantallas de información sobre las puertas de los coches (1.3).

   Como las pantallas TFT de los trenes modernos del Metro de Santiago:
     · en marcha: "PRÓXIMA ESTACIÓN" y su nombre, con las combinaciones;
     · detenido en una estación: "ESTACIÓN" y su nombre; al cerrar las
       puertas, "CIERRE DE PUERTAS" parpadeando;
     · arriba, la línea, la dirección y la hora.
   Las puertas siempre abren del lado del andén (+X del tren): las pantallas
   de ese lado avisan "SE ABRIRÁN LAS PUERTAS DE ESTE LADO" y las del lado
   contrario, "LAS PUERTAS SE ABRIRÁN AL OTRO LADO".
   Avisos especiales: tren detenido en plena vía y tren que se retira del
   servicio.

   Todos los trenes comparten los dos materiales de las pantallas (train.js),
   así que basta con un panel que sigue al tren en el que va el jugador.
   ========================================================================== */

import { LINE } from "../config.js";
import { makeCanvas, toTexture, drawLineBadge } from "../utils.js";
import { formatClock } from "../engine/format.js";

const W = 512, H = 124;
const BLINK = 0.5;

/** Letra más chica si el texto no cabe en el ancho. */
function fit(g, text, weight, size, maxW) {
  let s = size;
  do { g.font = `${weight} ${s}px Arial`; s -= 2; } while (g.measureText(text).width > maxW && s > 12);
}

export class CarInfoPanel {
  /** @param {{door: THREE.Material, other: THREE.Material}} materials  pantallas del lado del andén y del otro lado */
  constructor(materials) {
    this.sides = ["door", "other"].map(key => {
      const canvas = makeCanvas(W, H);
      const texture = toTexture(canvas);
      materials[key].map = texture;
      materials[key].needsUpdate = true;
      return { key, canvas, ctx: canvas.getContext("2d"), texture };
    });
    this.lastKey = "";
    this.update(null, 0, 0);
  }

  /**
   * @param {object|null} unit  tren que se muestra (o null)
   * @param {number} clock      hora del juego (s)
   * @param {number} time       segundos (para el parpadeo)
   */
  update(unit, clock, time) {
    const info = unit ? this.describe(unit) : null;
    const on = Math.floor(time / BLINK) % 2 === 0;
    const key = info ? `${info.kind}|${info.station?.id}|${info.blink ? on : ""}|${Math.floor(clock / 60)}|${unit.route.id}` : "off";
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const side of this.sides) this.draw(side, info, unit, clock, on);
  }

  /** Qué mostrar según el estado del tren. */
  describe(unit) {
    const sim = unit.sim, ato = unit.ato;
    const docked = sim.isStopped ? sim.dockedStation() : null;
    const next = sim.nextStation();
    if (ato?.evacuating || (ato?.outOfService && docked)) return { kind: "outOfService", station: docked || next, blink: true };
    if (docked) {
      const terminal = docked === unit.route.last;
      if (sim.doorState === "closing") return { kind: "closing", station: docked, blink: true };
      return { kind: terminal ? "terminal" : "station", station: docked };
    }
    if (!next) return { kind: "outOfService", station: null };
    if (sim.isStopped && sim.position - next.stopZ > 30) return { kind: "stopped", station: next, blink: true };
    return { kind: "next", station: next };
  }

  draw({ key, ctx: g, texture }, info, unit, clock, on) {
    g.fillStyle = "#06080b"; g.fillRect(0, 0, W, H);
    if (!info) { texture.needsUpdate = true; return; }

    // Cabecera: línea, dirección y hora
    g.fillStyle = LINE.color; g.fillRect(0, 0, W, 28);
    g.fillStyle = "#fff"; g.beginPath(); g.arc(16, 14, 12.5, 0, Math.PI * 2); g.fill();
    drawLineBadge(g, LINE.id, 16, 14, 11);
    g.fillStyle = "#fff"; g.textBaseline = "middle"; g.textAlign = "left";
    fit(g, `DIRECCIÓN ${unit.route.last.name}`, 800, 15, 380);
    g.fillText(`DIRECCIÓN ${unit.route.last.name}`, 33, 15);
    g.textAlign = "right"; g.font = "800 16px Arial";
    g.fillText(formatClock(clock).slice(0, 5), W - 8, 15);

    const st = info.station;
    const label = {
      next: "PRÓXIMA ESTACIÓN", station: "ESTACIÓN", terminal: "ESTACIÓN TERMINAL", closing: "CIERRE DE PUERTAS",
      stopped: "TREN DETENIDO", outOfService: "TREN FUERA DE SERVICIO",
    }[info.kind];
    const warn = info.kind === "closing" || info.kind === "outOfService" || info.kind === "stopped";
    g.textAlign = "left";
    g.fillStyle = warn ? (on ? "#ff4d4d" : "#7a2020") : "#ffb000";
    g.font = "800 15px Arial";
    g.fillText(label, 10, 43);

    // Nombre grande (o el aviso)
    let big = st ? st.name : "";
    if (info.kind === "stopped") big = "Reanudaremos la marcha en breve";
    if (info.kind === "outOfService") big = "Todos deben descender";
    g.fillStyle = "#ffffff";
    fit(g, big, 800, 32, W - 20);
    g.fillText(big, 10, 72);

    // Pie: combinaciones y lado de las puertas
    g.font = "700 13px Arial"; g.fillStyle = "#9fb3c4";
    let x = 10;
    if (st?.combos?.length && (info.kind === "next" || info.kind === "station")) {
      g.fillText("Combinación", x, 106); x += 84;
      st.combos.forEach(c => { drawLineBadge(g, c, x + 9, 106, 9); x += 22; });
    }
    if (info.kind === "next" || info.kind === "station" || info.kind === "terminal") {
      const here = key === "door";
      const text = info.kind === "next"
        ? (here ? "▶ SE ABRIRÁN LAS PUERTAS DE ESTE LADO" : "LAS PUERTAS SE ABRIRÁN AL OTRO LADO ◀")
        : (here ? "▶ PUERTAS DE ESTE LADO" : "PUERTAS AL OTRO LADO ◀");
      g.textAlign = "right"; g.fillStyle = here ? "#6fe39a" : "#9fb3c4";
      fit(g, text, 700, 13, W - x - 16);
      g.fillText(text, W - 10, 106);
    }
    texture.needsUpdate = true;
  }
}
