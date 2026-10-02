/* ==========================================================================
   MetroSim — Alpha 0.4 · people.js
   Viajeros (NPC) compartidos por todos los modos y todos los trenes.

   Dos niveles de detalle (la línea tiene 21 estaciones y muchos trenes):
     · Cerca de la cámara (CONFIG.people.activeRadius) los viajeros existen
       como personas 3D que caminan, esperan, suben, se sientan y bajan.
     · Lejos, solo se lleva la cuenta: viajeros esperando en cada andén y
       viajeros a bordo de cada tren ("load"). Al acercarse la cámara, esas
       cifras se convierten en personas, y al alejarse vuelven a ser cifras.

   Ciclo de vida de un viajero 3D:
     arriving → waiting → toDoor → boarding → onboard → alighting → leaving
   En el andén viven en coordenadas del mundo; dentro de un tren son hijos del
   grupo de ese tren (coordenadas locales) y se mueven con él.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, demandAt } from "./config.js";
import { clamp } from "./utils.js";

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const LAST = STATIONS.length - 1;


/* ==========================================================================
   Fábrica de personas (geometría y materiales compartidos)
   ========================================================================== */

class PersonFactory {
  constructor() {
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      head: new THREE.SphereGeometry(1, 12, 9),
      hair: new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    };
    const m = (c, rough = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });
    this.mat = {
      shirt: [0x2f4f7f, 0x8a2b2b, 0x3f6e46, 0xd9d4c7, 0x1d1f24, 0x6b4f8a, 0xc7862f, 0x5f6f7a, 0xa33f6b, 0x2d6c78, 0xe5e5e5, 0x7a6450].map(c => m(c)),
      pants: [0x1f2a3a, 0x24262b, 0x3b3f46, 0x4a3b2c, 0x2c3e5c, 0x6d6a60].map(c => m(c)),
      skin: [0xf1c7a5, 0xe0ac86, 0xc68d65, 0x9c6644, 0x6b4430, 0xf5d5bd].map(c => m(c, 0.7)),
      hair: [0x1b1410, 0x3a2617, 0x6b4a2b, 0xb08a52, 0x8f8f8f, 0x0d0d0d].map(c => m(c, 0.9)),
      bag: [0x222222, 0x5a3b22, 0x1f3d5c, 0x6e1f2a].map(c => m(c, 0.7)),
    };
  }

  part(parent, geo, mat, sx, sy, sz, x, y, z) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  /** Figura humana low-poly articulada. Origen = pies; frente = +Z. */
  create() {
    const { geo, mat } = this;
    const h = rand(0.9, 1.1);
    const legLen = 0.84 * h, thigh = legLen / 2, shin = legLen / 2;
    const torsoH = 0.58 * h, armLen = 0.62 * h;
    const shirt = pick(mat.shirt), pants = pick(mat.pants), skin = pick(mat.skin), hair = pick(mat.hair);
    const width = rand(0.36, 0.44);

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const legs = [-1, 1].map(s => {
      const hip = new THREE.Group();
      hip.position.set(s * width * 0.25, legLen, 0);
      body.add(hip);
      this.part(hip, geo.box, pants, 0.15, thigh, 0.17, 0, -thigh / 2, 0);
      const knee = new THREE.Group();
      knee.position.y = -thigh;
      hip.add(knee);
      this.part(knee, geo.box, pants, 0.13, shin, 0.16, 0, -shin / 2, 0.01);
      return { hip, knee };
    });

    this.part(body, geo.box, shirt, width, torsoH, 0.23, 0, legLen + torsoH / 2, 0);
    const shoulderY = legLen + torsoH - 0.05;
    const arms = [-1, 1].map(s => {
      const arm = new THREE.Group();
      arm.position.set(s * (width / 2 + 0.055), shoulderY, 0);
      body.add(arm);
      this.part(arm, geo.box, shirt, 0.1, armLen, 0.11, 0, -armLen / 2, 0);
      return arm;
    });

    const headY = shoulderY + 0.19 * h;
    this.part(body, geo.head, skin, 0.105, 0.125, 0.115, 0, headY, 0);
    this.part(body, geo.hair, hair, 0.112, Math.random() < 0.3 ? 0.16 : 0.12, 0.12, 0, headY + 0.01, -0.012);
    if (Math.random() < 0.3) this.part(body, geo.box, pick(mat.bag), 0.3, 0.36, 0.13, 0, legLen + torsoH * 0.55, -0.18);

    return {
      root, body, legLen,
      hipL: legs[0].hip, hipR: legs[1].hip, kneeL: legs[0].knee, kneeR: legs[1].knee,
      armL: arms[0], armR: arms[1],
    };
  }
}

