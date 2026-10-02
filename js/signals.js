/* ==========================================================================
   MetroSim — Alpha 0.4 · signals.js
   Señalización lateral con bloqueo automático de 3 aspectos.

   · Cada señal protege el cantón (bloque) que empieza en ella y termina en
     la siguiente señal.
   · ROJO     → el cantón siguiente está ocupado por un tren.
   · AMARILLO → la señal siguiente está en rojo (prepárate para parar).
   · VERDE    → vía libre.
   · Señales de salida (al final de cada andén): además se mantienen en rojo
     mientras el tren estacionado no tenga las puertas cerradas y no haya
     llegado su hora de salida según el horario.

   Tipos: "entrada" (antes de cada estación), "salida" (final de andén) e
   "intermedia" (en túnel, separación ≤ CONFIG.signals.maxBlock).
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS } from "./config.js";
import { std, glow, toTexture, signalPlateCanvas } from "./utils.js";

const ASPECT_COLORS = { red: 0xff2020, yellow: 0xffb000, green: 0x20ff6a };
const LAMP_OFF = 0x151515;

/** Lista ordenada (z descendente) de señales a lo largo de la línea. */
function buildSignalList() {
  const list = [];
  STATIONS.forEach((st, i) => {
    list.push({ type: "entrada", station: st, z: st.z + 52 });
    list.push({ type: "salida", station: st, z: st.z - 40 });
    const next = STATIONS[i + 1];
    if (!next) return;
    const from = st.z - 40, to = next.z + 52;
    const gap = from - to;
    const n = Math.ceil(gap / CONFIG.signals.maxBlock) - 1;
    for (let k = 1; k <= n; k++) list.push({ type: "intermedia", station: null, z: from - (gap * k) / (n + 1) });
  });
  list.sort((a, b) => b.z - a.z);
  list.forEach((s, i) => {
    s.index = i;
    s.id = `${String(i + 1).padStart(3, "0")}`;
    s.aspect = "green";
    s.endZ = list[i + 1]?.z ?? CONFIG.track.end;   // final de su cantón
  });
  return list;
}

export class SignalSystem {
  constructor() {
    this.signals = buildSignalList();
  }

  /* ----- Construcción 3D ----- */
  build3D(scene) {
    const post = std(0x3c4146, { metal: 0.6, rough: 0.4 });
    const head = std(0x0d0f11, { metal: 0.3, rough: 0.6 });
    const lampGeo = new THREE.CircleGeometry(0.1, 20);
    const visorGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.14, 16, 1, true, 0, Math.PI);

    for (const s of this.signals) {
      const g = new THREE.Group();
      // Las de salida van en el vestíbulo junto a la vía; el resto, en túnel junto al hastial derecho
      g.position.set(s.type === "salida" ? 2.2 : 2.75, 0, s.z);
      scene.add(g);

      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.5, 0.1), post);
      pole.position.y = 1.25;
      g.add(pole);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.22), head);
      box.position.y = 2.95;
      g.add(box);

      // Lámparas: rojo arriba, amarillo en medio, verde abajo (mirando al tren que llega, +Z)
      s.lamps = {};
      ["red", "yellow", "green"].forEach((aspect, k) => {
        const mat = new THREE.MeshBasicMaterial({ color: LAMP_OFF, fog: false, toneMapped: false });
        const lamp = new THREE.Mesh(lampGeo, mat);
        lamp.position.set(0, 3.25 - k * 0.3, 0.115);
        g.add(lamp);
        const visor = new THREE.Mesh(visorGeo, head);
        visor.rotation.x = Math.PI / 2;
        visor.rotation.y = Math.PI;
        visor.position.set(0, 3.27 - k * 0.3, 0.17);
        g.add(visor);
        s.lamps[aspect] = mat;
      });

      // Placa con el número de señal
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), glow(0xffffff, { map: toTexture(signalPlateCanvas(s.id)) }));
      plate.position.set(0, 2.25, 0.06);
      g.add(plate);

      s.group = g;
      s.shownAspect = null;
    }
    this.applyLamps();
  }

  applyLamps() {
    for (const s of this.signals) {
      if (!s.lamps || s.shownAspect === s.aspect) continue;
      s.shownAspect = s.aspect;
      for (const [aspect, mat] of Object.entries(s.lamps)) mat.color.setHex(aspect === s.aspect ? ASPECT_COLORS[aspect] : LAMP_OFF);
    }
  }

  /* ----- Lógica ----- */

  /**
   * Recalcula los aspectos.
   * @param {Array} units  trenes (con .sim y opcionalmente .trip / .departOk)
   * @param {number} clock
   */
  update(units, clock) {
    const L = CONFIG.train.length;
    const list = this.signals;

    // 1. Ocupación de cantones
    for (const s of list) s.occupied = false;
    for (const u of units) {
      const front = u.sim.position, rear = front + L;
      // Cantones que se solapan con el tren: el tren ocupa (front, rear)
      for (const s of list) {
        if (front < s.z && rear > s.endZ) s.occupied = true;
      }
    }

    // 2. Retención de las señales de salida (puertas abiertas u hora de salida no alcanzada)
    for (const s of list) {
      s.hold = false;
      if (s.type !== "salida") continue;
      const st = s.station;
      const standing = units.find(u => u.sim.position <= st.z + CONFIG.station.platformHalf && u.sim.position > s.z);
      if (standing && standing.sim.isStopped && Math.abs(standing.sim.position - st.stopZ) < 12) {
        const due = standing.trip ? standing.trip.dep[st.index] - 5 : -Infinity;
        s.hold = !standing.sim.doorsClosed || clock < due;
      }
    }

    // 3. Aspectos (de la última señal hacia atrás, porque el amarillo depende de la siguiente)
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i], next = list[i + 1];
      if (s.occupied || s.hold) s.aspect = "red";
      else if (next && next.aspect === "red") s.aspect = "yellow";
      else s.aspect = "green";
    }
    this.applyLamps();
  }

  /** Primera señal por delante de la posición z (la próxima que verá el tren). */
  nextAhead(z) {
    // Búsqueda binaria en la lista ordenada por z descendente
    let lo = 0, hi = this.signals.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.signals[mid].z < z) { ans = this.signals[mid]; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }

  /** Señales rebasadas entre dos posiciones (de prevZ a z, avanzando hacia -Z). */
  passedBetween(prevZ, z) {
    if (z >= prevZ) return [];
    return this.signals.filter(s => s.z < prevZ && s.z >= z);
  }

  /** Señal de salida de una estación. */
  startingSignal(st) {
    return this.signals.find(s => s.type === "salida" && s.station === st);
  }

  updateVisibility(cameraZ) {
    const R = CONFIG.renderRadius;
    for (const s of this.signals) if (s.group) s.group.visible = Math.abs(s.z - cameraZ) < R;
  }
}
