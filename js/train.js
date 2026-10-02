/* ==========================================================================
   MetroSim — Alpha 0.6 · train.js
   Tren AS-2014 de 5 coches (simplificado): exterior, intercirculación,
   salones de viajeros, pantógrafos y cabina de conducción.

   Origen del tren: centro de su vía en el testero delantero (z = 0); el tren
   se extiende hacia +Z local. Composición:
     [cabina] [intermedio+pantógrafo] [intermedio] [intermedio+pantógrafo] [cabina trasera]

   Rendimiento: todas las piezas fijas de un tren se FUSIONAN por material en
   una plantilla que comparten todos los trenes (≈ 20 llamadas de dibujo por
   tren). Las hojas de puerta del lado del andén (+X local) son dos
   InstancedMesh que se mueven al abrir. La cabina interior completa solo se
   construye para el tren del jugador.
   ========================================================================== */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG, LINE } from "./config.js";
import { ROUTE_A, ROUTE_B } from "./engine/route.js";
import { std, glow, addBox, addBoxSpan, addPlane, toTexture, lineMapCanvas, destinationCanvas } from "./utils.js";
import { CabDisplay } from "./dmi.js";
import { CAR_TYPES, CONSIST, carToTrainZ, TRAIN_LAYOUT } from "./engine/consist.js";

const T = CONFIG.train;
const CAR = T.carLength, GAP = T.carGap;

/* ==========================================================================
   Tipos de coche y composición
   ========================================================================== */

// La composición (tipos de coche, puertas, asientos) es lógica y vive en el motor
export { TRAIN_LAYOUT };

/* ==========================================================================
   Recursos compartidos (materiales, plantillas). Se recrean en cada partida.
   ========================================================================== */

let ASSETS = null;

/** Libera la caché (la escena anterior ya destruyó geometrías y materiales). */
export function resetTrainAssets() { ASSETS = null; }

/** Nombre del destino para el letrero del tren (abreviado si es muy largo). */
const signName = (st) => (st.name.length <= 20 ? st.name : st.short);

/** Material compartido del plano de línea de los coches (lo anima render/lineMapPanel.js). */
export function trainLineMapMaterial() { return ASSETS?.mat.lineMap ?? null; }

