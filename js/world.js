/* ==========================================================================
   MetroSim — Alpha 0.5 · world.js
   Mundo 3D fijo de la Línea 3 (doble vía): vías, catenaria rígida, túnel de
   doble vía, 21 estaciones con andenes laterales, escaleras, mezanina con
   torniquetes y salida a la calle, pantallas de próximo tren y topes.

   Sección transversal de una estación (x):
     muro −8,5 | andén vía 2 | borde −3,55 | vía 2 (x=−2) | columnas x=0 |
     vía 1 (x=+2) | borde +3,55 | andén vía 1 | muro +8,5
   A lo largo (z relativo al centro): andenes ±50 · escaleras +20…+34 ·
   mezanina +34…+52 a 7,2 m de altura · torniquetes en +44 · salida en +52.

   Rendimiento: estaciones lejanas ocultas, pool fijo de 3 luces que sigue a
   la cámara, piezas repetidas instanciadas y texturas comunes compartidas.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, WORLD, LINE } from "./config.js";
import { ROUTE_A, ROUTE_B } from "./route.js";
import {
  std, glow, addBox, addBoxSpan, addPlane, makeCanvas, toTexture, tunnelTexture, concreteTexture,
  terrazzoTexture, tileTexture, stationNameCanvas, lineMapCanvas, lineMapU, signCanvas, stopBoardCanvas,
  milepostCanvas, formatClock,
} from "./utils.js";

const S = CONFIG.station, MZ = CONFIG.mezzanine;
const TILE_TINTS = [[0, 0, 0], [-14, -4, 10], [8, -2, -14], [-8, 4, -4]];

/* ==========================================================================
   Materiales compartidos
   ========================================================================== */

