/* ==========================================================================
   RedMoviSim — 1.19 · bus/busPeople.js
   Los pasajeros del bus, en 3D: personas articuladas (las mismas del Metro,
   people.js) en vez de cápsulas de colores.

     · En el paradero: unos sentados en la banca y otros de pie, mirando si
       viene el bus. Cuando el bus se acerca para detenerse se arriman a la
       solera y hacen FILA junto a la puerta delantera.
     · Suben de a uno por la puerta delantera (cada «board» de la simulación)
       y dentro van a un asiento libre o se quedan de pie tomados del pasamanos
       (se van para adelante y para atrás cuando el bus frena o acelera).
     · Bajan por la puerta central o trasera («alight») y se van caminando por
       la vereda. Quien llega corriendo cuando ya se cierran las puertas
       («runner») corre hasta la puerta; si no alcanza, se queda mirando.
     · Hay adultos, estudiantes con mochila, adultos mayores (pelo cano,
       caminan despacio y algo encorvados), niños y gente con bolsas.

     · 1.20: peatones que pasan por las dos veredas y, en los paraderos con
       Metro, parte de los que bajan se van a combinar por el acceso (bajan
       la escalera junto al tótem, busWorld.js · buildMetroAccesses).

   Las CIFRAS (cuántos esperan, cuántos van a bordo) las lleva busSim.js; este
   módulo solo las dibuja (hasta MAX_STOP por paradero y MAX_ON a bordo).
   Todo se pinta con PeopleRenderer: 3 InstancedMesh para todas las personas.
   ========================================================================== */

import * as THREE from "three";
import { createSkeleton, PeopleRenderer } from "../people.js";
import { CURB_X, LANES } from "./busRoute.js";
import { BUS_LENGTH, BUS_WIDTH, makeRng } from "./busSim.js";

const MAX_STOP = 16;             // personas dibujadas por paradero
const MAX_ON = 44;               // personas dibujadas dentro del bus
const VIEW = 230;                // m: más lejos, el paradero no se dibuja
const WALK = 1.25, RUN = 3.6;    // m/s
const LINE_GAP = 0.78;           // m entre una persona y la siguiente en la fila
const SIDEWALK_Y = 0.16, FLOOR_Y = 1.02;
const DOORS = { front: 1.25, mid: 5.6, rear: 9.95 };   // z de las puertas en el bus (origen = frente)
const W2 = BUS_WIDTH / 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** 1.20 · Peatones: cuántos y por dónde caminan (x de la vereda del bus y de la vereda de enfrente). */
const PEDS = 30, PED_X = [CURB_X + 5.95, -19.0, -20.8];

/** Asientos del salón (mismas posiciones que busWorld.buildBus) y lugares para ir de pie. */
function cabinSpots() {
  const seats = [], stand = [];
  for (let z = 2.6; z < BUS_LENGTH - 0.8; z += 1.05) {
    if (Math.abs(z - 5.6) < 1.1) continue;
    for (const x of [-0.78, 0.78]) {
      if (x > 0 && Math.abs(z - 9.95) < 0.8) continue;
      seats.push({ x, z: z + 0.1, seat: true, yaw: Math.PI, taken: null });
    }
  }
  for (let z = 2.0; z < 11.2; z += 0.6) for (const x of [-0.17, 0.17]) stand.push({ x, z, seat: false, yaw: (x > 0 ? 1 : -1) * Math.PI / 2, taken: null });
  for (const [x, z] of [[0.7, 5.0], [0.7, 6.1], [-0.75, 5.1], [-0.75, 6.0], [0.5, 5.55]]) stand.push({ x, z, seat: false, yaw: Math.PI * 0.75, taken: null });
  return { seats, stand };
}