function assets() {
  if (ASSETS) return ASSETS;
  const mat = {
    body: std(0xc9d0d6, { metal: 0.65, rough: 0.32 }),
    stripe: std(LINE.colorHex, { metal: 0.3, rough: 0.4 }),    // franja del color de la línea activa
    mask: std(0x2a2e33, { metal: 0.35, rough: 0.35 }),
    black: std(0x101418, { metal: 0.3, rough: 0.5 }),
    roof: std(0x6e757b, { metal: 0.5, rough: 0.55 }),
    under: std(0x1d2024, { metal: 0.4, rough: 0.7 }),
    wheel: std(0x4a4f54, { metal: 0.85, rough: 0.35 }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fd3ef, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }),
    sideGlass: std(0x34495a, { metal: 0.2, rough: 0.1, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    lining: std(0xe1e4e6, { rough: 0.6 }),
    cabLining: std(0x3d454d, { rough: 0.7 }),
    ceiling: std(0xf0f1f2, { rough: 0.6 }),
    floor: std(0x56606a, { rough: 0.85 }),
    cabFloor: std(0x22272c, { rough: 0.9 }),
    seat: std(0x2f63b3, { rough: 0.8 }),
    seatShell: std(0xb7bec5, { metal: 0.3, rough: 0.5 }),
    pole: std(0xd8dee3, { metal: 0.9, rough: 0.2 }),
    poleYellow: std(0xf2c230, { metal: 0.2, rough: 0.4 }),
    bellows: std(0x15181b, { rough: 0.95 }),
    light: glow(0xf6f9ff),
    desk: std(0x23292f, { rough: 0.85 }),
    deskTop: std(0x15191d, { rough: 0.9 }),
    panelGrey: std(0x4a535c, { metal: 0.3, rough: 0.5 }),
    headlight: glow(0xfff6dc),
    taillight: glow(0xff1e1e),
    destination: glow(0xffffff, { map: toTexture(destinationCanvas(signName(ROUTE_A.last))) }),
    destinationB: glow(0xffffff, { map: toTexture(destinationCanvas(signName(ROUTE_B.last))) }),
    lineMap: glow(0xffffff, { map: toTexture(lineMapCanvas()) }),
  };
  ASSETS = { mat, templates: {} };

  // Hojas de puerta móviles (geometría compartida)
  const leafW = T.doorWidth / 2 + 0.02;
  ASSETS.leafBody = new THREE.BoxGeometry(0.05, T.doorHeight, leafW);
  const glassGeo = new THREE.BoxGeometry(0.06, 0.8, leafW - 0.2);
  glassGeo.translate(0, 0.35, 0);
  ASSETS.leafGlass = glassGeo;
  ASSETS.leafW = leafW;
  return ASSETS;
}

/**
 * Plantilla fusionada de un tren completo para un destino.
 * @param {"A"|"B"} routeId  destino del indicador frontal
 * @param {boolean} cabInterior  si la cabina delantera tendrá interior (jugador)
 */
function trainTemplate(routeId, cabInterior) {
  const A = assets();
  const key = `${routeId}-${cabInterior ? "cab" : "ai"}`;
  if (A.templates[key]) return A.templates[key];

  const root = new THREE.Group();
  const dest = routeId === "A" ? A.mat.destination : A.mat.destinationB;
  CONSIST.forEach((car, i) => {
    const g = new THREE.Group();
    buildCarStatic(g, car, A.mat, {
      dest,
      cabFiller: car.type === "cab" && (car.flipped || !cabInterior),
      openFront: i > 0, openRear: i < CONSIST.length - 1,
    });
    if (car.flipped) { g.rotation.y = Math.PI; g.position.z = car.offset + CAR; }
    else g.position.z = car.offset;
    root.add(g);
    if (i < CONSIST.length - 1) buildGangway(root, A.mat, car.offset + CAR);
  });
  A.templates[key] = mergeByMaterial(root);
  return A.templates[key];
}

/** Fusiona todas las mallas de un grupo en una por material. */
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const parts = [];
  for (const [material, geos] of byMat) {
    const indexed = geos.filter(g => g.index), plain = geos.filter(g => !g.index);
    if (indexed.length) parts.push({ material, geometry: mergeGeometries(indexed) });
    if (plain.length) parts.push({ material, geometry: mergeGeometries(plain) });
    geos.forEach(g => g.dispose());
  }
  return parts;
}


/* ==========================================================================
   Construcción de un coche (en coordenadas del coche: 0..18, cabina en z=0)
   ========================================================================== */

/** Pared lateral con huecos rectangulares (ventanas y puertas). */
export function buildPanelWall(parent, { x, thickness, mat, zStart, zEnd, yBottom, yTop, openings }) {
  const cuts = new Set([zStart, zEnd]);
  openings.forEach(o => { if (o.z0 > zStart && o.z0 < zEnd) cuts.add(o.z0); if (o.z1 > zStart && o.z1 < zEnd) cuts.add(o.z1); });
  const zs = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2;
    const holes = openings
      .filter(o => o.z0 <= mid && o.z1 >= mid)
      .map(o => [Math.max(o.y0, yBottom), Math.min(o.y1, yTop)])
      .sort((a, b) => a[0] - b[0]);
    let y = yBottom;
    for (const [h0, h1] of holes) {
      if (h0 > y + 0.001) addBoxSpan(parent, x, thickness, y, h0, z0, z1, mat);
      y = Math.max(y, h1);
    }
    if (y < yTop - 0.001) addBoxSpan(parent, x, thickness, y, yTop, z0, z1, mat);
  }
}

