/* ==========================================================================
   MetroSim — Alpha 0.6 · world.js
   Mundo 3D de la línea activa (doble vía): vías, catenaria rígida, túnel de
   doble vía, 21 estaciones con andenes laterales, escaleras, mezanina con
   torniquetes y salida a la calle, pantallas de próximo tren y topes.

   Sección transversal de una estación (x):
     muro −8,5 | andén vía 2 | borde −3,55 | vía 2 (x=−2) | columnas x=0 |
     vía 1 (x=+2) | borde +3,55 | andén vía 1 | muro +8,5
   A lo largo (z relativo al centro): andenes de 125 m (−75…+50) · escalera fija y escalera
   mecánica +20…+34 · mezanina +34…+52 a 7,2 m de altura · torniquetes en +44
   · boletería, tótems de carga y salida a la calle tras los torniquetes.
   En las colas tras cada terminal hay un cambio de vía para la maniobra de
   retorno y un cartel de FIN DE MANIOBRA.

   Rendimiento: estaciones lejanas ocultas, pool fijo de 3 luces que sigue a
   la cámara, piezas repetidas instanciadas y texturas comunes compartidas.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, WORLD, LINE, FARES, formatCLP } from "./config.js";
import { ROUTE_A, ROUTE_B } from "./engine/route.js";
import { Elevator, ElevatorSystem } from "./elevators.js";
import { PLATFORM_COLUMNS, PLATFORM_BENCHES, COLUMN_X, BENCH_X, PID_OFFSETS, isArrivalOnly } from "./stationLayout.js";
import {
  std, glow, addBox, addBoxSpan, addPlane, makeCanvas, toTexture, tunnelTexture, concreteTexture,
  terrazzoTexture, tileTexture, stationNameCanvas, lineMapCanvas, directionMapCanvas, transferSignCanvas, transferCorridorCanvas, lineMapU, signCanvas, stopBoardCanvas,
  milepostCanvas, formatClock,
} from "./utils.js";

const S = CONFIG.station, MZ = CONFIG.mezzanine;
const TILE_TINTS = [[0, 0, 0], [-14, -4, 10], [8, -2, -14], [-8, 4, -4]];

/* ==========================================================================
   Materiales compartidos
   ========================================================================== */

/** Fuente que hace caber un texto en un cartel (más pequeña para nombres largos). */
function fitFont(text, size, maxChars) {
  return `800 ${Math.round(size * Math.min(1, maxChars / Math.max(maxChars, text.length)))}px Arial`;
}