export class BusPeople {
  /**
   * @param {THREE.Scene} scene
   * @param {object} route
   * @param {THREE.Object3D} cabin  grupo de la carrocería del bus (los de adentro son sus hijos)
   * @param {{ride:boolean}} o  ride: el jugador va sentado adelante a la derecha (ese lugar queda libre)
   */
  constructor(scene, route, cabin, { ride = false, accesses = [], taxi = null, bend = null } = {}) {
    this.scene = scene;
    /* 2.3 · La calle dobla (busWorld.js · bendMatrix): la gente camina en el espacio «recto» (x de lado, z = −s)
       y se dobla al dibujarla. Los que van en el vehículo (local) ya siguen la carrocería. */
    this.bend = bend;
    this.bendM = bend ? new THREE.Matrix4() : null;
    /* 2.2 · Taxi: { driver: {x,y,z}, rider: {x,y,z} } posiciones del conductor y del pasajero (asiento de atrás).
       En el taxi nadie se dibuja en el salón del bus (sim.onboard solo sirve para los avisos). */
    this.taxi = taxi;
    this.extras = [];
    this.route = route;
    this.cabin = cabin;
    this.rng = makeRng(route.stops.length * 7919 + route.id.length);
    this.renderer = new PeopleRenderer(scene, MAX_STOP * 5 + MAX_ON + 30 + PEDS);
    // 1.20 · Acceso al Metro de cada paradero que lo tiene (índice del paradero → { x, z, mouthZ, bottomZ })
    this.access = new Map(accesses.map(a => [route.stops.indexOf(a.stop), a]));
    // 1.20 · Peatones por las veredas, en los dos sentidos
    this.peds = Array.from({ length: PEDS }, (_, i) => {
      const p = this.person();
      p.dir = this.rng() < 0.5 ? 1 : -1;
      p.root.position.set(PED_X[i % 3] + (this.rng() - 0.5) * 0.4, SIDEWALK_Y, -route.stops[0].s + 80 - this.rng() * 420);
      p.root.rotation.y = p.dir > 0 ? Math.PI : 0;
      p.pose = "walk";
      return p;
    });
    this.time = 0;
    this.stops = route.stops.map((st, i) => ({ index: i, z: -st.s, crowd: [], spots: this.stopSpots(st), shown: false }));
    this.walkers = [];           // en la calle, de paso (suben, bajan, se van)
    this.onboard = [];           // dentro del bus
    const { seats, stand } = cabinSpots();
    // El asiento del jugador (vista de pasajero, cámara en x 0,7 · z 4,45) y lo que tiene justo adelante quedan libres
    this.seats = ride ? seats.filter(s => !(s.x > 0 && s.z > 2.5 && s.z < 5)) : seats;
    this.stand = ride ? stand.filter(s => !(s.x > 0 && s.z < 5)) : stand;
    // El conductor, con camisa del uniforme, en su asiento con las manos en el volante
    const d = this.person("adulto");
    d.mesh.parts.find(x => x.obj.parent === d.mesh.body && x.kind === "box" && x.obj.scale.y > 0.4)?.color.setHex(0x9fc3e0);
    d.mesh.parts.filter(x => x.obj.parent === d.mesh.armL || x.obj.parent === d.mesh.armR).forEach(x => x.color.setHex(0x9fc3e0));
    d.pose = "drive";
    d.local = true;
    if (taxi) d.root.position.set(taxi.driver.x, taxi.driver.y - d.mesh.legLen, taxi.driver.z);
    else d.root.position.set(-0.75, FLOOR_Y + 0.5 - d.mesh.legLen, 1.32);
    d.root.rotation.y = Math.PI;
    cabin.add(d.root);
    this.driver = d;
  }

  /* ----------------------------- 2.2 · Taxi ----------------------------- */
  /** Alguien en la vereda a la altura `s` que hace señas al taxi. */
  hailer(s, x = CURB_X + 0.75, yaw = -Math.PI / 2) {
    const p = this.person(this.rng() < 0.2 ? "carga" : this.rng() < 0.3 ? "estudiante" : "adulto");
    p.root.position.set(x, SIDEWALK_Y, -s);
    p.root.rotation.y = yaw;                        // mira hacia la calle
    p.pose = "hail";
    this.scene.add(p.root);
    this.extras.push(p);
    return p;
  }
  /** Quita a una persona de los extras (sube al taxi o se va). */
  dropExtra(p) {
    if (!p) return;
    this.extras = this.extras.filter(q => q !== p);
    p.root.parent?.remove(p.root);
  }
  /** Pasajero sentado en el asiento de atrás del taxi (o null para que no haya nadie). */
  taxiRider(on, kind) {
    this.dropExtra(this.rider);
    this.rider = null;
    if (!on) return;
    const p = this.person(kind);
    const r = this.taxi.rider;
    p.root.position.set(r.x, r.y - p.mesh.legLen, r.z);
    p.root.rotation.y = Math.PI;
    p.pose = "sit";
    p.local = true;
    this.cabin.add(p.root);
    this.extras.push(p);
    this.rider = p;
  }
  /** Se baja del taxi por la puerta derecha y se va por la vereda. */
  taxiAlight(sim, kind) {
    const p = this.person(kind);
    // En el espacio recto de la ida (si el taxi va de vuelta, todo se refleja hacia la vereda de enfrente)
    const b = sim.bus, X = (x) => sim.toIdaX(x), z = -sim.toIdaS(b.s - 2.6);
    p.root.position.set(X(b.x + 1.1), SIDEWALK_Y, z);
    p.root.rotation.y = sim.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    p.pose = "walk";
    this.scene.add(p.root);
    const away = Math.random() < 0.5 ? 1 : -1;
    p.path = [V(X(CURB_X + 0.9), SIDEWALK_Y, z), V(X(CURB_X + 1.6 + Math.random() * 2), SIDEWALK_Y, z + away * 30)];
    p.onArrive = () => { p.gone = true; };
    this.walkers.push(p);
  }