function createWorldMaterials() {
  const wallH = S.ceilingY + 0.05;
  const bandV0 = (3.75 + 0.05) / wallH, bandV1 = (4.1 + 0.05) / wallH;
  const platformLen = S.platformHalf * 2;
  const platformW = S.wallX - S.platformEdgeX;
  const trackLen = WORLD.start - WORLD.end;

  // Fondo de la salida a la calle: luz de día al final de un pasillo
  const street = makeCanvas(256, 256), g = street.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#dfe9f2"); grd.addColorStop(0.55, "#a9b8c4"); grd.addColorStop(1, "#4b525a");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.fillStyle = "rgba(40,48,56,0.55)"; g.fillRect(0, 150, 256, 106);

  return {
    tunnelCanvas: tunnelTexture(),
    tunnelFloorCanvas: concreteTexture("#34383b"),
    walkwayCanvas: concreteTexture("#5a5e61"),
    slab: std(0xffffff, { map: toTexture(concreteTexture("#3c3f42", 30), 2, trackLen / 4), rough: 0.95 }),
    sleeper: std(0x77736b, { rough: 0.9 }),
    rail: std(0x8f989f, { metal: 0.85, rough: 0.32 }),
    railHead: std(0xd6dde2, { metal: 0.95, rough: 0.18 }),
    catenary: std(0x9aa1a7, { metal: 0.8, rough: 0.3 }),
    contactWire: std(0xb87333, { metal: 0.9, rough: 0.25 }),
    insulator: std(0x6b3a2a, { rough: 0.5 }),
    cable: std(0x15171a, { rough: 0.55 }),
    cableTray: std(0x6d747a, { metal: 0.6, rough: 0.45 }),
    tunnelLamp: glow(0xffdcaa),
    tunnelLampHousing: std(0x2a2d30, { metal: 0.4 }),
    headwall: std(0x2c3034, { rough: 0.95 }),
    hallFloor: std(0xffffff, { map: toTexture(concreteTexture("#34383b"), 6, 40), rough: 0.95 }),
    platform: std(0xffffff, { map: toTexture(terrazzoTexture(), platformW / 2, platformLen / 2), rough: 0.55 }),
    deck: std(0xffffff, { map: toTexture(terrazzoTexture(), S.wallX, (MZ.z1 - MZ.z0) / 2), rough: 0.5 }),
    platformFace: std(0x2b2f33, { rough: 0.9 }),
    platformEdge: std(0xf2c230, { rough: 0.6 }),
    platformLine: std(0xf4f4ef, { rough: 0.6 }),
    stationWalls: TILE_TINTS.map(t => std(0xffffff, {
      map: toTexture(tileTexture(LINE.color, bandV0, bandV1, t), S.hallHalf * 2 / 4, 2), rough: 0.35, metal: 0.05,
    })),
    portal: std(0xffffff, { map: toTexture(concreteTexture("#4a4e52"), 4, 2), rough: 0.9, side: THREE.DoubleSide }),
    ceiling: std(0x262c32, { rough: 0.8 }),
    soffit: std(0x8d949b, { rough: 0.7 }),
    fixture: glow(0xf2f7ff),
    fixtureHousing: std(0x1b1f23, { metal: 0.5 }),
    column: std(0xc9cfd4, { metal: 0.45, rough: 0.35 }),
    columnBase: std(0x30363c, { metal: 0.3 }),
    bench: std(0x9a6b3f, { rough: 0.6 }),
    benchFrame: std(0x3d434a, { metal: 0.7, rough: 0.4 }),
    steel: std(0x80888f, { metal: 0.75, rough: 0.35 }),
    stair: std(0x9ea3a6, { rough: 0.6 }),
    stairNose: std(0xf2c230, { rough: 0.6 }),
    balustrade: std(0x9fd3ef, { metal: 0.1, rough: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    gateCabinet: std(0xb9c0c6, { metal: 0.7, rough: 0.3 }),
    gateTop: std(0x1c2024, { rough: 0.5 }),
    gateFlap: std(0xbfe3f5, { metal: 0.1, rough: 0.05, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    validator: glow(0x37d67a),
    kiosk: std(0x3a4148, { metal: 0.4, rough: 0.5 }),
    kioskScreen: glow(0x2a74ff),
    screenHousing: std(0x15181c, { metal: 0.5, rough: 0.4 }),
    bufferRed: std(0xc8222a, { rough: 0.5 }),
    bufferWhite: std(0xeeeeee, { rough: 0.5 }),
    bufferLamp: glow(0xff2a2a),
    street: glow(0xffffff, { map: toTexture(street) }),
    // Carteles compartidos
    exitUp: glow(0xffffff, { map: toTexture(signCanvas("↑  SALIDA")) }),
    exitStreet: glow(0xffffff, { map: toTexture(signCanvas("SALIDA A LA CALLE", "#1f7a3c", 1024, 128, "800 60px Arial")) }),
    dirA: glow(0xffffff, { map: toTexture(signCanvas("DIRECCIÓN F. CASTILLO VELASCO", "#1d2228", 1024, 128, "800 50px Arial")) }),
    dirB: glow(0xffffff, { map: toTexture(signCanvas("DIRECCIÓN PLAZA QUILICURA", "#1d2228", 1024, 128, "800 50px Arial")) }),
    toPlatforms: glow(0xffffff, { map: toTexture(signCanvas("←  PLAZA QUILICURA     ANDENES     F. CASTILLO VELASCO  →", LINE.color, 2048, 128, "800 52px Arial")) }),
    ticketOffice: glow(0xffffff, { map: toTexture(signCanvas("BOLETERÍA · CARGA TU TARJETA bip!", "#c41e2a", 1024, 128, "800 48px Arial")) }),
    stopBoard: glow(0xffffff, { map: toTexture(stopBoardCanvas()) }),
    lineMap: glow(0xffffff, { map: toTexture(lineMapCanvas()) }),
    youAreHere: glow(0xd42026),
  };
}


/* ==========================================================================
   Clase World
   ========================================================================== */

export class World {
  constructor(scene) {
    this.scene = scene;
    this.M = createWorldMaterials();
    this.stations = [];
    this.gates = [];

    buildTrack(scene, this.M);
    this.buildTunnels();
    STATIONS.forEach(st => this.stations.push(buildStation(scene, this.M, st, this.gates)));
    buildTrackEnds(scene, this.M);

    // Pool de luces de estación: 3 luces reales que siguen a la cámara
    this.lightSpots = [];
    STATIONS.forEach(st => {
      this.lightSpots.push(new THREE.Vector3(0, 6.0, st.z - 30), new THREE.Vector3(0, 6.0, st.z + 5), new THREE.Vector3(0, 9.9, st.z + 43));
    });
    this.lights = Array.from({ length: 3 }, () => {
      const l = new THREE.PointLight(0xeef4ff, 85, 60, 1.6);
      scene.add(l);
      return l;
    });
    this.lastLightKey = "";
  }

  buildTunnels() {
    const bounds = [WORLD.start];
    STATIONS.forEach(s => bounds.push(s.z + S.hallHalf, s.z - S.hallHalf));
    bounds.push(WORLD.end);
    for (let i = 0; i < bounds.length; i += 2) buildTunnelSegment(this.scene, this.M, bounds[i], bounds[i + 1]);
  }

  /** Visibilidad por distancia y recolocación del pool de luces. */
  update(camera) {
    const cz = camera.z, R = CONFIG.renderRadius;
    for (const s of this.stations) s.group.visible = Math.abs(s.st.z - cz) < R;

    const key = `${Math.round(cz / 4)}|${Math.round(camera.y)}`;
    if (key !== this.lastLightKey) {
      this.lastLightKey = key;
      const nearest = this.lightSpots
        .map(p => ({ p, d: p.distanceTo(camera) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lights.length);
      nearest.forEach((n, i) => this.lights[i].position.copy(n.p));
    }
  }

  /**
   * Torniquetes: se abren cuando alguien pasa por ellos.
   * @param {Array<THREE.Vector3>} agents posiciones (mundo) de jugador y viajeros en la mezanina
   * @returns {Array} pasos abiertos este fotograma (para el sonido "bip")
   */
  updateGates(dt, agents, cameraZ) {
    const opened = [];
    for (const gate of this.gates) {
      if (Math.abs(gate.z - cameraZ) > 120) continue;
      const near = agents.some(a => Math.abs(a.y - MZ.y) < 1 && Math.abs(a.x - gate.x) < 0.4 && Math.abs(a.z - gate.z) < 1.1);
      const target = near ? 1 : 0;
      if (target === 1 && gate.open < 0.05) opened.push(gate);
      gate.open += Math.sign(target - gate.open) * Math.min(Math.abs(target - gate.open), dt * 5);
      const a = gate.open * Math.PI / 2;
      gate.flaps[0].rotation.y = a;
      gate.flaps[1].rotation.y = -a;
    }
    return opened;
  }

  /**
   * Pantallas de próximo tren (PID) de las estaciones cercanas.
   * @param {(st, side)=>Array<{minutes:number, here:boolean}>} arrivalsFor
   */
  updatePids(cameraZ, clock, arrivalsFor) {
    for (const s of this.stations) {
      if (Math.abs(s.st.z - cameraZ) > CONFIG.renderRadius) continue;
      s.pids.forEach(pid => drawPid(pid, s.st, clock, arrivalsFor(s.st, pid.side)));
    }
  }
}


/* ==========================================================================
   Vías, catenaria y túnel
   ========================================================================== */

function buildTrack(scene, M) {
  const z0 = WORLD.start, z1 = WORLD.end;
  const len = z0 - z1, mid = (z0 + z1) / 2;
  const gaugeHalf = 0.7175;
  const cy = CONFIG.catenary.contactY;
  const m = new THREE.Matrix4();
  const sleeperGeo = new THREE.BoxGeometry(2.3, 0.12, 0.24);

  [ROUTE_A.trackX, ROUTE_B.trackX].forEach(tx => {
    addBox(scene, 2.6, 0.08, len, M.slab, tx, -0.01, mid);
    instancedChunks(scene, sleeperGeo, M.sleeper, z0, z1, 0.75, (z) => m.makeTranslation(tx, 0.09, z));
    [-gaugeHalf, gaugeHalf].forEach(x => {
      addBox(scene, 0.07, 0.11, len, M.rail, tx + x, 0.2, mid);
      addBox(scene, 0.075, 0.02, len, M.railHead, tx + x, CONFIG.track.railTop - 0.01, mid);
    });
    // Catenaria rígida sobre cada vía
    addBox(scene, 0.11, 0.09, len, M.catenary, tx, cy + 0.07, mid);
    addBox(scene, 0.02, 0.02, len, M.contactWire, tx, cy, mid);
    instancedChunks(scene, new THREE.BoxGeometry(0.5, 0.06, 0.08), M.catenary, z0 - 5, z1, 10, (z) => m.makeTranslation(tx, cy + 0.15, z));
    instancedChunks(scene, new THREE.BoxGeometry(0.05, 2.2, 0.05), M.catenary, z0 - 5, z1, 10, (z) => m.makeTranslation(tx, cy + 1.3, z));
    instancedChunks(scene, new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), M.insulator, z0 - 5, z1, 10, (z) => m.makeTranslation(tx, cy + 0.3, z));
  });
}

/** Reparte piezas repetidas en InstancedMesh de 250 m (la cámara descarta lo que no ve). */
function instancedChunks(scene, geo, mat, zStart, zEnd, spacing, matrixAt, chunk = 250) {
  for (let c0 = zStart; c0 > zEnd; c0 -= chunk) {
    const c1 = Math.max(zEnd, c0 - chunk);
    const n = Math.floor((c0 - c1) / spacing);
    if (n <= 0) continue;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, matrixAt(c0 - i * spacing));
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}

/** Tramo de túnel de doble vía entre zA (mayor) y zB (menor). */
function buildTunnelSegment(scene, M, zA, zB) {
  const T = CONFIG.tunnel;
  const len = zA - zB, mid = (zA + zB) / 2;
  if (len <= 0) return;

  const below = T.centerY - T.floorY;
  const cut = Math.acos(below / T.radius);
  const geo = new THREE.CylinderGeometry(T.radius, T.radius, len, 48, 1, true, cut, Math.PI * 2 - cut * 2);
  geo.rotateX(Math.PI / 2);
  const arch = new THREE.Mesh(geo, std(0xffffff, { map: toTexture(M.tunnelCanvas, 12, len / 1.5), rough: 0.95, side: THREE.BackSide }));
  arch.position.set(0, T.centerY, mid);
  scene.add(arch);

  const halfChord = Math.sqrt(T.radius ** 2 - below ** 2);
  addBox(scene, halfChord * 2, 0.1, len, std(0xffffff, { map: toTexture(M.tunnelFloorCanvas, 4, len / 6), rough: 0.95 }), 0, T.floorY - 0.05, mid);

  // Andenes de evacuación a ambos lados, pasamanos y bandejas de cables
  const walkway = std(0xffffff, { map: toTexture(M.walkwayCanvas, 1, len / 6), rough: 0.9 });
  [-1, 1].forEach(s => {
    addBox(scene, 1.5, 0.95, len, walkway, s * 4.4, 0.425, mid);
    addBox(scene, 0.04, 0.04, len, M.steel, s * 5.3, 1.9, mid);
    addBox(scene, 0.06, 0.32, len, M.cableTray, s * 5.2, 2.9, mid);
    [2.78, 2.9, 3.02].forEach(y => addBox(scene, 0.07, 0.07, len, M.cable, s * 5.12, y, mid));
  });

  // Luminarias cada 20 m, alternando lados
  const spacing = 20;
  const n = Math.max(1, Math.floor(len / spacing));
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.14, 1.1), M.tunnelLamp, n);
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.22, 1.3), M.tunnelLampHousing, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const z = zA - spacing / 2 - i * spacing, s = i % 2 ? 1 : -1;
    m.makeTranslation(s * 5.0, 3.6, z); housings.setMatrixAt(i, m);
    m.makeTranslation(s * 4.93, 3.6, z); lamps.setMatrixAt(i, m);
  }
  scene.add(housings, lamps);

  // Hitos kilométricos cada 200 m (pk desde Plaza Quilicura)
  const origin = STATIONS[0].z;
  for (let d = Math.ceil((origin - zA) / 200) * 200; origin - d > zB; d += 200) {
    const z = origin - d;
    if (z >= zA - 2 || z <= zB + 2 || d < 0) continue;
    const board = addPlane(scene, 0.45, 0.45, glow(0xffffff, { map: toTexture(milepostCanvas((d / 1000).toFixed(1))) }), 5.25, 1.6, z, -Math.PI / 2);
    board.material.color.setScalar(0.55);
  }
}


/* ==========================================================================
   Estaciones
   ========================================================================== */

function buildStation(scene, M, st, gates) {
  const z = st.z, hall = S.hallHalf, ph = S.platformHalf;
  const group = new THREE.Group();
  group.name = `station-${st.id}`;
  scene.add(group);

  const nameMat = glow(0xffffff, { map: toTexture(stationNameCanvas(st)) });
  const wallMat = M.stationWalls[st.index % M.stationWalls.length];
  const pids = [];

  // Solera y techo del vestíbulo
  addBoxSpan(group, 0, S.wallX * 2, -0.15, -0.05, z + hall, z - hall, M.hallFloor);
  addBoxSpan(group, 0, S.wallX * 2 + 0.6, S.ceilingY, S.ceilingY + 0.2, z + hall, z - hall, M.ceiling);

  // Columnas centrales entre las dos vías; bajo la mezanina terminan en su losa
  for (let off = -50; off <= 50; off += 10) {
    const top = off >= MZ.z0 && off <= MZ.z1 ? MZ.y - 0.34 : S.ceilingY;
    addBox(group, 0.5, top + 0.05, 0.5, M.column, 0, top / 2 - 0.025, z + off);
  }

  [-1, 1].forEach(side => {
    const edgeX = S.platformEdgeX, wallX = S.wallX;
    const pw = wallX - edgeX, pcx = side * (edgeX + pw / 2);
    const faceRot = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    const route = side > 0 ? ROUTE_A : ROUTE_B;
    const inStairs = (zz) => zz > z + MZ.stairZ0 - 3 && zz < z + MZ.stairZ1 + 2;

    // Andén
    addBoxSpan(group, pcx, pw, -0.05, S.platformTop, z + ph, z - ph, M.platform);
    addBoxSpan(group, side * (edgeX + 0.02), 0.04, -0.05, S.platformTop - 0.06, z + ph, z - ph, M.platformFace);
    addBoxSpan(group, side * (edgeX + 0.25), 0.5, S.platformTop, S.platformTop + 0.012, z + ph, z - ph, M.platformEdge);
    addBoxSpan(group, side * (edgeX + 0.62), 0.06, S.platformTop, S.platformTop + 0.012, z + ph, z - ph, M.platformLine);
    [z + ph, z - ph].forEach(endZ => {
      addBox(group, pw - 0.6, 0.05, 0.05, M.steel, side * (edgeX + 0.3 + (pw - 0.6) / 2), S.platformTop + 1.0, endZ);
    });

    // Muro alicatado
    addBoxSpan(group, side * (wallX + 0.15), 0.3, -0.05, S.ceilingY, z + hall, z - hall, wallMat);

    // Columnas y bancos del andén (fuera de la zona de escaleras)
    for (let off = -46; off <= 46; off += 12) {
      if (inStairs(z + off)) continue;
      addBox(group, 0.42, S.platformCeilingY - S.platformTop + 0.4, 0.42, M.column, side * 6.0, (S.platformCeilingY + S.platformTop + 0.4) / 2, z + off);
      const bz = z + off + 6;
      if (off < 46 && !inStairs(bz)) {
        addBox(group, 0.45, 0.06, 1.8, M.bench, side * 7.95, S.platformTop + 0.45, bz);
        addBox(group, 0.06, 0.4, 1.8, M.bench, side * 8.22, S.platformTop + 0.7, bz);
        [-0.75, 0.75].forEach(dz => addBox(group, 0.4, 0.45, 0.06, M.benchFrame, side * 7.95, S.platformTop + 0.22, bz + dz));
      }
    }

    // Carteles de nombre y plano de línea en el muro
    for (const off of [-44, -32, 0, 12]) addPlane(group, 3.6, 0.9, nameMat, side * (wallX - 0.01), 2.85, z + off, faceRot);
    const mapW = 4.4, mapH = 0.825, mapZ = z - 16;
    addPlane(group, mapW, mapH, M.lineMap, side * (wallX - 0.01), 2.85, mapZ, faceRot);
    addPlane(group, 0.09, 0.09, M.youAreHere, side * (wallX - 0.02), 2.85 + mapH * (0.5 - 190 / 384), mapZ + side * (lineMapU(st) - 0.5) * mapW, faceRot);

    // Bandejas de luz sobre el andén (hasta la mezanina)
    for (let off = -57; off <= 31; off += 6) {
      addBox(group, 0.5, 0.08, 4.4, M.fixtureHousing, side * 5.8, S.platformCeilingY, z + off);
      addBox(group, 0.3, 0.03, 4.2, M.fixture, side * 5.8, S.platformCeilingY - 0.05, z + off);
    }

    // Carteles colgantes: dirección y salida
    const hang = (mat, sx, sy, sz, w = 2.6) => {
      addBox(group, 0.03, 1.0, 0.03, M.steel, sx - w / 2 + 0.1, sy + 0.75, sz);
      addBox(group, 0.03, 1.0, 0.03, M.steel, sx + w / 2 - 0.1, sy + 0.75, sz);
      addPlane(group, w, w / 8, mat, sx, sy, sz + 0.01, 0);
      addPlane(group, w, w / 8, mat, sx, sy, sz - 0.01, Math.PI);
    };
    hang(side > 0 ? M.dirA : M.dirB, side * 5.6, 4.7, z - 28, 3.2);
    hang(side > 0 ? M.dirA : M.dirB, side * 5.6, 4.7, z + 2, 3.2);
    hang(M.exitUp, side * 7.2, 4.9, z + MZ.stairZ0 - 2, 1.8);

    // Pantalla de próximo tren (una por andén, con su sentido)
    const pidCanvas = makeCanvas(512, 160);
    const pid = { side, route, canvas: pidCanvas, ctx: pidCanvas.getContext("2d"), texture: toTexture(pidCanvas), lastKey: "" };
    pids.push(pid);
    const pidMat = glow(0xffffff, { map: pid.texture });
    const px = side * 5.4, py = 4.0, pz = z - 10;
    addBox(group, 0.03, 0.9, 0.03, M.steel, px - 0.5, py + 0.75, pz);
    addBox(group, 0.03, 0.9, 0.03, M.steel, px + 0.5, py + 0.75, pz);
    addBox(group, 1.66, 0.56, 0.1, M.screenHousing, px, py, pz);
    addPlane(group, 1.5, 0.47, pidMat, px, py, pz + 0.052, 0);
    addPlane(group, 1.5, 0.47, pidMat, px, py, pz - 0.052, Math.PI);

    // Cartel de PARE (cabeza de tren) para el sentido de este andén
    const stopZ = route.toWorldZ(route.stationOf(st).stopZ);
    const postX = side * (edgeX + 0.9);
    addBox(group, 0.06, 1.6, 0.06, M.steel, postX, S.platformTop + 0.8, stopZ);
    addPlane(group, 0.6, 0.6, M.stopBoard, postX, S.platformTop + 1.85, stopZ, side > 0 ? 0 : Math.PI);
    addBoxSpan(group, side * (edgeX + 0.25), 0.5, S.platformTop + 0.013, S.platformTop + 0.016, stopZ + 0.1, stopZ - 0.1, M.platformLine);

    // Escalera al andén desde la mezanina
    buildStairs(group, M, side, z);
  });

  buildMezzanine(group, M, st, nameMat, gates);

  // Muros de boca de túnel
  [z + hall, z - hall].forEach(endZ => group.add(makePortalWall(M.portal, endZ)));

  return { st, group, pids };
}

/** Escalera fija entre el andén (y = 1,2) y la mezanina (y = 7,2), pegada al muro. */
function buildStairs(group, M, side, z) {
  const z0 = z + MZ.stairZ0, z1 = z + MZ.stairZ1;
  const y0 = S.platformTop, y1 = MZ.y;
  const x0 = MZ.stairX0, x1 = MZ.stairX1, w = x1 - x0, xc = side * (x0 + w / 2);
  const steps = 34, run = (z1 - z0) / steps, rise = (y1 - y0) / steps;

  // Peldaños instanciados (una sola llamada de dibujo)
  const geo = new THREE.BoxGeometry(w, rise, run);
  const treads = new THREE.InstancedMesh(geo, M.stair, steps);
  const noses = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 0.012, 0.05), M.stairNose, steps);
  const m = new THREE.Matrix4();
  for (let i = 0; i < steps; i++) {
    const yTop = y0 + rise * (i + 1);
    m.makeTranslation(xc, yTop - rise / 2, z0 + run * (i + 0.5)); treads.setMatrixAt(i, m);
    m.makeTranslation(xc, yTop + 0.006, z0 + run * i + 0.03); noses.setMatrixAt(i, m);
  }
  treads.computeBoundingSphere(); noses.computeBoundingSphere();
  group.add(treads, noses);

  // Cierre lateral bajo la escalera y barandal de vidrio
  const shape = new THREE.Shape();
  shape.moveTo(0, y0); shape.lineTo(z1 - z0, y0); shape.lineTo(z1 - z0, y1); shape.closePath();
  const side1 = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.portal);
  side1.rotation.y = -Math.PI / 2;
  side1.position.set(side * (x0 - 0.02), 0, z0);
  group.add(side1);
  const len = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
  const glass = addBox(group, 0.02, 1.0, len, M.balustrade, side * (x0 - 0.03), (y0 + y1) / 2 + 0.5, (z0 + z1) / 2);
  glass.rotation.x = -ang;
  const rail = addBox(group, 0.05, 0.05, len, M.steel, side * (x0 - 0.03), (y0 + y1) / 2 + 1.0, (z0 + z1) / 2);
  rail.rotation.x = -ang;
}