function createWorldMaterials() {
  const wallH = S.ceilingY + 0.05;
  const bandV0 = (3.75 + 0.05) / wallH, bandV1 = (4.1 + 0.05) / wallH;
  const platformLen = S.platformZ1 - S.platformZ0;
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
    // Equipamiento del túnel: señalética de evacuación, salidas de emergencia,
    // balizas del CBTC entre carriles y canaleta central de drenaje
    evacSign: glow(0xffffff, { map: toTexture(signCanvas("⇦  SALIDA DE EMERGENCIA  ⇨", "#1f7a3c", 512, 96, "800 36px Arial")) }),
    exitDoor: std(0x55606a, { metal: 0.5, rough: 0.45 }),
    exitFrame: glow(0x2fd36b),
    exitSign: glow(0xffffff, { map: toTexture(signCanvas("SALIDA · PIQUE DE EVACUACIÓN", "#1f7a3c", 512, 96, "800 32px Arial")) }),
    balise: std(0xf2c230, { rough: 0.6 }),
    drain: std(0x15181a, { rough: 0.95 }),
    headwall: std(0x2c3034, { rough: 0.95 }),
    hallFloor: std(0xffffff, { map: toTexture(concreteTexture("#34383b"), 6, 40), rough: 0.95 }),
    platform: std(0xffffff, { map: toTexture(terrazzoTexture(), platformW / 2, platformLen / 2), rough: 0.55 }),
    deck: std(0xffffff, { map: toTexture(terrazzoTexture(), S.wallX, (MZ.z1 - MZ.z0) / 2), rough: 0.5 }),
    platformFace: std(0x2b2f33, { rough: 0.9 }),
    platformEdge: std(0xf2c230, { rough: 0.6 }),
    platformLine: std(0xf4f4ef, { rough: 0.6 }),
    stationWalls: TILE_TINTS.map(t => std(0xffffff, {
      map: toTexture(tileTexture(LINE.color, bandV0, bandV1, t), (S.hallZ1 - S.hallZ0) / 4, 2), rough: 0.35, metal: 0.05,
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
    escSteps: std(0xffffff, { map: toTexture(escalatorStepsCanvas(), 1, 38), metal: 0.6, rough: 0.4 }),
    escRail: std(0x0d0d0d, { rough: 0.4 }),
    escSkirt: std(0x2b3036, { metal: 0.6, rough: 0.35 }),
    comb: std(0xd8b23a, { metal: 0.6, rough: 0.4 }),
    boothFrame: std(0xb7bec5, { metal: 0.65, rough: 0.3 }),
    boothPanel: std(0x8b5a2b, { rough: 0.6 }),
    boothGlass: std(0xcfe8f5, { metal: 0.1, rough: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
    boothInside: std(0x59626b, { rough: 0.8 }),
    boothLight: glow(0xfff4e0),
    reader: glow(0x2ee07a),
    fareBoard: glow(0xffffff, { map: toTexture(fareBoardCanvas()) }),
    totemScreen: glow(0xffffff, { map: toTexture(totemScreenCanvas()) }),
    stanchion: std(0xc9cfd4, { metal: 0.8, rough: 0.25 }),
    belt: std(0x1d3f95, { rough: 0.6 }),
    endBoard: glow(0xffffff, { map: toTexture(signCanvas("FIN DE MANIOBRA", "#c41e2a", 512, 128, "800 50px Arial")) }),
    // Carteles compartidos
    exitUp: glow(0xffffff, { map: toTexture(signCanvas("↑  SALIDA")) }),
    exitStreet: glow(0xffffff, { map: toTexture(signCanvas("SALIDA A LA CALLE", "#1f7a3c", 1024, 128, "800 60px Arial")) }),
    dirA: glow(0xffffff, { map: toTexture(signCanvas(`DIRECCIÓN ${ROUTE_A.last.name}`, "#1d2228", 1024, 128, fitFont(`DIRECCIÓN ${ROUTE_A.last.name}`, 50, 26))) }),
    dirB: glow(0xffffff, { map: toTexture(signCanvas(`DIRECCIÓN ${ROUTE_B.last.name}`, "#1d2228", 1024, 128, fitFont(`DIRECCIÓN ${ROUTE_B.last.name}`, 50, 26))) }),
    toPlatforms: glow(0xffffff, { map: toTexture(signCanvas(`←  ${ROUTE_B.last.short}     ANDENES     ${ROUTE_A.last.short}  →`, LINE.color, 2048, 128, "800 52px Arial")) }),
    ticketOffice: glow(0xffffff, { map: toTexture(signCanvas("BOLETERÍA · CARGA TU TARJETA bip!", "#c41e2a", 1024, 128, "800 48px Arial")) }),
    stopBoard: glow(0xffffff, { map: toTexture(stopBoardCanvas()) }),
    lineMap: glow(0xffffff, { map: toTexture(lineMapCanvas()) }),
    // Escalera de salida a la calle (mismos acabados que el acceso de la calle, city/city.js)
    passageTile: std(0xe9e4da, { rough: 0.35, emissive: 0x3a3833 }),
    passageGranite: std(0x8d8a86, { rough: 0.55, emissive: 0x1c1b1a }),
    // Planos de dirección de cada andén (en la mezanina, antes de bajar)
    dirMapA: glow(0xffffff, { map: toTexture(directionMapCanvas(ROUTE_A.last.world || ROUTE_A.last, "DERECHA")) }),
    dirMapB: glow(0xffffff, { map: toTexture(directionMapCanvas(ROUTE_B.last.world || ROUTE_B.last, "IZQUIERDA")) }),
    youAreHere: glow(0xd42026),
    noEntry: glow(0xd42026),
    exitOnly: glow(0xffffff, { map: toTexture(signCanvas("SOLO SALIDA · ANDÉN DE LLEGADA", "#b3121f", 512, 128, "800 36px Arial")) }),
  };
}


/** Rebote de luz simulado: el material se ilumina un poco con su propia textura. */
function addBounce(mat, amount) {
  mat.emissive.setScalar(amount);
  mat.emissiveMap = mat.map;
  return mat;
}

/* ---------- Texturas de la mezanina ---------- */
function escalatorStepsCanvas() {
  const c = makeCanvas(64, 64), g = c.getContext("2d");
  g.fillStyle = "#4a4f54"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#2a2e32";
  for (let x = 2; x < 64; x += 5) g.fillRect(x, 0, 2, 64);          // ranuras
  g.fillStyle = "#e1b62d"; g.fillRect(0, 0, 4, 64); g.fillRect(60, 0, 4, 64);   // bordes amarillos
  g.fillStyle = "#1a1d20"; g.fillRect(0, 56, 64, 8);                 // contrahuella
  return c;
}

/** Tablero de tarifas por tramo horario (valores de config.js). */
function fareBoardCanvas() {
  const c = makeCanvas(512, 384), g = c.getContext("2d");
  g.fillStyle = "#f4f2ec"; g.fillRect(0, 0, 512, 384);
  g.fillStyle = "#c41e2a"; g.fillRect(0, 0, 512, 70);
  g.fillStyle = "#fff"; g.font = "800 34px Arial"; g.textBaseline = "middle"; g.textAlign = "left";
  g.fillText("TARIFAS · tarjeta bip!", 22, 36);
  const hh = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  FARES.bands.forEach((b, i) => {
    const y = 110 + i * 92;
    g.fillStyle = "#1b2430"; g.font = "800 28px Arial"; g.textAlign = "left";
    g.fillText(b.label.toUpperCase(), 22, y);
    g.font = "500 18px Arial"; g.fillStyle = "#4b5560";
    g.fillText(b.ranges.map(([a, z]) => `${hh(a)}–${hh(z)}`).join(" · "), 22, y + 30);
    g.font = "900 34px Arial"; g.fillStyle = "#1b2430"; g.textAlign = "right";
    g.fillText(formatCLP(b.price), 490, y + 10);
  });
  g.font = "600 17px Arial"; g.fillStyle = "#4b5560"; g.textAlign = "left";
  g.fillText(`Tarjeta nueva ${formatCLP(FARES.cardPrice)} · combinaciones sin costo`, 22, 362);
  return c;
}

function totemScreenCanvas() {
  const c = makeCanvas(256, 320), g = c.getContext("2d");
  g.fillStyle = "#0c2f6b"; g.fillRect(0, 0, 256, 320);
  g.fillStyle = "#ffffff"; g.font = "800 40px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("CARGA", 128, 60); g.fillText("TU", 128, 105);
  g.fillStyle = "#e1251b"; g.fillRect(58, 135, 140, 64);
  g.fillStyle = "#fff"; g.font = "900 44px Arial"; g.fillText("bip!", 128, 168);
  g.font = "600 18px Arial"; g.fillStyle = "#cfe0f1";
  g.fillText("Débito o crédito", 128, 238); g.fillText("Toca la pantalla", 128, 266);
  return c;
}

/* ==========================================================================
   Clase World
   ========================================================================== */

export class World {
  constructor(scene) {
    this.scene = scene;
    this.M = createWorldMaterials();
    // Rebote de luz en muros, andenes, mezanina y techos
    this.M.stationWalls.forEach(m => addBounce(m, 0.2));
    addBounce(this.M.platform, 0.16);
    addBounce(this.M.deck, 0.2);
    this.M.ceiling.emissive.setHex(0x101317);
    this.M.soffit.emissive.setHex(0x30343a);
    this.escalatorTexture = this.M.escSteps.map;
    this.stations = [];
    this.gates = [];
    this.elevators = new ElevatorSystem();

    buildTrack(scene, this.M);
    this.buildTunnels();
    STATIONS.forEach(st => this.stations.push(buildStation(scene, this.M, st, this.gates, this.elevators)));
    buildTrackEnds(scene, this.M);

    // Pool de luces de estación: 3 luces reales que siguen a la cámara
    this.lightSpots = [];
    STATIONS.forEach(st => {
      this.lightSpots.push(
        new THREE.Vector3(0, 6.0, st.z - 58), new THREE.Vector3(0, 6.0, st.z - 30), new THREE.Vector3(0, 6.0, st.z + 2),
        new THREE.Vector3(0, 6.3, st.z + 27),                      // escaleras y zona bajo la mezanina
        new THREE.Vector3(0, 9.9, st.z + 43),                      // mezanina
        new THREE.Vector3(0, 9.6, st.z + 57),                      // pasillo y escalera de salida
      );
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
    STATIONS.forEach(s => bounds.push(s.z + S.hallZ1, s.z + S.hallZ0));
    bounds.push(WORLD.end);
    for (let i = 0; i < bounds.length; i += 2) buildTunnelSegment(this.scene, this.M, bounds[i], bounds[i + 1]);
  }

  /** Visibilidad por distancia, pool de luces y escaleras mecánicas en marcha. */
  update(camera, dt = 0) {
    this.elevators.update(dt);
    // Los peldaños avanzan (la textura se desplaza a lo largo de la rampa)
    this.escalatorTexture.offset.y -= dt * MZ.escSpeed * 38 / 15.2;
    // Marca "usted está aquí" de los planos de andén: parpadea
    this.blinkT = (this.blinkT || 0) + dt;
    this.M.youAreHere.color.setHex(Math.floor(this.blinkT / 0.5) % 2 === 0 ? 0xff1a1a : 0x3a0808);
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
      if (gate.flashT > 0) {
        gate.flashT -= dt;
        gate.validator.setHex(gate.flashT > 0 ? gate.flashColor : 0x37d67a);
      }
      const target = near && !gate.locked ? 1 : 0;
      if (target === 1 && gate.open < 0.05) opened.push(gate);
      gate.open += Math.sign(target - gate.open) * Math.min(Math.abs(target - gate.open), dt * 5);
      const a = gate.open * Math.PI / 2;
      gate.flaps[0].rotation.y = a;
      gate.flaps[1].rotation.y = -a;
    }
    return opened;
  }

  /** Destello del validador de un torniquete (verde = validado, rojo = rechazado). */
  flashValidator(gate, ok) {
    gate.flashColor = ok ? 0x6dff9a : 0xff2a2a;
    gate.flashT = 0.8;
  }

  /** Torniquete más cercano a una posición de mundo. */
  nearestGate(pos) {
    let best = null, bd = Infinity;
    for (const g of this.gates) { const d = Math.hypot(g.x - pos.x, g.z - pos.z); if (d < bd) { bd = d; best = g; } }
    return best;
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

  // Losa, carriles y catenaria en tramos de 250 m: la cámara descarta los lejanos
  // y cada tramo se subdivide para seguir las pendientes (render/trackLift.js)
  const CH = 250;
  const chunks = [];
  for (let c0 = z0; c0 > z1; c0 -= CH) chunks.push([c0, Math.max(z1, c0 - CH)]);
  [ROUTE_A.trackX, ROUTE_B.trackX].forEach(tx => {
    for (const [a, b] of chunks) {
      const l = a - b, cm = (a + b) / 2;
      addBox(scene, 2.6, 0.08, l, M.slab, tx, -0.01, cm);
      [-gaugeHalf, gaugeHalf].forEach(x => {
        addBox(scene, 0.07, 0.11, l, M.rail, tx + x, 0.2, cm);
        addBox(scene, 0.075, 0.02, l, M.railHead, tx + x, CONFIG.track.railTop - 0.01, cm);
      });
      // Catenaria rígida sobre cada vía
      addBox(scene, 0.11, 0.09, l, M.catenary, tx, cy + 0.07, cm);
      addBox(scene, 0.02, 0.02, l, M.contactWire, tx, cy, cm);
    }
    instancedChunks(scene, sleeperGeo, M.sleeper, z0, z1, 0.75, (z) => m.makeTranslation(tx, 0.09, z));
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
  const geo = new THREE.CylinderGeometry(T.radius, T.radius, len, 32, Math.ceil(len / 10), true, cut, Math.PI * 2 - cut * 2);
  geo.rotateX(Math.PI / 2);
  const archMat = std(0xffffff, { map: toTexture(M.tunnelCanvas, 12, len / 1.5), rough: 0.95, side: THREE.BackSide });
  addBounce(archMat, 0.05);                                       // el túnel no queda negro absoluto
  const arch = new THREE.Mesh(geo, archMat);
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

  // Canaleta central de drenaje (entre las dos vías)
  addBox(scene, 0.35, 0.02, len, M.drain, 0, T.floorY + 0.005, mid);

  // Señalética de evacuación cada 100 m en ambos hastiales (instanciada: 2 llamadas de dibujo)
  const signGeo = new THREE.PlaneGeometry(1.6, 0.3);
  const nSigns = Math.floor((len - 40) / 100);
  if (nSigns > 0) {
    [-1, 1].forEach(s => {
      const signs = new THREE.InstancedMesh(signGeo, M.evacSign, nSigns);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? -Math.PI / 2 : Math.PI / 2);
      const one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < nSigns; i++) {
        m.compose(new THREE.Vector3(s * 5.3, 2.35, zA - 70 - i * 100), q, one);
        signs.setMatrixAt(i, m);
      }
      signs.computeBoundingSphere();
      scene.add(signs);
    });
  }

  // Balizas del CBTC entre los carriles de cada vía, cada 250 m
  const nBal = Math.floor(len / 250);
  if (nBal > 0) {
    const bal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 0.35), M.balise, nBal * 2);
    let k = 0;
    for (let i = 0; i < nBal; i++) for (const tx of [ROUTE_A.trackX, ROUTE_B.trackX]) {
      m.makeTranslation(tx, 0.19, zA - 125 - i * 250);
      bal.setMatrixAt(k++, m);
    }
    bal.computeBoundingSphere();
    scene.add(bal);
  }

  // Salida de emergencia (pique de evacuación) a media distancia en los tramos largos
  if (len > 900) {
    const ez = mid, ex = 5.15, y0 = 0.95;
    addBoxSpan(scene, ex + 0.12, 0.12, y0, y0 + 2.25, ez + 0.75, ez - 0.75, M.exitDoor);              // puerta cortafuego
    addBoxSpan(scene, ex + 0.06, 0.06, y0 + 2.25, y0 + 2.33, ez + 0.85, ez - 0.85, M.exitFrame);     // marco iluminado
    [-1, 1].forEach(e => addBoxSpan(scene, ex + 0.06, 0.06, y0, y0 + 2.33, ez + e * 0.8 + 0.04, ez + e * 0.8 - 0.04, M.exitFrame));
    addPlane(scene, 2.2, 0.41, M.exitSign, ex - 0.02, y0 + 2.75, ez, -Math.PI / 2);
  }

  // Hitos kilométricos cada 200 m (pk desde la primera estación de la línea)
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

function buildStation(scene, M, st, gates, elevators) {
  const z = st.z, h1 = z + S.hallZ1, h0 = z + S.hallZ0, p1 = z + S.platformZ1, p0 = z + S.platformZ0;
  const group = new THREE.Group();
  group.name = `station-${st.id}`;
  scene.add(group);

  const nameMat = glow(0xffffff, { map: toTexture(stationNameCanvas(st)) });
  const wallMat = M.stationWalls[st.index % M.stationWalls.length];
  const pids = [];

  // Solera y techo del vestíbulo
  addBoxSpan(group, 0, S.wallX * 2, -0.15, -0.05, h1, h0, M.hallFloor);
  // (con un corte sobre la escalera de salida, que sube por encima del techo hacia la calle)
  const cutX = MZ.exitHalf + 0.15, cutZ = z + CONFIG.exit.corridorZ1;
  addBoxSpan(group, 0, S.wallX * 2 + 0.6, S.ceilingY, S.ceilingY + 0.2, cutZ, h0, M.ceiling);
  [[-S.wallX - 0.3, -cutX], [cutX, S.wallX + 0.3]].forEach(([x0, x1]) =>
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, S.ceilingY, S.ceilingY + 0.2, h1, cutZ, M.ceiling));

  // Columnas centrales entre las dos vías; bajo la mezanina terminan en su losa
  for (let off = -70; off <= 50; off += 10) {
    const top = off >= MZ.z0 && off <= MZ.z1 ? MZ.y - 0.34 : S.ceilingY;
    addBox(group, 0.5, top + 0.05, 0.5, M.column, 0, top / 2 - 0.025, z + off);
  }

  [-1, 1].forEach(side => {
    const edgeX = S.platformEdgeX, wallX = S.wallX;
    const pw = wallX - edgeX, pcx = side * (edgeX + pw / 2);
    const faceRot = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    const route = side > 0 ? ROUTE_A : ROUTE_B;

    // Andén
    addBoxSpan(group, pcx, pw, -0.05, S.platformTop, p1, p0, M.platform);
    addBoxSpan(group, side * (edgeX + 0.02), 0.04, -0.05, S.platformTop - 0.06, p1, p0, M.platformFace);
    addBoxSpan(group, side * (edgeX + 0.25), 0.5, S.platformTop, S.platformTop + 0.012, p1, p0, M.platformEdge);
    addBoxSpan(group, side * (edgeX + 0.62), 0.06, S.platformTop, S.platformTop + 0.012, p1, p0, M.platformLine);
    [p1, p0].forEach(endZ => {
      addBox(group, pw - 0.6, 0.05, 0.05, M.steel, side * (edgeX + 0.3 + (pw - 0.6) / 2), S.platformTop + 1.0, endZ);
    });

    // Muro alicatado
    addBoxSpan(group, side * (wallX + 0.15), 0.3, -0.05, S.ceilingY, h1, h0, wallMat);

    // Columnas y bancos del andén (posiciones compartidas: stationLayout.js)
    for (const off of PLATFORM_COLUMNS) {
      addBox(group, 0.42, S.platformCeilingY - S.platformTop + 0.4, 0.42, M.column, side * COLUMN_X, (S.platformCeilingY + S.platformTop + 0.4) / 2, z + off);
    }
    for (const off of PLATFORM_BENCHES) {
      const bz = z + off;
      addBox(group, 0.45, 0.06, 1.8, M.bench, side * BENCH_X, S.platformTop + 0.45, bz);
      addBox(group, 0.06, 0.4, 1.8, M.bench, side * (BENCH_X + 0.27), S.platformTop + 0.7, bz);
      [-0.75, 0.75].forEach(dz => addBox(group, 0.4, 0.45, 0.06, M.benchFrame, side * BENCH_X, S.platformTop + 0.22, bz + dz));
    }

    // Carteles de nombre y plano de línea en el muro
    for (const off of [-68, -56, -44, -32, 0, 12]) addPlane(group, 3.6, 0.9, nameMat, side * (wallX - 0.01), 2.85, z + off, faceRot);
    const mapW = 4.4, mapH = 0.825, mapZ = z - 16;
    addPlane(group, mapW, mapH, M.lineMap, side * (wallX - 0.01), 2.85, mapZ, faceRot);
    addPlane(group, 0.14, 0.14, M.youAreHere, side * (wallX - 0.02), 2.85 + mapH * (0.5 - 190 / 384), mapZ + side * (lineMapU(st) - 0.5) * mapW, faceRot);

    // Bandejas de luz sobre el andén (hasta la mezanina)
    for (let off = S.hallZ0 + 3; off <= 31; off += 6) {
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
    hang(M.exitUp, side * 6.6, 4.9, z + MZ.stairZ0 - 2.5, 2.4);

    // Pantallas de próximo tren: una sola imagen por andén repetida en 3 puntos
    // (cerca del pie de la escalera y repartidas por el andén), a la altura de la
    // vista y lejos de los carteles colgantes de dirección para que nada las tape.
    const pidCanvas = makeCanvas(512, 160);
    const pid = { side, route, canvas: pidCanvas, ctx: pidCanvas.getContext("2d"), texture: toTexture(pidCanvas), lastKey: "" };
    pids.push(pid);
    const pidMat = glow(0xffffff, { map: pid.texture });
    const sw = 2.1, sh = sw * 160 / 512, py = 3.75, px = side * 5.0;
    for (const off of PID_OFFSETS) {
      const pz = z + off;
      addBox(group, 0.04, S.platformCeilingY - py - sh / 2, 0.04, M.steel, px - sw / 2 + 0.15, (S.platformCeilingY + py + sh / 2) / 2, pz);
      addBox(group, 0.04, S.platformCeilingY - py - sh / 2, 0.04, M.steel, px + sw / 2 - 0.15, (S.platformCeilingY + py + sh / 2) / 2, pz);
      addBox(group, sw + 0.16, sh + 0.12, 0.12, M.screenHousing, px, py, pz);
      addPlane(group, sw, sh, pidMat, px, py, pz + 0.062, 0);
      addPlane(group, sw, sh, pidMat, px, py, pz - 0.062, Math.PI);
    }

    // Cartel de PARE (cabeza de tren) para el sentido de este andén
    const stopZ = route.toWorldZ(route.stationOf(st).stopZ);
    const postX = side * (edgeX + 0.9);
    addBox(group, 0.06, 1.6, 0.06, M.steel, postX, S.platformTop + 0.8, stopZ);
    addPlane(group, 0.6, 0.6, M.stopBoard, postX, S.platformTop + 1.85, stopZ, side > 0 ? 0 : Math.PI);
    addBoxSpan(group, side * (edgeX + 0.25), 0.5, S.platformTop + 0.013, S.platformTop + 0.016, stopZ + 0.1, stopZ - 0.1, M.platformLine);

    // Escalera al andén desde la mezanina
    buildStairs(group, M, side, z);

    // Ascensor de accesibilidad (andén ↔ mezanina, zona pagada): elevators.js
    elevators.add(new Elevator(group, st, side));

    // Plano de dirección del andén en la mezanina (antes de bajar): sobre la
    // escalera y junto a la puerta del ascensor, mirando a quien viene de los torniquetes
    if (!isArrivalOnly(st, side)) {
      const dirMap = side > 0 ? M.dirMapA : M.dirMapB, mh = 448 / 2048;
      const board = (w, x, y, zz) => {
        addPlane(group, w, w * mh, dirMap, x, y, zz, 0);
        addBox(group, w + 0.08, w * mh + 0.08, 0.04, M.screenHousing, x, y, zz - 0.03);
        addPlane(group, 0.07 * w / 3, 0.07 * w / 3, M.youAreHere, x + (lineMapU(st) - 0.5) * w, y + w * mh * (0.5 - 250 / 448), zz + 0.005, 0);
      };
      const sx = side * (MZ.stairX0 + MZ.escX0) / 2, sz = z + MZ.stairZ1 + 0.9, sy = MZ.y + 2.35;
      board(3.4, sx, sy, sz);
      [-1.4, 1.4].forEach(dx => addBox(group, 0.04, S.ceilingY - sy, 0.04, M.steel, sx + dx, (S.ceilingY + sy) / 2, sz - 0.03));
      const EV = CONFIG.elevator;
      board(1.5, side * (EV.x0 + EV.x1) / 2, MZ.y + 1.55, z + EV.z1 + 0.08);
    }

    // Terminal: el andén de llegada es solo de salida (barrera en lo alto de la escalera fija)
    if (isArrivalOnly(st, side)) {
      const bz = z + MZ.stairZ1 + 0.35, x0 = MZ.stairX0, x1 = MZ.stairX1;
      addBoxSpan(group, side * (x0 + x1) / 2, x1 - x0, MZ.y, MZ.y + 1.0, bz - 0.04, bz + 0.04, M.balustrade);
      addBoxSpan(group, side * (x0 + x1) / 2, x1 - x0, MZ.y + 0.95, MZ.y + 1.05, bz - 0.06, bz + 0.06, M.noEntry);
      addPlane(group, 2.2, 0.55, M.exitOnly, side * 6.7, MZ.y + 2.4, bz + 0.05, 0);
      addPlane(group, 2.2, 0.55, M.exitOnly, side * 6.7, MZ.y + 2.4, bz - 0.05, Math.PI);
    }
  });

  buildMezzanine(group, M, st, nameMat, gates);
  if (st.combos.length) buildTransfer(group, M, st);

  buildExitPassage(group, M, z);

  // Muros de boca de túnel (el del lado de la salida, con el paso de la escalera)
  group.add(makePortalWall(M.portal, h1, true));
  group.add(makePortalWall(M.portal, h0));

  return { st, group, pids };
}

/**
 * Salida a la calle (sin teletransporte): pasillo desde la puerta de la
 * mezanina y primer tramo de escalera hasta el descanso. Desde el descanso
 * sigue la escalera del acceso de la calle (city/city.js), construida justo
 * encima: el muro de cerámica, los peldaños de granito y las narices
 * amarillas son los mismos, así que se ve un solo recorrido continuo.
 */
function buildExitPassage(group, M, z) {
  const EX = CONFIG.exit, y0 = MZ.y, ex = MZ.exitHalf, hw = EX.halfW;
  const za = z + MZ.z1 + 0.3, zc = z + EX.corridorZ1, zf = z + EX.flightZ1;
  const y1 = y0 + EX.rise, H = 2.9;
  const tile = M.passageTile, granite = M.passageGranite;

  /* Pasillo a nivel de mezanina */
  addBoxSpan(group, 0, ex * 2, y0 - 0.3, y0, za - 0.3, zc, M.deck);
  [-1, 1].forEach(s => addBoxSpan(group, s * (ex + 0.08), 0.16, y0, y0 + 2.75, za, zc, tile));
  addBoxSpan(group, 0, ex * 2 + 0.3, y0 + 2.7, y0 + 2.85, za, zc, M.soffit);
  addBoxSpan(group, 0, 0.3, y0 + 2.67, y0 + 2.7, za + 0.4, zc - 0.4, M.fixture);
  // Remate donde el pasillo se angosta al ancho de la escalera y frente sobre ella
  [-1, 1].forEach(s => addBoxSpan(group, s * (hw + ex + 0.16) / 2, ex + 0.16 - hw, y0, y1 + H, zc - 0.15, zc, tile));
  addBoxSpan(group, 0, hw * 2, y0 + 2.75, y0 + H + 0.15, zc - 0.15, zc, tile);

  /* Primer tramo: 14 peldaños de granito con nariz amarilla */
  const steps = 14, run = (zf - zc) / steps, rise = EX.rise / steps;
  const treads = new THREE.InstancedMesh(new THREE.BoxGeometry(hw * 2, rise, run), granite, steps);
  const noses = new THREE.InstancedMesh(new THREE.BoxGeometry(hw * 2 - 0.1, 0.02, 0.05), M.stairNose, steps);
  const m = new THREE.Matrix4();
  for (let i = 0; i < steps; i++) {
    const top = y0 + rise * (i + 1);
    m.makeTranslation(0, top - rise / 2, zc + run * (i + 0.5)); treads.setMatrixAt(i, m);
    m.makeTranslation(0, top + 0.01, zc + run * i + 0.03); noses.setMatrixAt(i, m);
  }
  treads.computeBoundingSphere(); noses.computeBoundingSphere();
  group.add(treads, noses);

  // Muros, techo inclinado y bajo-escalera (piezas paralelas a la escalera)
  const len = Math.hypot(zf - zc, EX.rise), ang = Math.atan2(EX.rise, zf - zc);
  const sloped = (w, h, mat, x, yMid) => { const b = addBox(group, w, h, len, mat, x, yMid, (zc + zf) / 2); b.rotation.x = -ang; return b; };
  [-1, 1].forEach(s => addBoxSpan(group, s * (hw + 0.07), 0.14, y0, y1 + H + 0.2, zc, zf, tile));
  sloped(hw * 2 + 0.3, 0.15, M.soffit, 0, (y0 + y1) / 2 + H + 0.07);
  sloped(hw * 2, 0.3, granite, 0, (y0 + y1) / 2 - 0.3);
  sloped(0.3, 0.03, M.fixture, 0, (y0 + y1) / 2 + H - 0.01);
  [-1, 1].forEach(s => sloped(0.05, 0.05, M.steel, s * (hw - 0.12), (y0 + y1) / 2 + 0.9));   // pasamanos
  // Cartel de salida al pie de la escalera
  addPlane(group, 2.2, 0.3, M.exitStreet, 0, y0 + 2.45, zc - 0.17, Math.PI);
}

/**
 * Pasillo de combinación en la mezanina (zona pagada, muro +X): marco de
 * acero, boca del pasillo peatonal con la franja del color de la otra línea
 * y cartel "COMBINACIÓN LÍNEA N". Al recorrerlo el pasajero pasa a la otra
 * línea (main.js → transferLine); aquí solo se dibuja.
 */
function buildTransfer(group, M, st) {
  const T = MZ.transfer, lineId = st.combos[0];
  const y = MZ.y, x = S.wallX - 0.02, z0 = st.z + T.z0, z1 = st.z + T.z1, zc = (z0 + z1) / 2, w = z1 - z0;
  const rot = -Math.PI / 2;                                              // mira hacia el centro de la estación
  addPlane(group, w, T.h, glow(0xffffff, { map: toTexture(transferCorridorCanvas(lineId)) }), x, y + T.h / 2, zc, rot);
  // Marco
  [z0 - 0.08, z1 + 0.08].forEach(pz => addBox(group, 0.2, T.h + 0.1, 0.16, M.steel, x - 0.08, y + (T.h + 0.1) / 2, pz));
  addBox(group, 0.2, 0.16, w + 0.32, M.steel, x - 0.08, y + T.h + 0.08, zc);
  // Umbral con franja táctil amarilla
  addBoxSpan(group, x - 0.45, 0.9, y, y + 0.015, z0, z1, M.platformEdge);
  // Cartel sobre la boca, y otro colgado visible desde los torniquetes
  const sign = glow(0xffffff, { map: toTexture(transferSignCanvas(lineId)) });
  addPlane(group, w + 0.3, (w + 0.3) * 192 / 1024, sign, x - 0.03, y + T.h + 0.45, zc, rot);
  const hx = 5.0, hy = y + 2.75, hz = st.z + 42.9, hw = 2.6;
  addPlane(group, hw, hw * 192 / 1024, sign, hx, hy, hz, 0);
  [-1, 1].forEach(s => addBox(group, 0.03, S.ceilingY - hy, 0.03, M.steel, hx + s * (hw / 2 - 0.1), (S.ceilingY + hy) / 2, hz - 0.02));
}

/** Escalera fija y escalera mecánica de subida entre el andén (y = 1,2) y la mezanina (y = 7,2). */
function buildStairs(group, M, side, z) {
  const z0 = z + MZ.stairZ0, z1 = z + MZ.stairZ1;
  const y0 = S.platformTop, y1 = MZ.y;
  const len = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
  const sloped = (w, h, mat, x, yOff) => {
    const b = addBox(group, w, h, len, mat, x, (y0 + y1) / 2 + yOff, (z0 + z1) / 2);
    b.rotation.x = -ang;
    return b;
  };

  /* --- Escalera fija (pegada al muro) --- */
  const x0 = MZ.stairX0, x1 = MZ.stairX1, w = x1 - x0, xc = side * (x0 + w / 2);
  const steps = 34, run = (z1 - z0) / steps, rise = (y1 - y0) / steps;
  const treads = new THREE.InstancedMesh(new THREE.BoxGeometry(w, rise, run), M.stair, steps);
  const noses = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 0.012, 0.05), M.stairNose, steps);
  const m = new THREE.Matrix4();
  for (let i = 0; i < steps; i++) {
    const yTop = y0 + rise * (i + 1);
    m.makeTranslation(xc, yTop - rise / 2, z0 + run * (i + 0.5)); treads.setMatrixAt(i, m);
    m.makeTranslation(xc, yTop + 0.006, z0 + run * i + 0.03); noses.setMatrixAt(i, m);
  }
  treads.computeBoundingSphere(); noses.computeBoundingSphere();
  group.add(treads, noses);
  sloped(0.05, 0.05, M.steel, side * (x1 - 0.05), 1.0);                       // pasamanos junto al muro

  /* --- Escalera mecánica de subida --- */
  const e0 = MZ.escX0, e1 = MZ.escX1, ew = e1 - e0, exc = side * (e0 + ew / 2);
  sloped(ew - 0.3, 0.04, M.escSteps, exc, 0.02);                               // banda de peldaños (se mueve)
  [e0 + 0.08, e1 - 0.08].forEach(xe => {
    sloped(0.12, 0.25, M.escSkirt, side * xe, 0.12);                           // zócalo
    sloped(0.03, 0.85, M.balustrade, side * xe, 0.6);                          // balaustrada de vidrio
    sloped(0.09, 0.06, M.escRail, side * xe, 1.05);                            // pasamanos de goma
  });
  // Peines (placas de embarque) abajo y arriba
  addBoxSpan(group, exc, ew, y0, y0 + 0.02, z0 - 1.2, z0, M.comb);
  addBoxSpan(group, exc, ew, y1, y1 + 0.02, z1, z1 + 1.0, M.comb);
  addPlane(group, 0.9, 0.22, glow(0xffffff, { map: toTexture(signCanvas("↑ SUBIDA", "#1f7a3c", 256, 64, "800 34px Arial")) }), exc, y0 + 2.3, z0 - 1.4, Math.PI);

  // Cierre lateral bajo la escalera mecánica (lado del andén)
  const shape = new THREE.Shape();
  shape.moveTo(0, y0); shape.lineTo(z1 - z0, y0); shape.lineTo(z1 - z0, y1); shape.closePath();
  const sidePanel = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.escSkirt);
  sidePanel.rotation.y = -Math.PI / 2;
  sidePanel.position.set(side * (e0 - 0.02), 0, z0);
  group.add(sidePanel);
}

/** Mezanina: losa elevada con barandal, torniquetes, boletería y salida a la calle. */
function buildMezzanine(group, M, st, nameMat, gates) {
  const z = st.z, y = MZ.y, wx = S.wallX;
  const za = z + MZ.z0, zb = z + MZ.z1, zg = z + MZ.gateZ;

  // Losa y falso techo inferior con luminarias (sobre andenes y vías)
  // (con el hueco de los pozos de ascensor junto a cada muro)
  const EV = CONFIG.elevator, ez0 = z + EV.z0, ez1 = z + EV.z1;
  const slab = (x0, x1, z0, z1) => {
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y - 0.3, y, z0, z1, M.deck);
    addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y - 0.34, y - 0.3, z0, z1, M.soffit);
  };
  slab(-EV.x0, EV.x0, za, zb);
  [[-wx, -EV.x0], [EV.x0, wx]].forEach(([x0, x1]) => { slab(x0, x1, za, ez0); slab(x0, x1, ez1, zb); });
  for (let x = -6; x <= 6; x += 3) addBoxSpan(group, x, 0.3, y - 0.36, y - 0.34, za + 1, zb - 1, M.fixture);

  // Barandal de vidrio en el borde que da a los andenes (salvo las llegadas de escalera)
  const segs = [[-MZ.escX0, MZ.escX0]];
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
    // Validador bip! propio de cada paso (destella verde o rojo)
    const vMat = glow(0x37d67a);
    addBoxSpan(group, g + gh + 0.12, 0.16, y + 1.04, y + 1.1, zg + 0.3, zg + 0.5, vMat);
    gates.push({ x: g, z: zg, flaps, open: 0, station: st, validator: vMat.color, flashT: 0 });
  });

  // Cartel de orientación sobre los torniquetes (mirando a quien entra de la calle)
  addPlane(group, 7.2, 0.45, M.toPlatforms, 0, y + 2.6, zg + 0.8, 0);
  addPlane(group, 3.2, 0.8, nameMat, 0, y + 2.6, zg - 0.8, Math.PI);

  buildTicketOffice(group, M, z);
  buildTotems(group, M, z);

  // Muro final con la salida a la calle
  const ex = MZ.exitHalf, top = S.ceilingY;
  [[-wx, -ex], [ex, wx]].forEach(([x0, x1]) => addBoxSpan(group, (x0 + x1) / 2, x1 - x0, y, top, zb, zb + 0.3, M.portal));
  addBoxSpan(group, 0, ex * 2, y + 2.7, top, zb, zb + 0.3, M.portal);
  addPlane(group, ex * 2 + 0.4, 0.3, M.exitStreet, 0, y + 2.95, zb - 0.01, Math.PI);
}