  /** En la vista desde la cabina la cámara está en la cabeza del conductor: ahí no se dibuja. */
  showDriver(on) { this.driver.hidden = !on; }

  /* ----------------------------- Personas ----------------------------- */

  /** Crea una persona del tipo dado (aspecto, velocidad y forma de moverse). */
  person(kind = this.randomKind()) {
    const m = createSkeleton();
    const p = { kind, mesh: m, root: m.root, pose: "stand", phase: Math.random() * 6, idle: Math.random() * 6, path: [], speed: WALK * (0.85 + Math.random() * 0.3), hunch: 0, scale: 1 };
    const hair = m.parts.find(x => x.kind === "hair");
    const back = m.parts.some(x => x.obj.position.z < -0.15);
    if (kind === "mayor") {
      hair.color.setHex([0xc9c9c9, 0xe6e6e6, 0x9b9b9b][Math.floor(Math.random() * 3)]);
      p.speed = 0.75 + Math.random() * 0.15;
      p.hunch = 0.14;
    } else if (kind === "nino") {
      p.scale = 0.6;
      m.root.scale.setScalar(0.6);
      p.speed = WALK * 1.05;
    } else if (kind === "estudiante" && !back) {
      this.addPart(m, m.body, [0x1f3d5c, 0x6e1f2a, 0x222222, 0x3f6e46][Math.floor(Math.random() * 4)], 0.3, 0.38, 0.14, 0, m.legLen + 0.32, -0.19);
    } else if (kind === "carga") {
      // Bolsa de la feria o del supermercado en la mano derecha
      const arm = m.parts.find(x => x.obj.parent === m.armR);
      this.addPart(m, m.armR, [0xe8e4d8, 0x2f6f8f, 0xb3242a][Math.floor(Math.random() * 3)], 0.24, 0.3, 0.16, 0, -arm.obj.scale.y - 0.12, 0.02);
      p.speed = 1.0;
    }
    return p;
  }

  addPart(m, parent, hex, sx, sy, sz, x, y, z) {
    const o = new THREE.Object3D();
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    parent.add(o);
    m.parts.push({ obj: o, kind: "box", color: new THREE.Color(hex) });
  }

  randomKind() {
    const r = this.rng();
    return r < 0.55 ? "adulto" : r < 0.75 ? "estudiante" : r < 0.87 ? "mayor" : r < 0.94 ? "carga" : "nino";
  }

  /** Lugares de espera de un paradero (relativos a la marca): 3 en la banca y el resto de pie. */
  stopSpots(st) {
    const rng = makeRng(Math.round(st.s * 13) + 5);
    const spots = [];
    for (const dz of [-1.1, 0, 1.1]) spots.push({ x: CURB_X + 3.08, z: 6 + dz, seat: true, yaw: -Math.PI / 2, y: 0.64 });
    while (spots.length < MAX_STOP) {
      const x = CURB_X + 0.9 + rng() * 1.9, z = -1.5 + rng() * 13;
      if (x > CURB_X + 1.35 && x < CURB_X + 3.8 && z > 3.2 && z < 8.8) continue;             // bajo el refugio: la banca
      if (spots.some(s => Math.hypot(s.x - x, s.z - z) < 0.75)) continue;
      // Miran a la calle o hacia donde viene el bus
      spots.push({ x, z, seat: false, yaw: rng() < 0.55 ? -Math.PI / 2 + (rng() - 0.5) * 0.6 : (rng() - 0.5) * 0.8, y: SIDEWALK_Y });
    }
    return spots;
  }

