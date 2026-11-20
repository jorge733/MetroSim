/* =========================================================================
   RedMoviSim — 2.21 · render/vehicles.js
   Autos y buses con forma de verdad (antes eran cajas): la carrocería sale del
   perfil lateral del modelo (capó, parabrisas inclinado, techo, maleta y los
   pasos de rueda recortados), con ruedas con llanta, focos, parrilla,
   parachoques, espejos y patente blanca como las chilenas.

   Cada modelo se arma una sola vez y queda en caché como geometrías unidas por
   material («ranuras»: pintura, vidrio, plástico negro, neumático, llanta,
   focos, luces traseras, patente). Así un auto son ~8 mallas y los autos de
   la vista desde el tren pueden ir instanciados (render/outdoor.js).

   Ejes del modelo: centrado en el origen, el suelo en y = 0 y el FRENTE hacia −z.
   ========================================================================= */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Medidas de cada tipo de auto (m). zf/zr: ejes delantero y trasero; A..C: dónde empieza y termina la cabina. */
export const CAR_KINDS = {
  //          largo ancho alto  rueda despeje cintura capó-nariz  A     techo-ini techo-fin  C     maleta
  sedan:  { L: 4.5,  W: 1.80, H: 1.44, r: 0.32, cb: 0.22, belt: 0.92, nose: 0.70, A: -0.95, Ar: -0.25, Cr: 0.75, C: 1.42, tail: 0.95, zf: -1.42, zr: 1.32 },
  hatch:  { L: 4.0,  W: 1.74, H: 1.48, r: 0.31, cb: 0.22, belt: 0.93, nose: 0.72, A: -0.75, Ar: -0.05, Cr: 1.45, C: 1.86, tail: 1.02, zf: -1.27, zr: 1.25 },
  suv:    { L: 4.55, W: 1.88, H: 1.70, r: 0.37, cb: 0.32, belt: 1.08, nose: 0.92, A: -0.98, Ar: -0.3,  Cr: 1.7,  C: 2.06, tail: 1.12, zf: -1.36, zr: 1.36 },
  van:    { L: 4.7,  W: 1.92, H: 1.98, r: 0.34, cb: 0.26, belt: 1.05, nose: 0.92, A: -1.82, Ar: -1.3,  Cr: 2.22, C: 2.26, tail: 1.12, zf: -1.5,  zr: 1.45 },
  pickup: { L: 5.1,  W: 1.85, H: 1.78, r: 0.38, cb: 0.34, belt: 1.12, nose: 0.98, A: -1.2,  Ar: -0.55, Cr: 0.45, C: 0.62, tail: 1.12, zf: -1.62, zr: 1.55 },
};

/** Colores habituales del parque automotor (mucho blanco, gris y negro). */
export const CAR_COLORS = ["#e9ebed", "#e9ebed", "#c3c7cc", "#8a9099", "#55595f", "#16181c", "#16181c", "#9b1d22", "#1f3f73", "#2f6f8f", "#d8d2c2", "#4c5a4a", "#6b4a2f", "#b8a24a"];

/** Elige un tipo según lo que se ve en Santiago (sobre todo sedanes, hatchbacks y SUV; algunas camionetas). */
export function pickCarKind(rnd, van = false) {
  if (van) return "van";
  const u = rnd();
  return u < 0.34 ? "sedan" : u < 0.62 ? "hatch" : u < 0.88 ? "suv" : "pickup";
}

/* ---------------------------------------------------------------------
   Materiales compartidos (todo menos la pintura y las luces que se encienden)
   --------------------------------------------------------------------- */
