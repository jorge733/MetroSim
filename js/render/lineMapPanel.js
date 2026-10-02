/* ==========================================================================
   MetroSim — Render · lineMapPanel.js
   Plano de línea dinámico de los coches (como los paneles de los AS-2014).

   Muestra en tiempo real el recorrido del tren que estás mirando:
     · estaciones ya recorridas: apagadas (gris)
     · estaciones por recorrer: luz verde
     · estación actual (tren detenido): luz ROJA parpadeante
     · próxima estación (tren en marcha): luz ÁMBAR parpadeante
   En la cabecera: dirección del tren y "ESTACIÓN" / "PRÓXIMA ESTACIÓN".

   Todos los trenes comparten el material del plano (train.js), así que basta
   con un único panel que sigue al tren en el que va el jugador.
   ========================================================================== */

import { STATIONS, LINE } from "../config.js";
import { lineMapCanvas, lineMapU, makeCanvas, toTexture, drawLineBadge } from "../utils.js";

const W = 2048, H = 384, Y = 190;
const BLINK = 0.5;                     // segundos encendida / apagada

export class LineMapPanel {
  /** @param {THREE.MeshBasicMaterial} material  material del plano de línea de los trenes */
  constructor(material) {
    this.base = lineMapCanvas();         // plano fijo (línea, estaciones, nombres)
    this.canvas = makeCanvas(W, H);
    this.ctx = this.canvas.getContext("2d");
    this.texture = toTexture(this.canvas);
    material.map = this.texture;
    material.needsUpdate = true;
    this.lastKey = "";
    this.draw(null, 0);
  }

  /**
   * @param {object|null} unit  tren que se muestra (o null: plano estático)
   * @param {number} time       segundos (para el parpadeo)
   */
  update(unit, time) {
    const on = Math.floor(time / BLINK) % 2 === 0;
    let info = null;
    if (unit) {
      const sim = unit.sim, route = unit.route;
      const docked = sim.isStopped ? sim.dockedStation() : null;
      const next = sim.nextStation();
      const current = docked || next;
      info = {
        route,
        current: current?.world ?? null,
        stopped: !!docked,
        doneIndex: current ? current.index : route.stations.length,   // índice de ruta de la estación actual
      };
    }
    const key = info ? `${info.route.id}|${info.current?.index}|${info.stopped}|${on}` : "static";
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(info, on);
  }

  draw(info, on) {
    const g = this.ctx;
    g.drawImage(this.base, 0, 0);

    // Cabecera: dirección y estado
    g.fillStyle = "#f4f2ec"; g.fillRect(0, 0, W, 108);
    drawLineBadge(g, LINE.id, 70, 64, 40);
    g.fillStyle = "#1b2430"; g.textBaseline = "middle"; g.textAlign = "left"; g.font = "800 40px Arial";
    g.fillText(info ? `${LINE.name} · DIRECCIÓN ${info.route.last.name}` : `${LINE.name} · ${STATIONS[0].name} — ${STATIONS.at(-1).name}`, 130, 66);
    if (!info) { this.texture.needsUpdate = true; return; }
    if (info.current) {
      g.textAlign = "right";
      g.fillStyle = info.stopped ? "#c8102e" : "#b86e00";
      g.font = "800 38px Arial";
      g.fillText(`${info.stopped ? "ESTACIÓN" : "PRÓXIMA ESTACIÓN"}: ${info.current.short}`, W - 60, 66);
    }

    // Luces de cada estación
    const route = info.route;
    for (const rs of route.stations) {
      const st = STATIONS[rs.worldIndex];
      const x = lineMapU(st) * W;
      let color = "#3ad16b";                                        // por recorrer
      if (rs.index < info.doneIndex) color = "#b9bec4";               // ya recorrida
      if (st === info.current) color = on ? (info.stopped ? "#ff2a2a" : "#ffb000") : "#5a1d1d";
      g.fillStyle = color;
      g.beginPath(); g.arc(x, Y, 10, 0, Math.PI * 2); g.fill();
      if (st === info.current && on) {
        g.strokeStyle = info.stopped ? "#ff2a2a88" : "#ffb00088";
        g.lineWidth = 6;
        g.beginPath(); g.arc(x, Y, 26, 0, Math.PI * 2); g.stroke();
      }
    }

    // Flecha de sentido sobre la línea
    const dir = route.dir;                                            // +1: hacia la derecha del plano
    const ax = dir > 0 ? W - 60 : 60;
    g.fillStyle = "#1b2430";
    g.beginPath();
    g.moveTo(ax + dir * 26, Y); g.lineTo(ax - dir * 6, Y - 22); g.lineTo(ax - dir * 6, Y + 22);
    g.closePath(); g.fill();

    this.texture.needsUpdate = true;
  }
}