/** Boletería: cabina con ventanilla, mostrador, lector, tablero de tarifas y fila con postes. */
function buildTicketOffice(group, M, z) {
  const B = MZ.booth, y = MZ.y;
  const bx0 = B.x0, bx1 = B.x1, bz0 = z + B.z0, bz1 = z + B.z1, wz = z + B.windowZ;
  const top = y + 2.5;
  const win0 = wz - 0.7, win1 = wz + 0.7;
  // Fachada frontal (+X) con ventanilla de atención
  addBoxSpan(group, bx1, 0.08, y, y + 1.0, bz0, bz1, M.boothFrame);
  addBoxSpan(group, bx1, 0.08, y + 1.0, y + 2.0, bz0, win0, M.boothPanel);
  addBoxSpan(group, bx1, 0.08, y + 1.0, y + 2.0, win1, bz1, M.boothPanel);
  addBoxSpan(group, bx1, 0.03, y + 1.0, y + 2.0, win0, win1, M.boothGlass);
  addBoxSpan(group, bx1, 0.1, y + 2.0, top, bz0, bz1, M.boothFrame);
  // Laterales, techo e interior
  addBoxSpan(group, (bx0 + bx1) / 2, bx1 - bx0, y, top, bz0 - 0.05, bz0, M.boothPanel);
  addBoxSpan(group, (bx0 + bx1) / 2, bx1 - bx0, y, top, bz1, bz1 + 0.05, M.boothPanel);
  addBoxSpan(group, (bx0 + bx1) / 2, bx1 - bx0 + 0.1, top, top + 0.08, bz0 - 0.05, bz1 + 0.05, M.boothFrame);
  addBoxSpan(group, (bx0 + bx1) / 2, 1.0, top - 0.05, top - 0.03, wz - 0.6, wz + 0.6, M.boothLight);
  addBoxSpan(group, bx1 - 0.45, 0.6, y, y + 0.78, win0, win1, M.boothInside);      // mesa del cajero
  addBoxSpan(group, bx1 - 0.6, 0.05, y + 0.78, y + 1.15, wz - 0.25, wz + 0.25, M.kioskScreen);   // monitor
  // Repisa exterior con lector de tarjetas
  addBoxSpan(group, bx1 + 0.15, 0.3, y + 0.98, y + 1.03, win0, win1, M.boothFrame);
  addBoxSpan(group, bx1 + 0.2, 0.14, y + 1.03, y + 1.06, wz + 0.25, wz + 0.45, M.reader);
  // Rótulo y tablero de tarifas
  addPlane(group, 2.4, 0.3, M.ticketOffice, bx1 + 0.06, y + 2.25, (bz0 + bz1) / 2, Math.PI / 2);
  addPlane(group, 1.6, 1.2, M.fareBoard, bx1 + 0.05, y + 1.5, (win1 + bz1) / 2 + 0.3, Math.PI / 2);
  // Fila: postes con cinta
  const posts = [[-4.0, 46.9], [-4.0, 48.3], [-4.0, 49.7], [-4.0, 50.6]];
  posts.forEach(([px, pz], i) => {
    addBox(group, 0.06, 1.0, 0.06, M.stanchion, px, y + 0.5, z + pz);
    addBox(group, 0.3, 0.04, 0.3, M.stanchion, px, y + 0.02, z + pz);
    if (i > 0) addBoxSpan(group, px, 0.02, y + 0.9, y + 0.96, z + posts[i - 1][1], z + pz, M.belt);
  });
}

