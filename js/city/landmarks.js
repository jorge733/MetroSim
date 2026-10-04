/* ==========================================================================
   MetroSim — Alpha 0.9 · city/landmarks.js
   Modelos procedurales de los HITOS (catálogo en city/catalog.js).

   Marco de cada modelo: el origen está en la línea de fachadas de la vereda
   OESTE de la avenida; +X apunta hacia la calle y el hito crece hacia −X.
   Entre x = −plaza y x = 0 queda una explanada transitable (plaza, atrio,
   escalinata); detrás está el edificio. Z es el eje de la avenida.

   Cada constructor devuelve:
     plaza   profundidad de la explanada transitable (m)
     halfZ   medio largo que ocupa a lo largo de la avenida
     blocks  rectángulos NO transitables dentro de la explanada {x0,x1,z0,z1}
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox } from "../utils.js";
import { facadeTexture, signMaterial, facingPlane, gableGeometry, addMesh, tree, bench, chileanFlag, genericBuilding } from "./kit.js";

const hex = (c, fallback) => new THREE.Color(c || fallback);
const facadeMat = (color, o = {}) => {
  const tex = facadeTexture({ base: color, lit: o.night > 0.5 ? (o.lit ?? 0.35) : 0, cols: o.cols ?? 6, rows: o.rows ?? 4, style: o.style ?? "classic", glass: o.glass ?? "#2c3640" });
  tex.repeat.set(o.rx ?? 4, o.ry ?? 1);
  return std(0xffffff, { map: tex, rough: o.rough ?? 0.85, metal: o.metal ?? 0.05 });
};

/** Escalinata frontal (caja escalonada), de x0 a x1, ancho w (z). */
function steps(g, M, x0, x1, w, n = 3, h = 1.2) {
  for (let i = 0; i < n; i++) {
    const t = i / n;
    addBox(g, (x1 - x0) * (1 - t), h / n, w, M.stone, x0 + ((x1 - x0) * (1 - t)) / 2, (h / n) * (i + 0.5), 0);
  }
}

/** Pórtico con columnas y frontón (fachada mirando a +X en x = front). */
function portico(g, M, mat, { front, width, height, cols = 6, depth = 4 }) {
  const r = 0.55;
  for (let i = 0; i < cols; i++) {
    const z = -width / 2 + (width / (cols - 1)) * i;
    addMesh(g, new THREE.CylinderGeometry(r, r * 1.1, height, 12), mat, front - 1, 1.2 + height / 2, z);
  }
  addBox(g, depth, 1.4, width + 2, mat, front - depth / 2 + 0.5, 1.2 + height + 0.7, 0);
  const ped = addMesh(g, gableGeometry(width + 2, 3.2, depth), mat, front - depth / 2 + 0.5, 1.2 + height + 1.4, 0);
  ped.rotation.y = Math.PI / 2;
}

/* ==========================================================================
   Constructores por tipo
   ========================================================================== */

/** Mall: gran volumen con atrio de vidrio y franja de color con el letrero. */
function mall(g, lm, M, { night }) {
  const P = 14, W = 80, D = 54, H = 17;
  const body = facadeMat("#d9d6cf", { night, style: "grid", rows: 3, cols: 8, rx: 6, glass: "#5d6f80" });
  addBox(g, D, H, W, body, -P - D / 2, H / 2, 0);
  const brand = std(hex(lm.color, "#1f9a52"), { rough: 0.6 });
  addBox(g, 1.2, 3.4, W, brand, -P + 0.6, H - 1.7, 0);
  facingPlane(g, 46, 2.6, signMaterial(lm.sign || lm.name, { bg: lm.color || "#1f9a52", font: "900 96px Arial" }), -P + 1.25, H - 1.7, 0, 1);
  // Atrio de acceso de vidrio
  const glass = std(0x9fc6e0, { metal: 0.4, rough: 0.08, transparent: true, opacity: 0.55 });
  addBox(g, 7, 13, 18, glass, -P + 3.5, 6.5, 0);
  addBox(g, 7.4, 0.5, 18.4, brand, -P + 3.5, 13.2, 0);
  facingPlane(g, 6, 3, M.shopGlow, -P + 7.05, 1.6, 0, 1);         // puertas iluminadas
  // Estacionamientos y vidrieras laterales
  [-28, 28].forEach(z => facingPlane(g, 14, 4, M.shopGlow, -P + 0.05, 2.4, z, 1));
  // Jardineras con árboles en la explanada
  const blocks = [];
  [-30, -16, 16, 30].forEach(z => {
    addBox(g, 3, 0.7, 3, M.curb, -6, 0.35, z);
    tree(g, M, -6, z, 0.9);
    blocks.push({ x0: -7.6, x1: -4.4, z0: z - 1.6, z1: z + 1.6 });
  });
  bench(g, M, -2.5, -8, -Math.PI / 2); bench(g, M, -2.5, 8, -Math.PI / 2);
  return { plaza: P, halfZ: W / 2, blocks };
}

