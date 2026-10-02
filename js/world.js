/* ==========================================================================
   MetroSim — Alpha 0.4 · world.js
   Mundo 3D fijo de la Línea 3: vía, catenaria rígida, túnel, 21 estaciones,
   pantallas de próximo tren (PID) y fondos de saco.

   Rendimiento (la línea mide ~24 km):
     · Las estaciones lejanas se ocultan (CONFIG.renderRadius).
     · Las luces reales son un "pool" fijo que se recoloca en las estaciones
       más cercanas a la cámara (el número de luces nunca cambia, así three.js
       no tiene que recompilar shaders).
     · Las texturas comunes (salida, PARE, plano de línea...) se comparten.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, LINE } from "./config.js";
import {
  std, glow, addBox, addBoxSpan, addPlane, makeCanvas, toTexture, tunnelTexture, concreteTexture,
  terrazzoTexture, tileTexture, stationNameCanvas, lineMapCanvas, lineMapU, signCanvas, stopBoardCanvas,
  milepostCanvas, formatClock,
} from "./utils.js";

/** Variantes de alicatado para dar identidad a cada estación. */
const TILE_TINTS = [[0, 0, 0], [-14, -4, 10], [8, -2, -14], [-8, 4, -4]];

/** Materiales y texturas compartidos del mundo (se crean una vez por partida). */
function createWorldMaterials() {
  const S = CONFIG.station;
  const wallH = S.ceilingY + 0.05;
  const bandV0 = (3.75 + 0.05) / wallH, bandV1 = (4.1 + 0.05) / wallH;
  const platformLen = S.platformHalf * 2;
  const platformW = S.wallX - S.platformEdgeX;
  const trackLen = CONFIG.track.start - CONFIG.track.end;

  // Fondo de los pasillos de acceso: degradado que sugiere profundidad
  const access = makeCanvas(128, 256), g = access.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#0b0e12"); grd.addColorStop(0.55, "#1b2027"); grd.addColorStop(1, "#3a3f45");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 256);
  g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(40, 30, 48, 120);

  return {
    tunnelCanvas: tunnelTexture(),
    tunnelFloorCanvas: concreteTexture("#34383b"),
    walkwayCanvas: concreteTexture("#5a5e61"),
    slab: std(0xffffff, { map: toTexture(concreteTexture("#3c3f42", 30), 2, trackLen / 4), rough: 0.95 }),
    sleeper: std(0x77736b, { rough: 0.9 }),
    rail: std(0x8f989f, { metal: 0.85, rough: 0.32 }),
    railHead: std(0xd6dde2, { metal: 0.95, rough: 0.18 }),
    catenary: std(0x9aa1a7, { metal: 0.8, rough: 0.3 }),
    contactWire: std(0xb87333, { metal: 0.9, rough: 0.25 }),   // hilo de contacto de cobre
    insulator: std(0x6b3a2a, { rough: 0.5 }),
    cable: std(0x15171a, { rough: 0.55 }),
    cableTray: std(0x6d747a, { metal: 0.6, rough: 0.45 }),
    tunnelLamp: glow(0xffdcaa),
    tunnelLampHousing: std(0x2a2d30, { metal: 0.4 }),
    headwall: std(0x2c3034, { rough: 0.95 }),
    tunnelFloor: std(0xffffff, { map: toTexture(concreteTexture("#34383b"), 4, 30), rough: 0.95 }),
    platform: std(0xffffff, { map: toTexture(terrazzoTexture(), platformW / 2, platformLen / 2), rough: 0.55 }),
    platformFace: std(0x2b2f33, { rough: 0.9 }),
    platformEdge: std(0xf2c230, { rough: 0.6 }),
    platformLine: std(0xf4f4ef, { rough: 0.6 }),
    stationWalls: TILE_TINTS.map(t => std(0xffffff, {
      map: toTexture(tileTexture(LINE.color, bandV0, bandV1, t), S.hallHalf * 2 / 4, 1), rough: 0.35, metal: 0.05,
    })),
    portal: std(0xffffff, { map: toTexture(concreteTexture("#4a4e52"), 4, 2), rough: 0.9, side: THREE.DoubleSide }),
    ceiling: std(0x262c32, { rough: 0.8 }),
    ceilingSlat: std(0x3a424a, { metal: 0.5, rough: 0.5 }),
    fixture: glow(0xf2f7ff),
    fixtureHousing: std(0x1b1f23, { metal: 0.5 }),
    column: std(0xc9cfd4, { metal: 0.45, rough: 0.35 }),
    columnBase: std(0x30363c, { metal: 0.3 }),
    bench: std(0x9a6b3f, { rough: 0.6 }),
    benchFrame: std(0x3d434a, { metal: 0.7, rough: 0.4 }),
    steel: std(0x80888f, { metal: 0.75, rough: 0.35 }),
    screenHousing: std(0x15181c, { metal: 0.5, rough: 0.4 }),
    bufferRed: std(0xc8222a, { rough: 0.5 }),
    bufferWhite: std(0xeeeeee, { rough: 0.5 }),
    bufferLamp: glow(0xff2a2a),
    // Carteles compartidos por todas las estaciones
    exitSign: glow(0xffffff, { map: toTexture(signCanvas("SALIDA  ➜")) }),
    exitSignShort: glow(0xffffff, { map: toTexture(signCanvas("SALIDA")) }),
    stopBoard: glow(0xffffff, { map: toTexture(stopBoardCanvas()) }),
    accessBack: glow(0xffffff, { map: toTexture(access) }),
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

    buildTrack(scene, this.M);
    this.buildTunnels();
    STATIONS.forEach(st => this.stations.push(buildStation(scene, this.M, st)));
    buildTrackEnds(scene, this.M);

    // Pool de luces de estación: 3 luces reales que siguen a la cámara (las GPU integradas lo agradecen)
    this.lightSpots = [];
    STATIONS.forEach(st => [-26, 0, 26].forEach(off => this.lightSpots.push(new THREE.Vector3(0, 5.6, st.z + off))));
    this.lights = Array.from({ length: 3 }, () => {
      const l = new THREE.PointLight(0xeef4ff, 85, 60, 1.6);
      scene.add(l);
      return l;
    });
    this.lastLightZ = Infinity;
  }

  buildTunnels() {
    const S = CONFIG.station;
    const bounds = [CONFIG.track.start];
    STATIONS.forEach(s => bounds.push(s.z + S.hallHalf, s.z - S.hallHalf));
    bounds.push(CONFIG.track.end);
    for (let i = 0; i < bounds.length; i += 2) buildTunnelSegment(this.scene, this.M, bounds[i], bounds[i + 1]);
  }

  /** Visibilidad por distancia y recolocación del pool de luces. */
  update(cameraZ) {
    const R = CONFIG.renderRadius;
    for (const s of this.stations) s.group.visible = Math.abs(s.st.z - cameraZ) < R;

    if (Math.abs(cameraZ - this.lastLightZ) > 5) {
      this.lastLightZ = cameraZ;
      const nearest = this.lightSpots
        .map(p => ({ p, d: Math.abs(p.z - cameraZ) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lights.length);
      nearest.forEach((n, i) => this.lights[i].position.copy(n.p));
    }
  }

  /**
   * Pantallas de próximo tren (PID) de las estaciones cercanas.
   * @param {(st)=>Array<{label:string, minutes:number|null, here:boolean}>} arrivalsFor
   */
  updatePids(cameraZ, clock, arrivalsFor) {
    for (const s of this.stations) {
      if (Math.abs(s.st.z - cameraZ) > CONFIG.renderRadius) continue;
      drawPid(s.pid, s.st, clock, arrivalsFor(s.st));
    }
  }
}


/* ==========================================================================
   Vía, catenaria y túnel
   ========================================================================== */

/** Losa, traviesas, carriles y catenaria rígida a lo largo de toda la línea. */
function buildTrack(scene, M) {
  const z0 = CONFIG.track.start, z1 = CONFIG.track.end;
  const len = z0 - z1, mid = (z0 + z1) / 2;
  const gaugeHalf = 0.7175;                       // ancho internacional 1435 mm

  addBox(scene, 2.6, 0.08, len, M.slab, 0, -0.01, mid);

  // Traviesas instanciadas en tramos de 250 m: así la cámara descarta los tramos que no ve
  const m = new THREE.Matrix4();
  const sleeperGeo = new THREE.BoxGeometry(2.3, 0.12, 0.24);
  instancedChunks(scene, sleeperGeo, M.sleeper, z0, z1, 0.75, (z) => m.makeTranslation(0, 0.09, z));

  // Carriles: alma + cabeza pulida
  [-gaugeHalf, gaugeHalf].forEach(x => {
    addBox(scene, 0.07, 0.11, len, M.rail, x, 0.2, mid);
    addBox(scene, 0.075, 0.02, len, M.railHead, x, CONFIG.track.railTop - 0.01, mid);
  });

  // Catenaria rígida (perfil de aluminio + hilo de contacto), como la L3 real (1500 V CC)
  const cy = CONFIG.catenary.contactY;
  addBox(scene, 0.11, 0.09, len, M.catenary, 0, cy + 0.07, mid);
  addBox(scene, 0.02, 0.02, len, M.contactWire, 0, cy, mid);

  // Ménsulas y aisladores cada 10 m (instanciados por tramos)
  instancedChunks(scene, new THREE.BoxGeometry(0.5, 0.06, 0.08), M.catenary, z0 - 5, z1, 10, (z) => m.makeTranslation(0, cy + 0.15, z));
  instancedChunks(scene, new THREE.BoxGeometry(0.05, 1.2, 0.05), M.catenary, z0 - 5, z1, 10, (z) => m.makeTranslation(0, cy + 0.8, z));
  instancedChunks(scene, new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), M.insulator, z0 - 5, z1, 10, (z) => m.makeTranslation(0, cy + 0.3, z));
}

/**
 * Reparte piezas repetidas en InstancedMesh de 250 m cada uno.
 * matrixAt(z) devuelve la matriz de la pieza situada en z.
 */
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

/** Un tramo de túnel circular entre zA (mayor) y zB (menor). */
function buildTunnelSegment(scene, M, zA, zB) {
  const T = CONFIG.tunnel;
  const len = zA - zB, mid = (zA + zB) / 2;
  if (len <= 0) return;

  // Bóveda: cilindro abierto sin la parte inferior (que queda bajo la solera).
  const below = T.centerY - T.floorY;
  const cut = Math.acos(below / T.radius);
  const geo = new THREE.CylinderGeometry(T.radius, T.radius, len, 40, 1, true, cut, Math.PI * 2 - cut * 2);
  geo.rotateX(Math.PI / 2);
  const arch = new THREE.Mesh(geo, std(0xffffff, { map: toTexture(M.tunnelCanvas, 9, len / 1.5), rough: 0.95, side: THREE.BackSide }));
  arch.position.set(0, T.centerY, mid);
  scene.add(arch);

  const halfChord = Math.sqrt(T.radius ** 2 - below ** 2);
  addBox(scene, halfChord * 2, 0.1, len, std(0xffffff, { map: toTexture(M.tunnelFloorCanvas, 3, len / 6), rough: 0.95 }), 0, T.floorY - 0.05, mid);

  // Andén de evacuación (izquierda) con pasamanos
  addBox(scene, 1.3, 0.95, len, std(0xffffff, { map: toTexture(M.walkwayCanvas, 1, len / 6), rough: 0.9 }), -2.75, 0.425, mid);
  addBox(scene, 0.04, 0.04, len, M.steel, -3.55, 1.9, mid);

  // Bandejas de cables a ambos lados
  addBox(scene, 0.06, 0.32, len, M.cableTray, 3.66, 2.75, mid);
  [2.62, 2.74, 2.86].forEach(y => addBox(scene, 0.07, 0.07, len, M.cable, 3.6, y, mid));
  addBox(scene, 0.06, 0.25, len, M.cableTray, -3.66, 3.1, mid);
  [3.02, 3.14].forEach(y => addBox(scene, 0.07, 0.07, len, M.cable, -3.6, y, mid));

  // Luminarias de túnel cada 20 m (instanciadas)
  const spacing = 20;
  const n = Math.max(1, Math.floor(len / spacing));
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.14, 1.1), M.tunnelLamp, n);
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.22, 1.3), M.tunnelLampHousing, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const z = zA - spacing / 2 - i * spacing;
    m.makeTranslation(-3.5, 3.55, z); housings.setMatrixAt(i, m);
    m.makeTranslation(-3.43, 3.55, z); lamps.setMatrixAt(i, m);
  }
  scene.add(housings, lamps);

  // Hitos kilométricos cada 200 m (pk desde Plaza Quilicura) en el hastial izquierdo
  const origin = STATIONS[0].z;
  for (let d = Math.ceil((origin - zA) / 200) * 200; origin - d > zB; d += 200) {
    const z = origin - d;
    if (z >= zA - 2 || z <= zB + 2 || d < 0) continue;
    const board = addPlane(scene, 0.45, 0.45, glow(0xffffff, { map: toTexture(milepostCanvas((d / 1000).toFixed(1))) }), -3.42, 1.6, z, Math.PI / 2);
    board.material.color.setScalar(0.55);
  }
}