/** Mezanina: losa elevada con barandal, torniquetes, boletería y salida a la calle. */
function buildMezzanine(group, M, st, nameMat, gates) {
  const z = st.z, y = MZ.y, wx = S.wallX;
  const za = z + MZ.z0, zb = z + MZ.z1, zg = z + MZ.gateZ;

  // Losa y falso techo inferior con luminarias (sobre andenes y vías)
  addBoxSpan(group, 0, wx * 2, y - 0.3, y, za, zb, M.deck);
  addBoxSpan(group, 0, wx * 2, y - 0.34, y - 0.3, za, zb, M.soffit);
  for (let x = -6; x <= 6; x += 3) addBoxSpan(group, x, 0.3, y - 0.36, y - 0.34, za + 1, zb - 1, M.fixture);

  // Barandal de vidrio en el borde que da a los andenes (salvo las llegadas de escalera)
  const segs = [[-MZ.stairX0, MZ.stairX0]];
  segs.forEach(([x0, x1]) => {
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y, y + 1.05, za + 0.02, za + 0.06, M.balustrade);
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y + 1.05, y + 1.1, za, za + 0.08, M.steel);
  });

  // Línea de torniquetes: paneles de vidrio a los lados y armarios entre pasos
  const gx = MZ.gates, gh = MZ.gateHalf;
  const firstEdge = gx[0] - gh, lastEdge = gx.at(-1) + gh;
  [[-wx, firstEdge - 0.3], [lastEdge + 0.3, wx]].forEach(([x0, x1]) => {
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y, y + 1.1, zg - 0.03, zg + 0.03, M.balustrade);
  });
  const cabinetEdges = [firstEdge - 0.3, ...gx.flatMap(g => [g - gh, g + gh]), lastEdge + 0.3];
  for (let i = 0; i < cabinetEdges.length; i += 2) {
    const x0 = cabinetEdges[i], x1 = cabinetEdges[i + 1];
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y, y + 1.0, zg - 0.6, zg + 0.6, M.gateCabinet);
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0 + 0.02, y + 1.0, y + 1.04, zg - 0.62, zg + 0.62, M.gateTop);
    addBoxSpan(group, (x0 + x1) / 2, 0.14, y + 1.04, y + 1.09, zg + 0.35, zg + 0.5, M.validator);   // validador bip!
  }
  // Aletas de cada paso (se abren al pasar)
  gx.forEach(g => {
    const flaps = [-1, 1].map(s => {
      const pivot = new THREE.Group();
      pivot.position.set(g + s * gh, y + 0.55, zg);
      const flap = addBox(pivot, gh, 0.7, 0.02, M.gateFlap, -s * gh / 2, 0, 0);
      flap.userData.s = s;
      group.add(pivot);
      return pivot;
    });
    // Las dos aletas giran hacia la zona pagada
    gates.push({ x: g, z: zg, flaps, open: 0, station: st });
  });

  // Cartel de orientación sobre los torniquetes (mirando a quien entra de la calle)
  addPlane(group, 7.2, 0.45, M.toPlatforms, 0, y + 2.6, zg + 0.8, 0);
  addPlane(group, 3.2, 0.8, nameMat, 0, y + 2.6, zg - 0.8, Math.PI);

  // Boletería y tótems de carga en la zona no pagada
  addBoxSpan(group, -6.6, 2.6, y, y + 2.4, zg + 2.5, zb - 0.3, M.kiosk);
  addBoxSpan(group, -5.29, 0.02, y + 1.0, y + 1.9, zg + 3.2, zb - 1.0, M.balustrade);
  addPlane(group, 2.6, 0.33, M.ticketOffice, -5.28, y + 2.2, (zg + 2.5 + zb - 0.3) / 2, Math.PI / 2);
  [5.0, 6.3].forEach(x => {
    addBoxSpan(group, x, 0.7, y, y + 1.7, zb - 1.0, zb - 0.5, M.kiosk);
    addBoxSpan(group, x, 0.5, y + 1.0, y + 1.5, zb - 1.02, zb - 1.0, M.kioskScreen);
  });

  // Muro final con la salida a la calle
  const ex = MZ.exitHalf, top = S.ceilingY;
  [[-wx, -ex], [ex, wx]].forEach(([x0, x1]) => addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y, top, zb, zb + 0.3, M.portal));
  addBoxSpan(group, 0, ex * 2, y + 2.7, top, zb, zb + 0.3, M.portal);
  addPlane(group, ex * 2, 2.7, M.street, 0, y + 1.35, zb + 0.32, Math.PI);
  addPlane(group, ex * 2 + 0.4, 0.3, M.exitStreet, 0, y + 2.95, zb - 0.01, Math.PI);
}