function buildCarStatic(g, car, mat, { dest, cabFiller, openFront, openRear }) {
  const type = CAR_TYPES[car.type];
  const F = T.floorY, W = T.halfWidth, R = T.roofY, L = CAR;
  const isCab = car.type === "cab";

  const winY0 = F + 0.85, winY1 = F + 1.75;
  const doorHalf = T.doorWidth / 2;
  const windows = type.windows.map(([z0, z1]) => ({ z0, z1, y0: winY0, y1: winY1 }));
  const doorOpenings = type.doors.map(zc => ({ z0: zc - doorHalf, z1: zc + doorHalf, y0: F, y1: F + T.doorHeight }));
  const openings = [...windows, ...doorOpenings];

  /* ----- Carrocería ----- */
  [-1, 1].forEach(side => {
    buildPanelWall(g, { x: side * W, thickness: 0.05, mat: mat.body, zStart: 0, zEnd: L, yBottom: 0.85, yTop: R, openings });
    buildPanelWall(g, { x: side * (W + 0.03), thickness: 0.012, mat: mat.stripe, zStart: 0.05, zEnd: L - 0.05, yBottom: F + 0.62, yTop: F + 0.74, openings: doorOpenings });
    addBoxSpan(g, side * (W + 0.03), 0.012, 0.9, 1.05, 0.05, L - 0.05, mat.stripe);
    windows.forEach(w => addBoxSpan(g, side * (W - 0.02), 0.01, w.y0, w.y1, w.z0, w.z1, mat.sideGlass));
  });

  // Hojas de puerta FIJAS del lado opuesto al andén (−X en el tren).
  // En el coche girado ese lado es su +X local.
  const fixedSide = car.flipped ? 1 : -1;
  const leafW = doorHalf + 0.02;
  type.doors.forEach(zc => [-1, 1].forEach(leaf => {
    const z = zc + leaf * leafW / 2;
    addBox(g, 0.05, T.doorHeight, leafW, mat.body, fixedSide * (W + 0.035), F + T.doorHeight / 2, z);
    addBox(g, 0.06, 0.8, leafW - 0.2, mat.sideGlass, fixedSide * (W + 0.035), F + T.doorHeight / 2 + 0.35, z);
  }));

  // Techo, climatizadores, bastidor, bogies y ruedas
  addBoxSpan(g, 0, W * 2 + 0.04, R, R + 0.15, 0, L, mat.roof);
  [4.5, 13.5].forEach(zc => addBoxSpan(g, 0, 1.8, R + 0.15, R + 0.42, zc - 1.4, zc + 1.4, mat.roof));
  addBoxSpan(g, 0, W * 2 - 0.2, 0.55, 0.85, 0.4, L - 0.4, mat.under);
  [3.0, L - 3.0].forEach(zb => {
    addBoxSpan(g, 0, 2.0, 0.42, 0.72, zb - 1.3, zb + 1.3, mat.under);
    [-0.9, 0.9].forEach(dz => [-0.72, 0.72].forEach(x => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 14), mat.wheel);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, CONFIG.track.railTop + 0.4, zb + dz);
      g.add(wheel);
    }));
  });

  /* ----- Interior del salón ----- */
  const s0 = type.saloonStart, s1 = L - 0.05;
  [-1, 1].forEach(side => {
    buildPanelWall(g, { x: side * (W - 0.06), thickness: 0.04, mat: mat.lining, zStart: s0, zEnd: s1, yBottom: F, yTop: R - 0.03, openings });
  });
  addBoxSpan(g, 0, W * 2 - 0.04, F - 0.05, F, isCab ? 2.7 : 0, L, mat.floor);
  addBoxSpan(g, 0, W * 2 - 0.1, R - 0.04, R - 0.01, s0, s1, mat.ceiling);
  [-0.55, 0.55].forEach(x => addBoxSpan(g, x, 0.22, R - 0.06, R - 0.04, s0 + 0.3, s1 - 0.3, mat.light));

  // Testeros interiores con paso de intercirculación (0,6 m a cada lado del eje)
  const endWall = (z, open) => {
    if (!open) { addBoxSpan(g, 0, W * 2 - 0.1, F, R, z - 0.02, z + 0.02, mat.lining); return; }
    [-1, 1].forEach(s => addBoxSpan(g, s * (0.6 + (W - 0.66) / 2), W - 0.66, F, R, z - 0.02, z + 0.02, mat.lining));
    addBoxSpan(g, 0, 1.2, F + 2.0, R, z - 0.02, z + 0.02, mat.lining);
  };
  const frontOpen = car.flipped ? openRear : openFront;
  const rearOpen = car.flipped ? openFront : openRear;
  if (!isCab) endWall(0.04, frontOpen);
  endWall(L - 0.04, rearOpen);
  if (!isCab) {
    // Exterior de los testeros (marco alrededor del fuelle)
    [-1, 1].forEach(s => addBoxSpan(g, s * 1.1, 0.6, 0.85, R, 0, 0.03, mat.body));
  }
  [-1, 1].forEach(s => addBoxSpan(g, s * 1.1, 0.6, 0.85, R, L - 0.03, L, mat.body));

  // Asientos longitudinales
  [-1, 1].forEach(side => type.seatRuns.forEach(([z0, z1]) => {
    addBoxSpan(g, side * 1.08, 0.5, F, F + 0.42, z0, z1, mat.seatShell);
    addBoxSpan(g, side * 1.08, 0.48, F + 0.42, F + 0.5, z0, z1, mat.seat);
    addBoxSpan(g, side * 1.3, 0.08, F + 0.5, F + 0.95, z0, z1, mat.seat);
  }));

  // Barras verticales y asideros longitudinales
  const pole = (x, z, m = mat.pole) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, R - F, 8), m);
    p.position.set(x, (F + R) / 2, z);
    g.add(p);
  };
  type.doors.forEach(zc => { pole(0, zc, mat.poleYellow); [-1, 1].forEach(s => { pole(s * 0.75, zc - 0.95); pole(s * 0.75, zc + 0.95); }); });
  [-0.62, 0.62].forEach(x => {
    const len = s1 - s0 - 0.6;
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 6), mat.pole);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(x, R - 0.32, s0 + 0.3 + len / 2);
    g.add(rail);
  });

  // Plano de línea sobre las ventanas
  [-1, 1].forEach(side => type.maps.forEach(zc => {
    addPlane(g, 2.0, 0.375, mat.lineMap, side * (W - 0.085), R - 0.24, zc, side > 0 ? -Math.PI / 2 : Math.PI / 2);
  }));

  /* ----- Testero de cabina ----- */
  if (isCab) {
    const wsY0 = F + 0.85, wsY1 = R - 0.2;
    addBoxSpan(g, 0, W * 2, 0.85, wsY0, -0.04, 0.02, mat.mask);
    addBoxSpan(g, 0, W * 2, wsY1, R, -0.04, 0.02, mat.black);
    [-1, 1].forEach(side => addBoxSpan(g, side * (W - 0.06), 0.12, wsY0, wsY1, -0.04, 0.04, mat.black));
    addBoxSpan(g, 0, W * 2 - 0.2, wsY0, wsY1, -0.005, 0.005, mat.glass);
    // Faros (cabina delantera) o pilotos rojos (cabina trasera)
    [-1, 1].forEach(side => addBoxSpan(g, side * 0.95, 0.34, 1.4, 1.56, -0.06, -0.04, car.flipped ? mat.taillight : mat.headlight));
    addPlane(g, 1.6, 0.18, dest, 0, R - 0.1, -0.05, Math.PI);
    addBoxSpan(g, 0, 0.3, 0.75, 0.95, -0.45, 0, mat.under);
    addBoxSpan(g, 0, 2.2, 0.85, 0.95, -0.08, 0, mat.black);
    const wiper = addBox(g, 0.8, 0.018, 0.02, mat.black, -0.3, wsY0 + 0.05, -0.02);
    wiper.rotation.z = 0.04;
    // Tabique de cabina con puerta
    addBoxSpan(g, 0, W * 2 - 0.08, F, R - 0.02, 2.68, 2.74, mat.cabLining);
    addBoxSpan(g, 0.35, 0.7, F + 0.02, F + 1.95, 2.74, 2.76, mat.panelGrey);
    if (cabFiller) addBoxSpan(g, 0, W * 2 - 0.1, F, R - 0.05, 0.12, 2.66, mat.black);   // cabina vista desde fuera
  }

  if (car.panto) buildPantograph(g, mat, R);
}