let SHARED = null;
export function sharedVehicleMaterials() {
  if (SHARED) return SHARED;
  const ms = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
  SHARED = {
    glass: ms("#1a232c", { roughness: 0.06, metalness: 0.6 }),
    trim: ms("#1b1d20", { roughness: 0.75 }),
    tire: ms("#151617", { roughness: 0.95 }),
    rim: ms("#b9bec4", { roughness: 0.3, metalness: 0.85 }),
    plate: ms("#f2f2ee", { roughness: 0.5 }),
    head: ms("#dfe6ec", { roughness: 0.1, metalness: 0.6, emissive: new THREE.Color("#fff4d8"), emissiveIntensity: 0.15 }),
    tail: ms("#5a0b0b", { roughness: 0.25, emissive: new THREE.Color("#ff1a10"), emissiveIntensity: 0.3 }),
  };
  for (const m of Object.values(SHARED)) m.userData.shared = true;
  return SHARED;
}

/* ---------------------------------------------------------------------
   Piezas
   --------------------------------------------------------------------- */
const flat = (g) => (g.index ? g.toNonIndexed() : g);
function boxAt(w, h, d, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}
/** Pilar recto entre dos puntos del plano lateral (z, y), a la distancia x del centro. Va corrido hacia el lado
 *  de la cabina (a la derecha del sentido 0 → 1) para no asomarse por fuera del techo. */