  /* ----------------------------- Eventos de la simulación ----------------------------- */

  onEvent(e, sim) {
    const stop = this.stops[e.index];
    switch (e.type) {
      case "board": return this.board(stop, sim, e.kind, false);
      case "boardFail": return this.board(stop, sim, e.kind, true);
      case "alight": return this.alight(stop, sim, e.kind, e.door);
      case "runner": return this.runner(stop, sim, e.eta);
      case "runnerArrive": { const r = stop.crowd.find(p => p.runner); if (r) r.runner = false; return; }
      case "runnerMissed": {
        const r = stop.crowd.find(p => p.runner);
        if (!r) return;
        stop.crowd.splice(stop.crowd.indexOf(r), 1);
        r.path = [];
        r.pose = "stand";
        r.leaveAt = this.time + 3;                       // se queda mirando cómo se va el bus
        this.walkers.push(r);
        return;
      }
    }
  }

  /** Puerta delantera del bus en el mundo (o la marca del paradero si el bus aún no llega). */
  doorWorld(sim, stop, which = "front") {
    const b = sim.bus;
    const atStop = Math.abs(-b.s - stop.z) < 12;
    return { x: (atStop ? b.x : LANES[0]) + W2, z: (atStop ? -b.s : stop.z) + DOORS[which] };
  }

  /** Sube el primero de la fila. fail: el validador rechaza la tarjeta y se baja. */
  board(stop, sim, kind, fail) {
    if (!stop) return;
    const head = this.queueOrder(stop, sim)[0];
    const d = this.doorWorld(sim, stop);
    if (!head) return;                                     // el paradero no se estaba dibujando
    stop.crowd.splice(stop.crowd.indexOf(head), 1);
    head.queue = null;
    this.walkers.push(head);
    if (fail) {
      // Pisa el escalón, el validador pita y vuelve a la vereda
      head.path = [V(d.x + 0.15, FLOOR_Y * 0.6, d.z), V(CURB_X + 1.6, SIDEWALK_Y, d.z + 2), V(CURB_X + 1.8, SIDEWALK_Y, d.z + 22)];
      head.onArrive = () => { head.gone = true; };
      return;
    }
    head.path = [V(d.x + 0.25, SIDEWALK_Y, d.z), V(d.x - 0.3, FLOOR_Y, d.z), V(d.x - W2 + 0.1, FLOOR_Y, d.z + 0.35)];
    head.onArrive = () => this.enterCabin(head);
  }

  /** Pasa de la calle al salón: queda como hijo de la carrocería y busca asiento o lugar de pie. */
  enterCabin(p) {
    this.walkers.splice(this.walkers.indexOf(p), 1);
    this.cabin.updateWorldMatrix(true, false);
    if (this.bend) {                                   // del espacio recto al mapa, y de ahí a la carrocería
      p.root.rotation.y += this.bend.heading(-p.root.position.z);
      this.bend.toWorld(p.root.position.x, p.root.position.y, p.root.position.z, p.root.position);
    }
    this.cabin.worldToLocal(p.root.position);
    p.root.rotation.y -= this.cabin.parent?.rotation.y ?? 0;
    this.cabin.add(p.root);
    p.local = true;
    if (this.onboard.length >= MAX_ON) { this.cabin.remove(p.root); return; }
    this.onboard.push(p);
    const spot = this.takeSpot(p);
    if (!spot) return;
    const aisle = V(0, FLOOR_Y, Math.max(1.8, Math.min(spot.z, p.root.position.z + 0.6)));
    p.path = [V(0, FLOOR_Y, p.root.position.z + 0.4), aisle, V(spot.seat ? spot.x * 0.45 : spot.x, FLOOR_Y, spot.z), ...(spot.seat ? [V(spot.x, FLOOR_Y, spot.z)] : [])];
    p.onArrive = () => this.settle(p);
  }