/** Rascacielos (Costanera Center): podio comercial y torre de vidrio de 300 m. */
function skyscraper(g, lm, M, { night }) {
  const P = 16, W = 80, D = 54;
  addBox(g, D, 22, W, facadeMat("#c3c9cf", { night, style: "glass", rows: 4, cols: 8, rx: 8, glass: "#50677d", rough: 0.3, metal: 0.3 }), -P - D / 2, 11, 0);
  facingPlane(g, 34, 2.4, signMaterial(lm.sign || lm.name, { bg: "#14212e", font: "800 90px Arial" }), -P + 0.05, 18.5, 0, 1);
  facingPlane(g, 20, 4, M.shopGlow, -P + 0.05, 2.2, 0, 1);
  const towerTex = facadeTexture({ base: "#7e98ad", glass: "#4a6075", lit: night > 0.5 ? 0.5 : 0.04, cols: 8, rows: 16, style: "glass" });
  towerTex.repeat.set(6, 18);
  const towerMat = std(0xffffff, { map: towerTex, metal: 0.45, rough: 0.2 });
  const tower = addMesh(g, new THREE.CylinderGeometry(9, 15, 240, 4, 1), towerMat, -P - 27, 22 + 120, 0);
  tower.rotation.y = Math.PI / 4;
  // Corona abierta
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    addBox(g, 0.6, 26, 0.6, M.steel, -P - 27 + Math.cos(a) * 7, 22 + 240 + 13, Math.sin(a) * 7);
  }
  // Torres vecinas más bajas
  genericBuilding(g, { x: -P - 12, z: -30, w: 14, d: 14, h: 70, style: "glass", night });
  genericBuilding(g, { x: -P - 14, z: 31, w: 14, d: 12, h: 55, style: "glass", night });
  const blocks = [];
  [-22, 22].forEach(z => { tree(g, M, -5, z, 1); blocks.push({ x0: -5.6, x1: -4.4, z0: z - 0.6, z1: z + 0.6 }); });
  return { plaza: P, halfZ: W / 2, blocks };
}

/** Edificio neoclásico (Casa Central U. de Chile, UC, Bellas Artes): pórtico, frontón y cúpula opcional. */
function neoclassical(g, lm, M, { night }) {
  const P = 14, W = 66, D = 34, H = 15;
  const wall = facadeMat(lm.color || "#e7d7b4", { night, rows: 2, cols: 6, rx: 5, ry: 1 });
  const plain = std(hex(lm.color, "#e7d7b4"), { rough: 0.85 });
  addBox(g, D, H, W, wall, -P - D / 2, H / 2, 0);
  addBox(g, D + 1, 1.2, W + 1, plain, -P - D / 2, H + 0.6, 0);                  // cornisa
  steps(g, M, -P, -P + 5, 22, 4, 1.2);
  portico(g, M, plain, { front: -P + 4, width: 18, height: 10.5, cols: 6, depth: 5 });
  facingPlane(g, 3.4, 5, M.black, -P + 0.06, 3.7, 0, 1);                        // puerta
  if (lm.sign) facingPlane(g, 16, 1.2, signMaterial(lm.sign, { bg: "#2a2622", fg: "#f1e6cc", font: "700 70px Georgia" }), -P + 4.1, 13.0, 0, 1);
  if (lm.dome) {
    addMesh(g, new THREE.CylinderGeometry(7, 7, 4, 24), plain, -P - D / 2, H + 3, 0);
    const dome = addMesh(g, new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x7a8f88, { metal: 0.5, rough: 0.5 }), -P - D / 2, H + 5, 0);
    dome.scale.y = 1.1;
    addMesh(g, new THREE.CylinderGeometry(0.8, 0.8, 3, 10), plain, -P - D / 2, H + 13.5, 0);
  }
  const blocks = [{ x0: -P, x1: -P + 5, z0: -10, z1: 10 }];
  [-26, -16, 16, 26].forEach(z => { tree(g, M, -5, z, 1.1); blocks.push({ x0: -5.6, x1: -4.4, z0: z - 0.6, z1: z + 0.6 }); });
  return { plaza: P, halfZ: W / 2, blocks };
}