/** Fuelle de intercirculación entre dos coches (z = fin del coche delantero). */
function buildGangway(root, mat, z) {
  const F = T.floorY, R = T.roofY;
  const g = new THREE.Group();
  g.position.z = z;
  root.add(g);
  [-1, 1].forEach(s => addBoxSpan(g, s * 0.75, 0.12, F, F + 2.1, -0.05, GAP + 0.05, mat.bellows));   // laterales del fuelle
  addBoxSpan(g, 0, 1.62, F + 2.05, F + 2.2, -0.05, GAP + 0.05, mat.bellows);                          // techo del fuelle
  addBoxSpan(g, 0, 1.4, F - 0.04, F, -0.05, GAP + 0.05, mat.floor);                                   // chapa de paso
  [-1, 1].forEach(s => addBoxSpan(g, s * 1.3, 0.2, 0.9, R - 0.2, 0, GAP, mat.bellows));               // fuelle exterior
}

/** Pantógrafo de un brazo sobre el techo, tocando la catenaria. */
function buildPantograph(g, mat, R) {
  const contact = CONFIG.catenary.contactY;
  const z0 = 9;
  addBoxSpan(g, 0, 0.9, R + 0.15, R + 0.25, z0 - 0.5, z0 + 0.6, mat.under);
  [-0.35, 0.35].forEach(x => addBoxSpan(g, x, 0.1, R + 0.25, R + 0.4, z0 - 0.1, z0 + 0.1, mat.stripe));
  const arm = (y0, za, y1, zb, w) => {
    const len = Math.hypot(y1 - y0, zb - za);
    const m = addBox(g, w, w, len, mat.pole, 0, (y0 + y1) / 2, (za + zb) / 2);
    m.rotation.x = Math.atan2(y1 - y0, -(zb - za));
  };
  const kneeY = (R + 0.3 + contact) / 2;
  arm(R + 0.3, z0 + 0.5, kneeY, z0 - 0.35, 0.06);
  arm(kneeY, z0 - 0.35, contact - 0.04, z0 + 0.15, 0.045);
  addBox(g, 1.5, 0.04, 0.12, mat.black, 0, contact - 0.03, z0 + 0.15);
}


