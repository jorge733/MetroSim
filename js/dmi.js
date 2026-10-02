/* ==========================================================================
   MetroSim — Alpha 0.6 · dmi.js
   Pantalla de cabina (DMI) dibujada en un canvas y usada como textura.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { clamp, makeCanvas, formatStopError } from "./utils.js";

export class CabDisplay {
  constructor() {
    this.canvas = makeCanvas(640, 360);
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  draw(sim, info) {
    const g = this.ctx, Wd = 640, Hd = 360;
    g.fillStyle = "#070b10"; g.fillRect(0, 0, Wd, Hd);
    g.strokeStyle = "#1f2a35"; g.lineWidth = 4; g.strokeRect(2, 2, Wd - 4, Hd - 4);

    /* --- Inversor (sentido de marcha) --- */
    const rev = sim.reverserData;
    const revColor = { F: "#6fe39a", N: "#8b9bab", R: "#ffb547" }[rev.id];
    g.fillStyle = revColor; g.fillRect(14, 14, 44, 34);
    g.fillStyle = "#0a121b"; g.font = "900 24px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(rev.id, 36, 32);
    g.fillStyle = revColor; g.font = "700 12px Arial"; g.textAlign = "left";
    g.fillText(rev.label, 64, 32);

    /* --- Próxima señal (aspecto y distancia) --- */
    if (info.signal) {
      const colors = { red: "#ff3030", yellow: "#ffb000", green: "#30ff7a" };
      const sx = 268, sy = 30;
      g.fillStyle = "#0d1217"; g.fillRect(sx - 16, 10, 32, 78);
      ["red", "yellow", "green"].forEach((a, k) => {
        g.fillStyle = info.signal.aspect === a ? colors[a] : "#1f262d";
        g.beginPath(); g.arc(sx, sy + k * 23, 9, 0, Math.PI * 2); g.fill();
      });
      g.fillStyle = "#c9d6e2"; g.font = "700 13px Arial"; g.textAlign = "left";
      g.fillText(`S${info.signal.id}`, sx + 22, 30);
      g.fillStyle = "#ffffff"; g.font = "800 18px Arial";
      g.fillText(`${Math.round(info.signal.distance)} m`, sx + 22, 52);
    }

    /* --- Velocímetro --- */
    const cx = 170, cy = 185, r = 135, vmax = 80;
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    const ang = (v) => a0 + sweep * clamp(v / vmax, 0, 1);
    const kmh = sim.speedKmh;
    const over = kmh > info.limit + 0.5;

    g.lineCap = "butt";
    g.lineWidth = 16; g.strokeStyle = "#1a242e";
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep); g.stroke();
    g.strokeStyle = "#a3262c";
    g.beginPath(); g.arc(cx, cy, r, ang(info.limit), a0 + sweep); g.stroke();
    g.strokeStyle = over ? "#ff4b4b" : "#3fd0ff";
    g.beginPath(); g.arc(cx, cy, r, a0, ang(kmh)); g.stroke();

    g.fillStyle = "#c9d6e2"; g.font = "600 18px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    for (let v = 0; v <= vmax; v += 10) {
      const a = ang(v);
      g.strokeStyle = "#c9d6e2"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); g.lineTo(cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28)); g.stroke();
      g.fillText(String(v), cx + Math.cos(a) * (r - 46), cy + Math.sin(a) * (r - 46));
    }
    // Marca del límite
    const la = ang(info.limit);
    g.strokeStyle = "#ff4b4b"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx + Math.cos(la) * (r - 10), cy + Math.sin(la) * (r - 10)); g.lineTo(cx + Math.cos(la) * (r + 12), cy + Math.sin(la) * (r + 12)); g.stroke();
    // Aguja
    const na = ang(kmh);
    g.strokeStyle = "#ffffff"; g.lineWidth = 5; g.lineCap = "round";
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(na) * (r - 30), cy + Math.sin(na) * (r - 30)); g.stroke();
    g.fillStyle = "#1a242e"; g.beginPath(); g.arc(cx, cy, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = over ? "#ff6b6b" : "#ffffff"; g.font = "800 46px Arial";
    g.fillText(String(Math.round(kmh)), cx, cy - 4);
    g.fillStyle = "#8b9bab"; g.font = "600 14px Arial"; g.fillText("km/h", cx, cy + 28);
    g.fillStyle = "#ff8a8a"; g.font = "700 16px Arial"; g.fillText(`LÍMITE ${info.limit}`, cx, cy + 112);

    /* --- Columna derecha --- */
    const x0 = 360, w = 260;
    const n = sim.notchData;
    const notchColors = { power: "#4fd6ff", neutral: "#e8eef5", brake: "#ffb547", emergency: "#ff4b4b" };
    g.fillStyle = notchColors[n.type];
    g.fillRect(x0, 22, w, 66);
    g.fillStyle = n.type === "emergency" ? "#fff" : "#0a121b";
    g.textAlign = "left"; g.font = "900 44px Arial"; g.fillText(n.id, x0 + 14, 56);
    g.font = "700 18px Arial"; g.textAlign = "right"; g.fillText(n.label, x0 + w - 12, 56);

    // Barra de esfuerzo (tracción / freno aplicado)
    const barY = 104, barH = 16, mid = x0 + w / 2;
    g.fillStyle = "#1a242e"; g.fillRect(x0, barY, w, barH);
    const effort = clamp(sim.accel / 1.45, -1, 1);
    g.fillStyle = effort >= 0 ? "#4fd6ff" : "#ffb547";
    if (effort >= 0) g.fillRect(mid, barY, (w / 2) * effort, barH);
    else g.fillRect(mid + (w / 2) * effort, barY, -(w / 2) * effort, barH);
    g.fillStyle = "#ffffff"; g.fillRect(mid - 1, barY - 3, 2, barH + 6);
    g.fillStyle = "#8b9bab"; g.font = "600 12px Arial";
    g.textAlign = "left"; g.fillText("FRENO", x0, barY + 30);
    g.textAlign = "right"; g.fillText("TRACCIÓN", x0 + w, barY + 30);

    // Estación
    g.textAlign = "left";
    g.fillStyle = "#8b9bab"; g.font = "600 13px Arial";
    g.fillText(info.docked ? "EN ESTACIÓN" : "PRÓXIMA", x0, 168);
    g.fillStyle = "#ffffff"; g.font = "800 28px Arial";
    const stName = info.docked ? info.docked.short : (info.next ? info.next.short : "FIN DE LÍNEA");
    g.font = stName.length > 13 ? "800 21px Arial" : "800 27px Arial";
    g.fillText(stName, x0, 196);
    if (!info.docked && info.next) {
      g.fillStyle = "#cfe0f1"; g.font = "700 17px Arial"; g.textAlign = "right";
      g.fillText(`${Math.max(0, Math.round(info.distance))} m`, x0 + w, 168);
    }

    // Precisión de parada
    if (info.approach) {
      const sx = x0, sy = 222, sw = w, range = 10;
      g.fillStyle = "#1a242e"; g.fillRect(sx, sy, sw, 14);
      const tol = CONFIG.station.stopTolerance / range * (sw / 2);
      g.fillStyle = "#2f7a4b"; g.fillRect(sx + sw / 2 - tol, sy, tol * 2, 14);
      g.fillStyle = "#6fe39a"; g.fillRect(sx + sw / 2 - 1, sy - 3, 2, 20);
      const px = sx + sw / 2 + clamp(-info.approach.error / range, -1, 1) * (sw / 2);
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(px, sy + 7, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#cfe0f1"; g.font = "600 13px Arial"; g.textAlign = "left";
      g.fillText(`MARCA: ${formatStopError(info.approach.error)}`, sx, sy + 34);
    }

    // Horario
    if (info.schedule) {
      g.fillStyle = "#8b9bab"; g.font = "600 13px Arial"; g.textAlign = "left";
      g.fillText(info.schedule.label, x0, 286);
      g.fillStyle = info.schedule.color; g.font = "800 16px Arial"; g.textAlign = "right";
      g.fillText(info.schedule.delayText, x0 + w, 286);
    }

    // Puertas
    const doorText = { closed: "PUERTAS CERRADAS", opening: "ABRIENDO", open: "PUERTAS ABIERTAS", closing: "CERRANDO" }[sim.doorState];
    const doorColor = { closed: "#2a74ff", opening: "#ffd166", open: "#6fe39a", closing: "#ffd166" }[sim.doorState];
    g.fillStyle = doorColor; g.beginPath(); g.arc(x0 + 10, 318, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e8eef5"; g.font = "700 17px Arial"; g.textAlign = "left";
    g.fillText(doorText, x0 + 28, 319);

    this.texture.needsUpdate = true;
  }
}