function strut(x, z0, y0, z1, y1, w, t) {
  const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
  const nz = dy / len, ny = -dz / len;
  const g = new THREE.BoxGeometry(w, t, len - 0.06);
  g.rotateX(-Math.atan2(dy, dz));
  g.translate(x, (y0 + y1) / 2 + ny * t / 2, (z0 + z1) / 2 + nz * t / 2);
  return g;
}
/** Perfil lateral (en el plano z–y) extruido a lo ancho, centrado en x = 0. */
function extrudeSide(shape, width, bevel = 0.05) {
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);                 // x del perfil → z del mundo
  return g;
}
function cylX(r, w, seg, x, y, z) {
  const g = new THREE.CylinderGeometry(r, r, w, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Tramos de [a, b] que quedan fuera de los huecos (ordenados). */
export function spansOutside(a, b, gaps) {
  const out = []; let x = a;
  for (const [g0, g1] of gaps) { if (g0 > x) out.push([x, Math.min(g0, b)]); x = Math.max(x, g1); }
  if (x < b) out.push([x, b]);
  return out.filter(([p, q]) => q - p > 0.02);
}

/** Paso de rueda en el borde de abajo de un perfil lateral (se recorre de atrás hacia adelante). */
function archTo(s, zw, cy, ra, yb) {
  const dy = Math.max(0, cy - yb), dz = Math.sqrt(Math.max(0.01, ra * ra - dy * dy));
  const a0 = Math.atan2(yb - cy, dz);
  s.lineTo(zw + dz, yb);
  s.absarc(zw, cy, ra, a0, Math.PI - a0, false);
}

/** Rueda (neumático, llanta con rayos y tapa) en (x, y, z); `out` = ±1 hacia qué lado mira la llanta. */
function wheelParts(P, x, y, z, r, w, out) {
  P.tire.push(cylX(r, w, 20, x, y, z));
  P.tire.push(cylX(r * 0.82, w + 0.01, 20, x, y, z));                 // flanco
  P.rim.push(cylX(r * 0.6, 0.02, 18, x + out * (w / 2 + 0.005), y, z));
  for (let k = 0; k < 5; k++) {                                         // rayos
    const a = (k / 5) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.03, r * 0.95, 0.07);
    g.rotateX(a);
    g.translate(x + out * (w / 2 + 0.012), y, z);
    P.rim.push(g);
  }
  P.trim.push(cylX(r * 0.14, 0.03, 10, x + out * (w / 2 + 0.02), y, z));
}

/** Arma las geometrías de un tipo de auto (unidas por material). */
function buildCar(kind) {
  const k = CAR_KINDS[kind];
  const { L, W, H, r, cb, belt, nose, A, Ar, Cr, C, tail, zf, zr } = k;
  const zF = -L / 2, zR = L / 2;
  const fF = zF - 0.05, fR = zR + 0.05;                    // caras de adelante y de atrás (con el biselado)
  const P = { paint: [], glass: [], trim: [], tire: [], rim: [], head: [], tail: [], plate: [] };

  // --- Carrocería baja: perfil con capó, cintura, maleta y los pasos de rueda ---
  const s = new THREE.Shape();
  const ra = r + 0.07;
  const arch = (zw) => archTo(s, zw, r, ra, cb);
  const vanLike = kind === "van";
  s.moveTo(zF + 0.08, cb);
  s.lineTo(zF, cb + 0.14);
  s.lineTo(zF - 0.01, nose - 0.12);
  s.quadraticCurveTo(zF, nose, zF + 0.18, nose + 0.02);   // canto del capó
  if (vanLike) s.lineTo(A, belt);
  else s.quadraticCurveTo(A - 0.4, belt - 0.02, A, belt);  // capó que sube hacia el parabrisas
  if (kind === "pickup") {
    s.lineTo(C + 0.1, belt);
    s.lineTo(zR - 0.04, belt);                             // borde de la caja
  } else if (kind === "sedan") {
    s.lineTo(C, belt + 0.02);
    s.quadraticCurveTo(zR - 0.35, tail + 0.02, zR - 0.12, tail);   // maleta
  } else {
    s.lineTo(C, belt + 0.02);
    s.lineTo(zR - 0.06, Math.max(belt, tail - 0.05));
  }
  s.quadraticCurveTo(zR + 0.02, tail - 0.05, zR, tail - 0.25);
  s.lineTo(zR + 0.01, cb + 0.14);
  s.lineTo(zR - 0.08, cb);
  arch(zr);
  arch(zf);
  s.lineTo(zF + 0.08, cb);
  P.paint.push(extrudeSide(s, W, 0.06));

  // --- Cabina de vidrio (parabrisas, laterales y luneta) con techo y pilares pintados ---
  const Wg = W - (vanLike ? 0.12 : 0.24);
  const top = H - 0.06;
  const cab = new THREE.Shape();
  cab.moveTo(A, belt - 0.02);
  cab.lineTo(Ar, top);
  cab.lineTo(Cr, top);
  cab.lineTo(C, belt);
  cab.lineTo(A, belt - 0.02);
  P.glass.push(extrudeSide(cab, Wg, 0.03));
  const roof = new THREE.Shape();
  roof.moveTo(Ar - 0.06, top - 0.04);
  roof.quadraticCurveTo(Ar + 0.1, top + 0.07, Ar + 0.3, top + 0.07);
  roof.lineTo(Cr - 0.25, top + 0.07);
  roof.quadraticCurveTo(Cr - 0.08, top + 0.07, Cr + 0.05, top - 0.04);
  roof.lineTo(Ar - 0.06, top - 0.04);
  P.paint.push(extrudeSide(roof, Wg + 0.04, 0.03));
  for (const sx of [-1, 1]) {
    const x = sx * (Wg / 2 + 0.005);
    P.paint.push(strut(x, A, belt, Ar, top, 0.05, 0.09));                      // pilar A
    P.paint.push(strut(x, Cr, top, C, belt, 0.05, vanLike ? 0.12 : 0.24));      // pilar C
    const zb = kind === "pickup" ? (A + C) / 2 + 0.25 : (Ar + Cr) / 2 - 0.05;   // pilar B
    P.trim.push(boxAt(0.04, top - belt, 0.09, x, (top + belt) / 2, zb));
    if (kind === "suv" || kind === "van") P.trim.push(boxAt(0.04, top - belt, 0.07, x, (top + belt) / 2, (zb + Cr) / 2 + 0.2));
    // Línea de las puertas, manillas y espejo
    P.trim.push(boxAt(0.012, belt - cb - 0.18, 0.012, sx * (W / 2 + 0.002), (belt + cb) / 2 + 0.04, zb));
    for (const zz of [zb - 0.35, kind === "pickup" ? null : zb + 0.75]) if (zz != null) P.trim.push(boxAt(0.025, 0.035, 0.16, sx * (W / 2 + 0.01), belt - 0.12, zz));
    P.trim.push(boxAt(0.04, 0.05, 0.08, sx * (Wg / 2 + 0.05), belt + 0.05, A + 0.16));
    P.paint.push(boxAt(0.12, 0.12, 0.2, sx * (Wg / 2 + 0.14), belt + 0.1, A + 0.2));
    P.trim.push(boxAt(0.05, 0.05, Math.abs(zr - zf) - 2 * ra - 0.05, sx * (W / 2 - 0.02), cb + 0.04, (zf + zr) / 2));   // estribo
  }
  if (kind === "pickup") P.trim.push(boxAt(W - 0.2, 0.02, zR - C - 0.35, 0, belt + 0.005, (C + zR) / 2 + 0.05));   // la caja (con cubierta)
  if (kind === "suv") for (const sx of [-1, 1]) P.trim.push(boxAt(0.04, 0.04, Cr - Ar, sx * (Wg / 2 - 0.12), top + 0.1, (Ar + Cr) / 2));   // barras del techo

  // --- Frente: focos, parrilla, parachoques y patente ---
  const ly = nose - 0.08;
  for (const sx of [-1, 1]) {
    P.head.push(boxAt(0.4, 0.11, 0.06, sx * (W / 2 - 0.3), ly, fF + 0.01));
    P.trim.push(boxAt(0.22, 0.05, 0.04, sx * (W / 2 - 0.22), cb + 0.2, fF));          // antiniebla
  }
  P.trim.push(boxAt(W * 0.42, 0.15, 0.04, 0, ly - 0.07, fF + 0.005));                   // parrilla
  P.trim.push(boxAt(W - 0.02, 0.13, 0.16, 0, cb + 0.1, fF + 0.04));                     // parachoques
  P.plate.push(boxAt(0.4, 0.13, 0.02, 0, cb + 0.26, fF - 0.01));
  // --- Atrás: luces, parachoques y patente ---
  const ty = kind === "van" ? belt + 0.15 : tail - 0.14;
  for (const sx of [-1, 1]) {
    if (kind === "van") P.tail.push(boxAt(0.12, 0.42, 0.06, sx * (W / 2 - 0.1), ty, fR - 0.01));
    else P.tail.push(boxAt(0.38, 0.13, 0.06, sx * (W / 2 - 0.24), ty, fR - 0.01));
  }
  if (kind === "pickup") P.trim.push(boxAt(W - 0.3, 0.02, 0.02, 0, tail - 0.08, fR + 0.005));
  P.trim.push(boxAt(W - 0.02, 0.14, 0.16, 0, cb + 0.11, fR - 0.04));
  P.plate.push(boxAt(0.4, 0.13, 0.02, 0, cb + 0.38, fR + 0.01));

  // --- Ruedas ---
  for (const zw of [zf, zr]) for (const sx of [-1, 1]) wheelParts(P, sx * (W / 2 - 0.13), r, zw, r, 0.22, sx);

  const out = { kind, L, W, H, geos: {} };
  for (const [slot, list] of Object.entries(P)) if (list.length) out.geos[slot] = mergeGeometries(list.map(flat), false);
  for (const g of Object.values(out.geos)) { g.computeBoundingSphere(); g.userData.shared = true; }
  return out;
}

const CACHE = new Map();
/** Geometrías (en caché) de un tipo de auto: { L, W, H, geos: { paint, glass, trim, tire, rim, head, tail, plate } }. */
export function carModel(kind) {
  if (!CACHE.has(kind)) CACHE.set(kind, buildCar(kind));
  return CACHE.get(kind);
}

/**
 * Un auto listo para la escena (frente hacia −z, centrado). `mats` puede reemplazar cualquier
 * material (siempre hay que dar `paint`); lo demás usa los compartidos.
 */
export function carGroup(kind, mats) {
  const model = carModel(kind), S = sharedVehicleMaterials();
  const g = new THREE.Group();
  for (const [slot, geo] of Object.entries(model.geos)) {
    const m = new THREE.Mesh(geo, mats[slot] ?? S[slot]);
    m.castShadow = m.receiveShadow = slot === "paint";
    m.userData.slot = slot;
    g.add(m);
  }
  g.userData.model = model;
  return g;
}

/* ---------------------------------------------------------------------
   Bus de la calle (decorado): blanco con la franja de color, sin interior
   --------------------------------------------------------------------- */
/** Sección del bus con las esquinas del techo redondeadas (plano x–y), extruida a lo largo. */
function roundedSection(W, y0, y1, rTop, rBot = 0.06) {
  const s = new THREE.Shape(), w = W / 2;
  s.moveTo(-w + rBot, y0);
  s.lineTo(w - rBot, y0);
  s.quadraticCurveTo(w, y0, w, y0 + rBot);
  s.lineTo(w, y1 - rTop);
  s.quadraticCurveTo(w, y1, w - rTop, y1);
  s.lineTo(-w + rTop, y1);
  s.quadraticCurveTo(-w, y1, -w, y1 - rTop);
  s.lineTo(-w, y0 + rBot);
  s.quadraticCurveTo(-w, y0, -w + rBot, y0);
  return s;
}
function extrudeLong(shape, len) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -len / 2);
  return g;
}