/** Palacio (La Moneda, Escuela Militar): volumen largo y bajo, plaza cívica y bandera. */
function palace(g, lm, M, { night }) {
  const P = 26, W = 88, D = 42, H = 11;
  const color = lm.color || "#ece6d8";
  addBox(g, D, H, W, facadeMat(color, { night, rows: 2, cols: 8, rx: 7 }), -P - D / 2, H / 2, 0);
  const plain = std(hex(color), { rough: 0.85 });
  addBox(g, D + 1, 1, W + 1, plain, -P - D / 2, H + 0.5, 0);
  addBox(g, 3, H + 2.5, 20, facadeMat(color, { night, rows: 2, cols: 3, rx: 2 }), -P + 1.5, (H + 2.5) / 2, 0);   // cuerpo central
  facingPlane(g, 4, 5.5, M.black, -P + 3.05, 2.75, 0, 1);
  // Explanada: prados y mástiles
  const blocks = [];
  [-22, 22].forEach(z => {
    addBox(g, P - 8, 0.12, 22, M.grass, -P / 2 - 1, 0.06, z);
  });
  if (lm.flag) {
    chileanFlag(g, M, -P / 2, 0, 18);
    blocks.push({ x0: -P / 2 - 0.5, x1: -P / 2 + 0.5, z0: -0.5, z1: 0.5 });
  }
  [-40, -30, 30, 40].forEach(z => { tree(g, M, -3, z, 1); blocks.push({ x0: -3.6, x1: -2.4, z0: z - 0.6, z1: z + 0.6 }); });
  return { plaza: P, halfZ: W / 2, blocks };
}

/** Monumento en una plaza (Plaza Baquedano, Los Héroes): prado, pedestal y estatua u obelisco. */
function monument(g, lm, M, { night }) {
  const P = 42, cx = -22;
  addMesh(g, new THREE.CylinderGeometry(18, 18, 0.25, 40), M.grass, cx, 0.12, 0);
  addMesh(g, new THREE.CylinderGeometry(5, 5.4, 1, 24), M.stone, cx, 0.5, 0);
  const stone = std(hex(lm.color, "#8a8f8a"), { rough: 0.8 });
  if (lm.statue === "obelisk") {
    addBox(g, 4, 3, 4, stone, cx, 2.5, 0);
    addMesh(g, new THREE.CylinderGeometry(0.9, 1.7, 18, 4), stone, cx, 13, 0).rotation.y = Math.PI / 4;
    addMesh(g, new THREE.ConeGeometry(1.2, 2, 4), stone, cx, 23, 0).rotation.y = Math.PI / 4;
  } else {
    addBox(g, 4, 4.5, 6, stone, cx, 3.25, 0);
    // Estatua ecuestre (bronce)
    const b = M.bronze, y = 5.5;
    addBox(g, 1.3, 1.5, 3.4, b, cx, y + 2.1, 0);                                 // cuerpo del caballo
    [[-0.45, -1.3], [0.45, -1.3], [-0.45, 1.3], [0.45, 1.3]].forEach(([x, z]) => addBox(g, 0.28, 1.6, 0.28, b, cx + x, y + 0.8, z));
    const neck = addBox(g, 0.7, 1.8, 0.7, b, cx, y + 3.1, 1.7); neck.rotation.x = 0.5;
    addBox(g, 0.6, 0.6, 1.3, b, cx, y + 3.8, 2.3);                                // cabeza
    addBox(g, 0.8, 1.6, 0.6, b, cx, y + 3.6, -0.2);                               // jinete
    addMesh(g, new THREE.SphereGeometry(0.34, 10, 8), b, cx, y + 4.65, -0.2);
  }
  // Árboles alrededor y edificios detrás
  const blocks = [{ x0: cx - 5.5, x1: cx + 5.5, z0: -5.5, z1: 5.5 }];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = cx + Math.cos(a) * 21, z = Math.sin(a) * 21;
    if (x > -2) continue;
    tree(g, M, x, z, 1.1);
    blocks.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 });
  }
  bench(g, M, cx + 8, -9, -Math.PI / 2); bench(g, M, cx + 8, 9, -Math.PI / 2);
  for (let z = -36; z <= 36; z += 18) genericBuilding(g, { x: -P - 10, z, w: 18, d: 16, h: 18 + Math.abs(z) * 0.4, night });
  return { plaza: P, halfZ: 38, blocks };
}

