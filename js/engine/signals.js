/* ==========================================================================
   MetroSim — Motor · signals.js
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

   Hay un SignalSystem por ruta (sentido), en coordenadas de la ruta.
   Este módulo es SOLO lógica: el dibujo de los postes y lámparas está en
   render/signalViews.js, que lee el aspecto de cada señal.
   ========================================================================== */

import { CONFIG } from "../config.js";

/** Lista ordenada (z descendente) de señales a lo largo de una ruta. */
function buildSignalList(route) {
  const list = [];
  const S = CONFIG.station;
  const entryOff = S.hallHalf + 4, exitOff = -(S.platformHalf + 5);
  route.stations.forEach((st, i) => {
    list.push({ type: "entrada", station: st, z: st.z + entryOff });
    list.push({ type: "salida", station: st, z: st.z + exitOff });
    const next = route.stations[i + 1];
    if (!next) return;
    const from = st.z + exitOff, to = next.z + entryOff;
    const gap = from - to;
    const n = Math.ceil(gap / CONFIG.signals.maxBlock) - 1;
    for (let k = 1; k <= n; k++) list.push({ type: "intermedia", station: null, z: from - (gap * k) / (n + 1) });
  });
  list.sort((a, b) => b.z - a.z);
  list.forEach((s, i) => {
    s.index = i;
    s.id = `${route.id === "A" ? 1 : 2}${String(i + 1).padStart(2, "0")}`;   // 1xx vía 1 · 2xx vía 2
    s.aspect = "green";
    s.endZ = list[i + 1]?.z ?? route.track.end;    // final de su cantón
  });
  return list;
}

export class SignalSystem {
  constructor(route) {
    this.route = route;
    this.signals = buildSignalList(route);
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
      const standing = units.find(u => u.sim.position <= st.z + CONFIG.station.platformHalf && u.sim.position > s.z);   // (st en coordenadas de la ruta)
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

}
