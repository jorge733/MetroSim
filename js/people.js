/* ==========================================================================
   MetroSim — Alpha 0.6 · people.js
   Viajeros (NPC) compartidos por todos los modos, trenes y ambos sentidos.

   Recorrido de un viajero en una estación:
     calle → (a veces fila en la boletería) → torniquete → escalera fija →
     andén de su sentido → espera → sube al tren → viaja → baja →
     escalera mecánica (quieto sobre los peldaños) → torniquete → calle
   Cada estación dibujada tiene además un cajero en la boletería.

   Dos niveles de detalle:
     · Cerca de la cámara: personas 3D articuladas (caminan, suben escaleras,
       se sientan, se agarran a la barra...).
     · Lejos: solo cifras (esperando en cada andén / a bordo de cada tren).

   Dibujo: todas las personas se pintan con 3 InstancedMesh (cuerpo, cabeza y
   pelo), así cientos de viajeros cuestan solo 3 llamadas de dibujo.
   Cada persona es un esqueleto de Object3D (sin mallas) que se anima y
   cuyas matrices se copian a las instancias cada fotograma.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, demandAt } from "./config.js";
import { ROUTE_A, ROUTE_B, routeForSide } from "./route.js";
import { TRAIN_LAYOUT } from "./train.js";
import { clamp } from "./utils.js";

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const S = CONFIG.station, MZ = CONFIG.mezzanine, F = CONFIG.train.floorY;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const PALETTE = {
  shirt: [0x2f4f7f, 0x8a2b2b, 0x3f6e46, 0xd9d4c7, 0x1d1f24, 0x6b4f8a, 0xc7862f, 0x5f6f7a, 0xa33f6b, 0x2d6c78, 0xe5e5e5, 0x7a6450],
  pants: [0x1f2a3a, 0x24262b, 0x3b3f46, 0x4a3b2c, 0x2c3e5c, 0x6d6a60],
  skin: [0xf1c7a5, 0xe0ac86, 0xc68d65, 0x9c6644, 0x6b4430, 0xf5d5bd],
  hair: [0x1b1410, 0x3a2617, 0x6b4a2b, 0xb08a52, 0x8f8f8f, 0x0d0d0d],
  bag: [0x222222, 0x5a3b22, 0x1f3d5c, 0x6e1f2a],
};


/* ==========================================================================
   Esqueleto de una persona y dibujo instanciado
   ========================================================================== */

/** Crea el esqueleto articulado (Object3D sin mallas). Origen = pies; frente = +Z. */
function createSkeleton() {
  const h = rand(0.9, 1.1);
  const legLen = 0.84 * h, thigh = legLen / 2, shin = legLen / 2;
  const torsoH = 0.58 * h, armLen = 0.62 * h;
  const width = rand(0.36, 0.44);
  const color = (list) => new THREE.Color(pick(list));
  const shirt = color(PALETTE.shirt), pants = color(PALETTE.pants);
  const parts = [];

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const part = (parent, kind, col, sx, sy, sz, x, y, z) => {
    const o = new THREE.Object3D();
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    parent.add(o);
    parts.push({ obj: o, kind, color: col });
    return o;
  };

  const legs = [-1, 1].map(s => {
    const hip = new THREE.Group();
    hip.position.set(s * width * 0.25, legLen, 0);
    body.add(hip);
    part(hip, "box", pants, 0.15, thigh, 0.17, 0, -thigh / 2, 0);
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    hip.add(knee);
    part(knee, "box", pants, 0.13, shin, 0.16, 0, -shin / 2, 0.01);
    return { hip, knee };
  });
  part(body, "box", shirt, width, torsoH, 0.23, 0, legLen + torsoH / 2, 0);
  const shoulderY = legLen + torsoH - 0.05;
  const arms = [-1, 1].map(s => {
    const arm = new THREE.Group();
    arm.position.set(s * (width / 2 + 0.055), shoulderY, 0);
    body.add(arm);
    part(arm, "box", shirt, 0.1, armLen, 0.11, 0, -armLen / 2, 0);
    return arm;
  });
  const headY = shoulderY + 0.19 * h;
  part(body, "head", color(PALETTE.skin), 0.105, 0.125, 0.115, 0, headY, 0);
  part(body, "hair", color(PALETTE.hair), 0.112, Math.random() < 0.3 ? 0.16 : 0.12, 0.12, 0, headY + 0.01, -0.012);
  if (Math.random() < 0.3) part(body, "box", color(PALETTE.bag), 0.3, 0.36, 0.13, 0, legLen + torsoH * 0.55, -0.18);

  return {
    root, body, legLen, parts,
    hipL: legs[0].hip, hipR: legs[1].hip, kneeL: legs[0].knee, kneeR: legs[1].knee,
    armL: arms[0], armR: arms[1],
  };
}