/** Muro plano con hueco en forma de bóveda del túnel. */
function makePortalWall(mat, z) {
  const T = CONFIG.tunnel;
  const below = T.centerY - T.floorY;
  const halfChord = Math.sqrt(T.radius ** 2 - below ** 2);
  const aLeft = Math.atan2(-below, -halfChord), aRight = Math.atan2(-below, halfChord);
  const shape = new THREE.Shape();
  shape.moveTo(-S.wallX - 0.3, T.floorY);
  shape.lineTo(-halfChord, T.floorY);
  shape.absarc(0, T.centerY, T.radius, aLeft, aRight, true);
  shape.lineTo(S.wallX + 0.3, T.floorY);
  shape.lineTo(S.wallX + 0.3, S.ceilingY + 0.2);
  shape.lineTo(-S.wallX - 0.3, S.ceilingY + 0.2);
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), mat);
  mesh.position.z = z;
  return mesh;
}

/** Fondos de saco y toperas de ambas vías. */
function buildTrackEnds(scene, M) {
  const T = CONFIG.tunnel;
  const disc = new THREE.CircleGeometry(T.radius + 0.1, 48);
  const back = new THREE.Mesh(disc, M.headwall);
  back.position.set(0, T.centerY, WORLD.start);
  back.rotation.y = Math.PI;
  const front = new THREE.Mesh(disc, M.headwall);
  front.position.set(0, T.centerY, WORLD.end);
  scene.add(back, front);

  [ROUTE_A, ROUTE_B].forEach(route => {
    const g = new THREE.Group();
    g.position.set(route.trackX, 0, route.toWorldZ(route.track.bumperZ - 0.6));
    g.rotation.y = route.dir === 1 ? 0 : Math.PI;
    scene.add(g);
    addBox(g, 2.2, 0.35, 0.5, M.bufferRed, 0, 0.95, 0);
    for (let i = -2; i <= 2; i++) addBox(g, 0.2, 0.36, 0.52, i % 2 ? M.bufferRed : M.bufferWhite, i * 0.4, 0.95, 0);
    addBox(g, 0.2, 0.9, 1.6, M.steel, -0.72, 0.6, -0.6);
    addBox(g, 0.2, 0.9, 1.6, M.steel, 0.72, 0.6, -0.6);
    addBox(g, 0.25, 0.25, 0.1, M.bufferLamp, 0, 1.45, 0.2);
  });
}


