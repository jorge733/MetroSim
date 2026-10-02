/* ==========================================================================
   MetroSim — Alpha 0.4 · walker.js
   Modo Pasajero a pie: el jugador camina en primera persona por el andén,
   espera el tren, sube por una puerta abierta, viaja (de pie o sentado),
   baja en la estación que quiera y sale por un acceso.

   Controles: W A S D / flechas caminar · Shift correr · ratón mirar
   (clic para capturar el ratón, Esc para soltarlo) · F sentarse/levantarse
   · E salir de la estación junto a un acceso.

   El jugador vive en dos espacios, igual que los viajeros NPC:
     · "world": andén (coordenadas del mundo)
     · "train": dentro de un tren (coordenadas locales del tren; se mueve con él)
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS } from "./config.js";
import { clamp } from "./utils.js";

const EYE = 1.62;           // altura de los ojos sobre el suelo
const WALK = 1.45, RUN = 3.1;

export class Walker {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {import("./traffic.js").TrafficManager} opts.traffic
   * @param {object} opts.station  estación inicial
   * @param {(type:string, data?:object)=>void} opts.onEvent
   */
  constructor({ scene, camera, traffic, station, onEvent = () => {} }) {
    this.scene = scene;
    this.camera = camera;
    this.traffic = traffic;
    this.onEvent = onEvent;
    this.keys = new Set();
    this.holder = new THREE.Object3D();     // "cuerpo" del jugador; la cámara va a la altura de los ojos
    this.holder.add(camera);
    camera.position.set(0, EYE, 0);
    camera.rotation.order = "YXZ";
    this.placeOnPlatform(station);
    this.trip = { boardedAt: null, boardedClock: null, rode: [] };
  }

  /** Coloca al jugador de pie en el andén derecho, mirando a la vía. */
  placeOnPlatform(st) {
    this.leaveSeat();
    this.space = "world";
    this.unit = null;
    this.station = st;
    this.scene.add(this.holder);
    this.pos = new THREE.Vector3(4.2, CONFIG.station.platformTop, st.stopZ + 9);
    this.yaw = Math.PI / 2;                 // mirando hacia -X (la vía)
    this.pitch = -0.05;
    this.seat = null;
  }

  /* ----- Entrada ----- */
  attach(dom) {
    this.dom = dom;
    this.onClick = () => { if (document.pointerLockElement !== dom) dom.requestPointerLock?.(); };
    this.onMouse = (ev) => {
      const locked = document.pointerLockElement === dom;
      if (!locked && !(ev.buttons & 1)) return;           // sin captura: arrastrar con el botón
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
    if (key === "e") return this.tryExit();
    return null;
  }
  keyUp(key) { this.keys.delete(key); }

  /* ----- Geometría transitable ----- */

  /** Estación en cuyo andén está una coordenada z (o null). */
  stationAt(z) {
    return STATIONS.find(st => Math.abs(z - st.z) <= CONFIG.station.platformHalf - 0.3) || null;
  }

  /** Tren detenido con puertas abiertas en una estación. */
  openUnitAt(st) {
    const u = this.traffic.unitDockedAt(st);
    return u && u.sim.doorProgress > 0.75 && u.sim.doorState !== "closing" ? u : null;
  }

  /** ¿Se puede estar en (x, z) del andén? */
  worldWalkable(x, z) {
    const S = CONFIG.station;
    const st = this.stationAt(z);
    if (!st) return false;
    const ax = Math.abs(x);
    if (ax >= S.platformEdgeX + 0.3 && ax <= S.wallX - 0.35) return true;
    // Hueco de puerta: del borde del andén al interior del tren
    const u = this.openUnitAt(st);
    if (u && ax >= 1.0 && ax < S.platformEdgeX + 0.3) {
      return CONFIG.train.doorCenters.some(zc => Math.abs(z - (u.sim.position + zc)) < 0.55);
    }
    // Entrada del pasillo de acceso
    if (ax > S.wallX - 0.35 && ax < S.wallX + 0.4) return [-1, 1].some(e => Math.abs(z - (st.z + e * S.accessZ)) < 0.9);
    return false;
  }

  /** ¿Se puede estar en (x, z) dentro del tren (coordenadas locales)? */
  trainWalkable(x, z) {
    const ax = Math.abs(x);
    if (z < 2.95 || z > 17.75) return false;
    if (ax <= 0.8) return true;
    const nearDoor = CONFIG.train.doorCenters.some(zc => Math.abs(z - zc) < 0.6);
    if (!nearDoor) return false;
    if (ax <= 1.32) return true;
    // Salida al andén si el tren está en una estación con puertas abiertas
    const st = this.unit.sim.dockedStation();
    return ax < 1.7 && !!st && this.unit.sim.doorProgress > 0.75 && this.unit.sim.doorState !== "closing";
  }

  walkable(x, z) { return this.space === "world" ? this.worldWalkable(x, z) : this.trainWalkable(x, z); }

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
    this.pos.set(this.seat.pos.x * 0.95, CONFIG.train.floorY, this.seat.pos.z);
    this.yaw = this.seat.yaw + Math.PI;     // la cámara mira hacia -Z local; el asiento mira al pasillo
    return { text: "Te sientas · F para levantarte", level: "ok" };
  }

  leaveSeat() {
    if (!this.seat) return;
    if (this.seat.occupant === "player") this.seat.occupant = null;
    this.pos.set(this.seat.approach.x, CONFIG.train.floorY, this.seat.approach.z);
    this.seat = null;
  }

  /** Junto a un acceso del andén. */
  nearAccess() {
    if (this.space !== "world") return null;
    const S = CONFIG.station;
    const st = this.stationAt(this.pos.z);
    if (!st) return null;
    const close = Math.abs(this.pos.x) > S.wallX - 1.3 && [-1, 1].some(e => Math.abs(this.pos.z - (st.z + e * S.accessZ)) < 1.4);
    return close ? st : null;
  }

  tryExit() {
    const st = this.nearAccess();
    if (!st) return { text: "Acércate a un acceso de SALIDA para salir de la estación", level: "info" };
    this.onEvent("exit", { station: st });
    return null;
  }

  /* ----- Cambios de espacio ----- */
  enterTrain(unit) {
    this.pos.sub(unit.group.position);
    this.pos.y = CONFIG.train.floorY;
    this.space = "train";
    this.unit = unit;
    unit.group.add(this.holder);
    this.onEvent("boarded", { unit });
  }

  exitTrain() {
    const unit = this.unit;
    this.pos.add(unit.group.position);
    this.pos.y = CONFIG.station.platformTop;
    this.space = "world";
    this.unit = null;
    this.scene.add(this.holder);
    this.onEvent("alighted", { unit, station: this.stationAt(this.pos.z) });
  }

  /* ----- Paso por fotograma ----- */
  update(dt) {
    if (!this.seat) this.move(dt);

    // Si se cierran las puertas mientras estás en el umbral, quedas del lado en que estés
    if (this.space === "world" && Math.abs(this.pos.x) < CONFIG.station.platformEdgeX + 0.3 && !this.worldWalkable(this.pos.x, this.pos.z)) {
      this.pos.x = Math.sign(this.pos.x || 1) * (CONFIG.station.platformEdgeX + 0.35);
    }
    if (this.space === "train" && Math.abs(this.pos.x) > 1.32 && !this.trainWalkable(this.pos.x, this.pos.z)) {
      this.pos.x = Math.sign(this.pos.x) * 1.3;
    }

    // Transiciones andén ↔ tren por las puertas
    if (this.space === "world" && Math.abs(this.pos.x) < 1.42) {
      const st = this.stationAt(this.pos.z);
      const u = st && this.openUnitAt(st);
      if (u) this.enterTrain(u);
    } else if (this.space === "train" && Math.abs(this.pos.x) > 1.45) {
      this.exitTrain();
    }

    // Cámara
    const seated = !!this.seat;
    this.holder.position.copy(this.pos);
    if (seated) this.holder.position.y = this.seat.seatY - 0.62;
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
    // Adelante = -Z local de la cámara girada "yaw"
    const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * r) * speed;
    const dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * r) * speed;
    const { x, z } = this.pos;
    if (this.walkable(x + dx, z + dz)) { this.pos.x += dx; this.pos.z += dz; }
    else if (this.walkable(x + dx, z)) this.pos.x += dx;
    else if (this.walkable(x, z + dz)) this.pos.z += dz;
  }

  /** Coordenada Z del jugador en el mundo. */
  get worldZ() {
    return this.space === "train" ? this.unit.group.position.z + this.pos.z : this.pos.z;
  }

  /** Texto de ayuda contextual para el HUD. */
  hint() {
    if (this.seat) return "F levantarse";
    if (this.space === "train") {
      const st = this.unit.sim.dockedStation();
      const open = this.unit.sim.doorState === "open";
      return open && st ? `Puertas abiertas en ${st.name} · camina hacia una puerta para bajar · F sentarse` : "F sentarse en un asiento libre";
    }
    if (this.nearAccess()) return "E salir de la estación";
    const st = this.stationAt(this.pos.z);
    if (st && this.openUnitAt(st)) return "El tren tiene las puertas abiertas: camina hacia una puerta para subir";
    return "Espera el tren detrás de la línea amarilla";
  }
}