  /** Elige dónde va: los adultos mayores y quien va con bolsas buscan asiento primero; los estudiantes, de pie. */
  takeSpot(p) {
    const free = (l) => l.filter(s => !s.taken);
    const seats = free(this.seats), stand = free(this.stand);
    const prefersSeat = p.kind === "mayor" || p.kind === "carga" || p.kind === "nino" || (p.kind !== "estudiante" && Math.random() < 0.8);
    const list = prefersSeat && seats.length ? seats : stand.length ? stand : seats;
    if (!list.length) return null;
    const spot = list[Math.floor(Math.random() * list.length)];
    spot.taken = p;
    p.spot = spot;
    return spot;
  }

  settle(p) {
    const s = p.spot;
    if (!s) return;
    p.targetYaw = s.yaw;
    if (s.seat) {
      p.pose = "sit";
      p.root.position.set(s.x, FLOOR_Y + 0.52 - p.mesh.legLen * p.scale, s.z);
    } else p.pose = p.kind === "nino" ? "stand" : "hold";
  }

  /** Alguien baja por la puerta central o trasera y se va caminando por la vereda. */
  alight(stop, sim, kind, door) {
    if (!stop) return;
    // De preferencia, alguien del mismo tipo y que vaya cerca de esa puerta
    const dz = DOORS[door] ?? DOORS.rear;
    let p = null, best = Infinity;
    for (const q of this.onboard) {
      const cost = Math.abs(q.root.position.z - dz) + (q.kind === kind ? 0 : 6);
      if (cost < best) { best = cost; p = q; }
    }
    if (p) this.leaveCabin(p);
    else p = this.person(kind);
    this.scene.add(p.root);
    const b = sim.bus, x = b.x, z = -b.s + dz;
    p.root.position.set(x + 0.2, FLOOR_Y, z);
    p.root.rotation.y = -Math.PI / 2;
    p.pose = "walk";
    const away = Math.random() < 0.5 ? 1 : -1;
    const acc = this.access.get(stop.index);
    if (acc && Math.random() < 0.5) {
      // 1.20 · Va a combinar con el Metro: cruza la vereda hasta la boca del acceso y baja la escalera
      p.path = [V(x + W2 + 0.35, SIDEWALK_Y, z), V(CURB_X + 2.2, SIDEWALK_Y, z - 1), V(acc.x, SIDEWALK_Y, acc.mouthZ), V(acc.x, SIDEWALK_Y - 1.5, acc.z), V(acc.x, SIDEWALK_Y - 2.9, acc.bottomZ)];
    } else p.path = [V(x + W2 + 0.35, SIDEWALK_Y, z), V(CURB_X + 1.2 + Math.random() * 1.8, SIDEWALK_Y, z + away * (2 + Math.random() * 3)), V(CURB_X + 1.5 + Math.random() * 2.5, SIDEWALK_Y, z + away * (28 + Math.random() * 12))];
    p.onArrive = () => { p.gone = true; };
    this.walkers.push(p);
  }

  leaveCabin(p) {
    this.onboard.splice(this.onboard.indexOf(p), 1);
    if (p.spot) p.spot.taken = null;
    p.spot = null;
    this.cabin.remove(p.root);
    p.local = false;
  }

  /** Alguien llega corriendo cuando ya terminaron de subir: corre hasta la puerta delantera. */
  runner(stop, sim, eta) {
    if (!stop?.shown) return;
    const d = this.doorWorld(sim, stop);
    const p = this.person(this.rng() < 0.6 ? "estudiante" : "adulto");
    p.runner = true;
    p.speed = RUN;
    const from = d.z + 3 + RUN * eta;
    p.root.position.set(CURB_X + 1.6, SIDEWALK_Y, from);
    p.root.rotation.y = Math.PI;
    this.scene.add(p.root);
    p.queue = 0;
    p.path = [V(CURB_X + 0.55, SIDEWALK_Y, d.z + 0.7)];
    p.onArrive = () => { p.pose = "stand"; p.speed = WALK; p.targetYaw = -Math.PI / 2; };
    stop.crowd.unshift(p);
  }

  /* ----------------------------- Paraderos ----------------------------- */

  /**
   * 1.19.1 · La fila: el orden se decide UNA vez, cuando se forma (primero los que estaban más cerca de la
   * señal del paradero) y después solo se agregan los que llegan, al final. Así nadie se cuela ni se reordena.
   */
  queueOrder(stop, sim) {
    if (stop.line) return stop.line.filter(p => stop.crowd.includes(p));
    const d = this.doorWorld(sim, stop);
    return stop.crowd.filter(p => !p.runner || p.arrived).sort((a, b) => Math.hypot(a.root.position.x - d.x, a.root.position.z - d.z) - Math.hypot(b.root.position.x - d.x, b.root.position.z - d.z));
  }