/** Cerro (Santa Lucía): colina verde, Terraza Neptuno con fuente y castillo en la cumbre. */
function hill(g, lm, M, { night }) {
  const P = 14;
  const mound = addMesh(g, new THREE.SphereGeometry(48, 24, 12), M.darkGrass, -P - 48, -8, 0);
  mound.scale.set(1, 0.62, 1.1);
  const rock = std(hex(lm.color, "#c8b48c"), { rough: 0.9 });
  // Terraza Neptuno: muro con balaustrada y escalinatas en curva
  addBox(g, 5, 8, 34, rock, -P - 2.5, 4, 0);
  addBox(g, 5.6, 0.8, 35, std(0xe8dcc0), -P - 2.5, 8.4, 0);
  [-12, 12].forEach(z => { const r = addBox(g, 10, 0.6, 4, rock, -P - 4, 4, z); r.rotation.z = -0.65; });
  facingPlane(g, 4, 4, M.water, -P + 0.06, 2.4, 0, 1);
  // Fuente en la explanada
  addMesh(g, new THREE.CylinderGeometry(3.2, 3.4, 0.8, 24), rock, -6, 0.4, 0);
  addMesh(g, new THREE.CylinderGeometry(2.8, 2.8, 0.1, 24), M.water, -6, 0.78, 0);
  // Castillo Hidalgo en la cumbre
  const top = -P - 46, ty = 20;
  addBox(g, 10, 6, 12, rock, top, ty + 3, 0);
  for (let i = -2; i <= 2; i++) addBox(g, 1.2, 1.2, 1.2, rock, top + 5, ty + 6.6, i * 2.6);
  addBox(g, 4, 9, 4, rock, top, ty + 4.5, 7);
  chileanFlag(g, M, top, -3, ty + 12);
  for (let i = 0; i < 14; i++) tree(g, M, -P - 10 - Math.random() * 40, (Math.random() - 0.5) * 70, 0.8 + Math.random() * 0.5);
  const blocks = [{ x0: -9.4, x1: -2.6, z0: -3.4, z1: 3.4 }];
  return { plaza: P, halfZ: 40, blocks };
}