/* ==========================================================================
   Estaciones
   ========================================================================== */

/** Andenes, paredes, techo, señalética y PID de una estación. Devuelve su registro. */
function buildStation(scene, M, st) {
  const S = CONFIG.station;
  const z = st.z, hall = S.hallHalf, ph = S.platformHalf;
  const group = new THREE.Group();
  group.name = `station-${st.id}`;
  scene.add(group);

  const nameMat = glow(0xffffff, { map: toTexture(stationNameCanvas(st)) });
  const wallMat = M.stationWalls[st.index % M.stationWalls.length];

  // Pantalla de próximo tren (compartida por ambos andenes)
  const pidCanvas = makeCanvas(512, 160);
  const pid = { canvas: pidCanvas, ctx: pidCanvas.getContext("2d"), texture: toTexture(pidCanvas), lastKey: "" };
  const pidMat = glow(0xffffff, { map: pid.texture });

  // Solera del vestíbulo
  addBoxSpan(group, 0, S.wallX * 2, -0.15, -0.05, z + hall, z - hall, M.tunnelFloor);

  [-1, 1].forEach(side => {
    const edgeX = S.platformEdgeX, wallX = S.wallX;
    const pw = wallX - edgeX, pcx = side * (edgeX + pw / 2);
    const faceRot = side > 0 ? -Math.PI / 2 : Math.PI / 2;

    // Andén: cuerpo, frente hacia la vía, borde amarillo y línea de seguridad
    addBoxSpan(group, pcx, pw, -0.05, S.platformTop, z + ph, z - ph, M.platform);
    addBoxSpan(group, side * (edgeX + 0.02), 0.04, -0.05, S.platformTop - 0.06, z + ph, z - ph, M.platformFace);
    addBoxSpan(group, side * (edgeX + 0.25), 0.5, S.platformTop, S.platformTop + 0.012, z + ph, z - ph, M.platformEdge);
    addBoxSpan(group, side * (edgeX + 0.62), 0.06, S.platformTop, S.platformTop + 0.012, z + ph, z - ph, M.platformLine);

    // Barandilla al final de cada andén
    [z + ph, z - ph].forEach(endZ => {
      addBox(group, pw - 0.6, 0.05, 0.05, M.steel, side * (edgeX + 0.3 + (pw - 0.6) / 2), S.platformTop + 1.0, endZ);
      for (let k = 0; k < 4; k++) addBox(group, 0.05, 1.0, 0.05, M.steel, side * (edgeX + 0.4 + k * (pw - 0.8) / 3), S.platformTop + 0.5, endZ);
    });

    // Pared alicatada con franja café de la Línea 3
    addBoxSpan(group, side * (wallX + 0.15), 0.3, -0.05, S.ceilingY, z + hall, z - hall, wallMat);

    // Accesos (pasillos de salida) en ambos extremos
    [-1, 1].forEach(end => buildAccess(group, M, side, z + end * S.accessZ));

    // Columnas y bancos
    for (let off = -30; off <= 30; off += 10) {
      addBox(group, 0.42, S.ceilingY - S.platformTop, 0.42, M.column, side * 5.3, (S.ceilingY + S.platformTop) / 2, z + off);
      addBox(group, 0.52, 0.12, 0.52, M.columnBase, side * 5.3, S.platformTop + 0.06, z + off);
      if (off < 30) {
        const bz = z + off + 5;
        addBox(group, 0.45, 0.06, 1.8, M.bench, side * 6.45, S.platformTop + 0.45, bz);
        addBox(group, 0.06, 0.4, 1.8, M.bench, side * 6.72, S.platformTop + 0.7, bz);
        [-0.75, 0.75].forEach(dz => addBox(group, 0.4, 0.45, 0.06, M.benchFrame, side * 6.45, S.platformTop + 0.22, bz + dz));
      }
    }

    // Carteles con el nombre de la estación en la pared
    for (const off of [-22, -11, 11, 22]) addPlane(group, 3.6, 0.9, nameMat, side * (wallX - 0.01), 2.85, z + off, faceRot);

    // Plano de la línea con marca "usted está aquí"
    const mapW = 4.4, mapH = 0.825;
    addPlane(group, mapW, mapH, M.lineMap, side * (wallX - 0.01), 2.85, z, faceRot);
    const u = lineMapU(st);
    const markerZ = z + side * (u - 0.5) * mapW;                 // el plano se ve de frente desde la vía
    addPlane(group, 0.09, 0.09, M.youAreHere, side * (wallX - 0.02), 2.85 + mapH * (0.5 - 190 / 384), markerZ, faceRot);

    // Luminarias lineales sobre el andén
    for (let off = -39; off <= 39; off += 6) {
      addBox(group, 0.5, 0.08, 4.4, M.fixtureHousing, side * 4.2, S.ceilingY - 0.42, z + off);
      addBox(group, 0.3, 0.03, 4.2, M.fixture, side * 4.2, S.ceilingY - 0.47, z + off);
    }

    // Carteles colgantes (perpendiculares a la vía, visibles desde la cabina)
    [-20, 20].forEach(off => {
      const sx = side * 4.3, sy = 4.6, sz = z + off;
      addBox(group, 0.03, 1.0, 0.03, M.steel, sx - 0.7, sy + 0.9, sz);
      addBox(group, 0.03, 1.0, 0.03, M.steel, sx + 0.7, sy + 0.9, sz);
      addPlane(group, 1.8, 0.45, off > 0 ? M.exitSign : nameMat, sx, sy, sz + 0.01, 0);
      addPlane(group, 1.8, 0.45, off > 0 ? nameMat : M.exitSign, sx, sy, sz - 0.01, Math.PI);
    });

    // Pantalla de próximo tren colgada sobre el andén (doble cara)
    const px = side * 3.9, py = 4.25, pz = z - 4;
    addBox(group, 0.03, 0.9, 0.03, M.steel, px - 0.5, py + 0.75, pz);
    addBox(group, 0.03, 0.9, 0.03, M.steel, px + 0.5, py + 0.75, pz);
    addBox(group, 1.66, 0.56, 0.1, M.screenHousing, px, py, pz);
    addPlane(group, 1.5, 0.47, pidMat, px, py, pz + 0.052, 0);
    addPlane(group, 1.5, 0.47, pidMat, px, py, pz - 0.052, Math.PI);

    // Cartel de PARE (cabeza de tren) y marca en el pavimento
    const postX = side * (edgeX + 0.9);
    addBox(group, 0.06, 1.6, 0.06, M.steel, postX, S.platformTop + 0.8, st.stopZ);
    addPlane(group, 0.6, 0.6, M.stopBoard, postX, S.platformTop + 1.85, st.stopZ, 0);
    addBoxSpan(group, side * (edgeX + 0.25), 0.5, S.platformTop + 0.013, S.platformTop + 0.016, st.stopZ + 0.1, st.stopZ - 0.1, M.platformLine);
  });

  // Techo con lamas
  addBoxSpan(group, 0, S.wallX * 2 + 0.6, S.ceilingY, S.ceilingY + 0.2, z + hall, z - hall, M.ceiling);
  for (let off = -hall + 1; off < hall; off += 2) addBox(group, S.wallX * 2, 0.1, 0.12, M.ceilingSlat, 0, S.ceilingY - 0.05, z + off);

  // Muros de boca de túnel en ambos extremos del vestíbulo
  [z + hall, z - hall].forEach(endZ => group.add(makePortalWall(M.portal, endZ)));

  return { st, group, pid };
}

