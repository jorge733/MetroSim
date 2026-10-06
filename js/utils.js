/* ==========================================================================
   MetroSim — Alpha 0.6 · utils.js
   Utilidades: matemáticas, formato, materiales, geometría y texturas procedurales.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, LINE, LINE_COLORS, WORLD } from "./config.js";

// Matemáticas y formato puros: viven en el motor y se reexportan aquí
export { clamp, formatClock, formatStopError, gradeStop } from "./engine/format.js";
export const $ = (id) => document.getElementById(id);

/** Material PBR estándar con valores por defecto razonables. */
export function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metal ?? 0.1,
    roughness: opts.rough ?? 0.75,
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
  });
}

/** Material sin iluminación (luminarias, pantallas, carteles retroiluminados). */
export function glow(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, map: opts.map ?? null, side: opts.side ?? THREE.FrontSide, toneMapped: false });
}

/** Caja con centro en (x, y, z), añadida a parent. */
export function addBox(parent, w, h, d, mat, x = 0, y = 0, z = 0) {
  // Las piezas largas se subdividen a lo largo (cada ~10 m) para que el dibujo
  // pueda doblarlas siguiendo las pendientes de la vía (render/trackLift.js)
  const segs = d > 24 ? Math.ceil(d / 10) : 1;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 1, 1, segs), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Caja definida por sus límites en Y y Z (más cómodo para paredes). */
export function addBoxSpan(parent, x, w, y0, y1, z0, z1, mat) {
  return addBox(parent, w, y1 - y0, Math.abs(z1 - z0), mat, x, (y0 + y1) / 2, (z0 + z1) / 2);
}

export function addPlane(parent, w, h, mat, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  parent.add(mesh);
  return mesh;
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

export function toTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  return tex;
}

/** Añade ruido de grano a todo el canvas (hormigón, terrazo...). */
export function addNoise(g, w, h, amount) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

/* ---------- Texturas procedurales (sin archivos externos) ---------- */

