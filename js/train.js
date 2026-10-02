/* ==========================================================================
   MetroSim — Alpha 0.4 · train.js
   Modelo 3D del tren: exterior, cabina de conducción y salón de viajeros.
   Origen del grupo: centro de la vía en el testero delantero (z = 0); el coche se extiende hacia +Z.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { std, glow, addBox, addBoxSpan, addPlane, toTexture, lineMapCanvas, destinationCanvas } from "./utils.js";

/* Texturas compartidas por todos los trenes (se crean una sola vez) */
let SHARED = null;
function sharedTextures() {
  if (!SHARED) SHARED = {
    destination: toTexture(destinationCanvas("F. CASTILLO VELASCO")),
    lineMap: toTexture(lineMapCanvas()),
  };
  return SHARED;
}
import { CabDisplay } from "./dmi.js";

/**
 * Pared lateral con huecos rectangulares (ventanas y puertas).
 * Divide la pared en columnas por cada borde de hueco y rellena lo que no es hueco.
 */
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

/**
 * Construye un coche AS-2014 simplificado.
 * @param {object} opts
 * @param {boolean} opts.cab  true = cabina interior completa con pupitre y DMI (tren del jugador)
 */
export function buildTrainModel({ cab: withCab = true } = {}) {
  const T = CONFIG.train, F = T.floorY, L = T.length, W = T.halfWidth, R = T.roofY;
  const group = new THREE.Group();
  group.name = "train";

  const mat = {
    body: std(0xc9d0d6, { metal: 0.65, rough: 0.32 }),
    red: std(0x8b5a2b, { metal: 0.3, rough: 0.4 }),          // franja café de la Línea 3
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
    light: glow(0xf6f9ff),
    desk: std(0x23292f, { rough: 0.85 }),
    deskTop: std(0x15191d, { rough: 0.9 }),
    panelGrey: std(0x4a535c, { metal: 0.3, rough: 0.5 }),
    door: std(0xc9d0d6, { metal: 0.65, rough: 0.32 }),
    doorRed: std(0x8b5a2b, { metal: 0.3, rough: 0.4 }),
    headlight: glow(0xfff6dc),
    taillight: glow(0xff1e1e),
  };

  /* ----- Huecos comunes de exterior y revestimiento interior ----- */
  const winY0 = F + 0.85, winY1 = F + 1.75;
  const doorHalf = T.doorWidth / 2;
  const windows = [
    { z0: 0.6, z1: 2.2 },                     // ventanilla lateral de cabina
    { z0: 3.3, z1: 5.1 },
    { z0: 7.5, z1: 9.6 }, { z0: 9.8, z1: 11.9 },
    { z0: 14.3, z1: 17.4 },
  ].map(w => ({ ...w, y0: winY0, y1: winY1 }));
  const doorOpenings = T.doorCenters.map(zc => ({ z0: zc - doorHalf, z1: zc + doorHalf, y0: F, y1: F + T.doorHeight }));
  const openings = [...windows, ...doorOpenings];

  /* ----- Carrocería exterior ----- */
  [-1, 1].forEach(side => {
    buildPanelWall(group, { x: side * W, thickness: 0.05, mat: mat.body, zStart: 0, zEnd: L, yBottom: 0.85, yTop: R, openings });
    // Franja roja bajo las ventanas y franja inferior
    buildPanelWall(group, { x: side * (W + 0.03), thickness: 0.012, mat: mat.red, zStart: 0.05, zEnd: L - 0.05, yBottom: F + 0.62, yTop: F + 0.74, openings: doorOpenings });
    addBoxSpan(group, side * (W + 0.03), 0.012, 0.9, 1.05, 0.05, L - 0.05, mat.red);
    // Lunas laterales (vistas desde fuera y desde dentro)
    windows.forEach(w => addBoxSpan(group, side * (W - 0.02), 0.01, w.y0, w.y1, w.z0, w.z1, mat.sideGlass));
  });

  // Techo y equipos de climatización
  addBoxSpan(group, 0, W * 2 + 0.04, R, R + 0.15, 0, L, mat.roof);
  [5, 13].forEach(zc => addBoxSpan(group, 0, 1.8, R + 0.15, R + 0.45, zc - 1.6, zc + 1.6, mat.roof));

  // Bastidor, bogies y ruedas
  addBoxSpan(group, 0, W * 2 - 0.2, 0.55, 0.85, 0.4, L - 0.4, mat.under);
  [3.4, L - 3.4].forEach(zb => {
    addBoxSpan(group, 0, 2.0, 0.42, 0.72, zb - 1.3, zb + 1.3, mat.under);
    [-0.9, 0.9].forEach(dz => [-0.72, 0.72].forEach(x => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 20), mat.wheel);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, CONFIG.track.railTop + 0.4, zb + dz);
      group.add(wheel);
    }));
  });

  /* ----- Testero frontal ----- */
  const wsY0 = F + 0.85, wsY1 = R - 0.2;               // parabrisas: 2.10 → 3.25
  addBoxSpan(group, 0, W * 2, 0.85, wsY0, -0.04, 0.02, mat.mask);       // máscara inferior
  addBoxSpan(group, 0, W * 2, wsY1, R, -0.04, 0.02, mat.black);          // franja superior
  [-1, 1].forEach(side => addBoxSpan(group, side * (W - 0.06), 0.12, wsY0, wsY1, -0.04, 0.04, mat.black)); // montantes
  addBoxSpan(group, 0, W * 2 - 0.2, wsY0, wsY1, -0.005, 0.005, mat.glass);  // parabrisas
  // Faros y pilotos
  [-1, 1].forEach(side => {
    addBoxSpan(group, side * 0.95, 0.34, 1.4, 1.56, -0.06, -0.04, mat.headlight);
    addBoxSpan(group, side * 0.55, 0.14, 1.42, 1.54, -0.06, -0.04, std(0x401010));
  });
  // Indicador de destino
  const dest = addPlane(group, 1.6, 0.18, glow(0xffffff, { map: sharedTextures().destination }), 0, R - 0.1, -0.05, Math.PI);
  dest.name = "destination";
  // Enganche y anticlimber
  addBoxSpan(group, 0, 0.3, 0.75, 0.95, -0.45, 0, mat.under);
  addBoxSpan(group, 0, 2.2, 0.85, 0.95, -0.08, 0, mat.black);
  // Limpiaparabrisas (sobre el cristal, por fuera)
  const wiper = addBox(group, 0.8, 0.018, 0.02, mat.black, -0.3, wsY0 + 0.05, -0.02);   // aparcado en la base
  wiper.rotation.z = 0.04;

  /* ----- Testero trasero ----- */
  addBoxSpan(group, 0, W * 2, 0.85, R, L - 0.02, L + 0.03, mat.body);
  addBoxSpan(group, 0, 1.6, winY0, winY1, L + 0.03, L + 0.035, mat.black);
  [-1, 1].forEach(side => addBoxSpan(group, side * 0.95, 0.3, 1.4, 1.55, L + 0.03, L + 0.05, mat.taillight));

  /* ----- Puertas de viajeros (hojas deslizantes exteriores) ----- */
  const doors = [];
  [-1, 1].forEach(side => {
    T.doorCenters.forEach(zc => {
      [-1, 1].forEach(leaf => {
        const leafW = doorHalf + 0.02;
        const g = new THREE.Group();
        addBox(g, 0.05, T.doorHeight, leafW, mat.door, 0, 0, 0);
        addBox(g, 0.055, 0.12, leafW, mat.doorRed, 0, -T.doorHeight / 2 + 0.75, 0);
        addBox(g, 0.06, 0.8, leafW - 0.2, mat.sideGlass, 0, 0.35, 0);
        const closedZ = zc + leaf * leafW / 2;
        g.position.set(side * (W + 0.035), F + T.doorHeight / 2, closedZ);
        group.add(g);
        doors.push({ mesh: g, closedZ, openZ: closedZ + leaf * (leafW - 0.04) });
      });
    });
  });

  /* ----- Interior del salón ----- */
  [-1, 1].forEach(side => {
    buildPanelWall(group, { x: side * (W - 0.06), thickness: 0.04, mat: mat.lining, zStart: 2.75, zEnd: L - 0.05, yBottom: F, yTop: R - 0.03, openings });
  });
  addBoxSpan(group, 0, W * 2 - 0.04, F - 0.05, F, 2.7, L, mat.floor);
  addBoxSpan(group, 0, W * 2 - 0.1, R - 0.04, R - 0.01, 2.75, L - 0.05, mat.ceiling);
  [-0.55, 0.55].forEach(x => addBoxSpan(group, x, 0.22, R - 0.06, R - 0.04, 3.0, L - 0.4, mat.light));
  addBoxSpan(group, 0, W * 2 - 0.1, F, R, L - 0.08, L - 0.04, mat.lining);    // testero trasero interior

  // Asientos longitudinales entre puertas
  const seatRuns = [[3.0, 5.35], [7.05, 12.35], [14.05, 17.7]];
  [-1, 1].forEach(side => seatRuns.forEach(([z0, z1]) => {
    addBoxSpan(group, side * 1.08, 0.5, F, F + 0.42, z0, z1, mat.seatShell);
    addBoxSpan(group, side * 1.08, 0.48, F + 0.42, F + 0.5, z0, z1, mat.seat);
    addBoxSpan(group, side * 1.3, 0.08, F + 0.5, F + 0.95, z0, z1, mat.seat);
  }));

  // Barras verticales y asideros longitudinales
  const pole = (x, z, m = mat.pole) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, R - F, 10), m);
    p.position.set(x, (F + R) / 2, z);
    group.add(p);
  };
  T.doorCenters.forEach(zc => { pole(0, zc, mat.poleYellow); [-1, 1].forEach(s => { pole(s * 0.75, zc - 0.95); pole(s * 0.75, zc + 0.95); }); });
  [-0.62, 0.62].forEach(x => {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, L - 3.4, 8), mat.pole);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(x, R - 0.32, 2.75 + (L - 3.4) / 2 + 0.25);
    group.add(rail);
  });

  // Esquema de línea sobre las ventanas (información al viajero)
  const mapMat = glow(0xffffff, { map: sharedTextures().lineMap });
  [-1, 1].forEach(side => [8.7, 15.85].forEach(zc => {
    addPlane(group, 2.0, 0.375, mapMat, side * (W - 0.085), R - 0.24, zc, side > 0 ? -Math.PI / 2 : Math.PI / 2);
  }));

  // Tabique de cabina (con puerta)
  addBoxSpan(group, 0, W * 2 - 0.08, F, R - 0.02, 2.68, 2.74, mat.cabLining);
  addBoxSpan(group, 0.35, 0.7, F + 0.02, F + 1.95, 2.74, 2.76, mat.panelGrey);
  addBoxSpan(group, 0.35, 0.4, F + 1.3, F + 1.75, 2.76, 2.765, mat.sideGlass);

  /* ----- Pantógrafo (captación por catenaria rígida a 1500 V CC) ----- */
  buildPantograph(group, mat, R);

  /* ----- Cabina de conducción ----- */
  let cab = {};
  if (withCab) cab = buildCab(group, mat, { F, R, W, wsY0, wsY1 });
  else addBoxSpan(group, 0, W * 2 - 0.1, F, R - 0.05, 0.12, 2.66, mat.black);   // cabina vista desde fuera

  return { group, doors, ...cab };
}