/** Estación de trenes (Estación Central): nave de fierro y vidrio con fachada en arco y reloj. */
function trainhall(g, lm, M, { night }) {
  const P = 16, R = 17, L = 90;
  const iron = std(0x4b6b5c, { metal: 0.6, rough: 0.45, side: THREE.DoubleSide });
  const vault = addMesh(g, new THREE.CylinderGeometry(R, R, L, 28, 1, true, 0, Math.PI), iron, -P - L / 2, 6, 0);
  vault.rotation.z = Math.PI / 2;
  // Abanico de vidrio del frente
  const fan = addMesh(g, new THREE.CircleGeometry(R, 28, 0, Math.PI), std(0x8fb6c8, { metal: 0.3, rough: 0.1, transparent: true, opacity: 0.6, side: THREE.DoubleSide }), -P - 0.2, 6, 0);
  fan.rotation.y = Math.PI / 2;
  for (let i = 1; i < 8; i++) {                                                  // nervios del abanico
    const a = (i / 8) * Math.PI;
    const rib = addBox(g, 0.3, R, 0.3, M.metal, -P, 6 + Math.sin(a) * R / 2, Math.cos(a) * R / 2);
    rib.rotation.x = Math.PI / 2 - a;
  }
  const brick = facadeMat(lm.color || "#c9b48a", { night, rows: 2, cols: 4, rx: 2 });
  addBox(g, 6, 6, 2 * R + 2, brick, -P - 3, 3, 0);                             // basamento con accesos
  [-1, 1].forEach(s => addBox(g, 30, 14, 14, brick, -P - 15, 7, s * (R + 8)));  // alas laterales
  addMesh(g, new THREE.CircleGeometry(1.6, 24), glow(0xf3efe2), -P + 0.1, 15, 0).rotation.y = Math.PI / 2;   // reloj
  facingPlane(g, 18, 1.6, signMaterial("ESTACIÓN CENTRAL", { bg: "#2a3a33", fg: "#f1e6cc", font: "800 80px Georgia" }), -P + 0.1, 7.2, 0, 1);
  facingPlane(g, 12, 3, M.shopGlow, -P + 0.08, 1.6, 0, 1);
  const blocks = [];
  [-26, 26].forEach(z => { bench(g, M, -4, z, -Math.PI / 2); });
  return { plaza: P, halfZ: R + 15, blocks };
}

/** Catedral frente a una plaza de armas con palmeras y pileta. */
function cathedral(g, lm, M, { night }) {
  const P = 38, W = 46, D = 44, H = 18;
  const color = lm.color || "#d8cdb6";
  addBox(g, D, H, W, facadeMat(color, { night, rows: 2, cols: 5, rx: 3 }), -P - D / 2, H / 2, 0);
  const plain = std(hex(color), { rough: 0.85 });
  [-1, 1].forEach(s => {
    addBox(g, 8, 34, 8, facadeMat(color, { night, rows: 4, cols: 2, rx: 1, ry: 1 }), -P - 4, 17, s * 18);
    addMesh(g, new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x6d7f86, { metal: 0.5 }), -P - 4, 34, s * 18);
    addMesh(g, new THREE.ConeGeometry(0.6, 4, 8), M.steel, -P - 4, 38, s * 18);
  });
  const ped = addMesh(g, gableGeometry(26, 6, 3), plain, -P - 1.5, H, 0);
  ped.rotation.y = Math.PI / 2;
  facingPlane(g, 4.5, 8, M.black, -P + 0.06, 4, 0, 1);
  [-7, 7].forEach(z => facingPlane(g, 2.6, 5, M.black, -P + 0.06, 2.5, z, 1));
  addMesh(g, new THREE.CircleGeometry(1.4, 24), glow(0xf3efe2), -P - 1.4, H + 2.4, 0).rotation.y = Math.PI / 2;
  // Plaza de Armas: palmeras, pileta y bancos
  const blocks = [{ x0: -23.5, x1: -16.5, z0: -3.5, z1: 3.5 }];
  addMesh(g, new THREE.CylinderGeometry(3.4, 3.6, 0.9, 24), M.stone, -20, 0.45, 0);
  addMesh(g, new THREE.CylinderGeometry(3, 3, 0.1, 24), M.water, -20, 0.88, 0);
  for (let x = -32; x <= -6; x += 13) for (const z of [-28, -14, 14, 28]) {
    tree(g, M, x, z, 1, "palm");
    blocks.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
  }
  bench(g, M, -12, -6, -Math.PI / 2); bench(g, M, -12, 6, -Math.PI / 2);
  return { plaza: P, halfZ: 38, blocks };
}