/** Boca de pasillo en la pared del andén con marco y cartel de SALIDA. */
function buildAccess(group, M, side, z) {
  const S = CONFIG.station;
  const w = 2.2, h = 2.6, x = side * (S.wallX - 0.01);
  const rot = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  addPlane(group, w, h, M.accessBack, x, S.platformTop + h / 2, z, rot);
  const fx = side * (S.wallX - 0.06);
  addBox(group, 0.12, h + 0.12, 0.12, M.column, fx, S.platformTop + h / 2, z - w / 2 - 0.06);
  addBox(group, 0.12, h + 0.12, 0.12, M.column, fx, S.platformTop + h / 2, z + w / 2 + 0.06);
  addBox(group, 0.12, 0.12, w + 0.24, M.column, fx, S.platformTop + h + 0.06, z);
  addPlane(group, 1.6, 0.4, M.exitSignShort, side * (S.wallX - 0.02), S.platformTop + h + 0.45, z, rot);
}

/** Muro plano con hueco en forma de bóveda del túnel. */
function makePortalWall(mat, z) {
  const S = CONFIG.station, T = CONFIG.tunnel;
  const below = T.centerY - T.floorY;
  const halfChord = Math.sqrt(T.radius ** 2 - below ** 2);
  const aLeft = Math.atan2(-below, -halfChord), aRight = Math.atan2(-below, halfChord);
  const shape = new THREE.Shape();
  shape.moveTo(-S.wallX - 0.3, T.floorY);
  shape.lineTo(-halfChord, T.floorY);
  shape.absarc(0, T.centerY, T.radius, aLeft, aRight, true);   // por encima, en sentido horario
  shape.lineTo(S.wallX + 0.3, T.floorY);
  shape.lineTo(S.wallX + 0.3, S.ceilingY + 0.2);
  shape.lineTo(-S.wallX - 0.3, S.ceilingY + 0.2);
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), mat);
  mesh.position.z = z;
  return mesh;
}

