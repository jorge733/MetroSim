/* ==========================================================================
   MetroSim — elevators.js
   Ascensores de accesibilidad: uno por andén, dentro de la zona pagada,
   entre el andén (y = 1,2) y la mezanina (y = 7,2).

   Pozo de vidrio pegado al muro (|x| 6,6…8,45 · z +40,2…+42,6 respecto del
   centro de la estación), puertas de piso automáticas que dan hacia las vías
   y una cabina que sube y baja de verdad (el pasajero viaja dentro).

   Uso (pasajero a pie): E junto a la puerta llama al ascensor; E dentro de la
   cabina lo envía al otro nivel. Si alguien queda en el umbral mientras se
   cierran las puertas, se vuelven a abrir.
   Terminales: el andén de llegada es solo de salida, así que desde la
   mezanina el ascensor de ese lado no baja.

   Lógica (máquina de estados) y dibujo en el mismo módulo; no hay luces
   reales nuevas (solo materiales emisivos), para no cargar la GPU integrada.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { std, glow, addBox, addBoxSpan, addPlane, toTexture, signCanvas } from "./utils.js";
import { isArrivalOnly } from "./stationLayout.js";

const S = CONFIG.station, MZ = CONFIG.mezzanine, E = CONFIG.elevator;
const LEVEL_Y = [S.platformTop, MZ.y];            // 0 = andén · 1 = mezanina
const ZC = (E.z0 + E.z1) / 2;                     // eje de la puerta (z relativa)
const CAB_H = 2.3;                                // alto interior de la cabina
const TOP = MZ.y + 2.7;                           // remate superior del pozo

let M = null;
/** Materiales compartidos por todos los ascensores (se crean una vez). */
function materials() {
  if (M) return M;
  M = {
    glass: std(0xa8d8f0, { metal: 0.1, rough: 0.05, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    frame: std(0x7d868e, { metal: 0.8, rough: 0.3 }),
    door: std(0xb9c1c8, { metal: 0.85, rough: 0.28 }),
    cabWall: std(0xc7ced4, { metal: 0.75, rough: 0.3 }),
    cabFloor: std(0x2e3338, { rough: 0.8 }),
    cabLight: glow(0xf4f8ff),
    rail: std(0x9aa3aa, { metal: 0.9, rough: 0.2 }),
    panel: std(0x1a1d21, { metal: 0.4, rough: 0.4 }),
    button: glow(0x5fd0ff),
    sign: glow(0xffffff, { map: toTexture(signCanvas("♿ ASCENSOR", "#1d5fbf", 512, 128, "800 58px Arial")) }),
    arrowUp: glow(0x2bd46a),
    arrowDown: glow(0xffb020),
    arrowOff: std(0x202428, { rough: 0.6 }),
  };
  return M;
}

/** ¿Está la posición (|x|, dz) dentro de la huella del pozo? (margen r) */
export function inElevatorShaft(ax, dz, r = 0) {
  return ax > E.x0 - r && ax < E.x1 + r && dz > E.z0 - r && dz < E.z1 + r;
}

export class Elevator {
  /**
   * @param {THREE.Group} group  grupo de la estación (se oculta con ella)
   * @param {object} st          estación del mundo
   * @param {number} side        +1 / −1 (andén de ese lado)
   */
  constructor(group, st, side) {
    this.st = st;
    this.side = side;
    this.downBlocked = isArrivalOnly(st, side);   // terminal: no se baja a un andén de solo llegada
    this.level = 0;                                // nivel donde está (o del que partió)
    this.y = LEVEL_Y[0];
    this.pending = null;                           // nivel pedido
    this.state = "idle";                           // idle · opening · open · closing · moving
    this.door = 0;                                 // 0 cerrada … 1 abierta
    this.openT = 0;
    this.events = [];                              // "chime", "doors" (para el sonido)
    this.build(group);
  }

  /* ----- Lógica ----- */

  /** Pide el ascensor hacia un nivel (llamada desde un piso o botón de cabina). */
  request(level) {
    if (level === 0 && this.downBlocked) return false;
    if (this.state === "moving") { if (this.pending !== level) return false; return true; }
    if (level === this.level) {
      this.pending = null;
      if (this.state !== "open") this.state = "opening";
      this.openT = 0;
    } else {
      // Con las puertas abriéndose o abiertas se deja salir a quien viene dentro: se cierran tras un rato
      this.pending = level;
      if (this.state === "idle") this.state = "closing";
    }
    return true;
  }

  /** Algo bloquea el umbral: si se estaban cerrando, se reabren. */
  obstruct() {
    if (this.state === "closing") { this.state = "opening"; this.openT = 0; }
    else if (this.state === "open") this.openT = 0;
  }

  update(dt) {
    switch (this.state) {
      case "opening":
        this.door = Math.min(1, this.door + dt / E.doorTime);
        if (this.door >= 1) { this.state = "open"; this.openT = 0; }
        break;
      case "open":
        this.openT += dt;
        if ((this.pending !== null && this.openT > 2.5) || this.openT > E.dwell) this.state = "closing";
        break;
      case "closing":
        this.door = Math.max(0, this.door - dt / E.doorTime);
        if (this.door <= 0) {
          if (this.pending !== null && this.pending !== this.level) { this.state = "moving"; this.events.push("start"); }
          else { this.state = "idle"; this.pending = null; }
        }
        break;
      case "moving": {
        const ty = LEVEL_Y[this.pending], d = ty - this.y;
        // Arranque y llegada suaves
        const v = E.speed * Math.min(1, 0.25 + Math.abs(d) / 1.2);
        if (Math.abs(d) <= v * dt) {
          this.y = ty; this.level = this.pending; this.pending = null;
          this.state = "opening"; this.events.push("chime");
        } else this.y += Math.sign(d) * v * dt;
        break;
      }
    }
    this.sync();
  }

  /** ¿La cabina está detenida en este nivel con las puertas abiertas (se puede entrar/salir)? */
  openAt(level) { return this.state !== "moving" && this.level === level && this.door > 0.8; }

  /** Nivel (0/1) cuya altura coincide con y, o null. */
  static levelOf(y) {
    if (Math.abs(y - LEVEL_Y[0]) < 0.4) return 0;
    if (Math.abs(y - LEVEL_Y[1]) < 0.4) return 1;
    return null;
  }

  /* ----- Dibujo ----- */

  build(group) {
    const m = materials(), sd = this.side, z = this.st.z;
    const x0 = E.x0, x1 = E.x1, z0 = z + E.z0, z1 = z + E.z1, zc = z + ZC, dh = E.doorHalf;
    const X = (a) => sd * a;
    const span = (a, b, y0, y1, za, zb, mat) => addBoxSpan(group, X((a + b) / 2), b - a, y0, y1, za, zb, mat);
    const yP = LEVEL_Y[0], yM = LEVEL_Y[1];

    /* Pozo: frente de vidrio (con los huecos de puerta) y laterales */
    span(x0 - 0.02, x0 + 0.02, yP, TOP, z0, zc - dh, m.glass);
    span(x0 - 0.02, x0 + 0.02, yP, TOP, zc + dh, z1, m.glass);
    span(x0 - 0.02, x0 + 0.02, yP + 2.15, yM - 0.35, zc - dh, zc + dh, m.glass);
    span(x0 - 0.02, x0 + 0.02, yM + 2.15, TOP, zc - dh, zc + dh, m.glass);
    [z0, z1].forEach(zz => span(x0, x1, yP, TOP, zz - 0.02, zz + 0.02, m.glass));
    // Perfiles de acero en las esquinas y en el marco de las puertas
    [[x0, z0], [x0, z1], [x1 - 0.04, z0], [x1 - 0.04, z1]].forEach(([px, pz]) => addBox(group, 0.08, TOP - yP, 0.08, m.frame, X(px), (yP + TOP) / 2, pz));
    for (const y of LEVEL_Y) {
      [zc - dh - 0.05, zc + dh + 0.05].forEach(pz => addBox(group, 0.12, 2.2, 0.1, m.frame, X(x0 - 0.03), y + 1.1, pz));
      addBox(group, 0.12, 0.1, dh * 2 + 0.2, m.frame, X(x0 - 0.03), y + 2.2, zc);
      // Cartel azul de accesibilidad sobre la puerta y flechas de sentido
      const rot = sd > 0 ? -Math.PI / 2 : Math.PI / 2;
      addPlane(group, 1.5, 0.375, m.sign, X(x0 - 0.1), y + 2.55, zc, rot);
    }
    span(x0, x1, TOP, TOP + 0.12, z0, z1, m.frame);                            // techo del pozo
    // Guías de la cabina en el fondo del pozo
    [z0 + 0.35, z1 - 0.35].forEach(pz => addBox(group, 0.06, TOP - yP, 0.06, m.rail, X(x1 - 0.08), (yP + TOP) / 2, pz));

    /* Indicadores de piso (▲ / ▼ encendidos según el movimiento) */
    this.arrows = LEVEL_Y.map(y => {
      const up = addBox(group, 0.03, 0.12, 0.12, m.arrowOff, X(x0 - 0.08), y + 2.32, zc - 0.35);
      const dn = addBox(group, 0.03, 0.12, 0.12, m.arrowOff, X(x0 - 0.08), y + 2.32, zc + 0.35);
      return { up, dn };
    });
    // Botonera de llamada junto a cada puerta
    for (const y of LEVEL_Y) {
      addBox(group, 0.05, 0.3, 0.16, m.panel, X(x0 - 0.05), y + 1.1, zc + dh + 0.3);
      addBox(group, 0.02, 0.06, 0.06, m.button, X(x0 - 0.08), y + 1.12, zc + dh + 0.3);
    }

    /* Puertas de piso: dos hojas por nivel que se abren hacia los lados */
    this.leaves = LEVEL_Y.map(y => [-1, 1].map(s => addBox(group, 0.04, 2.15, dh, m.door, X(x0 - 0.06), y + 1.075, zc + s * dh / 2)));

    /* Cabina (sube y baja) */
    const cab = new THREE.Group();
    const cx0 = x0 + 0.08, cx1 = x1 - 0.14, cz0 = z0 + 0.1, cz1 = z1 - 0.1;
    const cspan = (a, b, y0, y1, za, zb, mat) => addBoxSpan(cab, X((a + b) / 2), b - a, y0, y1, za, zb, mat);
    cspan(cx0, cx1, -0.12, 0.01, cz0, cz1, m.cabFloor);                        // piso
    cspan(cx0, cx1, CAB_H, CAB_H + 0.1, cz0, cz1, m.cabWall);                  // techo
    cspan(cx0 + 0.3, cx1 - 0.3, CAB_H - 0.02, CAB_H, cz0 + 0.3, cz1 - 0.3, m.cabLight);
    cspan(cx1 - 0.04, cx1, 0, CAB_H, cz0, cz1, m.cabWall);                     // fondo
    [cz0, cz1 - 0.04].forEach(za => cspan(cx0, cx1, 0, CAB_H, za, za + 0.04, m.cabWall));   // laterales
    cspan(cx1 - 0.1, cx1 - 0.06, 0.88, 0.92, cz0 + 0.2, cz1 - 0.2, m.rail);    // pasamanos
    cspan(cx0 + 0.15, cx0 + 0.45, 0.85, 1.35, cz1 - 0.08, cz1 - 0.05, m.panel); // botonera interior
    cspan(cx0 + 0.25, cx0 + 0.35, 1.15, 1.25, cz1 - 0.1, cz1 - 0.08, m.button);
    cab.position.y = this.y;
    group.add(cab);
    this.cab = cab;
    this.sync();
  }

  sync() {
    if (!this.cab) return;
    this.cab.position.y = this.y;
    const dh = E.doorHalf, zc = this.st.z + ZC;
    this.leaves.forEach((pair, lv) => {
      const open = lv === this.level && this.state !== "moving" ? this.door : 0;
      pair.forEach((leaf, i) => { const s = i ? 1 : -1; leaf.position.z = zc + s * (dh / 2 + open * dh * 0.95); });
    });
    const m = materials();
    const dir = this.state === "moving" ? Math.sign(LEVEL_Y[this.pending] - this.y) : 0;
    this.arrows.forEach(a => { a.up.material = dir > 0 ? m.arrowUp : m.arrowOff; a.dn.material = dir < 0 ? m.arrowDown : m.arrowOff; });
  }
}

/** Ascensores de todas las estaciones: búsqueda por posición y avance por fotograma. */
export class ElevatorSystem {
  constructor() { this.list = []; this.byStation = new Map(); }

  add(el) {
    this.list.push(el);
    if (!this.byStation.has(el.st)) this.byStation.set(el.st, {});
    this.byStation.get(el.st)[el.side] = el;
  }

  /** Ascensor de una estación y lado. */
  at(st, side) { return this.byStation.get(st)?.[side] || null; }

  update(dt) {
    for (const el of this.list) if (el.state !== "idle") el.update(dt);
  }
}