/* ==========================================================================
   Tren completo
   ========================================================================== */

/**
 * Construye un tren de 5 coches.
 * @param {object} opts
 * @param {"A"|"B"} opts.routeId   sentido (para el indicador de destino)
 * @param {boolean} opts.cab       cabina interior con pupitre y DMI (tren del jugador)
 */
export function buildTrain({ routeId = "A", cab = false } = {}) {
  const A = assets();
  const group = new THREE.Group();
  group.name = "train";
  for (const part of trainTemplate(routeId, cab)) group.add(new THREE.Mesh(part.geometry, part.material));

  // Hojas de puerta del lado del andén (+X local): 2 por puerta, instanciadas
  const n = TRAIN_LAYOUT.doors.length * 2;
  const leafBody = new THREE.InstancedMesh(A.leafBody, A.mat.body, n);
  const leafGlass = new THREE.InstancedMesh(A.leafGlass, A.mat.sideGlass, n);
  leafBody.frustumCulled = leafGlass.frustumCulled = false;
  group.add(leafBody, leafGlass);
  const leaves = [];
  TRAIN_LAYOUT.doors.forEach(zc => [-1, 1].forEach(leaf => {
    const closedZ = zc + leaf * A.leafW / 2;
    leaves.push({ closedZ, openZ: closedZ + leaf * (A.leafW - 0.04) });
  }));
  const m = new THREE.Matrix4();
  const x = T.halfWidth + 0.035, y = T.floorY + T.doorHeight / 2;
  let lastProgress = -1;
  const setDoors = (progress) => {
    if (progress === lastProgress) return;
    lastProgress = progress;
    const e = progress * progress * (3 - 2 * progress);
    leaves.forEach((l, i) => {
      m.makeTranslation(x, y, l.closedZ + (l.openZ - l.closedZ) * e);
      leafBody.setMatrixAt(i, m);
      leafGlass.setMatrixAt(i, m);
    });
    leafBody.instanceMatrix.needsUpdate = leafGlass.instanceMatrix.needsUpdate = true;
  };
  setDoors(0);

  let cabParts = {};
  if (cab) cabParts = buildCab(group, A.mat);

  return { group, setDoors, ...cabParts };
}

