/* ==========================================================================
   MetroSim — Alpha 0.9 · city/kit.js
   Piezas 3D reutilizables de la ciudad: texturas de fachada, edificios
   genéricos, árboles, faroles, bancos, frontones y letreros.

   Todo es geometría simple y texturas de canvas (sin archivos externos),
   pensado para la GPU integrada: pocas luces reales, materiales baratos.
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox, makeCanvas, toTexture } from "../utils.js";

/**
 * Textura de fachada con ventanas.
 * @param {object} o  base (color del muro), frame (marco), glass (vidrio de día),
 *                    lit (fracción de ventanas encendidas de noche), cols, rows,
 *                    style "grid" (oficinas) | "classic" (ventanas altas) | "glass" (muro cortina)
 */
export function facadeTexture({ base = "#9a9590", glass = "#3d4f63", lit = 0, cols = 4, rows = 8, style = "grid", seed = Math.random }) {
  const W = 256, H = 512;
  const c = makeCanvas(W, H), g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const on = seed() < lit;
      g.fillStyle = on ? (seed() < 0.5 ? "#ffe2a6" : "#fff3d6") : glass;
      if (style === "glass") {
        g.fillRect(k * cw + 1, r * rh + 1, cw - 2, rh - 2);
      } else if (style === "classic") {
        g.fillRect(k * cw + cw * 0.3, r * rh + rh * 0.18, cw * 0.4, rh * 0.62);
        g.fillStyle = "#00000030"; g.fillRect(k * cw + cw * 0.26, r * rh + rh * 0.12, cw * 0.48, rh * 0.06);
      } else {
        g.fillRect(k * cw + cw * 0.14, r * rh + rh * 0.2, cw * 0.72, rh * 0.56);
      }
    }
  }
  if (style !== "glass") {             // franjas de losa
    g.fillStyle = "#00000022";
    for (let r = 0; r < rows; r++) g.fillRect(0, r * rh, W, 3);
  }
  return toTexture(c);
}

/** Letrero de texto (canvas) como material sin iluminación. */
export function signMaterial(text, { bg = "#1d2b3a", fg = "#ffffff", w = 1024, h = 160, font = "800 84px Arial", border = null } = {}) {
  const c = makeCanvas(w, h), g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); }
  g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  let size = parseInt(font.match(/(\d+)px/)[1], 10);
  while (g.measureText(text).width > w * 0.92 && size > 12) { size -= 4; g.font = font.replace(/\d+px/, `${size}px`); }
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return glow(0xffffff, { map: tex });
}

/** Plano orientado hacia +X (fachadas que miran a la calle desde el lado oeste) o −X (lado este). */
export function facingPlane(parent, w, h, mat, x, y, z, facing = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  parent.add(m);
  return m;
}

/** Frontón / techo a dos aguas: prisma triangular de ancho w (x), alto h, largo len (z). */
export function gableGeometry(w, h, len) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  geo.translate(0, 0, -len / 2);
  return geo;
}

export function addMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * Materiales compartidos de una calle (se crean una vez por calle y se
 * liberan al descargarla).
 */
export function cityMaterials(night) {
  return {
    asphalt: std(0x2b2d30, { rough: 0.95 }),
    sidewalk: std(0x9d978c, { rough: 0.9 }),
    curb: std(0xbab4aa, { rough: 0.8 }),
    paint: glow(night > 0.5 ? 0xb8b8b0 : 0xf2f2ea),
    yellow: glow(0xe6b800),
    grass: std(0x4f8a3a, { rough: 1 }),
    darkGrass: std(0x3f6f30, { rough: 1 }),
    trunk: std(0x5a4130, { rough: 1 }),
    leaves: std(0x3d7a35, { rough: 1 }),
    palm: std(0x4c8a3a, { rough: 1, side: THREE.DoubleSide }),
    metal: std(0x3a4046, { metal: 0.6, rough: 0.4 }),
    steel: std(0x8e979f, { metal: 0.7, rough: 0.35 }),
    darkGlass: std(0x1b2631, { metal: 0.5, rough: 0.15 }),
    shopGlow: glow(night > 0.5 ? 0xffd9a0 : 0xd8c7a8),
    lampOn: glow(night > 0.5 ? 0xfff0c8 : 0x9aa0a6),
    stone: std(0xb9b2a4, { rough: 0.85 }),
    water: std(0x3d6f9a, { metal: 0.3, rough: 0.1 }),
    bronze: std(0x3f4a3b, { metal: 0.8, rough: 0.45 }),
    black: glow(0x050608),
  };
}

