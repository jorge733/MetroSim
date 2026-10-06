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
    const cx = 170, cy = 185, r = 135, vmax = 90;
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

    // Barra de esfuerzo REAL (no lo pedido): tracción a la derecha; a la izquierda el
    // freno eléctrico regenerativo (verde) y el de fricción (ámbar)
    const barY = 104, barH = 16, mid = x0 + w / 2;
    g.fillStyle = "#1a242e"; g.fillRect(x0, barY, w, barH);
    const effort = sim.effort ?? clamp(sim.accel / 1.3, -1, 1);
    if (effort >= 0) {
      g.fillStyle = "#4fd6ff"; g.fillRect(mid, barY, (w / 2) * effort, barH);
    } else {
      const f = sim.forces || { electricBrake: 0, frictionBrake: 1 };
      const total = f.electricBrake + f.frictionBrake || 1;
      const len = -(w / 2) * effort, elec = len * f.electricBrake / total;
      g.fillStyle = "#3ee08a"; g.fillRect(mid - elec, barY, elec, barH);
      g.fillStyle = "#ffb547"; g.fillRect(mid - len, barY, len - elec, barH);
    }
    g.fillStyle = "#ffffff"; g.fillRect(mid - 1, barY - 3, 2, barH + 6);
    g.fillStyle = "#8b9bab"; g.font = "600 12px Arial";
    g.textAlign = "left"; g.fillText("FRENO", x0, barY + 30);
    g.fillStyle = "#3ee08a"; g.textAlign = "center"; g.fillText("REGEN.", x0 + w * 0.34, barY + 30);
    g.fillStyle = "#8b9bab"; g.textAlign = "right"; g.fillText("TRACCIÓN", x0 + w, barY + 30);

    // Pendiente, tensión de catenaria y corriente (abajo a la izquierda)
    if (sim.voltage !== undefined) {
      const permil = Math.round((sim.grade || 0) * 1000);
      const arrow = permil > 1 ? "↗" : permil < -1 ? "↘" : "→";
      g.fillStyle = Math.abs(permil) >= 20 ? "#ffd166" : "#9fb0c2";
      g.font = "700 15px Arial"; g.textAlign = "left";
      g.fillText(`${arrow} ${permil > 0 ? "+" : ""}${permil} ‰`, 16, 340);
      g.fillStyle = "#9fb0c2";
      g.fillText(`${Math.round(sim.voltage)} V`, 106, 340);
      g.fillStyle = sim.current < -5 ? "#3ee08a" : "#9fb0c2";
      g.fillText(`${sim.current >= 0 ? "" : "−"}${Math.abs(Math.round(sim.current)).toLocaleString("es-CL")} A`, 180, 340);
    }

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


/**
 * Pantalla de estado (derecha del pupitre): recorrido de la línea con la
 * posición del tren, próximas estaciones con su hora prevista, hora y
 * viajeros a bordo. Complementa a la DMI (velocidad y señal).
 */