/**
 * Luces del tren "en foco": un faro y una luz interior.
 * Se reubican entre trenes para mantener constante el número de luces.
 */
export function createTrainLights({ cab = true } = {}) {
  const R = T.roofY;
  const group = new THREE.Group();
  const spot = new THREE.SpotLight(0xfff1d6, 480, 140, 0.4, 0.55, 1.4);
  spot.position.set(0, 1.5, -0.2);
  spot.target.position.set(0, 0.4, -40);
  group.add(spot, spot.target);
  const inner = cab ? new THREE.PointLight(0xffe7c8, 0.6, 2.6, 1.5) : new THREE.PointLight(0xf4f7ff, 6, 14, 1.6);
  inner.position.set(0, cab ? R - 0.25 : R - 0.4, cab ? 1.5 : 10);
  inner.name = "innerLight";
  group.add(inner);
  return group;
}

/** Asientos y sitios de pie de los 5 coches (coordenadas locales del tren). */
export function buildTrainSlots() {
  const F = T.floorY;
  const slots = [];
  CONSIST.forEach((car, ci) => {
    const type = CAR_TYPES[car.type];
    const toTrain = (x, z) => ({ x: car.flipped ? -x : x, z: carToTrainZ(car, z) });
    [-1, 1].forEach(side => type.seatRuns.forEach(([z0, z1]) => {
      for (let z = z0 + 0.32; z <= z1 - 0.26; z += 0.56) {
        const p = toTrain(side * 1.08, z), a = toTrain(side * 0.45, z);
        const trainSide = Math.sign(p.x);
        slots.push({
          type: "seat", side: trainSide, car: ci,
          pos: new THREE.Vector3(p.x, F, p.z),
          seatY: F + 0.5,
          approach: new THREE.Vector3(a.x, F, a.z),
          yaw: trainSide > 0 ? -Math.PI / 2 : Math.PI / 2,
          occupant: null,
        });
      }
    }));
    const standing = [];
    type.doors.forEach(zc => [-1, 1].forEach(sx => [-1, 1].forEach(sz => standing.push([sx * 0.42, zc + sz * 0.55]))));
    type.standZ.forEach(z => [-1, 1].forEach(sx => standing.push([sx * 0.32, z])));
    standing.forEach(([x0, z0]) => {
      const p = toTrain(x0, z0);
      slots.push({
        type: "stand", side: Math.sign(p.x) || 1, car: ci,
        pos: new THREE.Vector3(p.x, F, p.z),
        approach: new THREE.Vector3(p.x, F, p.z),
        yaw: Math.random() < 0.5 ? 0 : Math.PI,
        occupant: null,
      });
    });
  });
  return slots;
}


/* ==========================================================================
   Cabina de conducción (solo tren del jugador)
   ========================================================================== */