  /** Puesto k de la fila: una sola hilera junto a la solera, detrás de la señal del paradero (puerta delantera). */
  lineSlot(stop, k, p) {
    p.qjit ??= (this.rng() - 0.5) * 0.12;            // nadie queda perfectamente alineado
    return V(CURB_X + 0.62 + p.qjit, SIDEWALK_Y, stop.z + DOORS.front + 0.65 + k * LINE_GAP);
  }

  updateStop(stop, sim, dt) {
    const S = sim.idaS ?? sim.bus.s;                  // 2.3 · posición en el recorrido dibujado (el taxi puede ir de vuelta)
    const near = Math.abs(stop.z + S) < VIEW && (sim.dir < 0 || stop.z < -S + 70);
    const want = near ? Math.min(MAX_STOP, sim.waiting[stop.index]) : 0;
    // Quien llegó corriendo ya cuenta como uno que espera (runnerArrive) y no hay que dibujarlo dos veces
    const counted = stop.crowd.filter(p => !p.runner);
    const serving = sim.serving?.index === stop.index;
    while (counted.length > want) {                    // subieron fuera de cámara o se dejó de dibujar
      const p = counted.pop();
      stop.crowd.splice(stop.crowd.indexOf(p), 1);
      this.scene.remove(p.root);
    }
    while (counted.length < want) {
      const free = stop.spots.filter(s => !stop.crowd.some(p => p.spot === s));
      const spot = free[0] ? (stop.shown ? free[Math.floor(this.rng() * free.length)] : free[0]) : stop.spots[counted.length % stop.spots.length];
      const p = this.person();
      p.spot = spot;
      this.scene.add(p.root);
      if (!stop.shown || serving) {
        // Al aparecer el paradero (o atrás de la fila mientras suben): ya está ahí
        this.placeAt(p, spot, stop);
      } else {
        // Va llegando por la vereda
        const dir = this.rng() < 0.5 ? 1 : -1;
        p.root.position.set(CURB_X + 1.4 + this.rng() * 2.5, SIDEWALK_Y, stop.z + spot.z + dir * (24 + this.rng() * 10));
        p.path = [V(CURB_X + spot.x - CURB_X, SIDEWALK_Y, stop.z + spot.z)];
        p.onArrive = () => this.placeAt(p, spot, stop);
      }
      stop.crowd.push(p);
      counted.push(p);
    }
    stop.shown = near;
    if (!near) return;

    // ¿El bus viene a detenerse aquí? Entonces se arriman a la solera y hacen fila junto a la puerta delantera
    const b = sim.bus;
    const coming = serving || (!this.taxi && sim.stopIndex === stop.index && sim.bus.doors === "closed" && -b.s - stop.z < 45 && -b.s - stop.z > -4 && b.v < 9 && sim.waiting[stop.index] > 0);
    if (coming) {
      // La fila se forma una vez; los que llegan después (o el que llegó corriendo) se ponen al final
      stop.line = this.queueOrder(stop, sim);
      for (const p of stop.crowd) if (!stop.line.includes(p) && (!p.runner || p.arrived)) stop.line.push(p);
      stop.line.forEach((p, k) => {
        if (p.queue === k && (p.path.length || p.pose !== "sit")) return;   // ya va a su puesto o está en él
        const target = this.lineSlot(stop, k, p);
        const pos = p.root.position;
        if (p.pose === "sit") { p.pose = "stand"; pos.y = SIDEWALK_Y; }
        // Para entrar a la fila se acerca por el lado de la vereda (no camina entre los que ya están formados);
        // para avanzar un puesto, da un paso adelante
        const far = p.queue == null && Math.hypot(pos.x - target.x, pos.z - target.z) > 1.2;
        p.path = far ? [V(target.x + 0.9, SIDEWALK_Y, target.z), target] : [target];
        p.speed = Math.min(p.speed, p.queue == null ? WALK : 0.9);
        p.queue = k;
        p.onArrive = () => { p.pose = "stand"; p.targetYaw = Math.PI + (this.rng() - 0.5) * 0.25; };
      });
    } else {
      stop.line = null;
      // El bus se fue o no para aquí: vuelven a su lugar (sin apuro)
      for (const p of stop.crowd) {
        if (p.queue == null) continue;
        p.queue = null;
        if (p.kind === "mayor") p.speed = 0.75 + this.rng() * 0.15; else if (!p.runner) p.speed = WALK * (0.85 + this.rng() * 0.3);
        if (!p.spot) continue;
        p.path = [V(p.spot.x, SIDEWALK_Y, stop.z + p.spot.z)];
        p.onArrive = () => this.placeAt(p, p.spot, stop);
      }
    }
    for (const p of stop.crowd) if (p.runner && !p.path.length) p.arrived = true;
  }