/**
 * Edificio genérico: caja con fachada de ventanas.
 * @param {object} o  x, z (centro), w (a lo largo de x), d (a lo largo de z), h, color, night, rnd, style
 */
export function genericBuilding(parent, { x, z, w, d, h, color, night = 0, rnd = Math.random, style }) {
  const palette = ["#a29a8f", "#8d939a", "#b8ad9c", "#7f8a92", "#c2b6a3", "#9b8e84", "#6f7b86", "#d0c7b8"];
  const base = color || palette[Math.floor(rnd() * palette.length)];
  const st = style || (rnd() < 0.25 ? "glass" : "grid");
  const floors = Math.max(2, Math.round(h / 3.2));
  const tex = facadeTexture({ base, glass: st === "glass" ? "#41566b" : "#33414f", lit: night > 0.5 ? 0.45 : 0, cols: 4, rows: 8, style: st, seed: rnd });
  tex.repeat.set(Math.max(1, Math.round(Math.max(w, d) / 7)), floors / 8);
  const mat = std(0xffffff, { map: tex, rough: st === "glass" ? 0.35 : 0.85, metal: st === "glass" ? 0.3 : 0.05 });
  const m = addBox(parent, w, h, d, mat, x, h / 2, z);
  // Remate de azotea
  addBox(parent, w * 0.4, 2.2, d * 0.35, std(0x6b6f73), x + (rnd() - 0.5) * w * 0.3, h + 1.1, z + (rnd() - 0.5) * d * 0.3);
  return m;
}

/** Árbol: redondo (plátano oriental, típico de Santiago) o palmera. */
export function tree(parent, M, x, z, s = 1, kind = "round") {
  if (kind === "palm") {
    addMesh(parent, new THREE.CylinderGeometry(0.18 * s, 0.28 * s, 9 * s, 6), M.trunk, x, 4.5 * s, z);
    for (let i = 0; i < 7; i++) {
      const leaf = addMesh(parent, new THREE.ConeGeometry(0.5 * s, 4 * s, 4), M.palm, x, 9 * s, z);
      leaf.rotation.set(Math.PI / 2.6, (i / 7) * Math.PI * 2, 0, "YXZ");
      leaf.translateY(1.6 * s);
    }
    return;
  }
  addMesh(parent, new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 3.2 * s, 6), M.trunk, x, 1.6 * s, z);
  const crown = addMesh(parent, new THREE.IcosahedronGeometry(2.3 * s, 1), M.leaves, x, 4.6 * s, z);
  crown.scale.set(1, 0.85, 1);
}

/** Farol de calle (la luz es emisiva: no gasta luces reales). */
export function streetLamp(parent, M, x, z, armDir = 1) {
  addMesh(parent, new THREE.CylinderGeometry(0.07, 0.1, 7, 6), M.metal, x, 3.5, z);
  addBox(parent, 1.6, 0.08, 0.08, M.metal, x + armDir * 0.8, 6.95, z);
  addBox(parent, 0.7, 0.16, 0.32, M.lampOn, x + armDir * 1.5, 6.86, z);
}

export function bench(parent, M, x, z, rotY = 0) {
  const g = new THREE.Group();
  addBox(g, 1.8, 0.08, 0.45, std(0x6b4a2f), 0, 0.45, 0);
  addBox(g, 1.8, 0.4, 0.06, std(0x6b4a2f), 0, 0.7, -0.2);
  addBox(g, 0.06, 0.45, 0.4, M.metal, -0.8, 0.22, 0);
  addBox(g, 0.06, 0.45, 0.4, M.metal, 0.8, 0.22, 0);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  parent.add(g);
}

/** Bandera chilena en un mástil. */
export function chileanFlag(parent, M, x, z, h = 16) {
  addMesh(parent, new THREE.CylinderGeometry(0.08, 0.12, h, 6), M.steel, x, h / 2, z);
  const c = makeCanvas(192, 128), g = c.getContext("2d");
  g.fillStyle = "#d52b1e"; g.fillRect(0, 64, 192, 64);
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 192, 64);
  g.fillStyle = "#0039a6"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#ffffff"; g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 8 : 20, a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshStandardMaterial({ map: toTexture(c), side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(x, h - 1.1, z + 1.55);
  flag.rotation.y = Math.PI / 2;           // de cara a la avenida (eje X)
  parent.add(flag);
}