/** Ruedas del bus con los arcos negros: se agregan a P (por material). */
export function busWheelParts(P, W, axles, r = 0.5) {
  for (const zw of axles) for (const sx of [-1, 1]) {
    wheelParts(P, sx * (W / 2 - 0.2), r, zw, r, 0.3, sx);
    const a = new THREE.TorusGeometry(r + 0.1, 0.05, 6, 16, Math.PI);
    a.rotateY(Math.PI / 2);
    a.translate(sx * (W / 2 + 0.01), r, zw);
    P.trim.push(a);
  }
}

let BUS_MODEL = null;
/** Geometrías del bus de la calle (12 m, frente hacia −z). */
export function streetBusModel() {
  if (BUS_MODEL) return BUS_MODEL;
  const L = 12, W = 2.5, H = 3.1, zF = -L / 2, zR = L / 2;
  const P = { paint: [], stripe: [], glass: [], trim: [], tire: [], rim: [], head: [], tail: [], plate: [], sign: [] };
  // Abajo, el perfil lateral con los pasos de rueda; arriba, la caja con las esquinas del techo redondeadas
  const AX = [-3.4, 2.9];
  const lo = new THREE.Shape();
  lo.moveTo(zF, 0.38); lo.lineTo(zF, 1.32); lo.lineTo(zR, 1.32); lo.lineTo(zR, 0.38);
  for (const zw of [...AX].reverse()) archTo(lo, zw, 0.5, 0.64, 0.38);
  lo.lineTo(zF, 0.38);
  P.paint.push(extrudeSide(lo, W, 0.04));
  P.paint.push(extrudeLong(roundedSection(W, 1.3, H, 0.22, 0.01), L));
  P.paint.push(boxAt(W - 0.6, 0.3, 3.0, 0, H + 0.13, 1.2));            // aire acondicionado
  // Ventanas (banda oscura a los lados), parabrisas de una pieza y luneta
  for (const sx of [-1, 1]) {
    P.glass.push(boxAt(0.02, 1.12, L - 1.4, sx * (W / 2 + 0.006), 2.2, 0.35));
    for (const z of [-3.3, -0.9, 1.5, 3.9]) P.trim.push(boxAt(0.02, 1.12, 0.08, sx * (W / 2 + 0.012), 2.2, z));
    for (const [a, b] of spansOutside(zF + 0.15, zR - 0.15, AX.map(z => [z - 0.7, z + 0.7]))) {
      P.stripe.push(boxAt(0.02, 0.4, b - a, sx * (W / 2 + 0.008), 0.85, (a + b) / 2));
      P.trim.push(boxAt(0.04, 0.1, b - a, sx * (W / 2 + 0.01), 0.42, (a + b) / 2));   // zócalo
    }
  }
  P.glass.push(boxAt(W - 0.16, 1.55, 0.03, 0, 1.95, zF - 0.01));
  P.trim.push(boxAt(W - 0.1, 0.3, 0.03, 0, 2.9, zF - 0.012));          // marco del letrero
  P.sign.push(boxAt(1.9, 0.22, 0.02, 0, 2.9, zF - 0.025));
  P.glass.push(boxAt(W - 0.5, 0.85, 0.03, 0, 2.25, zR + 0.01));
  P.stripe.push(boxAt(W - 0.3, 0.4, 0.03, 0, 0.85, zF - 0.008));
  // Frente: parachoques, focos y patente · atrás: rejilla del motor, luces y patente
  P.trim.push(boxAt(W + 0.02, 0.32, 0.16, 0, 0.5, zF + 0.02));
  P.trim.push(boxAt(W + 0.02, 0.32, 0.16, 0, 0.5, zR - 0.02));
  for (const sx of [-1, 1]) {
    P.head.push(boxAt(0.42, 0.16, 0.04, sx * (W / 2 - 0.36), 0.88, zF - 0.012));
    P.tail.push(boxAt(0.22, 0.5, 0.04, sx * (W / 2 - 0.2), 1.05, zR + 0.012));
    P.trim.push(boxAt(0.06, 0.06, 0.4, sx * (W / 2 + 0.15), 2.35, zF + 0.25));   // espejos
    P.trim.push(boxAt(0.1, 0.42, 0.06, sx * (W / 2 + 0.2), 2.15, zF + 0.05));
  }
  for (let i = 0; i < 6; i++) P.trim.push(boxAt(W - 0.7, 0.04, 0.03, 0, 1.1 + i * 0.08, zR + 0.012));
  P.plate.push(boxAt(0.4, 0.13, 0.02, 0, 0.5, zF - 0.07));
  P.plate.push(boxAt(0.4, 0.13, 0.02, 0, 1.55, zR + 0.012));
  // Puertas al lado derecho (+x, mirando hacia −z)
  for (const z of [-5.3, -0.6, 4.6]) P.glass.push(boxAt(0.03, 2.3, 1.15, W / 2 + 0.014, 1.55, z));
  busWheelParts(P, W, AX);
  BUS_MODEL = { L, W, H, geos: {} };
  for (const [slot, list] of Object.entries(P)) if (list.length) BUS_MODEL.geos[slot] = mergeGeometries(list.map(flat), false);
  for (const g of Object.values(BUS_MODEL.geos)) { g.computeBoundingSphere(); g.userData.shared = true; }
  return BUS_MODEL;
}