/** Fondos de saco: muro tras las cocheras de Plaza Quilicura y topera tras F. Castillo Velasco. */
function buildTrackEnds(scene, M) {
  const T = CONFIG.tunnel;
  const disc = new THREE.CircleGeometry(T.radius + 0.1, 40);
  const back = new THREE.Mesh(disc, M.headwall);
  back.position.set(0, T.centerY, CONFIG.track.start);
  back.rotation.y = Math.PI;
  const front = new THREE.Mesh(disc, M.headwall);
  front.position.set(0, T.centerY, CONFIG.track.end);
  scene.add(back, front);

  const bz = CONFIG.track.bumperZ - 0.6;
  addBox(scene, 2.2, 0.35, 0.5, M.bufferRed, 0, 0.95, bz);
  for (let i = -2; i <= 2; i++) addBox(scene, 0.2, 0.36, 0.52, i % 2 ? M.bufferRed : M.bufferWhite, i * 0.4, 0.95, bz);
  addBox(scene, 0.2, 0.9, 1.6, M.steel, -0.72, 0.6, bz - 0.6);
  addBox(scene, 0.2, 0.9, 1.6, M.steel, 0.72, 0.6, bz - 0.6);
  addBox(scene, 0.25, 0.25, 0.1, M.bufferLamp, 0, 1.45, bz + 0.2);
}


