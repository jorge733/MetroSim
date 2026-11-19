/* ==========================================================================
   RedMoviSim — 2.17 · city/shopInterior.js
   Interior de los locales de la calle: se entra caminando por la puerta
   automática de vidrio y adentro hay estanterías con productos, el mesón con
   la caja y quien atiende, la lista de precios y la vidriera con el nombre del
   local al revés. Se compra en la caja y se sale por la misma puerta.

   El interior se arma recién al entrar (y se libera al salir), dentro del
   grupo de la calle pero lejos de ella (INSIDE), así que nunca se ve desde
   afuera. Coordenadas del interior (metros): la puerta está en x = 0, el local
   crece hacia +X (el fondo, con el mesón) y va de −W/2 a W/2 en Z.
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox, makeCanvas, toTexture } from "../utils.js";
import { formatCLP } from "../config.js";
import { seededRandom } from "./plan.js";

/** Dónde se arma el interior (coordenadas locales de la calle): lejos de todo. */
export const INSIDE = { x: -900, z: 0 };
const D = 9, W = 8, H = 3.2, FLOOR = 0.1;
const COUNTER_X = 6.3;          // frente del mesón (el cliente se para antes)

/** Rubros que tienen interior (el cajero del banco y el kiosko se atienden desde la vereda). */
export const ENTERABLE = new Set(["panaderia", "almacen", "farmacia", "cafeteria", "fuente", "floreria", "libreria"]);

/** Colores de cada rubro: muro, piso (dos tonos) y estanterías. */
const LOOK = {
  panaderia: { wall: "#efe0c6", floor: ["#c9a27a", "#b48a62"], shelf: 0x8a5a32 },
  almacen: { wall: "#f1ecd9", floor: ["#d9d6cf", "#bfbcb4"], shelf: 0xd8dade },
  farmacia: { wall: "#f6f8fa", floor: ["#e6ebef", "#d2d9df"], shelf: 0xf2f4f6 },
  cafeteria: { wall: "#d9c3a5", floor: ["#7a5838", "#6a4a2e"], shelf: 0x5a3b22 },
  fuente: { wall: "#f3ead2", floor: ["#e8e2d4", "#a13a2a"], shelf: 0xb0b4b8 },
  floreria: { wall: "#e4eedc", floor: ["#c7b9a4", "#b3a58f"], shelf: 0x6b5036 },
  libreria: { wall: "#ece3d3", floor: ["#8b6a48", "#7a5b3c"], shelf: 0x6e4c2e },
};

/* ---------------------------------------------------------------------
   Texturas
   --------------------------------------------------------------------- */

function floorTexture([a, b]) {
  const c = makeCanvas(256, 256), g = c.getContext("2d");
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) { g.fillStyle = (i + k) % 2 ? a : b; g.fillRect(i * 64, k * 64, 64, 64); }
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(D / 2.4, W / 2.4);
  return t;
}

function wallTexture(color) {
  const c = makeCanvas(256, 256), g = c.getContext("2d");
  g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  const z = g.createLinearGradient(0, 200, 0, 256);           // zócalo
  z.addColorStop(0, "rgba(0,0,0,0)"); z.addColorStop(0.2, "rgba(0,0,0,.18)"); z.addColorStop(1, "rgba(0,0,0,.25)");
  g.fillStyle = z; g.fillRect(0, 236, 256, 20);
  return toTexture(c);
}

/** Lo que se ve por la vidriera y la puerta: la vereda, la avenida y los edificios de enfrente. */
function outsideTexture(night) {
  const c = makeCanvas(512, 256), g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 150);
  sky.addColorStop(0, night ? "#0e1626" : "#a9cbea"); sky.addColorStop(1, night ? "#263248" : "#e4eef6");
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  const rnd = seededRandom("vereda");
  for (let x = -10; x < 512; ) {                               // edificios de enfrente
    const w = 50 + rnd() * 70, h = 60 + rnd() * 90;
    g.fillStyle = night ? "#1c2230" : ["#b9b2a6", "#c8c1b4", "#9fa6ad", "#d3cabb"][Math.floor(rnd() * 4)];
    g.fillRect(x, 160 - h, w - 4, h);
    g.fillStyle = night ? "#ffd98a" : "rgba(60,80,100,.45)";
    for (let y = 168 - h; y < 150; y += 14) for (let k = x + 6; k < x + w - 12; k += 14) if (!night || rnd() < 0.4) g.fillRect(k, y, 7, 8);
    x += w;
  }
  g.fillStyle = night ? "#26282c" : "#5d6166"; g.fillRect(0, 160, 512, 40);     // avenida
  g.fillStyle = night ? "#3a3a38" : "#b5afa5"; g.fillRect(0, 200, 512, 56);     // vereda
  g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(0, 0, 512, 256);           // reflejo del vidrio
  return toTexture(c);
}