/** Pantógrafo de un brazo sobre el techo, tocando la catenaria. */
function buildPantograph(group, mat, R) {
  const contact = CONFIG.catenary.contactY;
  const z0 = 12.6;
  addBoxSpan(group, 0, 0.9, R + 0.15, R + 0.25, z0 - 0.5, z0 + 0.6, mat.under);           // bastidor
  [-0.35, 0.35].forEach(x => addBoxSpan(group, x, 0.1, R + 0.25, R + 0.4, z0 - 0.1, z0 + 0.1, std(0x6b3a2a)));  // aisladores
  const arm = (x0, y0, z0a, x1, y1, z1a, w) => {
    const len = Math.hypot(y1 - y0, z1a - z0a);
    const m = addBox(group, w, w, len, mat.roof, (x0 + x1) / 2, (y0 + y1) / 2, (z0a + z1a) / 2);
    m.rotation.x = Math.atan2(y1 - y0, -(z1a - z0a));
    m.material = std(0x9aa1a7, { metal: 0.7, rough: 0.35 });
    return m;
  };
  const kneeY = (R + 0.3 + contact) / 2;
  arm(0, R + 0.3, z0 + 0.5, 0, kneeY, z0 - 0.35, 0.06);          // brazo inferior
  arm(0, kneeY, z0 - 0.35, 0, contact - 0.04, z0 + 0.15, 0.045); // brazo superior
  addBox(group, 1.5, 0.04, 0.12, std(0x2b2b2b, { metal: 0.5 }), 0, contact - 0.03, z0 + 0.15);   // frotador
}