class PeopleRenderer {
  constructor(scene, capacity) {
    const mk = (geo, rough, n) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0 }), n);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.box = mk(new THREE.BoxGeometry(1, 1, 1), 0.85, capacity * 8);
    this.head = mk(new THREE.SphereGeometry(1, 12, 9), 0.7, capacity);
    this.hair = mk(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0.9, capacity);
  }

  render(people) {
    const meshes = { box: this.box, head: this.head, hair: this.hair };
    const n = { box: 0, head: 0, hair: 0 };
    for (const p of people) {
      if (p.hidden) continue;
      p.root.updateWorldMatrix(false, true);
      for (const part of p.mesh.parts) {
        const m = meshes[part.kind], i = n[part.kind];
        if (i >= m.instanceMatrix.count) continue;
        m.setMatrixAt(i, part.obj.matrixWorld);
        m.setColorAt(i, part.color);
        n[part.kind]++;
      }
    }
    for (const k of Object.keys(meshes)) {
      meshes[k].count = n[k];
      meshes[k].instanceMatrix.needsUpdate = true;
      meshes[k].instanceColor.needsUpdate = true;
    }
  }
}


/* ==========================================================================
   Geometría de recorridos en una estación
   ========================================================================== */

/** Bancos de un andén (mismas posiciones que world.js). */
function benchSpots(st, side) {
  const spots = [];
  const inStairs = (zz) => zz > st.z + MZ.stairZ0 - 3 && zz < st.z + MZ.stairZ1 + 2;
  for (let off = -46; off <= 46; off += 12) {
    if (inStairs(st.z + off)) continue;
    const bz = st.z + off + 6;
    if (off < 46 && !inStairs(bz)) {
      [-0.45, 0.45].forEach(dz => spots.push({ side, bench: true, occupant: null, pos: V(side * 7.92, S.platformTop, bz + dz), seatY: S.platformTop + 0.48 }));
    }
  }
  return spots;
}

const stairX = (MZ.stairX0 + MZ.stairX1) / 2, escX = (MZ.escX0 + MZ.escX1) / 2;
const stairTop = (st, side) => V(side * stairX, MZ.y, st.z + MZ.stairZ1 + 0.4);
const stairBottom = (st, side) => V(side * stairX, S.platformTop, st.z + MZ.stairZ0 - 0.4);
const streetDoor = (st) => V(rand(-1.2, 1.2), MZ.y, st.z + MZ.z1 - 0.3);

/** Punto marcado como tramo de escalera mecánica (el viajero va quieto). */
function onEscalator(v) { v.esc = true; return v; }

/** Recorrido desde la zona no pagada hasta el andén de un lado (torniquete + escalera fija). */
function pathFromGates(st, side, spot) {
  const g = pick(MZ.gates);
  return [
    V(g, MZ.y, st.z + MZ.gateZ + 0.9), V(g, MZ.y, st.z + MZ.gateZ - 0.9),
    stairTop(st, side), stairBottom(st, side), spot.clone(),
  ];
}

/** Recorrido desde el andén hasta la calle (escalera mecánica de subida). */
function pathToStreet(st, side, from) {
  const g = pick(MZ.gates);
  return [
    V(side * rand(4.0, 4.8), S.platformTop, from.z),
    V(side * escX, S.platformTop, st.z + MZ.stairZ0 - 1.0),
    onEscalator(V(side * escX, MZ.y, st.z + MZ.stairZ1 + 0.6)),
    V(g, MZ.y, st.z + MZ.gateZ - 0.9), V(g, MZ.y, st.z + MZ.gateZ + 0.9), streetDoor(st),
  ];
}