/* ==========================================================================
   Pantalla de próximo tren (PID)
   ========================================================================== */

function drawPid(pid, st, clock, arrivals) {
  const lines = arrivals.slice(0, 2).map(a => a.here ? "EN ANDÉN" : a.minutes === null ? "--" : a.minutes < 1 ? "LLEGANDO" : `${a.minutes} min`);
  const key = `${Math.floor(clock / 30)}|${lines.join("|")}`;
  if (key === pid.lastKey) return;                 // solo se redibuja si cambia algo
  pid.lastKey = key;

  const g = pid.ctx, W = 512, H = 160;
  g.fillStyle = "#050607"; g.fillRect(0, 0, W, H);
  g.fillStyle = LINE.color; g.fillRect(0, 0, W, 34);
  g.fillStyle = "#fff"; g.font = "800 20px Arial"; g.textBaseline = "middle"; g.textAlign = "left";
  g.fillText("L3 · DIR. F. CASTILLO VELASCO", 12, 18);
  g.textAlign = "right"; g.fillText(formatClock(clock).slice(0, 5), W - 12, 18);

  const terminal = st === STATIONS.at(-1);
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
      g.fillText("F.C.VELASCO", 70, y);
      g.textAlign = "right"; g.fillText(lines[i] ?? "--", W - 14, y);
    });
  }
  pid.texture.needsUpdate = true;
}