/**
 * Luces del tren "en foco" (el del jugador o el que observa): faros, salón y cabina.
 * Se reubican entre trenes para mantener constante el número de luces.
 */
export function createTrainLights({ cab = true } = {}) {
  const R = CONFIG.train.roofY;
  const group = new THREE.Group();
  // Un único foco centrado (equivale a los dos faros y cuesta la mitad)
  const spot = new THREE.SpotLight(0xfff1d6, 480, 140, 0.4, 0.55, 1.4);
  spot.position.set(0, 1.5, -0.2);
  spot.target.position.set(0, 0.4, -40);
  group.add(spot, spot.target);
  // Luz interior: de cabina para el conductor, de salón para el pasajero
  const inner = cab ? new THREE.PointLight(0xffe7c8, 0.6, 2.6, 1.5) : new THREE.PointLight(0xf4f7ff, 6, 14, 1.6);
  inner.position.set(0, cab ? R - 0.25 : R - 0.4, cab ? 1.5 : 10);
  group.add(inner);
  return group;
}

/** Asientos y sitios de pie en coordenadas locales del tren (para viajeros). */
export function buildTrainSlots() {
  const T = CONFIG.train, F = T.floorY;
  const slots = [];
  const seatRuns = [[3.0, 5.35], [7.05, 12.35], [14.05, 17.7]];
  [-1, 1].forEach(side => seatRuns.forEach(([z0, z1]) => {
    for (let z = z0 + 0.32; z <= z1 - 0.26; z += 0.56) {
      slots.push({
        type: "seat", side,
        pos: new THREE.Vector3(side * 1.08, F, z),
        seatY: F + 0.5,
        approach: new THREE.Vector3(side * 0.45, F, z),
        yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        occupant: null,
      });
    }
  }));
  const standing = [];
  T.doorCenters.forEach(zc => [-1, 1].forEach(sx => [-1, 1].forEach(sz => standing.push([sx * 0.42, zc + sz * 0.55]))));
  [4.2, 8.3, 10.6, 15.2, 16.6].forEach(z => [-1, 1].forEach(sx => standing.push([sx * 0.32, z])));
  standing.forEach(([x, z]) => slots.push({
    type: "stand", side: Math.sign(x) || 1,
    pos: new THREE.Vector3(x, F, z),
    approach: new THREE.Vector3(x, F, z),
    yaw: Math.random() < 0.5 ? 0 : Math.PI,
    occupant: null,
  }));
  return slots;
}

