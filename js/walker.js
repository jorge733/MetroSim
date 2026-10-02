/* ==========================================================================
   MetroSim — Alpha 0.6 · walker.js
   Modo Pasajero a pie (primera persona).

   Recorrido completo: entras desde la calle a la mezanina, validas en un
   torniquete ("bip!"), bajas por la escalera al andén del sentido que
   quieras, esperas, subes por una puerta abierta, recorres el tren de 5
   coches por la intercirculación, te sientas, bajas, subes a la mezanina y
   sales a la calle.

   Controles: W A S D / flechas caminar · Shift correr · ratón mirar
   (clic para capturar, Esc para soltar) · F sentarse · E interactuar
   (boletería, tótem de carga, salida a la calle).

   Tarjeta bip!: al cruzar un torniquete desde la zona no pagada se cobra la
   tarifa del tramo horario; sin saldo, el torniquete no se abre.
   La escalera mecánica solo sube y te lleva aunque no camines.

   Zonas transitables con altura: andenes (y = 1,2), escaleras (rampa),
   mezanina (y = 7,2) con la línea de torniquetes, huecos de puerta y el
   interior del tren (coordenadas locales del tren).
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS } from "./config.js";
import { ROUTES, routeForSide } from "./route.js";
import { TRAIN_LAYOUT } from "./train.js";
import { clamp } from "./utils.js";

const EYE = 1.62;
const WALK = 1.45, RUN = 3.1;
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
   */
  constructor({ scene, camera, traffic, station, onEvent = () => {}, onValidate = () => ({ ok: true }) }) {
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

  /* ----- Entrada ----- */
  attach(dom) {
    this.dom = dom;
    // requestPointerLock puede devolver una promesa rechazada (iframes, permisos): se ignora y queda el arrastre con el ratón
    this.onClick = () => { if (document.pointerLockElement !== dom) dom.requestPointerLock?.()?.catch?.(() => {}); };
    this.onMouse = (ev) => {
      const locked = document.pointerLockElement === dom;
      if (!locked && !(ev.buttons & 1)) return;
      const k = locked ? 0.0022 : 0.004;
      this.yaw -= ev.movementX * k;
      this.pitch = clamp(this.pitch - ev.movementY * k, -1.3, 1.3);
    };
    dom.addEventListener("click", this.onClick);
    dom.addEventListener("mousemove", this.onMouse);
  }

  detach() {
    this.dom?.removeEventListener("click", this.onClick);
    this.dom?.removeEventListener("mousemove", this.onMouse);
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
    if (this.space === "world") return this.pos;
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
    if (ax >= S.platformEdgeX + 0.3 && ax <= S.wallX - 0.35 && Math.abs(dz) <= S.platformHalf - 0.3 && !onStairFoot) candidates.push(S.platformTop);

    // Hueco de puerta del tren detenido con puertas abiertas
    if (Math.abs(dz) <= S.platformHalf && ax >= S.trackX + 1.0 && ax < S.platformEdgeX + 0.3) {
      const u = this.openUnit(st, side);
      if (u && this.traffic.doorAtWorldZ(u, z) !== null) candidates.push(S.platformTop);
    }

    // Escalera fija y escalera mecánica (rampas del andén a la mezanina)
    const onStairs = ax >= MZ.stairX0 + 0.05 && ax <= MZ.stairX1 - 0.05;
    const onEsc = ax >= MZ.escX0 + 0.2 && ax <= MZ.escX1 - 0.2;
    if ((onStairs || onEsc) && dz >= MZ.stairZ0 - 0.2 && dz <= MZ.stairZ1 + 0.2) {
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
  toggleSeat() {
    if (this.seat) { this.leaveSeat(); return { text: "Te levantas", level: "info" }; }
    if (this.space !== "train") return { text: "Aquí no hay asientos libres cerca", level: "info" };
    const free = this.unit.slots
      .filter(s => s.type === "seat" && !s.occupant)
      .map(s => ({ s, d: Math.hypot(s.approach.x - this.pos.x, s.approach.z - this.pos.z) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!free || free.d > 1.2) return { text: "No hay ningún asiento libre a tu lado", level: "info" };
    this.seat = free.s;
    this.seat.occupant = "player";
    this.pos.set(this.seat.pos.x * 0.95, F, this.seat.pos.z);
    this.yaw = this.seat.yaw + Math.PI;
    return { text: "Te sientas · F para levantarte", level: "ok" };
  }

  leaveSeat() {
    if (!this.seat) return;
    if (this.seat.occupant === "player") this.seat.occupant = null;
    this.pos.set(this.seat.approach.x, F, this.seat.approach.z);
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

    // Cámara
    this.holder.position.copy(this.pos);
    if (this.seat) this.holder.position.y = this.seat.seatY - 0.62;
    const bob = this.moving ? Math.sin(this.stepPhase) * 0.025 : 0;
    this.camera.position.set(0, EYE + bob, 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  move(dt) {
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has("w") || k.has("arrowup")) f += 1;
    if (k.has("s") || k.has("arrowdown")) f -= 1;
    if (k.has("d") || k.has("arrowright")) r += 1;
    if (k.has("a") || k.has("arrowleft")) r -= 1;
    this.moving = f !== 0 || r !== 0;
    if (!this.moving) return;
    const speed = (k.has("shift") ? RUN : WALK) * dt / Math.hypot(f, r);
    this.stepPhase = (this.stepPhase || 0) + dt * (k.has("shift") ? 14 : 9);
    const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * r) * speed;
    const dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * r) * speed;
    const { x, z, y } = this.pos;

    if (this.space === "train") {
      if (this.trainWalkable(x + dx, z + dz)) { this.pos.x += dx; this.pos.z += dz; }
      else if (this.trainWalkable(x + dx, z)) this.pos.x += dx;
      else if (this.trainWalkable(x, z + dz)) this.pos.z += dz;
      return;
    }
    const tries = [[dx, dz], [dx, 0], [0, dz]];
    for (const [mx, mz] of tries) {
      const fy = this.worldFloor(x + mx, z + mz, y);
      if (fy !== null) { this.pos.set(x + mx, fy, z + mz); return; }
    }
  }

  /** Texto de ayuda contextual para el HUD. */
  hint() {
    if (this.seat) return "F levantarse";
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
      return this.paid
        ? "Zona pagada · escalera izquierda: dir. Plaza Quilicura · derecha: dir. F. Castillo Velasco"
        : "Pasa por un torniquete para validar tu tarjeta bip! · boletería a la izquierda, tótems a la derecha";
    }
    if (this.pos.y > S.platformTop + 0.3) {
      const ax = Math.abs(this.pos.x);
      return ax < MZ.stairX0 ? "Escalera mecánica de subida: te lleva sola" : "Escalera fija entre el andén y la mezanina";
    }
    const side = this.platformSide();
    const st = this.stationAt(this.pos.z);
    if (st && side && this.openUnit(st, side)) return "El tren tiene las puertas abiertas: camina hacia una puerta para subir";
    return "Espera el tren detrás de la línea amarilla · escalera mecánica y fija hacia la mezanina";
  }
}

export { ROUTES };