export class CabStatusDisplay {
  constructor() {
    this.canvas = makeCanvas(640, 360);
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** @param {{clock:number, onboard:number, trip:object, lineColor:string}} extra */
  draw(sim, info, extra) {
    const g = this.ctx, Wd = 640, Hd = 360, route = sim.route, sts = route.stations;
    const color = extra.lineColor || "#8b5a2b";
    g.fillStyle = "#070b10"; g.fillRect(0, 0, Wd, Hd);
    g.strokeStyle = "#1f2a35"; g.lineWidth = 4; g.strokeRect(2, 2, Wd - 4, Hd - 4);

    // Cabecera: destino y hora
    g.fillStyle = color; g.fillRect(14, 14, Wd - 28, 40);
    g.fillStyle = "#ffffff"; g.font = "800 20px Arial"; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText(`→ ${route.last.short}`, 26, 35);
    const h = Math.floor(extra.clock / 3600) % 24, m = Math.floor(extra.clock / 60) % 60, s = Math.floor(extra.clock) % 60;
    g.textAlign = "right"; g.font = "800 22px Arial";
    g.fillText(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, Wd - 26, 35);

    // Recorrido: barra con todas las estaciones y el tren
    const x0 = 30, x1 = Wd - 30, y = 84;
    g.fillStyle = "#26323e"; g.fillRect(x0, y - 3, x1 - x0, 6);
    const first = sts[0].stopZ, last = sts.at(-1).stopZ, span = last - first || 1;
    const px = (z) => x0 + clamp((z - first) / span, 0, 1) * (x1 - x0);
    const next = info.docked || info.next;
    for (const st of sts) {
      const passed = next && route.stationOf ? st.index < next.index : false;
      g.fillStyle = passed ? "#4a5560" : st === next ? "#ffd166" : "#e8eef5";
      g.beginPath(); g.arc(px(st.stopZ), y, st === next ? 6 : 4, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = color; g.fillRect(x0, y - 3, Math.max(0, px(sim.position) - x0), 6);
    g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(px(sim.position) + 9, y); g.lineTo(px(sim.position) - 5, y - 8); g.lineTo(px(sim.position) - 5, y + 8); g.fill();

    // Próximas estaciones con hora prevista
    g.textBaseline = "alphabetic";
    g.fillStyle = "#8b9bab"; g.font = "700 13px Arial"; g.textAlign = "left";
    g.fillText("PRÓXIMAS ESTACIONES", 26, 122);
    const startIdx = next ? sts.indexOf(next) : sts.length;
    const upcoming = sts.slice(startIdx, startIdx + 5);
    upcoming.forEach((st, i) => {
      const yy = 152 + i * 34;
      if (i === 0) { g.fillStyle = "#1a2633"; g.fillRect(18, yy - 24, Wd - 36, 32); }
      g.fillStyle = i === 0 ? "#ffd166" : "#e8eef5";
      g.font = `${i === 0 ? 800 : 600} 19px Arial`; g.textAlign = "left";
      g.fillText(st.name.length > 26 ? st.short : st.name, 30, yy);
      if (st.combos?.length) {
        let cx = 360;
        for (const c of st.combos) { g.fillStyle = "#3a4654"; g.beginPath(); g.arc(cx, yy - 6, 11, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.font = "800 11px Arial"; g.textAlign = "center"; g.fillText(c, cx, yy - 2); cx += 26; }
      }
      const arr = extra.trip?.arr?.[st.index];
      if (arr != null) {
        const hh = Math.floor(arr / 3600) % 24, mm = Math.floor(arr / 60) % 60;
        g.fillStyle = "#9fb0c2"; g.font = "700 17px Arial"; g.textAlign = "right";
        g.fillText(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, Wd - 30, yy);
      }
    });
    if (!upcoming.length) { g.fillStyle = "#e8eef5"; g.font = "700 19px Arial"; g.textAlign = "left"; g.fillText("Fin de servicio · maniobra de retorno", 30, 152); }

    // Pie: viajeros a bordo (y ocupación), masa del tren y energía neta del turno
    const occ = Math.round((sim.occupancy ?? 0) * 100);
    g.fillStyle = occ >= 85 ? "#ff8a8a" : occ >= 65 ? "#ffd166" : "#8b9bab";
    g.font = "600 14px Arial"; g.textAlign = "left";
    g.fillText(`A BORDO: ${extra.onboard ?? 0} VIAJEROS · ${occ} %`, 26, Hd - 16);
    if (sim.energy) {
      const net = sim.energy.traction + sim.energy.aux - sim.energy.regen;
      g.fillStyle = "#8b9bab"; g.textAlign = "right";
      g.fillText(`${Math.round(sim.mass / 1000)} t · ${net.toFixed(1)} kWh (regen. ${sim.energy.regen.toFixed(1)})`, Wd - 26, Hd - 16);
    } else {
      g.textAlign = "right"; g.fillText(`LÍMITE ${info.limit} KM/H`, Wd - 26, Hd - 16);
    }
    this.texture.needsUpdate = true;
  }
}