/** Interior de cabina: pupitre, pantalla DMI, manipulador, pilotos y paneles. */
export function buildCab(group, mat, { F, R, W, wsY0, wsY1 }) {
  // Revestimiento interior de cabina (laterales, techo, suelo)
  const cabOpenings = [{ z0: 0.6, z1: 2.2, y0: F + 0.85, y1: F + 1.75 }];
  [-1, 1].forEach(side => {
    buildPanelWall(group, { x: side * (W - 0.06), thickness: 0.04, mat: mat.cabLining, zStart: 0.06, zEnd: 2.68, yBottom: F, yTop: R - 0.03, openings: cabOpenings });
    addBoxSpan(group, side * (W - 0.12), 0.1, wsY0, wsY1, 0.04, 0.16, mat.black);   // montantes interiores
  });
  addBoxSpan(group, 0, W * 2 - 0.04, F - 0.05, F, 0, 2.7, mat.cabFloor);
  addBoxSpan(group, 0, W * 2 - 0.1, R - 0.05, R - 0.01, 0.02, 2.68, mat.cabLining);
  addBoxSpan(group, 0, W * 2 - 0.1, wsY1, R - 0.01, 0.02, 0.2, mat.black);           // dintel interior
  addBoxSpan(group, 0, 0.6, R - 0.07, R - 0.05, 1.3, 1.9, mat.light);                // plafón

  // Pupitre
  const deskTopY = F + 0.72;
  addBoxSpan(group, 0, W * 2 - 0.14, F, deskTopY, 0.1, 0.95, mat.desk);
  const desk = new THREE.Group();
  desk.position.set(0, deskTopY + 0.05, 0.52);
  desk.rotation.x = 0.3;
  group.add(desk);
  addBox(desk, W * 2 - 0.14, 0.04, 0.92, mat.deskTop, 0, 0, 0);

  // Capota de instrumentos con pantalla DMI frente al conductor
  const hood = new THREE.Group();
  hood.position.set(-0.3, F + 0.86, 0.3);
  hood.rotation.x = -0.28;
  group.add(hood);
  addBox(hood, 0.7, 0.44, 0.1, mat.desk, 0, 0, 0);
  addBox(hood, 0.74, 0.04, 0.2, mat.desk, 0, 0.23, -0.04);                           // visera
  const dmi = new CabDisplay();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3375), glow(0xffffff, { map: dmi.texture }));
  screen.position.z = 0.051;
  hood.add(screen);

  // Manipulador combinado (izquierda del conductor)
  addBox(desk, 0.24, 0.06, 0.46, mat.panelGrey, -0.95, 0.05, 0.05);
  const lever = new THREE.Group();
  lever.position.set(-0.95, 0.08, 0.05);
  desk.add(lever);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), mat.pole);
  rod.position.y = 0.1;
  lever.add(rod);
  addBox(lever, 0.16, 0.05, 0.06, std(0x151515, { rough: 0.4 }), 0, 0.21, 0);

  // Inversor (sentido de marcha): llave giratoria delante del manipulador
  addBox(desk, 0.16, 0.03, 0.16, mat.panelGrey, -0.7, 0.035, -0.2);
  const reverserKey = new THREE.Group();
  reverserKey.position.set(-0.7, 0.06, -0.2);
  desk.add(reverserKey);
  addBox(reverserKey, 0.025, 0.035, 0.08, std(0xd7b740, { metal: 0.7, rough: 0.3 }), 0, 0.025, 0);
  ["F", "N", "R"].forEach((_, i) => addBox(desk, 0.012, 0.004, 0.012, glow([0x6fe39a, 0xffffff, 0xffb547][i]), -0.7 + (i - 1) * 0.06, 0.052, -0.29));

  // Pilotos (lámparas) y botones de puertas
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
  // Seta de emergencia y equipo de radio
  const mushroom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.05, 20), std(0xd41f1f, { rough: 0.35 }));
  mushroom.position.set(0.95, 0.05, 0.15);
  desk.add(mushroom);
  addBox(desk, 0.36, 0.08, 0.22, mat.panelGrey, 0.8, 0.06, -0.2);
  addBox(desk, 0.18, 0.005, 0.08, glow(0x52ff9a), 0.76, 0.102, -0.22);

  // Panel de techo con interruptores
  addBoxSpan(group, 0, 1.4, R - 0.18, R - 0.05, 0.2, 0.6, mat.panelGrey);
  for (let i = 0; i < 6; i++) addBoxSpan(group, -0.55 + i * 0.22, 0.05, R - 0.2, R - 0.18, 0.5, 0.53, glow(i % 3 ? 0x2f9d58 : 0xffb547));

  // Parasol
  const visor = addBox(group, 0.7, 0.012, 0.32, std(0x0c1014, { transparent: true, opacity: 0.85 }), -0.3, wsY1 - 0.06, 0.32);
  visor.rotation.x = -0.25;

  return { lever, reverserKey, lamps, dmi };
}