/** Bancos de cada estación (mismas posiciones que world.js). */
function buildBenchSpots(st) {
  const S = CONFIG.station, spots = [];
  [-1, 1].forEach(side => {
    for (let off = -30; off < 30; off += 10) {
      const bz = st.z + off + 5;
      [-0.45, 0.45].forEach(dz => spots.push({
        side, bench: true, occupant: null,
        pos: new THREE.Vector3(side * 6.42, S.platformTop, bz + dz),
        seatY: S.platformTop + 0.48,
      }));
    }
  });
  return spots;
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
    this.factory = new PersonFactory();
    this.people = [];
    this.time = 0;
    this.stations = STATIONS.map(st => ({
      st,
      waiting: this.targetWaiting(st, clock),     // viajeros abstractos esperando
      materialized: false,
      benches: buildBenchSpots(st),
      spawnTimer: rand(1, 5),
    }));
    traffic.isBusyFor = (unit) => this.isBusy(unit);
  }

  /* ----- Consultas ----- */
  targetWaiting(st, clock) {
    if (st.index === LAST) return Math.round(4 * demandAt(clock));     // fin de línea: casi nadie espera
    return Math.round(CONFIG.people.maxWaitingPerStation * demandAt(clock));
  }

  npcsOf(unit) { return this.people.filter(p => p.unit === unit && p.space === "train"); }

  onboardCount(unit) {
    if (!unit) return 0;
    return unit.materialized ? this.npcsOf(unit).length : unit.load;
  }

  /** true mientras haya viajeros subiendo o bajando de ese tren (el ATO espera). */
  isBusy(unit) {
    return this.people.some(p => (p.pending && p.pending.unit === unit)
      || (p.unit === unit && (p.state === "toDoor" || p.state === "boarding" || p.state === "alighting")));
  }

  /** Nivel de murmullo (0..1) según la gente cerca de la cámara. */
  crowdLevel(cameraZ) {
    let n = 0;
    for (const p of this.people) {
      if (p.space !== "world") continue;
      const dz = Math.abs(p.root.position.z - cameraZ);
      if (dz < 60) n += 1 - dz / 60;
    }
    return clamp(n / 14, 0, 1);
  }

  /* ----- Creación de personas ----- */
  newPerson(station, side) {
    const mesh = this.factory.create();
    const p = {
      mesh, root: mesh.root,
      state: "waiting", space: "world", unit: null,
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

  randomDestination(fromIndex) {
    return fromIndex >= LAST ? null : randInt(fromIndex + 1, LAST);
  }

  waitingSpot(st, side) {
    const S = CONFIG.station;
    if (Math.random() < 0.25) {
      const free = this.stations[st.index].benches.filter(b => b.side === side && !b.occupant);
      if (free.length) return pick(free);
    }
    const z = Math.random() < 0.8 ? st.stopZ + rand(1, 18) : st.z + rand(-31, 18);
    return { side, bench: false, pos: new THREE.Vector3(side * rand(2.6, 4.9), S.platformTop, z) };
  }

  accessPoint(st, side, nearZ) {
    const S = CONFIG.station;
    const end = nearZ < st.z ? -1 : 1;
    return new THREE.Vector3(side * (S.wallX - 0.45), S.platformTop, st.z + end * S.accessZ);
  }

  spawnWaiting(st, instant) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const p = this.newPerson(st, side);
    p.dest = this.randomDestination(st.index);
    const spot = this.waitingSpot(st, side);
    if (spot.bench) spot.occupant = p;
    p.spot = spot;
    if (instant) {
      p.root.position.copy(spot.pos);
      this.settleWaiting(p);
    } else {
      p.state = "arriving";
      p.root.position.copy(this.accessPoint(st, side, spot.pos.z));
      this.walk(p, [spot.pos], () => this.settleWaiting(p));
    }
    return p;
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

  /** Crea un viajero directamente en una plaza de un tren (sin animación). */
  spawnOnboard(unit, fromIndex) {
    const slot = this.freeSlot(unit, Math.random() < 0.8);
    if (!slot) return null;
    const p = this.newPerson(STATIONS[Math.max(0, fromIndex)], 1);
    p.dest = this.randomDestination(fromIndex) ?? LAST;
    this.toTrain(p, unit);
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

  sitAt(p, pos, seatY) {
    p.root.position.set(pos.x, seatY - p.mesh.legLen, pos.z);
    p.pose = "sit";
  }

  standUp(p, floorY) { p.root.position.y = floorY; p.pose = "stand"; }

  remove(p) {
    if (p.slot) { p.slot.occupant = null; p.slot = null; }
    if (p.spot?.bench && p.spot.occupant === p) p.spot.occupant = null;
    p.root.parent?.remove(p.root);
    p.state = "gone";
  }

  /* ----- Cambios de espacio (andén ↔ tren) ----- */
  toTrain(p, unit) {
    if (p.space === "train") return;
    p.root.position.sub(unit.group.position);
    this.scene.remove(p.root);
    unit.group.add(p.root);
    p.space = "train";
    p.unit = unit;
  }

  toWorld(p) {
    if (p.space === "world") return;
    p.root.position.add(p.unit.group.position);
    p.unit.group.remove(p.root);
    this.scene.add(p.root);
    p.space = "world";
    p.unit = null;
  }

  walk(p, points, onArrive) {
    p.path = points.map(v => v.clone());
    p.onArrive = onArrive;
    p.pose = "walk";
  }

  nearestDoor(localZ) {
    return CONFIG.train.doorCenters.reduce((a, b) => (Math.abs(b - localZ) < Math.abs(a - localZ) ? b : a));
  }

  /* ----- Subida ----- */
  startBoarding(p, unit) {
    const S = CONFIG.station, F = CONFIG.train.floorY;
    const trainZ = unit.group.position.z;
    const doorLocal = this.nearestDoor(p.root.position.z - trainZ);
    const doorZ = trainZ + doorLocal;
    const side = p.side;

    if (p.spot?.bench) { p.spot.occupant = null; this.standUp(p, S.platformTop); }
    p.state = "toDoor";
    p.unit = unit;                                   // tren al que se dirige (aún en el andén)
    p.root.position.y = S.platformTop;
    this.walk(p, [
      new THREE.Vector3(side * rand(2.3, 2.7), S.platformTop, doorZ + rand(-0.6, 0.6)),
      new THREE.Vector3(side * 1.7, S.platformTop, doorZ + rand(-0.25, 0.25)),
    ], () => {
      if (unit.sim.doorState !== "open" || !this.traffic.units.includes(unit)) return this.abortBoarding(p);
      p.unit = null;
      this.toTrain(p, unit);
      p.root.position.set(side * 1.3, F, doorLocal + rand(-0.2, 0.2));
      p.state = "boarding";
      this.walk(p, [new THREE.Vector3(side * 0.7, F, doorLocal), p.slot.approach], () => this.settleInSlot(p));
    });
  }

  abortBoarding(p) {
    if (p.slot) { p.slot.occupant = null; p.slot = null; }
    p.unit = null;
    const spot = this.waitingSpot(p.station, p.side);
    if (spot.bench) spot.occupant = p;
    p.spot = spot;
    p.state = "arriving";
    this.walk(p, [spot.pos], () => this.settleWaiting(p));
  }

  /* ----- Bajada ----- */
  startAlighting(p, station) {
    const F = CONFIG.train.floorY, S = CONFIG.station;
    const unit = p.unit;
    const slot = p.slot;
    const side = Math.random() < 0.5 ? -1 : 1;
    const doorLocal = this.nearestDoor(slot ? slot.pos.z : p.root.position.z);
    if (slot) {
      if (slot.type === "seat") { p.root.position.copy(slot.approach); this.standUp(p, F); }
      slot.occupant = null;
      p.slot = null;
    }
    p.state = "alighting";
    this.walk(p, [new THREE.Vector3(side * 0.6, F, doorLocal + rand(-0.3, 0.3)), new THREE.Vector3(side * 1.3, F, doorLocal)], () => {
      if (unit.sim.doorState !== "open") {
        // Se le cerraron las puertas: vuelve a una plaza y bajará en la siguiente
        const back = this.freeSlot(unit, false);
        if (back) { back.occupant = p; p.slot = back; p.state = "boarding"; this.walk(p, [back.approach], () => this.settleInSlot(p)); }
        else { p.state = "onboard"; p.pose = "hold"; }
        p.dest = Math.min(station.index + 1, LAST);
        return;
      }
      this.toWorld(p);
      p.root.position.y = S.platformTop;
      p.station = station;
      p.side = side;
      p.state = "leaving";
      const out = new THREE.Vector3(side * rand(2.4, 3.2), S.platformTop, p.root.position.z + rand(-1.5, 1.5));
      this.walk(p, [out, this.accessPoint(station, side, out.z)], () => this.remove(p));
    });
  }

  /* ---------------------------------------------------------------------
     Niveles de detalle: cifras ↔ personas
     --------------------------------------------------------------------- */
  materializeStation(ss) {
    ss.materialized = true;
    const n = Math.round(ss.waiting);
    for (let i = 0; i < n; i++) this.spawnWaiting(ss.st, true);
  }

  dematerializeStation(ss) {
    ss.materialized = false;
    let n = 0;
    for (const p of this.people) {
      if (p.space !== "world" || p.station !== ss.st) continue;
      if (p.state === "waiting" || p.state === "arriving" || p.state === "toDoor") n++;
      this.remove(p);
    }
    ss.waiting = n;
  }

  materializeUnit(unit) {
    unit.materialized = true;
    const sim = unit.sim;
    const docked = sim.dockedStation();
    const next = sim.nextStation();
    const fromIndex = docked ? docked.index : next ? next.index - 1 : LAST;
    for (let i = 0; i < unit.load; i++) if (!this.spawnOnboard(unit, fromIndex)) break;
  }

  dematerializeUnit(unit) {
    unit.materialized = false;
    const npcs = this.npcsOf(unit);
    unit.load = npcs.length;
    npcs.forEach(p => this.remove(p));
    // Quien iba hacia la puerta de este tren vuelve a esperar
    this.people.filter(p => p.state === "toDoor" && p.unit === unit).forEach(p => this.abortBoarding(p));
  }

  /** Quita todos los viajeros de un tren (retirada del servicio o reinicio). */
  clearUnit(unit, load = 0) {
    this.npcsOf(unit).forEach(p => this.remove(p));
    this.people.filter(p => p.unit === unit && p.state === "toDoor").forEach(p => this.abortBoarding(p));
    unit.slots.forEach(s => { if (s.occupant && s.occupant !== "player") s.occupant = null; });
    unit.load = load;
    unit.exchangeIdx = null;
    if (unit.materialized) { unit.materialized = false; }
  }

  /** Intercambio "por cifras" cuando el tren o la estación no están dibujados. */
  abstractExchange(unit, st) {
    const remaining = LAST - st.index;
    const ss = this.stations[st.index];
    const load = this.onboardCount(unit);
    const alight = st.index === LAST ? load : Math.round(load * clamp(1.6 / Math.max(1, remaining), 0, 0.6));
    const capacity = CONFIG.people.maxOnboard;
    const board = st.index === LAST ? 0 : Math.min(Math.floor(ss.waiting), Math.max(0, capacity - (load - alight)));
    ss.waiting -= board;

    if (unit.materialized) {
      const npcs = this.npcsOf(unit).sort((a, b) => (b.dest === st.index) - (a.dest === st.index));
      npcs.slice(0, alight).forEach(p => this.remove(p));
      for (let i = 0; i < board; i++) this.spawnOnboard(unit, st.index);
    } else {
      unit.load = load - alight + board;
    }
  }

  /* ---------------------------------------------------------------------
     Actualización por fotograma
     --------------------------------------------------------------------- */
  update(dt, clock, { cameraZ = 0, hideUnit = null } = {}) {
    this.time += dt;
    const R = CONFIG.people.activeRadius;
    const demand = demandAt(clock);
    const units = this.traffic.units;

    // 1. Niveles de detalle de estaciones y trenes
    for (const ss of this.stations) {
      const near = Math.abs(ss.st.z - cameraZ) < R;
      if (near && !ss.materialized) this.materializeStation(ss);
      else if (!near && ss.materialized && Math.abs(ss.st.z - cameraZ) > R + 40) this.dematerializeStation(ss);
    }
    for (const u of units) {
      const near = Math.abs(u.sim.position + CONFIG.train.length / 2 - cameraZ) < R;
      if (near && !u.materialized) this.materializeUnit(u);
      else if (!near && u.materialized && Math.abs(u.sim.position + CONFIG.train.length / 2 - cameraZ) > R + 40) this.dematerializeUnit(u);
    }

    // 2. Llegada de viajeros a los andenes según la demanda horaria
    for (const ss of this.stations) {
      const target = this.targetWaiting(ss.st, clock);
      if (!ss.materialized) {
        ss.waiting = Math.min(target, ss.waiting + (demand * 10 / 60) * dt);
        continue;
      }
      ss.spawnTimer -= dt;
      if (ss.spawnTimer > 0) continue;
      ss.spawnTimer = rand(0.6, 1.4) * 60 / Math.max(1, demand * 10);
      const waitingNow = this.people.filter(p => p.station === ss.st && p.space === "world" && (p.state === "arriving" || p.state === "waiting" || p.state === "toDoor")).length;
      if (waitingNow < target) this.spawnWaiting(ss.st, false);
    }

    // 3. Intercambio de viajeros en trenes con puertas abiertas
    for (const u of units) {
      const docked = u.sim.isStopped ? u.sim.dockedStation() : null;
      const open = u.sim.doorState === "open" && docked;
      if (!open) {
        // Puertas no abiertas: cancelar subidas pendientes y retirar a quien iba hacia la puerta
        for (const p of this.people) {
          if (p.pending && p.pending.unit === u) {
            if (p.pending.type === "board" && p.slot) { p.slot.occupant = null; p.slot = null; }
            p.pending = null;
          }
          if (p.state === "toDoor" && p.unit === u && u.sim.doorState !== "opening") this.abortBoarding(p);
        }
        continue;
      }
      const ss = this.stations[docked.index];
      if (!(u.materialized && ss.materialized)) {
        if (u.exchangeIdx !== docked.index) { u.exchangeIdx = docked.index; this.abstractExchange(u, docked); }
        continue;
      }
      u.exchangeIdx = docked.index;
      let onboard = this.npcsOf(u).length + this.people.filter(p => p.pending?.type === "board" && p.pending.unit === u).length;
      for (const p of this.people) {
        if (p.pending) continue;
        if (p.space === "train" && p.unit === u && p.state === "onboard" && (p.dest === docked.index || docked.index === LAST)) {
          p.pending = { type: "alight", t: rand(0, 2.5), station: docked, unit: u };
        } else if (p.state === "waiting" && p.station === docked && p.dest !== null && onboard < CONFIG.people.maxOnboard) {
          const slot = this.freeSlot(u, Math.random() < 0.7);
          if (!slot) continue;
          slot.occupant = p; p.slot = slot;
          p.pending = { type: "board", t: rand(1.2, 4), unit: u };
          onboard++;
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

    // 5. Movimiento, animación y visibilidad
    for (const p of this.people) {
      if (p.state === "gone") continue;
      this.move(p, dt);
      this.animate(p, dt);
      if (p.space === "train") p.root.visible = p.unit.group.visible && p.unit !== hideUnit;
    }
    this.people = this.people.filter(p => p.state !== "gone");
  }

  move(p, dt) {
    if (p.path.length) {
      const target = p.path[0], pos = p.root.position;
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const step = p.speed * dt;
      if (dist <= step) {
        pos.set(target.x, target.y, target.z);
        p.path.shift();
        if (!p.path.length) {
          p.pose = "stand";
          const cb = p.onArrive; p.onArrive = null;
          cb?.();
        }
      } else {
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        pos.y = target.y;
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
    switch (p.pose) {
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