function buildCab(group, mat) {
  const F = T.floorY, R = T.roofY, W = T.halfWidth;
  const wsY0 = F + 0.85, wsY1 = R - 0.2;

  const cabOpenings = [{ z0: 0.6, z1: 2.2, y0: F + 0.85, y1: F + 1.75 }];
  [-1, 1].forEach(side => {
    buildPanelWall(group, { x: side * (W - 0.06), thickness: 0.04, mat: mat.cabLining, zStart: 0.06, zEnd: 2.68, yBottom: F, yTop: R - 0.03, openings: cabOpenings });
    addBoxSpan(group, side * (W - 0.12), 0.1, wsY0, wsY1, 0.04, 0.16, mat.black);
  });
  addBoxSpan(group, 0, W * 2 - 0.04, F - 0.05, F, 0, 2.7, mat.cabFloor);
  addBoxSpan(group, 0, W * 2 - 0.1, R - 0.05, R - 0.01, 0.02, 2.68, mat.cabLining);
  addBoxSpan(group, 0, W * 2 - 0.1, wsY1, R - 0.01, 0.02, 0.2, mat.black);
  addBoxSpan(group, 0, 0.6, R - 0.07, R - 0.05, 1.3, 1.9, mat.light);

  // Pupitre
  const deskTopY = F + 0.72;
  addBoxSpan(group, 0, W * 2 - 0.14, F, deskTopY, 0.1, 0.95, mat.desk);
  const desk = new THREE.Group();
  desk.position.set(0, deskTopY + 0.05, 0.52);
  desk.rotation.x = 0.3;
  group.add(desk);
  addBox(desk, W * 2 - 0.14, 0.04, 0.92, mat.deskTop, 0, 0, 0);

  // Capota de instrumentos con pantalla DMI
  const hood = new THREE.Group();
  hood.position.set(-0.3, F + 0.86, 0.3);
  hood.rotation.x = -0.28;
  group.add(hood);
  addBox(hood, 0.7, 0.44, 0.1, mat.desk, 0, 0, 0);
  addBox(hood, 0.74, 0.04, 0.2, mat.desk, 0, 0.23, -0.04);
  const dmi = new CabDisplay();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3375), glow(0xffffff, { map: dmi.texture }));
  screen.position.z = 0.051;
  hood.add(screen);

  // Manipulador combinado
  addBox(desk, 0.24, 0.06, 0.46, mat.panelGrey, -0.95, 0.05, 0.05);
  const lever = new THREE.Group();
  lever.position.set(-0.95, 0.08, 0.05);
  desk.add(lever);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), mat.pole);
  rod.position.y = 0.1;
  lever.add(rod);
  addBox(lever, 0.16, 0.05, 0.06, std(0x151515, { rough: 0.4 }), 0, 0.21, 0);

  // Inversor
  addBox(desk, 0.16, 0.03, 0.16, mat.panelGrey, -0.7, 0.035, -0.2);
  const reverserKey = new THREE.Group();
  reverserKey.position.set(-0.7, 0.06, -0.2);
  desk.add(reverserKey);
  addBox(reverserKey, 0.025, 0.035, 0.08, std(0xd7b740, { metal: 0.7, rough: 0.3 }), 0, 0.025, 0);
  ["F", "N", "R"].forEach((_, i) => addBox(desk, 0.012, 0.004, 0.012, glow([0x6fe39a, 0xffffff, 0xffb547][i]), -0.7 + (i - 1) * 0.06, 0.052, -0.29));

  // Pilotos y botones de puertas
  const lampDefs = {
    doorsClosed: { x: 0.18, color: 0x2a74ff },
    doorLeft:    { x: -0.55, color: 0x35e06f, button: true },
    doorRight:   { x: 0.55, color: 0x35e06f, button: true },
    traction:    { x: 0.28, color: 0x4fd6ff },
    brake:       { x: 0.38, color: 0xffb547 },
    emergency:   { x: 0.48, color: 0xff3030 },
  };
  const lamps = {};
  for (const [key, def] of Object.entries(lampDefs)) {
    const m = new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false });
    const r = def.button ? 0.026 : 0.02;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 16), m);
    lamp.position.set(def.x, 0.035, def.button ? 0.18 : -0.2);
    desk.add(lamp);
    lamps[key] = { material: m, on: new THREE.Color(def.color), off: new THREE.Color(def.color).multiplyScalar(0.12) };
  }
  const mushroom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.05, 20), std(0xd41f1f, { rough: 0.35 }));
  mushroom.position.set(0.95, 0.05, 0.15);
  desk.add(mushroom);
  addBox(desk, 0.36, 0.08, 0.22, mat.panelGrey, 0.8, 0.06, -0.2);
  addBox(desk, 0.18, 0.005, 0.08, glow(0x52ff9a), 0.76, 0.102, -0.22);

  // Panel de techo y parasol
  addBoxSpan(group, 0, 1.4, R - 0.18, R - 0.05, 0.2, 0.6, mat.panelGrey);
  for (let i = 0; i < 6; i++) addBoxSpan(group, -0.55 + i * 0.22, 0.05, R - 0.2, R - 0.18, 0.5, 0.53, glow(i % 3 ? 0x2f9d58 : 0xffb547));
  const visor = addBox(group, 0.7, 0.012, 0.32, std(0x0c1014, { transparent: true, opacity: 0.85 }), -0.3, wsY1 - 0.06, 0.32);
  visor.rotation.x = -0.25;

  return { lever, reverserKey, lamps, dmi };
}