/** Tótems de autocarga de la tarjeta bip!. */
function buildTotems(group, M, z) {
  const y = MZ.y, tz = z + MZ.totemZ;
  MZ.totems.forEach(x => {
    addBoxSpan(group, x, 0.75, y, y + 1.85, tz - 0.25, tz + 0.25, M.kiosk);
    const screen = addPlane(group, 0.52, 0.65, M.totemScreen, x, y + 1.35, tz - 0.255, Math.PI);
    screen.rotation.x = -0.12;
    addBoxSpan(group, x, 0.22, y + 0.9, y + 0.95, tz - 0.34, tz - 0.25, M.reader);   // lector NFC
    addBoxSpan(group, x, 0.75, y + 1.85, y + 2.05, tz - 0.25, tz + 0.25, M.boothPanel);
  });
}

/** Cambio de vía (escape) entre dos vías en una cola de maniobras. */
function buildCrossover(scene, M, zFrom, zTo, xFrom, xTo) {
  const dz = zTo - zFrom, dx = xTo - xFrom, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
  const g = new THREE.Group();
  g.position.set((xFrom + xTo) / 2, 0, (zFrom + zTo) / 2);
  g.rotation.y = ang;
  scene.add(g);
  [-0.7175, 0.7175].forEach(x => {
    addBox(g, 0.07, 0.11, len, M.rail, x, 0.2, 0);
    addBox(g, 0.075, 0.02, len, M.railHead, x, CONFIG.track.railTop - 0.01, 0);
  });
  for (let t = -len / 2; t < len / 2; t += 0.75) addBox(g, 2.6, 0.12, 0.24, M.sleeper, 0, 0.09, t);
  [-1, 1].forEach(e => addBox(g, 0.5, 0.35, 0.8, M.bufferRed, 1.6, 0.2, e * (len / 2 - 2)));   // motores de aguja
}