/** Mercado (Mercado Central, Persa Bío Bío): nave con techo de fierro y gran letrero. */
function market(g, lm, M, { night }) {
  const P = 10, W = 60, D = 40, H = 10;
  addBox(g, D, H, W, facadeMat(lm.color || "#e0b84a", { night, rows: 1, cols: 6, rx: 5, style: "classic" }), -P - D / 2, H / 2, 0);
  const roof = addMesh(g, new THREE.ConeGeometry(30, 11, 4, 1), std(0x56606a, { metal: 0.6, rough: 0.5 }), -P - D / 2, H + 5.5, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(0.95, 1, 1.4);
  addMesh(g, new THREE.CylinderGeometry(2.2, 2.2, 3, 8), std(0x56606a, { metal: 0.6 }), -P - D / 2, H + 12, 0);
  facingPlane(g, 30, 3, signMaterial(lm.sign || lm.name, { bg: "#1d2731", fg: "#ffd479", font: "900 100px Arial" }), -P + 0.06, H - 1.8, 0, 1);
  facingPlane(g, 10, 4.5, M.shopGlow, -P + 0.06, 2.3, 0, 1);
  // Puestos con toldos de colores en la vereda del mercado
  const colors = [0xd84a3a, 0x2f8f5b, 0xf0b429, 0x3577c9];
  const blocks = [];
  [-22, -14, 14, 22].forEach((z, i) => {
    addBox(g, 2.4, 1, 3, std(0x7a5a3a), -4, 0.5, z);
    addBox(g, 3, 0.15, 3.6, std(colors[i]), -4, 2.4, z);
    blocks.push({ x0: -5.4, x1: -2.6, z0: z - 1.7, z1: z + 1.7 });
  });
  return { plaza: P, halfZ: W / 2, blocks };
}

/** Parque (Quinta Normal): prado, laguna, árboles y museo al fondo. */
function park(g, lm, M, { night }) {
  const P = 46;
  addBox(g, P - 2, 0.1, 86, M.grass, -P / 2, 0.05, 0);
  addMesh(g, new THREE.CircleGeometry(11, 32), M.water, -26, 0.12, -14).rotation.x = -Math.PI / 2;
  const blocks = [{ x0: -37, x1: -15, z0: -25, z1: -3 }];
  const rnd = mulberry(7);
  for (let i = 0; i < 26; i++) {
    const x = -6 - rnd() * (P - 10), z = (rnd() - 0.5) * 80;
    if (x < -14 && x > -38 && z < -1 && z > -27) continue;
    tree(g, M, x, z, 0.9 + rnd() * 0.6);
    blocks.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 });
  }
  // Museo de Historia Natural al fondo
  const plain = std(hex(lm.color, "#d6c9a8"), { rough: 0.85 });
  addBox(g, 20, 12, 50, facadeMat(lm.color || "#d6c9a8", { night, rows: 2, cols: 6, rx: 4 }), -P - 10, 6, 0);
  portico(g, M, plain, { front: -P + 2, width: 14, height: 8, cols: 6, depth: 4 });
  bench(g, M, -8, 10, -Math.PI / 2); bench(g, M, -8, 22, -Math.PI / 2);
  return { plaza: P, halfZ: 43, blocks };
}

/** Estadio: graderías de hormigón, torres de iluminación y letrero. */
function stadium(g, lm, M, { night }) {
  const P = 22, R = 62;
  const wall = std(hex(lm.color, "#d4d0c6"), { rough: 0.8, side: THREE.DoubleSide });
  const bowl = addMesh(g, new THREE.CylinderGeometry(R, R - 6, 22, 48, 1, true), wall, -P - R, 11, 0);
  bowl.scale.set(0.8, 1, 1);
  addMesh(g, new THREE.TorusGeometry(R - 3, 1.2, 6, 48), std(0x8b8f94), -P - R, 22, 0).rotation.x = Math.PI / 2;
  facingPlane(g, 30, 3, signMaterial(lm.sign || lm.name, { bg: "#c62828", font: "900 100px Arial" }), -P + 0.2 - (R - R * 0.8), 16, 0, 1);
  [[-P - 15, -45], [-P - 15, 45], [-P - 105, -45], [-P - 105, 45]].forEach(([x, z]) => {
    addBox(g, 1.2, 46, 1.2, M.steel, x, 23, z);
    addBox(g, 6, 3, 0.6, glow(night > 0.5 ? 0xffffff : 0xb0b6bc), x, 46, z);
  });
  const blocks = [];
  [-30, -18, 18, 30].forEach(z => { tree(g, M, -6, z, 1); blocks.push({ x0: -6.6, x1: -5.4, z0: z - 0.6, z1: z + 0.6 }); });
  return { plaza: P, halfZ: 44, blocks };
}