  placeAt(p, spot, stop) {
    p.root.position.set(spot.x + (spot.seat ? 0.12 : 0), spot.seat ? spot.y + 0.04 - p.mesh.legLen * p.scale : SIDEWALK_Y, stop.z + spot.z);
    p.root.rotation.y = spot.yaw;
    p.targetYaw = spot.yaw;
    p.pose = spot.seat ? "sit" : "stand";
  }

  /* ----------------------------- Cada fotograma ----------------------------- */

  update(sim, dt) {
    this.time += dt;
    for (const st of this.stops) this.updateStop(st, sim, dt);

    // A bordo: tantos como lleva la simulación (hasta MAX_ON). Los que faltan (p. ej. al subir en un paradero
    // que no se dibujaba) aparecen en su lugar; los que sobran se quitan.
    const boarding = this.walkers.filter(p => p.onArrive && !p.gone && p.path.length && p.path.at(-1).y === FLOOR_Y && !p.leaving).length;
    const want = this.taxi ? 0 : Math.min(MAX_ON, sim.onboard.length);
    while (this.onboard.length + boarding < want) {
      const p = this.person();
      const spot = this.takeSpot(p);
      if (!spot) break;
      this.cabin.add(p.root);
      p.local = true;
      this.onboard.push(p);
      p.root.position.set(spot.x, FLOOR_Y, spot.z);
      p.root.rotation.y = spot.yaw;
      this.settle(p);
    }
    while (this.onboard.length > want) this.leaveCabin(this.onboard.at(-1));

    // 1.20 · Peatones: caminan por su vereda y vuelven a aparecer adelante o atrás del bus
    const zBus = -sim.idaS;
    for (const p of this.peds) {
      p.root.position.z -= p.dir * p.speed * dt;
      if (p.root.position.z > zBus + 120) p.root.position.z -= 420;
      else if (p.root.position.z < zBus - 300) p.root.position.z += 420;
    }
    const all = [...this.walkers, ...this.onboard, this.driver, ...this.peds, ...this.extras];
    for (const st of this.stops) if (st.shown) all.push(...st.crowd);
    for (const p of all) {
      if (p.leaveAt && this.time > p.leaveAt) {
        p.leaveAt = null;
        p.path = [V(CURB_X + 2.2, SIDEWALK_Y, p.root.position.z + 18)];
        p.onArrive = () => { p.gone = true; };
      }
      this.move(p, dt);
      this.animate(p, dt, sim);
    }
    // Los que ya se fueron
    this.walkers = this.walkers.filter(p => {
      if (!p.gone && Math.abs(p.root.position.z + sim.idaS) < VIEW + 60) return true;
      this.scene.remove(p.root);
      return false;
    });
    this.cabin.updateWorldMatrix(true, false);
    this.renderer.render(all.filter(p => !p.gone && !p.hidden), this.bend ? (p) => p.local ? null : this.bend.bendMatrix(-p.root.position.z, this.bendM) : null);
  }

  move(p, dt) {
    if (p.path.length) {
      const pos = p.root.position, target = p.path[0];
      const dx = target.x - pos.x, dz = target.z - pos.z, dist = Math.hypot(dx, dz);
      if (p.pose === "sit" || p.pose === "hold") pos.y = p.local ? FLOOR_Y : SIDEWALK_Y;
      p.pose = p.speed > 2.5 ? "run" : "walk";
      const step = p.speed * dt;
      if (dist <= step) {
        pos.copy(target);
        p.path.shift();
        if (!p.path.length) {
          p.pose = "stand";
          const cb = p.onArrive; p.onArrive = null;
          cb?.();
        }
      } else {
        pos.y += (target.y - pos.y) * Math.min(1, step / dist);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        p.targetYaw = Math.atan2(dx, dz);
      }
    }
    if (p.targetYaw !== undefined) {
      const diff = wrapAngle(p.targetYaw - p.root.rotation.y);
      p.root.rotation.y += Math.max(-6 * dt, Math.min(6 * dt, diff));
    }
  }