/** Hormigón de dovelas del túnel: juntas de anillo cada repetición. */
export function tunnelTexture() {
  const c = makeCanvas(256, 256), g = c.getContext("2d");
  g.fillStyle = "#6c7176"; g.fillRect(0, 0, 256, 256);
  addNoise(g, 256, 256, 26);
  for (let i = 0; i < 22; i++) {           // manchas de humedad
    const x = Math.random() * 256, y = Math.random() * 256, r = 10 + Math.random() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(20,22,24,0.18)"); grd.addColorStop(1, "rgba(20,22,24,0)");
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.fillRect(0, 0, 256, 4);                 // junta de anillo
  g.fillRect(0, 0, 3, 256);                 // junta longitudinal de dovela
  g.fillStyle = "rgba(255,255,255,0.06)";
  g.fillRect(0, 4, 256, 2);
  return c;
}

export function concreteTexture(base = "#55595d", amount = 22) {
  const c = makeCanvas(128, 128), g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  addNoise(g, 128, 128, amount);
  return c;
}

/** Terrazo de andén: gris claro con granos de colores. */
export function terrazzoTexture() {
  const c = makeCanvas(256, 256), g = c.getContext("2d");
  g.fillStyle = "#a7a9a6"; g.fillRect(0, 0, 256, 256);
  addNoise(g, 256, 256, 18);
  const colors = ["#6d6f70", "#d9d6cf", "#8b7f74", "#4d5257", "#c7c2b8"];
  for (let i = 0; i < 900; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  return c;
}

/**
 * Azulejo de estación con franja del color de la línea.
 * bandV0/bandV1: posición vertical de la franja (0 abajo, 1 arriba).
 * tint: [r, g, b] desplazamiento de color para variar el estilo de cada estación.
 */
export function tileTexture(lineColor, bandV0, bandV1, tint = [0, 0, 0]) {
  const S = 512, c = makeCanvas(S, S), g = c.getContext("2d");
  g.fillStyle = "#e9e5da"; g.fillRect(0, 0, S, S);
  const tile = 32;
  for (let y = 0; y < S; y += tile) {
    for (let x = 0; x < S; x += tile) {
      const shade = 228 + Math.floor(Math.random() * 14);
      g.fillStyle = `rgb(${shade + tint[0]},${shade - 3 + tint[1]},${shade - 12 + tint[2]})`;
      g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  }
  g.fillStyle = "#b9b4a8";
  for (let i = 0; i <= S; i += tile) { g.fillRect(i - 1, 0, 2, S); g.fillRect(0, i - 1, S, 2); }
  const y0 = (1 - bandV1) * S, y1 = (1 - bandV0) * S;
  g.fillStyle = lineColor; g.fillRect(0, y0, S, y1 - y0);
  g.fillStyle = "#1b2430"; g.fillRect(0, y1, S, 6);
  return c;
}

/** Insignia circular de línea ("3", "1"...) en un canvas. */
export function drawLineBadge(g, id, x, y, r) {
  g.fillStyle = LINE_COLORS[id] || "#777";
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = id === "2" ? "#1b1b1b" : "#fff";
  g.font = `900 ${Math.round(r * 1.15)}px Arial`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(id, x, y + r * 0.06);
}

/** Ajusta el tamaño de letra para que el texto quepa en un ancho. */
function fitFont(g, text, weight, maxSize, maxWidth) {
  let size = maxSize;
  do { g.font = `${weight} ${size}px Arial`; size -= 4; } while (g.measureText(text).width > maxWidth && size > 20);
}

/**
 * Cartel de estación al estilo Metro de Santiago: fondo oscuro, insignia
 * del color de la línea activa y, si existen, insignias de combinación.
 */
export function stationNameCanvas(st) {
  const W = 1024, H = 256, c = makeCanvas(W, H), g = c.getContext("2d");
  g.fillStyle = "#1d2228"; g.fillRect(0, 0, W, H);
  g.fillStyle = LINE.color; g.fillRect(0, H - 22, W, 22);
  drawLineBadge(g, LINE.id, 110, 116, 66);
  const combosW = st.combos.length * 120;
  g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle";
  fitFont(g, st.name, 800, 96, W - 230 - combosW - 30);
  g.fillText(st.name, 210, 118);
  st.combos.forEach((id, i) => drawLineBadge(g, id, W - 70 - i * 120, 116, 46));
  if (st.combos.length) { g.fillStyle = "#aab4bf"; g.font = "600 24px Arial"; g.textAlign = "right"; g.fillText("COMBINACIÓN", W - 30 - combosW, 205); }
  return c;
}

/**
 * Plano completo de la línea activa (compartido por todas las estaciones y trenes).
 * Las estaciones se colocan según su distancia real aproximada.
 */
export function lineMapCanvas() {
  const W = 2048, H = 384, c = makeCanvas(W, H), g = c.getContext("2d");
  g.fillStyle = "#f4f2ec"; g.fillRect(0, 0, W, H);
  drawLineBadge(g, LINE.id, 70, 64, 40);
  g.fillStyle = "#1b2430"; g.font = "800 40px Arial"; g.textAlign = "left"; g.textBaseline = "middle";
  g.fillText(`${LINE.name} · ${STATIONS[0].name} — ${STATIONS.at(-1).name}`, 130, 66);
  const x0 = 90, x1 = W - 90, y = 190;
  const xOf = (st) => x0 + (x1 - x0) * ((STATIONS[0].z - st.z) / WORLD.lineLength);
  g.fillStyle = LINE.color; g.fillRect(x0, y - 9, x1 - x0, 18);
  STATIONS.forEach((st, i) => {
    const x = xOf(st);
    g.fillStyle = "#fff"; g.strokeStyle = LINE.color; g.lineWidth = 8;
    g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fill(); g.stroke();
    st.combos.forEach((id, k) => drawLineBadge(g, id, x, y - 44 - k * 34, 15));
    g.save(); g.translate(x, y + 30); g.rotate(Math.PI / 4);
    g.fillStyle = "#1b2430"; g.font = "700 25px Arial"; g.textAlign = "left";
    g.fillText(st.short, 0, 0);
    g.restore();
  });
  return c;
}

/**
 * Plano de dirección de un andén (en la mezanina, antes de bajar): la línea
 * completa con una flecha hacia la terminal de destino. Uno por sentido,
 * compartido por todas las estaciones; la marca "usted está aquí" es aparte
 * (misma escala horizontal que lineMapU).
 * @param {object} dest  estación terminal hacia la que va el andén
 * @param {string} side  "IZQUIERDA" / "DERECHA" (escalera vista desde los torniquetes)
 */
export function directionMapCanvas(dest, side) {
  const W = 2048, H = 448, c = makeCanvas(W, H), g = c.getContext("2d");
  g.fillStyle = "#f4f2ec"; g.fillRect(0, 0, W, H);
  // Franja superior: dirección del andén
  g.fillStyle = "#1d2228"; g.fillRect(0, 0, W, 130);
  g.fillStyle = LINE.color; g.fillRect(0, 130, W, 12);
  drawLineBadge(g, LINE.id, 75, 65, 46);
  g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle";
  fitFont(g, `ANDÉN DIRECCIÓN ${dest.name}`, 800, 72, W - 560);
  g.fillText(`ANDÉN DIRECCIÓN ${dest.name}`, 150, 68);
  g.fillStyle = "#ffd23f"; g.font = "800 40px Arial"; g.textAlign = "right";
  g.fillText(`ESCALERA ${side} ↓`, W - 40, 68);

  // Línea: el tramo hacia el destino resaltado y una flecha en su extremo
  const x0 = 90, x1 = W - 90, y = 250;
  const xOf = (st) => x0 + (x1 - x0) * ((STATIONS[0].z - st.z) / WORLD.lineLength);
  const xd = xOf(dest), dir = xd > W / 2 ? 1 : -1;
  g.fillStyle = LINE.color; g.fillRect(x0, y - 11, x1 - x0, 22);
  g.beginPath();
  g.moveTo(xd + dir * 70, y); g.lineTo(xd + dir * 20, y - 40); g.lineTo(xd + dir * 20, y + 40); g.closePath();
  g.fill();
  STATIONS.forEach(st => {
    const x = xOf(st), end = st === dest;
    g.fillStyle = "#fff"; g.strokeStyle = LINE.color; g.lineWidth = end ? 12 : 8;
    g.beginPath(); g.arc(x, y, end ? 24 : 17, 0, Math.PI * 2); g.fill(); g.stroke();
    st.combos.forEach((id, k) => drawLineBadge(g, id, x, y - 48 - k * 34, 15));
    g.save(); g.translate(x, y + 34); g.rotate(Math.PI / 4);
    g.fillStyle = "#1b2430"; g.font = `${end ? 900 : 700} 25px Arial`; g.textAlign = "left";
    g.fillText(st.short, 0, 0);
    g.restore();
  });
  return c;
}

/** Cartel del pasillo de combinación: "COMBINACIÓN LÍNEA N →" con la insignia de esa línea. */
export function transferSignCanvas(lineId) {
  const W = 1024, H = 192, c = makeCanvas(W, H), g = c.getContext("2d");
  g.fillStyle = "#1d2228"; g.fillRect(0, 0, W, H);
  g.fillStyle = LINE_COLORS[lineId] || "#777"; g.fillRect(0, H - 20, W, 20);
  drawLineBadge(g, lineId, 100, 86, 62);
  g.fillStyle = "#fff"; g.font = "800 66px Arial"; g.textAlign = "left"; g.textBaseline = "middle";
  g.fillText(`COMBINACIÓN LÍNEA ${lineId}`, 190, 74);
  g.fillStyle = "#aab4bf"; g.font = "600 30px Arial";
  g.fillText("Pasillo de conexión · sin volver a pagar", 192, 136);
  g.fillStyle = "#ffd23f"; g.font = "900 96px Arial"; g.textAlign = "right";
  g.fillText("→", W - 40, 86);
  return c;
}

/** Fondo del pasillo de combinación: un túnel peatonal iluminado que se pierde a lo lejos. */
export function transferCorridorCanvas(lineId) {
  const W = 512, H = 512, c = makeCanvas(W, H), g = c.getContext("2d");
  const color = LINE_COLORS[lineId] || "#777";
  g.fillStyle = "#c9ccc8"; g.fillRect(0, 0, W, H);
  const vx = W / 2, vy = H * 0.46, fw = 70, fh = 90;               // punto de fuga y boca del fondo
  const quad = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); };
  quad([[0, 0], [W, 0], [vx + fw, vy - fh], [vx - fw, vy - fh]], "#e9ece9");                 // techo
  quad([[0, H], [W, H], [vx + fw, vy + fh], [vx - fw, vy + fh]], "#8d918f");                 // piso
  quad([[0, 0], [vx - fw, vy - fh], [vx - fw, vy + fh], [0, H]], "#d8dbd6");                 // muro izquierdo
  quad([[W, 0], [vx + fw, vy - fh], [vx + fw, vy + fh], [W, H]], "#d3d6d1");                 // muro derecho
  // Franja del color de la línea a lo largo de los muros
  quad([[0, H * 0.42], [vx - fw, vy - 10], [vx - fw, vy + 4], [0, H * 0.5]], color);
  quad([[W, H * 0.42], [vx + fw, vy - 10], [vx + fw, vy + 4], [W, H * 0.5]], color);
  // Luminarias del techo
  g.fillStyle = "#fffbe8";
  for (let k = 0; k < 6; k++) { const t = k / 6, y = (vy - fh) * t + 2, w = (1 - t) * 60 + 8; g.fillRect(vx - w / 2, y, w, 6 * (1 - t) + 2); }
  g.fillStyle = "#f7f9fb"; g.fillRect(vx - fw, vy - fh, fw * 2, fh * 2);                     // luz del fondo
  addNoise(g, W, H, 10);
  return c;
}

/** Posición horizontal (0..1) de una estación en el plano de línea. */
export function lineMapU(st) {
  const x0 = 90 / 2048, x1 = 1 - 90 / 2048;
  return x0 + (x1 - x0) * ((STATIONS[0].z - st.z) / WORLD.lineLength);
}

/** Placa identificativa de una señal. */
export function signalPlateCanvas(id) {
  const c = makeCanvas(128, 64), g = c.getContext("2d");
  g.fillStyle = "#f2f2ea"; g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#111"; g.font = "800 34px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(id, 64, 34);
  return c;
}

/** Cartel genérico (texto blanco sobre color). */
export function signCanvas(text, bg = "#1f7a3c", w = 512, h = 128, font = "800 64px Arial") {
  const c = makeCanvas(w, h), g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff"; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 4);
  return c;
}

/** Cartel de punto de parada (marca de cabeza de tren). */
export function stopBoardCanvas() {
  const c = makeCanvas(256, 256), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#d42026"; g.lineWidth = 26; g.strokeRect(13, 13, 230, 230);
  g.fillStyle = "#111"; g.font = "900 60px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("PARE", 128, 104);
  g.font = "800 40px Arial"; g.fillText("CABEZA", 128, 166);
  return c;
}

/** Hito kilométrico del túnel. */
export function milepostCanvas(text) {
  const c = makeCanvas(128, 128), g = c.getContext("2d");
  g.fillStyle = "#f1f1ea"; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#111"; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.fillStyle = "#111"; g.font = "800 46px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 64, 68);
  return c;
}

/** Indicador de destino (matriz ámbar del frontal). */
export function destinationCanvas(text) {
  const c = makeCanvas(512, 64), g = c.getContext("2d");
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, 512, 64);
  g.fillStyle = "#ffb000"; g.font = "700 44px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = text.length > 18 ? "700 30px monospace" : "700 40px monospace";
  g.fillText(`3  ${text}`, 256, 34);
  return c;
}