/** Nombre del local en la vidriera, visto desde adentro (al revés). */
function mirroredName(text, color) {
  const c = makeCanvas(1024, 160), g = c.getContext("2d");
  g.translate(1024, 0); g.scale(-1, 1);
  g.font = "800 84px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 84;
  while (g.measureText(text).width > 940 && size > 20) { size -= 4; g.font = `800 ${size}px Arial`; }
  g.fillStyle = color; g.fillText(text, 512, 84);
  const t = toTexture(c);
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false });
}

/** Lista de precios (pizarra o cartel) con lo que vende el local. */
function priceBoard(shop) {
  const items = shop.items.slice(0, 7);
  const chalk = ["panaderia", "cafeteria", "fuente"].includes(shop.kind);
  const c = makeCanvas(512, 384), g = c.getContext("2d");
  g.fillStyle = chalk ? "#22302a" : "#ffffff"; g.fillRect(0, 0, 512, 384);
  g.strokeStyle = chalk ? "#8a6a44" : shop.color; g.lineWidth = 16; g.strokeRect(8, 8, 496, 368);
  g.fillStyle = chalk ? "#f4f0e0" : shop.color; g.textAlign = "center"; g.font = "800 40px Arial";
  g.fillText(chalk ? "PIZARRA" : "PRECIOS", 256, 58);
  g.font = "600 25px Arial";
  items.forEach((it, i) => {
    const y = 108 + i * 38;
    g.textAlign = "left"; g.fillStyle = chalk ? "#f4f0e0" : "#1d2630";
    let name = it.name;
    while (g.measureText(name).width > 330 && name.length > 4) name = name.slice(0, -2);
    g.fillText(name === it.name ? name : name + "…", 32, y);
    g.textAlign = "right"; g.fillStyle = chalk ? "#ffd166" : "#c62828";
    g.fillText(formatCLP(it.price), 480, y);
  });
  return glow(0xffffff, { map: toTexture(c) });
}

function plateTexture(lines, { bg = "#ffffff", fg = "#1d2630", w = 256, h = 128, font = "700 30px Arial" } = {}) {
  const c = makeCanvas(w, h), g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; g.font = font;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * parseInt(font.match(/(\d+)px/)[1], 10) * 1.2));
  return glow(0xffffff, { map: toTexture(c) });
}

/* ---------------------------------------------------------------------
   El interior
   --------------------------------------------------------------------- */

export class ShopInterior {
  /**
   * @param {object} shop  local del plan (city/plan.js)
   * @param {object} o     night (0..1)
   */
  constructor(shop, { night = 0 } = {}) {
    this.shop = shop;
    this.blocks = [];                      // rectángulos no transitables (x0, x1, z0, z1)
    this.group = new THREE.Group();
    this.group.position.set(INSIDE.x, 0, INSIDE.z);
    this.rnd = seededRandom(shop.name + "#adentro");
    this.items = [];                       // productos (una sola malla instanciada)
    const look = LOOK[shop.kind] || LOOK.almacen;
    this.look = look;
    this.buildRoom(look, night);
    this.buildFront(night);
    this.buildCounter(look);
    this[`fit_${shop.kind}`]?.(look);
    this.flushItems();
  }

  /* --- Consultas (coordenadas del interior) --- */

  walkable(x, z) {
    if (x < 0.35 || x > COUNTER_X - 0.3 || Math.abs(z) > W / 2 - 0.35) return false;
    return !this.blocks.some(b => x > b.x0 - 0.25 && x < b.x1 + 0.25 && z > b.z0 - 0.25 && z < b.z1 + 0.25);
  }

  atCounter(x, z) { return x > COUNTER_X - 1.5 && Math.abs(z) < 2.8; }
  nearDoor(x, z) { return x < 1.6 && Math.abs(z) < 1.3; }
  /** Cruzando la puerta hacia afuera. */
  leaving(x, z, yaw) { return x < 0.62 && Math.abs(z) < 0.95 && -Math.sin(yaw) < -0.3; }
  /** Dónde aparece el que entra (y hacia dónde mira). */
  get entry() { return { x: 1.0, z: 0, yaw: -Math.PI / 2 }; }
  get counterSpot() { return { x: COUNTER_X - 0.7, z: 0 }; }
  get floor() { return FLOOR; }

