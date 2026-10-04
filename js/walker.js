/* ==========================================================================
   MetroSim — Alpha 0.9 · walker.js
   Modo Pasajero a pie (primera persona).

   Alpha 0.9: la partida empieza en la CALLE de la estación elegida
   (city/city.js). Desde ahí se baja por la boca del acceso a la mezanina,
   y al salir de una estación se aparece en su calle. Espacios del jugador:
   "street" (calle), "world" (estación) y "train" (dentro de un tren).

   Recorrido completo: entras desde la calle a la mezanina, validas en un
   torniquete ("bip!"), bajas por la escalera al andén del sentido que
   quieras, esperas, subes por una puerta abierta, recorres el tren de 5
   coches por la intercirculación, te sientas, bajas, subes a la mezanina y
   sales a la calle.

   Controles (solo teclado, como una persona de verdad): W / ↑ caminar
   hacia adelante · S / ↓ retroceder despacio · A D / ← → girar · Shift
   correr · Re Pág / Av Pág mirar arriba / abajo (la mirada vuelve sola al
   frente al caminar) · F sentarse · E interactuar.
   El cuerpo tiene inercia: acelera y frena de a poco, gira con suavidad,
   la cabeza se balancea con cada paso y se oyen los pasos (evento "step").

   Choques: no se atraviesan columnas, bancos ni a los demás viajeros
   (stationLayout.js y el sistema de viajeros).
   Terminales: el andén de llegada es solo de salida; no se puede bajar a
   él desde la mezanina.

   Tarjeta bip!: al cruzar un torniquete desde la zona no pagada se cobra la
   tarifa del tramo horario; sin saldo, el torniquete no se abre.
   La escalera mecánica solo sube y te lleva aunque no camines.

   Zonas transitables con altura: andenes (y = 1,2), escaleras (rampa),
   mezanina (y = 7,2) con la línea de torniquetes, huecos de puerta y el
   interior del tren (coordenadas locales del tren).
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS } from "./config.js";
import { ROUTES, ROUTE_A, ROUTE_B, routeForSide } from "./engine/route.js";
import { TRAIN_LAYOUT } from "./engine/consist.js";
import { clamp } from "./utils.js";
import { platformSolidAt, isArrivalOnly } from "./stationLayout.js";

const EYE = 1.62;
const WALK = 1.4, RUN = 3.2, BACK = 0.75;        // m/s: caminar, correr, retroceder
const ACCEL = 2.2, DECEL = 4.5;                   // m/s²: arrancar / detenerse
const TURN = 1.7, TURN_RUN = 1.25;                // rad/s de giro (corriendo se gira más abierto)
const LOOK = 0.9;                                 // rad/s al mirar arriba / abajo
const S = CONFIG.station, MZ = CONFIG.mezzanine, F = CONFIG.train.floorY;

export class Walker {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {import("./traffic.js").TrafficManager} opts.traffic
   * @param {object} opts.station  estación inicial (del mundo)
   * @param {(type:string, data?:object)=>void} opts.onEvent
   * @param {() => {ok:boolean}} opts.onValidate  intenta cobrar el pasaje al cruzar un torniquete
   * @param {(st, side:number) => Array} opts.benches  bancos de un andén (compartidos con los viajeros)
   * @param {(x, y, z, fromX, fromZ, unit) => boolean} opts.isCrowded  ¿hay otro viajero en el camino?
   * @param {import("./city/city.js").City} [opts.city]  calle de la estación (modo calle)
   */
  constructor({ scene, camera, traffic, station, onEvent = () => {}, onValidate = () => ({ ok: true }), benches = () => [], isCrowded = () => false, city = null }) {
    this.city = city;
    this.benches = benches;
    this.isCrowded = isCrowded;
    this.scene = scene;
    this.camera = camera;
    this.traffic = traffic;
    this.onEvent = onEvent;
    this.onValidate = onValidate;
    this.frozen = false;                 // true mientras hay un panel abierto (boletería, tótem)
    this.gatePass = false;               // validó en un torniquete y lo está cruzando
    this.deniedT = 0;
    this.keys = new Set();
    this.holder = new THREE.Object3D();
    this.holder.add(camera);
    camera.position.set(0, EYE, 0);
    camera.rotation.order = "YXZ";
    this.tmp = new THREE.Vector3();
    this.enterStation(station);
  }

  /** Entra a la estación desde la calle (mezanina, zona no pagada). */
  enterStation(st) {
    this.leaveSeat();
    if (this.space === "train") this.unit.group.remove(this.holder);
    this.space = "world";
    this.unit = null;
    this.station = st;
    this.scene.add(this.holder);
    this.pos = new THREE.Vector3(0, MZ.y, st.z + MZ.z1 - 1.2);
    this.yaw = 0;                         // mirando hacia los torniquetes (−Z)
    this.pitch = -0.08;
    this.seat = null;
    this.paid = false;
    this.gatePass = false;
  }

  /** Sale a la calle de la estación (la calle ya debe estar construida en this.city). */
  enterStreet(st) {
    this.leaveSeat();
    if (this.space === "train") this.unit.group.remove(this.holder);
    this.space = "street";
    this.unit = null;
    this.station = st;
    this.scene.add(this.holder);
    const sp = this.city.spawn();
    this.pos = new THREE.Vector3(sp.x, sp.y, sp.z);
    this.yaw = sp.yaw;
    this.pitch = 0.02;
    this.seat = null;
    this.paid = false;
    this.gatePass = false;
    this.descending = false;
  }

  /* ----- Entrada ----- */
  /** El pasajero se maneja solo con el teclado (o los controles táctiles): el ratón no mueve la vista. */
  attach(dom) {
    this.dom = dom;
    this.speed = 0;          // velocidad actual hacia adelante (m/s, negativa al retroceder)
    this.turnRate = 0;       // giro actual (rad/s)
    this.stepPhase = 0;
    this.sway = 0;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  detach() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  keyDown(key) {
    this.keys.add(key);
    if (key === "f") return this.toggleSeat();
    if (key === "e") return this.interact();
    return null;
  }
  keyUp(key) { this.keys.delete(key); }

  /* ----- Consultas ----- */

  /** Estación cuyo vestíbulo contiene la coordenada z (o null). */
  stationAt(z) {
    return STATIONS.find(st => Math.abs(z - st.z) <= S.hallHalf) || null;
  }

  /** Lado del andén en el que está (+1 / −1) o 0 si no está en un andén. */
  platformSide() {
    if (this.space !== "world" || Math.abs(this.pos.y - S.platformTop) > 0.3) return 0;
    return Math.sign(this.pos.x);
  }

  /** Tren detenido con puertas abiertas en el andén de un lado. */
  openUnit(st, side) {
    const u = this.traffic.unitDockedAt(st, routeForSide(side));
    return u && u.sim.doorProgress > 0.75 && u.sim.doorState !== "closing" ? u : null;
  }

  get worldPos() {
    if (this.space !== "train") return this.pos;
    return this.unit.group.localToWorld(this.tmp.copy(this.pos));
  }
  get worldZ() { return this.worldPos.z; }

  /* ----- Geometría transitable ----- */

  /**
   * Altura del suelo en (x, z) del mundo, o null si no se puede pisar.
   * @param {number} fromY  altura actual (evita "saltar" entre niveles)
   */
  worldFloor(x, z, fromY) {
    const st = this.stationAt(z);
    if (!st) return null;
    const dz = z - st.z, ax = Math.abs(x), side = Math.sign(x) || 1;
    const candidates = [];

    // Andenes (salvo la huella de la escalera)
    const onStairFoot = ax >= MZ.escX0 - 0.05 && dz >= MZ.stairZ0 && dz <= MZ.stairZ1;
    if (ax >= S.platformEdgeX + 0.3 && ax <= S.wallX - 0.35 && Math.abs(dz) <= S.platformHalf - 0.3 && !onStairFoot && !platformSolidAt(x, dz)) candidates.push(S.platformTop);

    // Hueco de puerta del tren detenido con puertas abiertas
    if (Math.abs(dz) <= S.platformHalf && ax >= S.trackX + 1.0 && ax < S.platformEdgeX + 0.3) {
      const u = this.openUnit(st, side);
      if (u && this.traffic.doorAtWorldZ(u, z) !== null) candidates.push(S.platformTop);
    }

    // Escalera fija y escalera mecánica (rampas del andén a la mezanina)
    const onStairs = ax >= MZ.stairX0 + 0.05 && ax <= MZ.stairX1 - 0.05;
    const onEsc = ax >= MZ.escX0 + 0.2 && ax <= MZ.escX1 - 0.2;
    const goingDown = fromY >= MZ.y - 0.01 && isArrivalOnly(st, side);     // andén de llegada de una terminal: solo se sube
    if ((onStairs || onEsc) && dz >= MZ.stairZ0 - 0.2 && dz <= MZ.stairZ1 + 0.2 && !goingDown) {
      const t = clamp((dz - MZ.stairZ0) / (MZ.stairZ1 - MZ.stairZ0), 0, 1);
      candidates.push(S.platformTop + t * (MZ.y - S.platformTop));
    }

    // Mezanina
    if (ax <= S.wallX - 0.3 && dz >= MZ.z0 && dz <= MZ.z1 - 0.35) {
      const nearGates = Math.abs(dz - MZ.gateZ) < 0.65;
      const inGate = MZ.gates.some(g => Math.abs(x - g) < MZ.gateHalf - 0.05);
      const B = MZ.booth;
      const inBooth = x < B.x1 + 0.1 && dz > B.z0 - 0.15 && dz < B.z1 + 0.1;
      const inTotem = MZ.totems.some(t => Math.abs(x - t) < 0.45) && Math.abs(dz - MZ.totemZ) < 0.32;
      let gateOk = !nearGates;
      if (nearGates && inGate) gateOk = this.paid || this.gatePass || this.tryValidate();
      if (gateOk && !inBooth && !inTotem) candidates.push(MZ.y);
    }
    // Umbral de la salida a la calle
    if (Math.abs(x) < MZ.exitHalf - 0.2 && dz > MZ.z1 - 0.4 && dz < MZ.z1 + 0.3) candidates.push(MZ.y);

    // Se elige el nivel más cercano a la altura actual, si es alcanzable
    let best = null;
    for (const y of candidates) if (Math.abs(y - fromY) < 0.45 && (best === null || Math.abs(y - fromY) < Math.abs(best - fromY))) best = y;
    return best;
  }

  /** Intenta validar la tarjeta al entrar en un paso de torniquete desde la zona no pagada. */
  tryValidate() {
    if (this.deniedT > 0) return false;
    const r = this.onValidate();
    if (r.ok) { this.gatePass = true; return true; }
    this.deniedT = 1.5;                  // no se reintenta en cada fotograma
    return false;
  }

  /** ¿Se puede estar en (x, z) dentro del tren (coordenadas locales)? */
  trainWalkable(x, z) {
    const [a0, a1] = TRAIN_LAYOUT.aisle;
    if (z < a0 || z > a1) return false;
    const inGangway = TRAIN_LAYOUT.gangways.some(([g0, g1]) => z > g0 && z < g1);
    if (inGangway) return Math.abs(x) <= 0.5;
    if (Math.abs(x) <= 0.8) return true;
    const nearDoor = TRAIN_LAYOUT.doors.some(d => Math.abs(z - d) < 0.6);
    if (!nearDoor) return false;
    if (Math.abs(x) <= 1.32) return true;
    // Salida al andén (lado +X local) con el tren en una estación y puertas abiertas
    const sim = this.unit.sim;
    return x > 0 && x < 1.75 && !!sim.dockedStation() && sim.doorProgress > 0.75 && sim.doorState !== "closing";
  }

  /* ----- Acciones ----- */
  /**
   * Sentarse o levantarse. this.seat = { place, seatY, stand }:
   *   place  plaza ocupada (asiento del tren o sitio de un banco, con .occupant)
   *   seatY  altura del asiento · stand  dónde queda al levantarse
   */
  toggleSeat() {
    if (this.seat) { this.leaveSeat(); return { text: "Te levantas", level: "info" }; }
    if (this.space === "street") return { text: "Estás en la calle: los bancos para esperar el tren están en los andenes", level: "info" };
    return this.space === "train" ? this.sitInTrain() : this.sitOnBench();
  }

  sitInTrain() {
    const free = this.unit.slots
      .filter(s => s.type === "seat" && !s.occupant)
      .map(s => ({ s, d: Math.hypot(s.approach.x - this.pos.x, s.approach.z - this.pos.z) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!free || free.d > 1.2) return { text: "No hay ningún asiento libre a tu lado", level: "info" };
    const slot = free.s;
    slot.occupant = "player";
    this.seat = { place: slot, seatY: slot.seatY, stand: slot.approach.clone() };
    this.pos.set(slot.pos.x * 0.95, F, slot.pos.z);
    this.yaw = slot.yaw + Math.PI;
    return { text: "Te sientas · F para levantarte", level: "ok" };
  }

  /** Banco del andén: te sientas mirando a la vía mientras esperas el tren. */
  sitOnBench() {
    const side = this.platformSide();
    const st = side ? this.stationAt(this.pos.z) : null;
    if (!st) return { text: "Aquí no hay asientos: los bancos están en los andenes, junto al muro", level: "info" };
    const free = this.benches(st, side)
      .filter(b => !b.occupant)
      .map(b => ({ b, d: Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z) }))
      .sort((a, c) => a.d - c.d)[0];
    if (!free || free.d > 1.8) return { text: "Acércate a un banco libre (junto al muro del andén) para sentarte", level: "info" };
    const spot = free.b;
    spot.occupant = "player";
    this.seat = { place: spot, seatY: spot.seatY, stand: new THREE.Vector3(side * 7.15, S.platformTop, spot.pos.z) };
    this.pos.set(side * 7.75, S.platformTop, spot.pos.z);
    this.yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;           // mirando a la vía
    this.pitch = -0.05;
    return { text: "Te sientas en el banco · F para levantarte cuando llegue el tren", level: "ok" };
  }

  leaveSeat() {
    if (!this.seat) return;
    if (this.seat.place.occupant === "player") this.seat.place.occupant = null;
    this.pos.copy(this.seat.stand);
    this.seat = null;
  }

  /** Junto a la salida a la calle. */
  nearExit() {
    if (this.space !== "world" || Math.abs(this.pos.y - MZ.y) > 0.3) return null;
    const st = this.stationAt(this.pos.z);
    if (!st) return null;
    return Math.abs(this.pos.x) < MZ.exitHalf + 0.5 && this.pos.z - st.z > MZ.z1 - 2.2 ? st : null;
  }

  /** Qué hay al alcance en la mezanina: ventanilla de boletería, tótem o salida. */
  nearService() {
    if (this.space !== "world" || Math.abs(this.pos.y - MZ.y) > 0.3 || this.paid) return null;
    const st = this.stationAt(this.pos.z);
    if (!st) return null;
    const dz = this.pos.z - st.z, B = MZ.booth;
    if (this.pos.x < B.x1 + 1.3 && Math.abs(dz - B.windowZ) < 1.0) return { kind: "boleteria", station: st };
    if (MZ.totems.some(t => Math.abs(this.pos.x - t) < 0.7) && Math.abs(dz - MZ.totemZ) < 1.3) return { kind: "totem", station: st };
    return null;
  }

  interact() {
    if (this.space === "street") {
      const target = this.city.nearest(this.pos);
      if (!target) return { text: "Acércate a la puerta de un local, al acceso del Metro o al hito de enfrente", level: "info" };
      this.onEvent("street", target);
      return null;
    }
    const service = this.nearService();
    if (service) { this.onEvent("service", service); return null; }
    const st = this.nearExit();
    if (!st) return { text: "Acércate a la boletería, a un tótem de carga o a la salida (en la mezanina)", level: "info" };
    if (this.paid) return { text: "Primero cruza los torniquetes para salir", level: "info" };
    this.onEvent("exit", { station: st });
    return null;
  }

  /* ----- Cambios de espacio ----- */
  enterTrain(unit) {
    unit.group.updateMatrixWorld(true);
    unit.group.worldToLocal(this.pos);
    this.pos.y = F;
    this.yaw -= unit.group.rotation.y;
    this.space = "train";
    this.unit = unit;
    unit.group.add(this.holder);
    this.onEvent("boarded", { unit });
  }

  exitTrain() {
    const unit = this.unit;
    unit.group.updateMatrixWorld(true);
    unit.group.localToWorld(this.pos);
    this.pos.y = S.platformTop;
    this.yaw += unit.group.rotation.y;
    this.space = "world";
    this.unit = null;
    this.scene.add(this.holder);
    this.onEvent("alighted", { unit, station: this.stationAt(this.pos.z) });
  }

  /* ----- Paso por fotograma ----- */
  update(dt) {
    this.deniedT = Math.max(0, this.deniedT - dt);
    if (!this.seat && dt > 0 && !this.frozen) this.move(dt);
    if (this.seat || this.frozen) { this.speed = 0; this.turnRate = 0; this.moving = false; }   // sentado o en un panel: quieto

    // En la calle: solo caminar; al pisar la boca del acceso se baja a la estación
    if (this.space === "street") {
      this.pos.y = this.city.floorAt(this.pos.x);
      if (this.moving && !this.descending && this.city.atAccessMouth(this.pos)) { this.descending = true; this.onEvent("street", { kind: "access" }); }
      this.updateCamera();
      return;
    }

    // Escalera mecánica: avanza (y sube) sola
    if (this.space === "world" && dt > 0) {
      const st = this.stationAt(this.pos.z);
      const ax = Math.abs(this.pos.x), dz = st ? this.pos.z - st.z : -1e9;
      if (st && ax >= MZ.escX0 + 0.2 && ax <= MZ.escX1 - 0.2 && dz >= MZ.stairZ0 - 0.2 && dz < MZ.stairZ1 + 0.15) {
        const nz = this.pos.z + MZ.escSpeed * dt;
        const fy = this.worldFloor(this.pos.x, nz, this.pos.y);
        if (fy !== null) { this.pos.z = nz; this.pos.y = fy; }
      }
    }

    // Si se cierran las puertas con el jugador en el umbral, queda del lado del andén
    if (this.space === "world" && Math.abs(this.pos.y - S.platformTop) < 0.3 && Math.abs(this.pos.x) < S.platformEdgeX + 0.3
        && this.worldFloor(this.pos.x, this.pos.z, this.pos.y) === null) {
      this.pos.x = Math.sign(this.pos.x || 1) * (S.platformEdgeX + 0.35);
    }
    if (this.space === "train" && Math.abs(this.pos.x) > 1.32 && !this.trainWalkable(this.pos.x, this.pos.z)) {
      this.pos.x = Math.sign(this.pos.x) * 1.3;
    }

    // Transiciones andén ↔ tren
    if (this.space === "world" && Math.abs(this.pos.y - S.platformTop) < 0.3 && Math.abs(this.pos.x) < S.trackX + 1.42) {
      const st = this.stationAt(this.pos.z);
      const u = st && this.openUnit(st, Math.sign(this.pos.x));
      if (u) this.enterTrain(u);
    } else if (this.space === "train" && this.pos.x > 1.45) {
      this.exitTrain();
    }

    // Torniquetes: zona pagada (z < línea) / no pagada
    if (this.space === "world" && Math.abs(this.pos.y - MZ.y) < 0.3) {
      const st = this.stationAt(this.pos.z);
      if (st) {
        const paid = this.pos.z - st.z < MZ.gateZ;
        if (paid !== this.paid) { this.paid = paid; this.gatePass = false; this.onEvent(paid ? "gateIn" : "gateOut", { station: st }); }
        // Si retrocede sin cruzar, el pase validado se conserva (como en la realidad, ya se cobró)
        if (this.moving && this.pos.z - st.z > MZ.z1 - 0.1 && !paid) this.onEvent("exit", { station: st });
      }
    }

    this.updateCamera();
  }

  updateCamera() {
    this.holder.position.copy(this.pos);
    if (this.seat) this.holder.position.y = this.seat.seatY - 0.62;
    // Balanceo de la cabeza: sube y baja con cada paso y se mece de lado a lado
    const amp = Math.min(1, Math.abs(this.speed || 0) / WALK);
    const bob = Math.abs(Math.sin(this.stepPhase || 0)) * 0.045 * amp;
    const side = Math.cos(this.stepPhase || 0) * 0.025 * amp;
    this.camera.position.set(side * Math.cos(this.yaw), EYE - 0.02 * amp + bob, -side * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch, this.yaw, (this.sway || 0) + side * 0.15);
  }

  move(dt) {
    const k = this.keys;
    let f = 0, turn = 0;
    if (k.has("w") || k.has("arrowup")) f += 1;
    if (k.has("s") || k.has("arrowdown")) f -= 1;
    if (k.has("d") || k.has("arrowright")) turn -= 1;
    if (k.has("a") || k.has("arrowleft")) turn += 1;
    const running = k.has("shift") && f > 0;

    // Velocidad con inercia: acelera y frena de a poco
    const target = f > 0 ? (running ? RUN : WALK) : f < 0 ? -BACK : 0;
    const rate = Math.abs(target) > Math.abs(this.speed) && Math.sign(target || 1) === Math.sign(this.speed || target || 1) ? ACCEL : DECEL;
    this.speed += Math.max(-rate * dt, Math.min(rate * dt, target - this.speed));
    if (Math.abs(this.speed) < 0.02 && !target) this.speed = 0;

    // Giro suave (el cuerpo no gira de golpe) y leve inclinación al girar caminando
    const maxTurn = running ? TURN_RUN : TURN;
    this.turnRate += (turn * maxTurn - this.turnRate) * Math.min(1, dt * 6);
    this.yaw += this.turnRate * dt;
    this.sway += (-this.turnRate * Math.min(1, Math.abs(this.speed) / WALK) * 0.03 - this.sway) * Math.min(1, dt * 5);

    // Mirada: Re Pág / Av Pág; al caminar vuelve sola a mirar al frente
    const look = (k.has("pageup") ? 1 : 0) - (k.has("pagedown") ? 1 : 0);
    if (look) this.pitch = clamp(this.pitch + look * LOOK * dt, -1.1, 1.1);
    else if (Math.abs(this.speed) > 0.3) this.pitch += (-0.04 - this.pitch) * Math.min(1, dt * 1.5);

    this.moving = Math.abs(this.speed) > 0.05;
    if (!this.moving) return;

    // Pasos: la cadencia sube con la velocidad; cada medio ciclo suena un paso
    const before = Math.floor((this.stepPhase || 0) / Math.PI);
    this.stepPhase = (this.stepPhase || 0) + dt * (5.2 + Math.abs(this.speed) * 2.6);
    if (Math.floor(this.stepPhase / Math.PI) !== before) this.onEvent("step", { running, space: this.space });

    const dx = -Math.sin(this.yaw) * this.speed * dt;
    const dz = -Math.cos(this.yaw) * this.speed * dt;
    const { x, z, y } = this.pos;

    if (this.space === "street") {
      const tries = [[dx, dz], [dx, 0], [0, dz]];
      for (const [mx, mz] of tries) if (this.city.walkable(x + mx, z + mz)) { this.pos.x += mx; this.pos.z += mz; if (mx !== dx || mz !== dz) this.speed *= 0.9; return; }
      this.speed *= 0.5;
      return;
    }
    const unit = this.space === "train" ? this.unit : null;
    const free = (nx, nz) => !this.isCrowded(nx, y, nz, x, z, unit);      // no se atraviesa a otros viajeros
    if (this.space === "train") {
      if (this.trainWalkable(x + dx, z + dz) && free(x + dx, z + dz)) { this.pos.x += dx; this.pos.z += dz; }
      else if (this.trainWalkable(x + dx, z) && free(x + dx, z)) this.pos.x += dx;
      else if (this.trainWalkable(x, z + dz) && free(x, z + dz)) this.pos.z += dz;
      return;
    }
    const tries = [[dx, dz], [dx, 0], [0, dz]];
    for (const [mx, mz] of tries) {
      const fy = this.worldFloor(x + mx, z + mz, y);
      if (fy !== null && free(x + mx, z + mz)) { this.pos.set(x + mx, fy, z + mz); return; }
    }
  }

  /** Texto de ayuda contextual para el HUD. */
  hint() {
    if (this.space === "street") return this.city.hint(this.pos);
    if (this.seat) return this.space === "train" ? "F levantarse" : "Sentado en el banco · F levantarse para subir al tren";
    if (this.space === "train") {
      const rs = this.unit.sim.dockedStation();
      const open = this.unit.sim.doorState === "open";
      return open && rs ? `Puertas abiertas en ${rs.name} · camina hacia una puerta (lado derecho del pasillo) para bajar · F sentarse` : "F sentarse · puedes recorrer los 5 coches por el pasillo";
    }
    if (Math.abs(this.pos.y - MZ.y) < 0.3) {
      const service = this.nearService();
      if (service?.kind === "boleteria") return "E · atención en boletería (cargar tarjeta bip!, comprar tarjeta)";
      if (service?.kind === "totem") return "E · tótem de autoservicio: carga con tarjeta de débito o crédito";
      if (this.nearExit() && !this.paid) return "E (o sigue caminando) para salir a la calle";
      const here = this.stationAt(this.pos.z);
      const closed = here && [1, -1].find(sd => isArrivalOnly(here, sd));
      if (this.paid && closed) return `Estación terminal · baja por la escalera ${closed > 0 ? "izquierda" : "derecha"} (la otra es solo de salida)`;
      return this.paid
        ? `Zona pagada · escalera izquierda: dir. ${ROUTE_B.last.short} · derecha: dir. ${ROUTE_A.last.short}`
        : "Pasa por un torniquete para validar tu tarjeta bip! · boletería a la izquierda, tótems a la derecha";
    }
    if (this.pos.y > S.platformTop + 0.3) {
      const ax = Math.abs(this.pos.x);
      return ax < MZ.stairX0 ? "Escalera mecánica de subida: te lleva sola" : "Escalera fija entre el andén y la mezanina";
    }
    const side = this.platformSide();
    const st = this.stationAt(this.pos.z);
    if (st && side && this.openUnit(st, side)) return "El tren tiene las puertas abiertas: camina hacia una puerta para subir";
    if (st && side && isArrivalOnly(st, side)) return "Andén de llegada de la terminal: no salen trenes desde aquí · sube a la mezanina para salir";
    return "Espera el tren detrás de la línea amarilla · F sentarse en un banco · escaleras hacia la mezanina";
  }
}

export { ROUTES };