/** Posición de la fila de la boletería para el puesto i. */
function queueSlot(st, i) {
  const q = MZ.queue, last = q.length - 1;
  const [x, z] = q[Math.min(i, last)];
  return V(x + Math.max(0, i - last) * 0.8, MZ.y, st.z + z);
}


/* ==========================================================================
   Sistema de viajeros
   ========================================================================== */

export class PeopleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import("./traffic.js").TrafficManager} traffic
   */
  constructor(scene, traffic, clock) {
    this.scene = scene;
    this.traffic = traffic;
    this.renderer = new PeopleRenderer(scene, CONFIG.people.capacity);
    this.people = [];
    this.time = 0;
    this.stations = STATIONS.map(st => ({
      st,
      waiting: { 1: this.targetWaiting(st, 1, clock), "-1": this.targetWaiting(st, -1, clock) },
      materialized: false,
      benches: { 1: benchSpots(st, 1), "-1": benchSpots(st, -1) },
      spawnTimer: rand(1, 5),
      queue: [],                                  // viajeros en la fila de la boletería
      serveT: null,                               // tiempo restante de atención al primero
      clerk: null,
    }));
    traffic.isBusyFor = (unit) => this.isBusy(unit);
  }

  /* ----- Consultas ----- */

  /** Viajeros que esperan en un andén: ninguno en el andén de llegada de una terminal. */
  targetWaiting(st, side, clock) {
    const route = routeForSide(side);
    if (route.stationOf(st) === route.last) return 0;
    return Math.round(CONFIG.people.maxWaitingPerSide * demandAt(clock));
  }

  npcsOf(unit) { return this.people.filter(p => p.unit === unit && p.space === "train"); }

  onboardCount(unit) {
    if (!unit) return 0;
    return unit.materialized ? this.npcsOf(unit).length + (unit.hiddenLoad || 0) : unit.load;
  }

  isBusy(unit) {
    return this.people.some(p => (p.pending && p.pending.unit === unit)
      || (p.unit === unit && (p.state === "toDoor" || p.state === "boarding" || p.state === "alighting")));
  }

  crowdLevel(cameraPos) {
    let n = 0;
    for (const p of this.people) {
      if (p.space !== "world") continue;
      const d = p.root.position.distanceTo(cameraPos);
      if (d < 50) n += 1 - d / 50;
    }
    return clamp(n / 14, 0, 1);
  }

  /** Posiciones de mundo de los viajeros en la mezanina (para los torniquetes). */
  deckAgents(out = []) {
    for (const p of this.people) if (p.space === "world" && p.root.position.y > MZ.y - 0.5) out.push(p.root.position);
    return out;
  }

  /* ----- Creación ----- */
  newPerson(station, side) {
    const mesh = createSkeleton();
    const p = {
      mesh, root: mesh.root,
      state: "waiting", space: "world", unit: null, hidden: false,
      station, side, dest: null,
      slot: null, spot: null,
      path: [], onArrive: null,
      speed: rand(1.05, 1.5),
      phase: Math.random() * 10,
      idle: Math.random() * 10,
      pose: "stand",
      pending: null,
    };
    this.scene.add(p.root);
    this.people.push(p);
    return p;
  }

  /** Destino (índice de estación del mundo) para quien sube por un lado. */
  randomDestination(st, side) {
    const route = routeForSide(side);
    const rs = route.stationOf(st);
    if (rs === route.last) return null;
    return route.stations[randInt(rs.index + 1, route.last.index)].worldIndex;
  }

  waitingSpot(st, side) {
    if (Math.random() < 0.25) {
      const free = this.stations[st.index].benches[side].filter(b => !b.occupant);
      if (free.length) return pick(free);
    }
    const z = Math.random() < 0.85 ? st.z + rand(-45, 15) : st.z + rand(-49, 48);
    return { side, bench: false, pos: V(side * rand(4.3, 5.7), S.platformTop, z) };
  }

  spawnWaiting(st, side, instant) {
    const p = this.newPerson(st, side);
    p.dest = this.randomDestination(st, side);
    const spot = this.waitingSpot(st, side);
    if (spot.bench) spot.occupant = p;
    p.spot = spot;
    if (instant) {
      p.root.position.copy(spot.pos);
      this.settleWaiting(p);
    } else {
      p.root.position.copy(streetDoor(st));
      if (Math.random() < 0.18) {
        // Pasa primero por la boletería a cargar su tarjeta
        p.state = "queue";
        p.queueIndex = -1;
        this.stations[st.index].queue.push(p);
      } else {
        p.state = "arriving";
        this.walk(p, pathFromGates(st, side, spot.pos), () => this.settleWaiting(p));
      }
    }
    return p;
  }

  /** Mueve la fila de la boletería y atiende al primero. */
  updateQueue(ss, dt) {
    const st = ss.st;
    ss.queue.forEach((p, i) => {
      if (p.queueIndex === i) return;
      p.queueIndex = i;
      p.atSlot = false;
      this.walk(p, [queueSlot(st, i)], () => {
        p.atSlot = true;
        p.targetYaw = i === 0 ? -Math.PI / 2 : Math.PI;          // el primero mira a la ventanilla
      });
    });
    const first = ss.queue[0];
    if (!first || !first.atSlot) return;
    if (ss.serveT === null) ss.serveT = rand(6, 12);
    ss.serveT -= dt;
    if (ss.serveT > 0) return;
    ss.serveT = null;
    ss.queue.shift();
    first.state = "arriving";
    this.walk(first, pathFromGates(st, first.side, first.spot.pos), () => this.settleWaiting(first));
  }

  /** Cajero sentado dentro de la boletería. */
  spawnClerk(ss) {
    const st = ss.st;
    const p = this.newPerson(st, -1);
    p.state = "clerk";
    p.root.rotation.y = p.targetYaw = Math.PI / 2;               // mirando a la ventanilla (+X)
    this.sitAt(p, V(MZ.booth.x1 - 0.85, MZ.y, st.z + MZ.booth.windowZ), MZ.y + 0.48);
    ss.clerk = p;
  }

  settleWaiting(p) {
    p.state = "waiting";
    p.root.rotation.y = p.targetYaw = (p.side > 0 ? -Math.PI / 2 : Math.PI / 2) + (p.spot.bench ? 0 : rand(-0.6, 0.6));
    if (p.spot.bench) this.sitAt(p, p.spot.pos, p.spot.seatY);
  }

  freeSlot(unit, preferSeat) {
    const free = unit.slots.filter(s => !s.occupant);
    if (!free.length) return null;
    const seats = free.filter(s => s.type === "seat");
    return preferSeat && seats.length ? pick(seats) : pick(free);
  }

  /** Viajero colocado directamente en una plaza (sin animación). */
  spawnOnboard(unit, fromRouteIndex) {
    const slot = this.freeSlot(unit, Math.random() < 0.8);
    if (!slot) return null;
    const route = unit.route;
    const from = route.stations[Math.max(0, fromRouteIndex)];
    const p = this.newPerson(from.world, route.side);
    const destIdx = Math.min(route.last.index, randInt(fromRouteIndex + 1, route.last.index));
    p.dest = route.stations[destIdx].worldIndex;
    p.space = "train"; p.unit = unit;
    this.scene.remove(p.root);
    unit.group.add(p.root);
    slot.occupant = p;
    p.slot = slot;
    p.root.position.copy(slot.approach);
    this.settleInSlot(p);
    return p;
  }

  settleInSlot(p) {
    const slot = p.slot;
    p.state = "onboard";
    p.root.rotation.y = p.targetYaw = slot.yaw;
    if (slot.type === "seat") this.sitAt(p, slot.pos, slot.seatY);
    else { p.root.position.copy(slot.pos); p.pose = "hold"; }
  }

  sitAt(p, pos, seatY) { p.root.position.set(pos.x, seatY - p.mesh.legLen, pos.z); p.pose = "sit"; }
  standUp(p, floorY) { p.root.position.y = floorY; p.pose = "stand"; }

  remove(p) {
    if (p.slot) { if (p.slot.occupant === p) p.slot.occupant = null; p.slot = null; }
    if (p.spot?.bench && p.spot.occupant === p) p.spot.occupant = null;
    p.root.parent?.remove(p.root);
    p.state = "gone";
  }

  /* ----- Cambios de espacio (andén ↔ tren) ----- */
  toTrain(p, unit) {
    if (p.space === "train") return;
    unit.group.updateMatrixWorld(true);
    unit.group.worldToLocal(p.root.position);
    p.root.rotation.y -= unit.group.rotation.y;
    if (p.targetYaw !== undefined) p.targetYaw -= unit.group.rotation.y;
    this.scene.remove(p.root);
    unit.group.add(p.root);
    p.space = "train";
    p.unit = unit;
  }

  toWorld(p) {
    if (p.space === "world") return;
    const g = p.unit.group;
    g.updateMatrixWorld(true);
    g.localToWorld(p.root.position);
    p.root.rotation.y += g.rotation.y;
    if (p.targetYaw !== undefined) p.targetYaw += g.rotation.y;
    g.remove(p.root);
    this.scene.add(p.root);
    p.space = "world";
    p.unit = null;
  }

  walk(p, points, onArrive) {
    p.path = points.map(v => { const c = v.clone(); c.esc = v.esc; return c; });
    p.onArrive = onArrive;
    p.pose = "walk";
  }

  nearestDoor(localZ) {
    return TRAIN_LAYOUT.doors.reduce((a, b) => (Math.abs(b - localZ) < Math.abs(a - localZ) ? b : a));
  }

  /* ----- Subida ----- */
  startBoarding(p, unit) {
    const side = p.side;
    unit.group.updateMatrixWorld(true);
    const local = unit.group.worldToLocal(p.root.position.clone());
    const doorLocal = this.nearestDoor(local.z);
    const doorWorld = unit.group.localToWorld(V(1.3, F, doorLocal));

    if (p.spot?.bench) { p.spot.occupant = null; this.standUp(p, S.platformTop); }
    p.state = "toDoor";
    p.unit = unit;
    p.root.position.y = S.platformTop;
    this.walk(p, [
      V(side * rand(3.95, 4.4), S.platformTop, doorWorld.z + rand(-0.6, 0.6)),
      V(side * 3.7, S.platformTop, doorWorld.z + rand(-0.25, 0.25)),
    ], () => {
      if (unit.sim.doorState !== "open" || !this.traffic.units.includes(unit)) return this.abortBoarding(p);
      // Tren lleno de viajeros dibujados: pasa a la cuenta oculta
      if (this.npcsOf(unit).length >= CONFIG.people.maxVisibleOnboard) {
        unit.hiddenLoad = (unit.hiddenLoad || 0) + 1;
        return this.remove(p);
      }
      p.unit = null;
      this.toTrain(p, unit);
      p.root.position.set(1.3, F, doorLocal + rand(-0.2, 0.2));
      p.state = "boarding";
      this.walk(p, [V(0.7, F, doorLocal), p.slot.approach], () => this.settleInSlot(p));
    });
  }

  abortBoarding(p) {
    if (p.slot) { if (p.slot.occupant === p) p.slot.occupant = null; p.slot = null; }
    p.unit = null;
    const spot = this.waitingSpot(p.station, p.side);
    if (spot.bench) spot.occupant = p;
    p.spot = spot;
    p.state = "arriving";
    p.root.position.y = S.platformTop;
    this.walk(p, [spot.pos], () => this.settleWaiting(p));
  }

  /* ----- Bajada ----- */
  startAlighting(p, station) {
    const unit = p.unit;
    const slot = p.slot;
    const doorLocal = this.nearestDoor(slot ? slot.pos.z : p.root.position.z);
    if (slot) {
      if (slot.type === "seat") { p.root.position.copy(slot.approach); this.standUp(p, F); }
      if (slot.occupant === p) slot.occupant = null;
      p.slot = null;
    }
    p.state = "alighting";
    this.walk(p, [V(0.6, F, doorLocal + rand(-0.3, 0.3)), V(1.3, F, doorLocal)], () => {
      if (unit.sim.doorState !== "open") {
        const back = this.freeSlot(unit, false);
        if (back) { back.occupant = p; p.slot = back; p.state = "boarding"; this.walk(p, [back.approach], () => this.settleInSlot(p)); }
        else { p.state = "onboard"; p.pose = "hold"; }
        return;
      }
      const side = unit.route.side;
      this.toWorld(p);
      p.root.position.y = S.platformTop;
      p.station = station;
      p.side = side;
      p.state = "leaving";
      this.walk(p, pathToStreet(station, side, p.root.position), () => this.remove(p));
    });
  }

  /* ---------------------------------------------------------------------
     Niveles de detalle: cifras ↔ personas
     --------------------------------------------------------------------- */
  materializeStation(ss) {
    ss.materialized = true;
    this.spawnClerk(ss);
    [1, -1].forEach(side => {
      const n = Math.round(ss.waiting[side]);
      for (let i = 0; i < n; i++) this.spawnWaiting(ss.st, side, true);
    });
  }

  dematerializeStation(ss) {
    ss.materialized = false;
    const count = { 1: 0, "-1": 0 };
    for (const p of this.people) {
      if (p.space !== "world" || p.station !== ss.st) continue;
      if (p.state === "waiting" || p.state === "arriving" || p.state === "toDoor" || p.state === "queue") count[p.side]++;
      this.remove(p);
    }
    ss.queue = [];
    ss.serveT = null;
    ss.clerk = null;
    ss.waiting[1] = count[1];
    ss.waiting[-1] = count[-1];
  }

  materializeUnit(unit) {
    unit.materialized = true;
    const sim = unit.sim;
    const docked = sim.dockedStation();
    const next = sim.nextStation();
    const fromIndex = docked ? docked.index : next ? next.index - 1 : unit.route.last.index;
    const visible = Math.min(unit.load, CONFIG.people.maxVisibleOnboard);
    let placed = 0;
    for (let i = 0; i < visible; i++) if (this.spawnOnboard(unit, fromIndex)) placed++;
    unit.hiddenLoad = unit.load - placed;
  }

  dematerializeUnit(unit) {
    unit.materialized = false;
    const npcs = this.npcsOf(unit);
    unit.load = npcs.length + (unit.hiddenLoad || 0);
    unit.hiddenLoad = 0;
    npcs.forEach(p => this.remove(p));
    this.people.filter(p => p.state === "toDoor" && p.unit === unit).forEach(p => this.abortBoarding(p));
  }

  /** Quita todos los viajeros de un tren (retirada del servicio o reinicio). */
  clearUnit(unit, load = 0) {
    this.npcsOf(unit).forEach(p => this.remove(p));
    this.people.filter(p => p.unit === unit && p.state === "toDoor").forEach(p => this.abortBoarding(p));
    unit.slots.forEach(s => { if (s.occupant && s.occupant !== "player") s.occupant = null; });
    unit.load = load;
    unit.hiddenLoad = 0;
    unit.exchangeIdx = null;
    unit.materialized = false;
  }

  /** Intercambio "por cifras" en una parada. */
  abstractExchange(unit, rs) {
    const route = unit.route, st = rs.world, side = route.side;
    const ss = this.stations[st.index];
    const remaining = route.last.index - rs.index;
    const load = this.onboardCount(unit);
    const alight = rs === route.last ? load : Math.round(load * clamp(1.6 / Math.max(1, remaining), 0, 0.6));
    const board = rs === route.last ? 0 : Math.min(Math.floor(ss.waiting[side]), Math.max(0, CONFIG.people.maxOnboard - (load - alight)));
    ss.waiting[side] -= board;

    if (unit.materialized) {
      const npcs = this.npcsOf(unit).sort((a, b) => (b.dest === st.index) - (a.dest === st.index));
      const fromNpcs = Math.min(alight, npcs.length);
      npcs.slice(0, fromNpcs).forEach(p => this.remove(p));
      unit.hiddenLoad = Math.max(0, (unit.hiddenLoad || 0) - (alight - fromNpcs));
      for (let i = 0; i < board; i++) {
        if (this.npcsOf(unit).length >= CONFIG.people.maxVisibleOnboard || !this.spawnOnboard(unit, rs.index)) unit.hiddenLoad++;
      }
    } else {
      unit.load = load - alight + board;
    }
  }

  /* ---------------------------------------------------------------------
     Actualización por fotograma
     --------------------------------------------------------------------- */
  update(dt, clock, { cameraZ = 0, hideUnit = null, render = true } = {}) {
    this.time += dt;
    const R = CONFIG.people.activeRadius;
    const demand = demandAt(clock);
    const traffic = this.traffic;
    const units = traffic.units;

    // 1. Niveles de detalle
    for (const ss of this.stations) {
      const d = Math.abs(ss.st.z - cameraZ);
      if (d < R && !ss.materialized) this.materializeStation(ss);
      else if (d > R + 40 && ss.materialized) this.dematerializeStation(ss);
    }
    for (const u of units) {
      const d = Math.abs(traffic.worldCenterZ(u) - cameraZ);
      if (d < R && !u.materialized) this.materializeUnit(u);
      else if (d > R + 40 && u.materialized) this.dematerializeUnit(u);
    }

    // 2. Llegada de viajeros desde la calle según la demanda horaria
    for (const ss of this.stations) {
      if (!ss.materialized) {
        [1, -1].forEach(side => { ss.waiting[side] = Math.min(this.targetWaiting(ss.st, side, clock), ss.waiting[side] + (demand * 6 / 60) * dt); });
        continue;
      }
      ss.spawnTimer -= dt;
      if (ss.spawnTimer > 0) continue;
      ss.spawnTimer = rand(0.5, 1.2) * 60 / Math.max(1, demand * 14);
      const side = Math.random() < 0.5 ? 1 : -1;
      const now = this.people.filter(p => p.station === ss.st && p.side === side && p.space === "world" && (p.state === "arriving" || p.state === "waiting" || p.state === "toDoor" || p.state === "queue")).length;
      if (now < this.targetWaiting(ss.st, side, clock)) this.spawnWaiting(ss.st, side, false);
    }

    // Filas de las boleterías
    for (const ss of this.stations) if (ss.materialized && ss.queue.length) this.updateQueue(ss, dt);

    // 3. Intercambio de viajeros en trenes con puertas abiertas
    for (const u of units) {
      const rs = u.sim.isStopped ? u.sim.dockedStation() : null;
      const open = u.sim.doorState === "open" && rs;
      if (!open) {
        for (const p of this.people) {
          if (p.pending && p.pending.unit === u) {
            if (p.pending.type === "board" && p.slot) { if (p.slot.occupant === p) p.slot.occupant = null; p.slot = null; }
            p.pending = null;
          }
          if (p.state === "toDoor" && p.unit === u && u.sim.doorState !== "opening") this.abortBoarding(p);
        }
        continue;
      }
      const st = rs.world, ss = this.stations[st.index];
      if (!(u.materialized && ss.materialized)) {
        if (u.exchangeIdx !== rs.index) { u.exchangeIdx = rs.index; this.abstractExchange(u, rs); }
        continue;
      }
      if (u.exchangeIdx !== rs.index) {
        u.exchangeIdx = rs.index;
        // Los viajeros "ocultos" también bajan en proporción
        const remaining = u.route.last.index - rs.index;
        u.hiddenLoad = rs === u.route.last ? 0 : Math.round((u.hiddenLoad || 0) * (1 - clamp(1.6 / Math.max(1, remaining), 0, 0.6)));
      }
      const terminal = rs === u.route.last;
      for (const p of this.people) {
        if (p.pending) continue;
        if (p.space === "train" && p.unit === u && p.state === "onboard" && (p.dest === st.index || terminal)) {
          p.pending = { type: "alight", t: rand(0, 2.5), station: st, unit: u };
        } else if (p.state === "waiting" && p.station === st && p.side === u.route.side && p.dest !== null && !terminal) {
          const slot = this.freeSlot(u, Math.random() < 0.7);
          if (!slot) continue;
          slot.occupant = p; p.slot = slot;
          p.pending = { type: "board", t: rand(1.2, 4), unit: u };
        }
      }
    }

    // 4. Acciones programadas
    for (const p of this.people) {
      if (!p.pending) continue;
      p.pending.t -= dt;
      if (p.pending.t > 0) continue;
      const action = p.pending;
      p.pending = null;
      if (action.type === "board") this.startBoarding(p, action.unit);
      else this.startAlighting(p, action.station);
    }

    // 5. Movimiento, animación y dibujo
    for (const p of this.people) {
      if (p.state === "gone") continue;
      this.move(p, dt);
      this.animate(p, dt);
      p.hidden = p.space === "train" && (!p.unit.group.visible || p.unit === hideUnit);
    }
    this.people = this.people.filter(p => p.state !== "gone");
    if (render) this.renderer.render(this.people);
  }

  move(p, dt) {
    if (p.path.length) {
      const target = p.path[0], pos = p.root.position;
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const onEsc = !!target.esc && Math.abs(target.y - pos.y) > 0.05;
      p.riding = onEsc;
      const step = onEsc ? CONFIG.mezzanine.escSpeed * dt                           // la escalera mecánica los lleva
        : p.speed * dt * (Math.abs(target.y - pos.y) > 0.3 ? 0.75 : 1);             // más lento en escaleras fijas
      if (dist <= step) {
        pos.set(target.x, target.y, target.z);
        p.path.shift();
        if (!p.path.length) {
          p.pose = "stand";
          const cb = p.onArrive; p.onArrive = null;
          cb?.();
        }
      } else {
        pos.y += (target.y - pos.y) * (step / dist);        // sube o baja en proporción (escaleras)
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        p.targetYaw = Math.atan2(dx, dz);
      }
    }
    if (p.targetYaw !== undefined) {
      const diff = wrapAngle(p.targetYaw - p.root.rotation.y);
      p.root.rotation.y += clamp(diff, -7 * dt, 7 * dt);
    }
  }

  animate(p, dt) {
    const m = p.mesh;
    const ease = Math.min(1, dt * 10);
    const to = (obj, x) => { obj.rotation.x += (x - obj.rotation.x) * ease; };
    const pose = p.riding ? "stand" : p.pose;
    switch (pose) {
      case "walk": {
        p.phase += dt * p.speed * 5.4;
        const s = Math.sin(p.phase);
        m.hipL.rotation.x = s * 0.5; m.hipR.rotation.x = -s * 0.5;
        m.kneeL.rotation.x = Math.max(0, -s) * 0.75; m.kneeR.rotation.x = Math.max(0, s) * 0.75;
        m.armL.rotation.x = -s * 0.4; m.armR.rotation.x = s * 0.4;
        m.body.position.y = Math.abs(Math.cos(p.phase)) * 0.025;
        m.body.rotation.set(0, 0, 0);
        break;
      }
      case "sit":
        to(m.hipL, -Math.PI / 2); to(m.hipR, -Math.PI / 2);
        to(m.kneeL, Math.PI / 2); to(m.kneeR, Math.PI / 2);
        to(m.armL, -0.55); to(m.armR, -0.55);
        m.body.position.y = 0;
        m.body.rotation.set(0, 0, 0);
        break;
      case "hold": {
        to(m.hipL, 0); to(m.hipR, 0); to(m.kneeL, 0); to(m.kneeR, 0);
        to(m.armR, -2.95);
        to(m.armL, Math.sin(this.time * 0.8 + p.idle) * 0.05);
        const accel = p.unit ? p.unit.sim.accel : 0;
        m.body.rotation.x = clamp(-accel * 0.04, -0.06, 0.06) * Math.cos(p.root.rotation.y);
        m.body.position.y = 0;
        break;
      }
      default: {
        to(m.hipL, 0); to(m.hipR, 0); to(m.kneeL, 0); to(m.kneeR, 0);
        const idle = Math.sin(this.time * 0.9 + p.idle);
        to(m.armL, idle * 0.04); to(m.armR, -idle * 0.04);
        m.body.rotation.z = idle * 0.015;
        m.body.position.y = 0;
      }
    }
  }
}