/** Templo (Votivo de Maipú): gran nave moderna con vitral y torre esbelta con cruz. */
function temple(g, lm, M, { night }) {
  const P = 24, W = 48, D = 52, H = 24;
  const concrete = std(hex(lm.color, "#cfc8bb"), { rough: 0.9 });
  addBox(g, D, H, W, concrete, -P - D / 2, H / 2, 0);
  const roof = addMesh(g, gableGeometry(W + 2, 10, D), concrete, -P - D / 2, H, 0);
  roof.rotation.y = Math.PI / 2;
  facingPlane(g, 8, 18, glow(night > 0.5 ? 0x5b8cff : 0x3f6fb0), -P + 0.06, 11, 0, 1);   // vitral
  facingPlane(g, 5, 5, M.black, -P + 0.07, 2.5, 0, 1);
  const tx = -P - 6, tz = 30;
  addBox(g, 7, 72, 7, concrete, tx, 36, tz);
  addBox(g, 0.8, 8, 0.8, M.steel, tx, 76, tz);
  addBox(g, 0.8, 0.8, 4.4, M.steel, tx, 77.5, tz);
  const blocks = [{ x0: tx - 3.6, x1: tx + 3.6, z0: tz - 3.6, z1: tz + 3.6 }];
  [-16, 16].forEach(z => { tree(g, M, -6, z, 1); blocks.push({ x0: -6.6, x1: -5.4, z0: z - 0.6, z1: z + 0.6 }); });
  return { plaza: P, halfZ: 36, blocks };
}

/** Iglesia colonial (Los Dominicos, Puente Alto): muros blancos, techo de tejas y torres. */
function church(g, lm, M, { night }) {
  const P = 22, W = 16, D = 34, H = 9;
  const white = std(hex(lm.color, "#f2efe6"), { rough: 0.9 });
  const tile = std(0xa4482c, { rough: 0.9 });
  addBox(g, D, H, W, white, -P - D / 2, H / 2, 0);
  const roof = addMesh(g, gableGeometry(W + 1.4, 4.5, D + 1), tile, -P - D / 2, H, 0);
  roof.rotation.y = Math.PI / 2;
  [-1, 1].forEach(s => {
    addBox(g, 4.5, 15, 4.5, white, -P - 2.25, 7.5, s * 6.5);
    addMesh(g, new THREE.SphereGeometry(2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), white, -P - 2.25, 15, s * 6.5);
    addMesh(g, new THREE.ConeGeometry(0.25, 1.6, 6), M.steel, -P - 2.25, 17.4, s * 6.5);
  });
  facingPlane(g, 3, 4.6, std(0x5a3a22), -P + 0.06, 2.3, 0, 1);
  addMesh(g, new THREE.CircleGeometry(1, 20), M.black, -P + 0.07, 7, 0).rotation.y = Math.PI / 2;
  // Atrio con prado y pimientos
  addBox(g, P - 6, 0.1, 30, M.grass, -P / 2 - 1, 0.05, 0);
  const blocks = [];
  [-24, -12, 12, 24].forEach(z => { tree(g, M, -8, z, 1.2); blocks.push({ x0: -8.6, x1: -7.4, z0: z - 0.6, z1: z + 0.6 }); });
  bench(g, M, -5, -5, -Math.PI / 2); bench(g, M, -5, 5, -Math.PI / 2);
  for (const z of [-30, 30]) genericBuilding(g, { x: -P - 8, z, w: 16, d: 14, h: 8, color: "#e8ddc8", night });
  return { plaza: P, halfZ: 36, blocks };
}

function mulberry(seed) {
  let a = seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const BUILDERS = { mall, skyscraper, neoclassical, palace, monument, hill, trainhall, cathedral, market, park, stadium, temple, church };

/**
 * Construye el hito de una estación.
 * @returns {{ group: THREE.Group, plaza:number, halfZ:number, blocks:Array }}
 */
export function buildLandmark(lm, M, ctx) {
  const group = new THREE.Group();
  const builder = BUILDERS[lm.type] || mall;
  const info = builder(group, lm, M, ctx);
  return { group, ...info };
}