/** Bus de la calle como grupo (frente hacia −z, centrado). */
export function streetBusGroup(mats) {
  const model = streetBusModel(), S = sharedVehicleMaterials();
  const g = new THREE.Group();
  for (const [slot, geo] of Object.entries(model.geos)) {
    const m = new THREE.Mesh(geo, mats[slot] ?? S[slot]);
    m.castShadow = slot === "paint";
    g.add(m);
  }
  return g;
}

const WHEELS = new Map();
/** Rueda suelta que gira (rotation.x): neumático, llanta y tapa, centrada; `out` = ±1 hacia dónde mira la llanta. */
export function wheelGroup(r, w, out) {
  const key = `${r}|${w}|${out}`;
  if (!WHEELS.has(key)) {
    const P = { tire: [], rim: [], trim: [] };
    wheelParts(P, 0, 0, 0, r, w, out);
    const geos = {};
    for (const [k, list] of Object.entries(P)) { geos[k] = mergeGeometries(list.map(flat), false); geos[k].userData.shared = true; }
    WHEELS.set(key, geos);
  }
  const S = sharedVehicleMaterials(), g = new THREE.Group();
  for (const [k, geo] of Object.entries(WHEELS.get(key))) g.add(new THREE.Mesh(geo, S[k]));
  return g;
}