/* ==========================================================================
   Pantalla de próximo tren (PID)
   ========================================================================== */

function drawPid(pid, st, clock, arrivals) {
  const route = pid.route;
  const terminal = route.stationOf(st) === route.last;
  const lines = arrivals.slice(0, 2).map(a => a.here ? "EN ANDÉN" : a.minutes < 1 ? "LLEGANDO" : `${a.minutes} min`);
  const key = `${Math.floor(clock / 30)}|${lines.join("|")}`;
  if (key === pid.lastKey) return;
  pid.lastKey = key;

  const g = pid.ctx, W = 512, H = 160;
  g.fillStyle = "#050607"; g.fillRect(0, 0, W, H);
  g.fillStyle = LINE.color; g.fillRect(0, 0, W, 34);
  g.fillStyle = "#fff"; g.font = "800 19px Arial"; g.textBaseline = "middle"; g.textAlign = "left";
  g.fillText(`L3 · DIR. ${route.last.short}`, 12, 18);
  g.textAlign = "right"; g.fillText(formatClock(clock).slice(0, 5), W - 12, 18);

  g.font = "700 30px monospace";
  if (terminal) {
    g.fillStyle = "#ffb000"; g.textAlign = "center";
    g.fillText("FIN DE TRAYECTO", W / 2, 80);
    g.font = "600 20px monospace"; g.fillText("NO SUBIR AL TREN", W / 2, 122);
  } else {
    [0, 1].forEach(i => {
      const y = 68 + i * 50;
      g.fillStyle = i === 0 ? "#ffb000" : "#c98a00";
      g.textAlign = "left"; g.fillText(i === 0 ? "1º" : "2º", 14, y);
      g.font = "700 24px monospace";
      g.fillText(route.last.short.replace(".", ""), 64, y);
      g.font = "700 30px monospace";
      g.textAlign = "right"; g.fillText(lines[i] ?? "--", W - 14, y);
    });
  }
  pid.texture.needsUpdate = true;
}