/** Muro plano con hueco en forma de bóveda del túnel. */
function makePortalWall(mat, z, exitNotch = false) {
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
  if (exitNotch) {
    // Paso de la escalera de salida (que cruza este muro por encima del túnel)
    const nx = CONFIG.exit.halfW + 0.2;
    shape.lineTo(nx, S.ceilingY + 0.2);
    shape.lineTo(nx, MZ.y + 1.2);
    shape.lineTo(-nx, MZ.y + 1.2);
    shape.lineTo(-nx, S.ceilingY + 0.2);
  }
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

  // Cambios de vía tras cada terminal (de la cola de una vía al andén de la otra)
  const T0 = CONFIG.turnback;
  const pq = STATIONS[0].z, fcv = STATIONS.at(-1).z;
  buildCrossover(scene, M, fcv - T0.crossoverTo, fcv - T0.crossoverFrom, ROUTE_A.trackX, ROUTE_B.trackX);
  buildCrossover(scene, M, pq + T0.crossoverTo, pq + T0.crossoverFrom, ROUTE_B.trackX, ROUTE_A.trackX);

  [ROUTE_A, ROUTE_B].forEach(route => {
    // Cartel de FIN DE MANIOBRA donde debe detenerse el testero
    const endZ = route.toWorldZ(route.track.retireZ);
    const sx = route.trackX + route.dir * 1.6;
    addBox(scene, 0.08, 2.2, 0.08, M.steel, sx, 1.1, endZ);
    addPlane(scene, 1.2, 0.3, M.endBoard, sx, 2.4, endZ, route.dir === 1 ? 0 : Math.PI);

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
  g.fillText(`L${LINE.id} · DIR. ${route.last.short}`, 12, 18);
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