  /* --- Armado --- */

  buildRoom(look, night) {
    const g = this.group;
    const wall = std(0xffffff, { map: wallTexture(look.wall), rough: 0.9, side: THREE.BackSide });
    const floor = std(0xffffff, { map: floorTexture(look.floor), rough: 0.55, side: THREE.BackSide });
    const ceil = std(0xf4f2ee, { rough: 1, side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(D, H, W), [wall, wall, ceil, floor, wall, wall]);
    room.position.set(D / 2, FLOOR + H / 2, 0);
    g.add(room);
    // Luminarias en el cielo falso
    const lamp = glow(night > 0.5 ? 0xfff1d6 : 0xffffff);
    for (const x of [1.6, 4.2, 6.8]) for (const z of [-2.2, 0, 2.2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), lamp);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, FLOOR + H - 0.01, z);
      g.add(p);
    }
    // Nombre del local en el muro del fondo, sobre la caja
    const c = makeCanvas(1024, 160), q = c.getContext("2d");
    q.fillStyle = this.shop.color; q.fillRect(0, 0, 1024, 160);
    q.fillStyle = "#fff"; q.textAlign = "center"; q.textBaseline = "middle";
    let size = 80; q.font = `800 ${size}px Arial`;
    while (q.measureText(this.shop.name.toUpperCase()).width > 940 && size > 20) { size -= 4; q.font = `800 ${size}px Arial`; }
    q.fillText(this.shop.name.toUpperCase(), 512, 84);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.66), glow(0xffffff, { map: toTexture(c) }));
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(D - 0.02, FLOOR + 2.75, -0.6);
    g.add(sign);
    // Lista de precios
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.12), priceBoard(this.shop));
    board.rotation.y = -Math.PI / 2;
    board.position.set(D - 0.02, FLOOR + 1.85, 2.3);
    g.add(board);
  }

  /** Muro de la calle: vidriera, puerta automática (cerrada) y avisos pegados. */
  buildFront(night) {
    const g = this.group;
    const out = glow(0xffffff, { map: outsideTexture(night > 0.5) });
    const metal = std(0x50575e, { metal: 0.6, rough: 0.4 });
    const glass = std(0xbfd8e6, { metal: 0.4, rough: 0.05, transparent: true, opacity: 0.22, depthWrite: false });
    const pane = (w, h, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.rotation.y = Math.PI / 2;
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    // La calle por la vidriera (de lado a lado) y por la puerta
    pane(W - 0.3, 2.5, 0.012, FLOOR + 1.45, 0, out);
    pane(W - 0.3, 2.5, 0.05, FLOOR + 1.45, 0, glass);
    // Marcos
    addBox(g, 0.1, 0.12, W, metal, 0.06, FLOOR + 0.06, 0);
    addBox(g, 0.1, 0.14, W, metal, 0.06, FLOOR + 2.72, 0);
    for (const z of [-3.7, -1.05, 1.05, 3.7]) addBox(g, 0.1, 2.7, 0.08, metal, 0.06, FLOOR + 1.36, z);
    // Hojas de la puerta corredera (cerradas) con su tirador de goma
    for (const s of [-1, 1]) {
      addBox(g, 0.03, 2.5, 0.04, metal, 0.09, FLOOR + 1.33, s * 0.02);
      addBox(g, 0.03, 0.06, 1.0, metal, 0.09, FLOOR + 2.55, s * 0.52);
    }
    // Avisos en el vidrio: ABIERTO, horario y medios de pago
    pane(0.5, 0.2, 0.1, FLOOR + 1.55, -0.5, plateTexture(["ABIERTO"], { bg: "#1f8a3a", fg: "#fff", w: 256, h: 100, font: "800 52px Arial" }));
    pane(0.36, 0.28, 0.1, FLOOR + 1.2, 0.5, plateTexture(["HORARIO", "L–S 8:00–21:00", "DOM 10:00–14:00"], { w: 256, h: 200, font: "700 26px Arial" }));
    pane(0.4, 0.16, 0.1, FLOOR + 0.95, -0.5, plateTexture(["DÉBITO · CRÉDITO"], { bg: "#0d47a1", fg: "#fff", w: 256, h: 100, font: "800 30px Arial" }));
    // Nombre del local en la vidriera (se lee al revés desde adentro)
    pane(3.2, 0.5, 0.08, FLOOR + 2.3, 2.4, mirroredName(this.shop.name.toUpperCase(), this.shop.color));
    pane(3.2, 0.5, 0.08, FLOOR + 2.3, -2.4, mirroredName(this.shop.label.toUpperCase(), this.shop.color));
    // Felpudo
    addBox(g, 1.2, 0.02, 1.8, std(0x2b2d30, { rough: 1 }), 0.8, FLOOR + 0.01, 0);
  }

  /** Mesón con la caja, el POS de la tarjeta y quien atiende. */
  buildCounter(look) {
    const g = this.group, x0 = COUNTER_X, depth = 0.7, z0 = -2.9, z1 = 2.9;
    const body = std(new THREE.Color(this.shop.color).lerp(new THREE.Color(0xffffff), 0.35), { rough: 0.7 });
    const top = std(0xe9e6df, { rough: 0.3, metal: 0.1 });
    addBox(g, depth, 1.0, z1 - z0, body, x0 + depth / 2, FLOOR + 0.5, (z0 + z1) / 2);
    addBox(g, depth + 0.1, 0.05, z1 - z0 + 0.1, top, x0 + depth / 2 - 0.05, FLOOR + 1.02, (z0 + z1) / 2);
    this.blocks.push({ x0, x1: D, z0: -W / 2, z1: W / 2 });
    // Caja registradora y POS (con su pantalla encendida)
    const dark = std(0x23262b, { rough: 0.5 });
    addBox(g, 0.36, 0.12, 0.42, dark, x0 + 0.35, FLOOR + 1.1, -0.35);
    const screen = addBox(g, 0.05, 0.24, 0.34, dark, x0 + 0.48, FLOOR + 1.32, -0.35);
    screen.rotation.z = 0.25;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), plateTexture([formatCLP(0)], { bg: "#10324a", fg: "#7fe0ff", w: 256, h: 170, font: "700 48px Arial" }));
    disp.rotation.order = "YXZ";
    disp.rotation.set(0.25, -Math.PI / 2, 0);
    disp.position.set(x0 + 0.45, FLOOR + 1.33, -0.35);
    g.add(disp);
    const pos = addBox(g, 0.16, 0.05, 0.09, std(0x2d3238, { rough: 0.4 }), x0 + 0.14, FLOOR + 1.07, 0.25);
    pos.rotation.y = 0.4;
    addBox(g, 0.1, 0.012, 0.07, glow(0x9fe8c2), x0 + 0.14, FLOOR + 1.1, 0.25).rotation.y = 0.4;
    // Frasco de propinas y cartel de "pague aquí"
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), std(0xcfe3ea, { transparent: true, opacity: 0.5, rough: 0.05 }));
    jar.position.set(x0 + 0.15, FLOOR + 1.13, 0.75);
    g.add(jar);
    const pay = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.26), plateTexture(["CAJA · PAGUE AQUÍ"], { bg: "#ffd54a", fg: "#222", w: 512, h: 160, font: "800 56px Arial" }));
    pay.rotation.y = -Math.PI / 2;
    pay.position.set(x0 - 0.01, FLOOR + 0.72, -0.35);
    g.add(pay);
    this.clerk = this.person({ x: x0 + 1.15, z: -0.35, shirt: this.shop.color, apron: true });   // mira hacia la puerta (−X)
  }

  /** Una persona sencilla (como los peatones de la calle); con rotation.y = 0 mira hacia −X. */
  person({ x, z, shirt = 0x2d5f9a, apron = false }) {
    const rnd = this.rnd, p = new THREE.Group();
    const skin = std([0xe6c3a0, 0xc99a72, 0x8d5b3a, 0xf1d6bd][Math.floor(rnd() * 4)]);
    const cloth = std(new THREE.Color(shirt), { rough: 0.9 }), pants = std(0x262a33, { rough: 0.9 });
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); p.add(m); return m; };
    for (const s of [-0.1, 0.1]) add(new THREE.CylinderGeometry(0.075, 0.06, 0.82, 6), pants, 0, 0.5, s);
    add(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8), cloth, 0, 1.22, 0);
    if (apron) add(new THREE.BoxGeometry(0.05, 0.7, 0.3), std(0xf4f4f0, { rough: 0.9 }), -0.19, 1.05, 0);
    for (const s of [-0.25, 0.25]) add(new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6), cloth, 0, 1.22, s);
    p.head = add(new THREE.SphereGeometry(0.12, 10, 8), skin, 0, 1.68, 0);
    add(new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), std([0x1a1410, 0x3b2a1e, 0x6b4a2b, 0x9a9a9a][Math.floor(rnd() * 4)]), 0.015, 1.7, 0);
    p.position.set(x, FLOOR, z);
    this.group.add(p);
    return p;
  }

  /* --- Muebles y productos --- */

  item(x, y, z, sx, sy, sz, color) { this.items.push({ x, y, z, sx, sy, sz, color }); }

  flushItems() {
    if (!this.items.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff, { rough: 0.6 }), this.items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    this.items.forEach((it, i) => {
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(it.color));
    });
    this.group.add(mesh);
  }

  /** Estante con repisas; side = hacia dónde mira (+1: hacia +Z, −1: hacia −Z). */
  shelf({ x0, x1, z, side, depth = 0.45, levels = [0.35, 0.8, 1.25, 1.7], top = 2.0, colors, size = [0.14, 0.22, 0.12], back = true, mat }) {
    const g = this.group, rnd = this.rnd;
    mat ||= std(this.look.shelf, { rough: 0.6 });
    const zc = z + side * depth / 2;
    if (back) addBox(g, x1 - x0, top, 0.04, mat, (x0 + x1) / 2, FLOOR + top / 2, z + side * 0.02);
    for (const xe of [x0, x1]) addBox(g, 0.04, top, depth, mat, xe, FLOOR + top / 2, zc);
    addBox(g, x1 - x0, 0.12, depth, mat, (x0 + x1) / 2, FLOOR + 0.06, zc);
    for (const y of levels) {
      addBox(g, x1 - x0, 0.03, depth, mat, (x0 + x1) / 2, FLOOR + y, zc);
      if (!colors) continue;
      const [w, h, d] = size;
      for (let x = x0 + 0.06 + w / 2; x < x1 - w / 2 - 0.04; x += w + 0.02 + rnd() * 0.03) {
        if (rnd() < 0.08) continue;                                         // algún hueco
        const hh = h * (0.75 + rnd() * 0.5), col = colors[Math.floor(rnd() * colors.length)];
        for (let k = 0; k < 2; k++) this.item(x, FLOOR + y + 0.015 + hh / 2, z + side * (0.08 + d / 2 + k * (d + 0.02)), w, hh, d, col);
      }
    }
    const zz = [z, z + side * depth].sort((a, b) => a - b);
    this.blocks.push({ x0, x1, z0: zz[0], z1: zz[1] });
  }

  /** Góndola de doble cara al centro del local. */
  gondola(x0, x1, zc, colors, size) {
    const mat = std(this.look.shelf, { rough: 0.6 });
    addBox(this.group, x1 - x0, 1.5, 0.05, mat, (x0 + x1) / 2, FLOOR + 0.75, zc);
    this.shelf({ x0, x1, z: zc + 0.03, side: 1, levels: [0.3, 0.72, 1.14], top: 1.5, colors, size, back: false, mat });
    this.shelf({ x0, x1, z: zc - 0.03, side: -1, levels: [0.3, 0.72, 1.14], top: 1.5, colors, size, back: false, mat });
    // Cabecera con oferta
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), plateTexture(["OFERTA"], { bg: "#e53935", fg: "#fff", w: 256, h: 90, font: "900 54px Arial" }));
    tag.rotation.y = -Math.PI / 2;
    tag.position.set(x0 - 0.02, FLOOR + 1.75, zc);
    this.group.add(tag);
    addBox(this.group, 0.02, 0.3, 0.02, mat, x0 + 0.05, FLOOR + 1.6, zc);
  }

  /** Refrigerador con puertas de vidrio contra el muro z (side hacia el interior). */
  fridge(x0, x1, z, side) {
    const g = this.group, d = 0.7, zc = z + side * d / 2;
    addBox(g, x1 - x0, 2.2, d, std(0xe9ecef, { rough: 0.4, metal: 0.3 }), (x0 + x1) / 2, FLOOR + 1.1, zc);
    const c = makeCanvas(512, 512), q = c.getContext("2d");
    q.fillStyle = "#dff3ff"; q.fillRect(0, 0, 512, 512);
    const cols = ["#d32f2f", "#1565c0", "#2e7d32", "#f9a825", "#ffffff", "#6d4c41", "#ef6c00"], rnd = this.rnd;
    for (let r = 0; r < 5; r++) {
      q.fillStyle = "#9fb4c2"; q.fillRect(0, 96 + r * 100, 512, 6);
      for (let x = 10; x < 500; x += 30) { q.fillStyle = cols[Math.floor(rnd() * cols.length)]; q.fillRect(x, 30 + r * 100, 22, 66); q.fillRect(x + 7, 20 + r * 100, 8, 12); }
    }
    for (let x = 0; x < 512; x += 128) { q.fillStyle = "#8d99a3"; q.fillRect(x, 0, 8, 512); }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, 1.9), glow(0xffffff, { map: toTexture(c) }));
    front.position.set((x0 + x1) / 2, FLOOR + 1.1, z + side * (d + 0.005));
    if (side < 0) front.rotation.y = Math.PI;
    g.add(front);
    const zz = [z, z + side * d].sort((a, b) => a - b);
    this.blocks.push({ x0, x1, z0: zz[0], z1: zz[1] });
  }

  table(x, z, round = true) {
    const g = this.group, wood = std(0x6b4a2e, { rough: 0.6 }), metal = std(0x3a3f45, { metal: 0.6, rough: 0.4 });
    const topGeo = round ? new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20) : new THREE.BoxGeometry(0.8, 0.04, 0.8);
    const t = new THREE.Mesh(topGeo, wood); t.position.set(x, FLOOR + 0.75, z); g.add(t);
    addBox(g, 0.06, 0.73, 0.06, metal, x, FLOOR + 0.37, z);
    for (const s of [-1, 1]) {
      addBox(g, 0.4, 0.05, 0.4, wood, x, FLOOR + 0.46, z + s * 0.62);
      addBox(g, 0.4, 0.45, 0.04, wood, x, FLOOR + 0.7, z + s * 0.82);
      for (const dx of [-0.17, 0.17]) addBox(g, 0.03, 0.45, 0.03, metal, x + dx, FLOOR + 0.22, z + s * 0.62);
    }
    this.blocks.push({ x0: x - 0.45, x1: x + 0.45, z0: z - 0.85, z1: z + 0.85 });
  }

  /* --- Cada rubro --- */

  fit_almacen() {
    const prod = ["#d32f2f", "#1976d2", "#fbc02d", "#388e3c", "#f57c00", "#7b1fa2", "#ffffff", "#5d4037", "#c2185b"];
    this.shelf({ x0: 0.9, x1: 5.6, z: -W / 2, side: 1, colors: prod });
    this.fridge(1.2, 5.6, W / 2, -1);
    this.gondola(2.0, 4.8, -1.2, prod);
    this.customer = this.person({ x: 3.2, z: -3.1, shirt: 0x4a7a3a });   // mirando la estantería
    this.customer.rotation.y = -Math.PI / 2;
    this.blocks.push({ x0: 2.95, x1: 3.45, z0: -3.35, z1: -2.85 });
  }

  fit_farmacia() {
    const prod = ["#ffffff", "#e3f2fd", "#1e88e5", "#43a047", "#ffffff", "#ef5350", "#fff59d"];
    this.shelf({ x0: 0.9, x1: 5.6, z: -W / 2, side: 1, colors: prod, size: [0.12, 0.16, 0.08], levels: [0.35, 0.7, 1.05, 1.4, 1.75] });
    this.shelf({ x0: 1.4, x1: 5.6, z: W / 2, side: -1, colors: prod, size: [0.12, 0.16, 0.08], levels: [0.35, 0.7, 1.05, 1.4, 1.75] });
    // Número de atención ("su turno")
    const turn = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), plateTexture(["SU TURNO", String(10 + Math.floor(this.rnd() * 80))], { bg: "#101418", fg: "#ff5252", w: 256, h: 150, font: "800 52px Arial" }));
    turn.rotation.y = -Math.PI / 2;
    turn.position.set(D - 0.02, FLOOR + 1.85, -2.6);
    this.group.add(turn);
    // Dispensador de números junto a la entrada
    addBox(this.group, 0.2, 1.2, 0.2, std(0xd32f2f, { rough: 0.5 }), 1.5, FLOOR + 0.6, 3.2);
    this.blocks.push({ x0: 1.4, x1: 1.6, z0: 3.1, z1: 3.3 });
    // Báscula
    addBox(this.group, 0.6, 1.0, 0.5, std(0x5f6b75, { metal: 0.4 }), 1.0, FLOOR + 0.5, -2.9);
    this.blocks.push({ x0: 0.7, x1: 1.3, z0: -3.15, z1: -2.65 });
  }

  fit_panaderia() {
    const g = this.group;
    // Vitrina con dulces y empanadas delante del mesón
    const bread = ["#c8873e", "#d9a15a", "#b06e2a", "#e3b36a", "#8a4f1f"];
    const base = std(0x8a5a32, { rough: 0.7 });
    addBox(g, 0.6, 0.85, 1.8, base, COUNTER_X - 0.95, FLOOR + 0.43, -2.0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 1.8), std(0xd8ecf2, { transparent: true, opacity: 0.25, rough: 0.05, depthWrite: false }));
    glass.position.set(COUNTER_X - 0.95, FLOOR + 1.08, -2.0);
    g.add(glass);
    for (let z = -2.78; z < -1.2; z += 0.24) for (const x of [-0.12, 0.12]) this.item(COUNTER_X - 0.95 + x, FLOOR + 0.92, z, 0.18, 0.07, 0.15, bread[Math.floor(this.rnd() * bread.length)]);
    this.blocks.push({ x0: COUNTER_X - 1.25, x1: COUNTER_X - 0.65, z0: -2.9, z1: -1.1 });
    // Canastos con marraquetas y hallullas detrás del mesón
    this.shelf({ x0: COUNTER_X + 1.6, x1: D - 0.05, z: -W / 2, side: 1, colors: bread, size: [0.16, 0.08, 0.14], levels: [0.5, 1.0, 1.5] });
    this.shelf({ x0: 0.9, x1: 4.2, z: -W / 2, side: 1, colors: ["#f5e6c8", "#d84315", "#6d4c41", "#ffecb3"], size: [0.14, 0.2, 0.1] });
    this.shelf({ x0: 1.2, x1: 5.5, z: W / 2, side: -1, colors: bread, size: [0.18, 0.09, 0.16], levels: [0.5, 1.0, 1.5] });
  }

  fit_cafeteria() {
    const g = this.group;
    const machine = addBox(g, 0.5, 0.45, 0.7, std(0xb0b6bc, { metal: 0.8, rough: 0.25 }), COUNTER_X + 0.35, FLOOR + 1.27, 1.6);
    addBox(machine, 0.02, 0.1, 0.5, std(0x222222), -0.26, 0.1, 0);
    for (const z of [1.4, 1.8]) this.item(COUNTER_X + 0.08, FLOOR + 1.09, z, 0.07, 0.08, 0.07, "#ffffff");
    this.table(2.2, -2.4); this.table(4.4, -2.4); this.table(2.2, 2.3);
    this.shelf({ x0: 4.0, x1: 5.6, z: W / 2, side: -1, colors: ["#6d4c41", "#8d6e63", "#3e2723", "#d7ccc8"], size: [0.12, 0.2, 0.1], levels: [0.9, 1.4, 1.9], top: 2.2 });
    this.customer = this.person({ x: 2.2, z: -1.78, shirt: 0x7a4a8a });
    this.customer.position.y = FLOOR - 0.42;                              // sentado
    this.customer.rotation.y = -Math.PI / 2;
  }

  fit_fuente() {
    const g = this.group;
    // Plancha detrás del mesón y taburetes en la barra
    addBox(g, 0.7, 0.9, 1.6, std(0x9ea4aa, { metal: 0.7, rough: 0.3 }), D - 0.45, FLOOR + 0.45, -2.2);
    addBox(g, 0.68, 0.02, 1.5, std(0x1c1c1c, { metal: 0.6, rough: 0.5 }), D - 0.45, FLOOR + 0.91, -2.2);
    for (const z of [-2.2, -1.2, 0.8, 1.8]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), std(0xb71c1c, { rough: 0.6 }));
      seat.position.set(COUNTER_X - 0.45, FLOOR + 0.75, z); g.add(seat);
      addBox(g, 0.06, 0.72, 0.06, std(0x9ea4aa, { metal: 0.8 }), COUNTER_X - 0.45, FLOOR + 0.36, z);
      this.blocks.push({ x0: COUNTER_X - 0.65, x1: COUNTER_X - 0.25, z0: z - 0.2, z1: z + 0.2 });
    }
    for (const z of [-1.7, 1.3]) this.item(COUNTER_X + 0.2, FLOOR + 1.1, z, 0.08, 0.14, 0.08, z < 0 ? "#d32f2f" : "#f9a825");   // ketchup y mostaza
    this.table(2.0, -2.5, false); this.table(2.0, 2.4, false);
    this.fridge(3.4, 5.4, W / 2, -1);
  }

  fit_floreria() {
    const g = this.group, rnd = this.rnd;
    const petals = ["#e53935", "#ffffff", "#f06292", "#ffca28", "#ab47bc", "#ff7043"];
    const bucket = std(0x6f7a82, { metal: 0.5, rough: 0.4 }), stem = std(0x3f7a33, { rough: 0.9 });
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), std(0xffffff, { rough: 0.8 }), 480);
    let n = 0;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const stand = (x0, x1, z, side) => {
      for (let t = 0; t < 3; t++) {
        const zz = z + side * (0.25 + t * 0.4), y = 0.1 + (2 - t) * 0.3;
        addBox(g, x1 - x0, 0.05, 0.4, std(0x6b5036), (x0 + x1) / 2, FLOOR + y, zz);
        for (let x = x0 + 0.25; x < x1 - 0.2; x += 0.45) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 10), bucket);
          b.position.set(x, FLOOR + y + 0.17, zz); g.add(b);
          addBox(g, 0.22, 0.35, 0.22, stem, x, FLOOR + y + 0.45, zz);
          const col = petals[Math.floor(rnd() * petals.length)];
          for (let k = 0; k < 6 && n < 480; k++, n++) {
            const s = 0.06 + rnd() * 0.03;
            m.makeScale(s, s, s).setPosition(x + (rnd() - 0.5) * 0.24, FLOOR + y + 0.65 + rnd() * 0.12, zz + (rnd() - 0.5) * 0.24);
            flowers.setMatrixAt(n, m); flowers.setColorAt(n, c.set(col));
          }
        }
      }
      const zs = [z, z + side * 1.3].sort((a, b) => a - b);
      this.blocks.push({ x0, x1, z0: zs[0], z1: zs[1] });
    };
    stand(0.9, 5.4, -W / 2, 1);
    stand(1.4, 5.4, W / 2, -1);
    flowers.count = n;
    g.add(flowers);
    // Plantas en maceta al centro
    for (const [x, z] of [[2.8, -1.9], [4.4, 1.9]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.4, 12), std(0xb5651d, { rough: 0.9 }));
      pot.position.set(x, FLOOR + 0.2, z); g.add(pot);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), std(0x4c8a3a, { rough: 0.9 }));
      leaf.position.set(x, FLOOR + 0.75, z); g.add(leaf);
      this.blocks.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
    }
  }

  fit_libreria() {
    const books = ["#b71c1c", "#0d47a1", "#1b5e20", "#f9a825", "#4a148c", "#e65100", "#263238", "#ffffff", "#795548"];
    const tall = { colors: books, size: [0.05, 0.26, 0.17], levels: [0.3, 0.75, 1.2, 1.65, 2.1], top: 2.5 };
    this.shelf({ x0: 0.9, x1: 5.6, z: -W / 2, side: 1, ...tall });
    this.shelf({ x0: 1.4, x1: 5.6, z: W / 2, side: -1, ...tall });
    // Mesa de novedades con libros apilados
    const g = this.group;
    addBox(g, 1.8, 0.75, 1.0, std(0x6e4c2e, { rough: 0.6 }), 3.2, FLOOR + 0.375, -1.3);
    for (let x = 2.5; x < 3.95; x += 0.35) for (const z of [-1.55, -1.05]) {
      const h = 0.04 + Math.floor(this.rnd() * 4) * 0.035;
      this.item(x, FLOOR + 0.75 + h / 2, z, 0.22, h, 0.3, books[Math.floor(this.rnd() * books.length)]);
    }
    this.blocks.push({ x0: 2.3, x1: 4.1, z0: -1.8, z1: -0.8 });
  }

  /* --- Cada fotograma --- */

  /** Quien atiende mira al cliente; los demás respiran. */
  update(dt, px, pz) {
    this.t = (this.t || 0) + dt;
    if (this.clerk) {
      const a = THREE.MathUtils.clamp(Math.atan2(pz - this.clerk.position.z, this.clerk.position.x - px), -0.7, 0.7);
      this.clerk.rotation.y += (a - this.clerk.rotation.y) * Math.min(1, dt * 3);
      this.clerk.head.position.y = 1.68 + Math.sin(this.t * 1.6) * 0.004;
    }
    if (this.customer) this.customer.rotation.z = Math.sin(this.t * 0.9) * 0.015;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse(o => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach(m => { m.map?.dispose(); m.dispose(); });
    });
  }
}