  animate(p, dt, sim) {
    const m = p.mesh;
    const ease = Math.min(1, dt * 10);
    const to = (o, x) => { o.rotation.x += (x - o.rotation.x) * ease; };
    m.body.rotation.set(p.hunch, 0, 0);
    switch (p.pose) {
      case "walk":
      case "run": {
        const run = p.pose === "run";
        p.phase += dt * p.speed * (run ? 3.4 : 5.4);
        const s = Math.sin(p.phase), amp = run ? 0.95 : 0.5;
        m.hipL.rotation.x = s * amp; m.hipR.rotation.x = -s * amp;
        m.kneeL.rotation.x = Math.max(0, -s) * (run ? 1.4 : 0.75); m.kneeR.rotation.x = Math.max(0, s) * (run ? 1.4 : 0.75);
        const arm = p.kind === "carga" ? 0.12 : run ? 0.9 : 0.4;
        m.armL.rotation.x = -s * arm; m.armR.rotation.x = p.kind === "carga" ? 0.05 : s * arm;
        m.body.position.y = Math.abs(Math.cos(p.phase)) * (run ? 0.06 : 0.025);
        if (run) m.body.rotation.x = 0.18;
        break;
      }
      case "drive":
        to(m.hipL, -Math.PI / 2 + 0.15); to(m.hipR, -Math.PI / 2 + 0.15);
        to(m.kneeL, Math.PI / 2 - 0.1); to(m.kneeR, Math.PI / 2 - 0.1);
        to(m.armL, -1.05); to(m.armR, -1.05);
        m.body.position.y = 0;
        break;
      case "hail": {
        // 2.2 · Hace señas al taxi: brazo derecho arriba, moviéndolo
        to(m.hipL, 0); to(m.hipR, 0); to(m.kneeL, 0); to(m.kneeR, 0);
        m.armR.rotation.x = -2.7 + Math.sin(this.time * 5 + p.idle) * 0.25;
        to(m.armL, 0.05);
        m.body.position.y = 0;
        break;
      }
      case "sit":
        to(m.hipL, -Math.PI / 2); to(m.hipR, -Math.PI / 2);
        to(m.kneeL, Math.PI / 2); to(m.kneeR, Math.PI / 2);
        to(m.armL, -0.55); to(m.armR, -0.55);
        m.body.position.y = 0;
        break;
      case "hold": {
        // De pie en el bus, tomado del pasamanos: se balancea con las frenadas y aceleraciones
        to(m.hipL, 0); to(m.hipR, 0); to(m.kneeL, 0); to(m.kneeR, 0);
        to(m.armR, -2.95);
        to(m.armL, Math.sin(this.time * 0.8 + p.idle) * 0.05);
        const a = Math.max(-3, Math.min(3, sim.bus.accel));
        p.lean = (p.lean ?? 0) + (-a * 0.035 - (p.lean ?? 0)) * Math.min(1, dt * 3);
        // El bus avanza hacia −z; la persona mira de lado (yaw ±π/2): la inclinación va hacia el frente del bus
        m.body.rotation.z = p.lean * Math.sin(p.root.rotation.y);
        m.body.rotation.x += p.lean * -Math.cos(p.root.rotation.y);
        m.body.position.y = 0;
        break;
      }
      default: {
        to(m.hipL, 0); to(m.hipR, 0); to(m.kneeL, 0); to(m.kneeR, 0);
        const idle = Math.sin(this.time * 0.9 + p.idle);
        // Algunos miran el celular mientras esperan
        if (!p.local && p.idle > 3.5) { to(m.armR, -1.2); to(m.armL, idle * 0.04); }
        else { to(m.armL, idle * 0.04); to(m.armR, p.kind === "carga" ? 0.05 : -idle * 0.04); }
        m.body.rotation.z = idle * 0.015;
        m.body.position.y = 0;
      }
    }
  }
}
