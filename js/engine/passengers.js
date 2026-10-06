/* ==========================================================================
   MetroSim — Motor · passengers.js
   Pasajeros LÓGICOS: la demanda real de la línea, en números.

   Para el motor un pasajero no es un muñeco, es una cifra:
     · en cada estación entra gente sin parar según la hora y el tipo de día
       (config.js → demandAt), la importancia de la estación (weight) y el
       volumen de la línea (network.js → demand);
     · ORIGEN-DESTINO (1.1): cada estación "emite" y "atrae" viajes según su
       centralidad. En la punta de la mañana la gente sale de los barrios
       hacia el centro (y por la tarde al revés), así que en cada andén
       espera más gente en el sentido que va hacia donde se viaja, y en cada
       estación baja la parte de los viajeros que tiene ahí su destino;
     · cuando un tren abre las puertas, primero bajan y luego suben, a un
       ritmo por puerta (20 puertas por costado en el AS-2014). Con el tren
       por encima de 4 personas/m² subir cuesta cada vez más, y a 6 p/m²
       (1.299 personas) ya no cabe nadie: el resto espera al siguiente;
     · mientras hay intercambio, el tren no cierra puertas (hasta un límite).

   De ahí sale la causa y efecto: un tren que llega tarde encuentra más
   gente esperando → tarda más en la parada → llega aún más tarde, y el de
   atrás encuentra menos gente y se le acerca (trenes "en racimo"). Y un
   tren lleno pesa ~90 t más: acelera menos y gasta más energía (sim.js).

   Los viajeros dibujados (people.js) son solo una muestra visual de estas
   cifras: el motor no depende de ellos.
   ========================================================================== */

import { CONFIG, demandAt, flowPeriodAt } from "../config.js";
import { TRAIN_LAYOUT, STOCK } from "./consist.js";
import { headwayAt } from "./schedule.js";
import { clamp } from "./format.js";

/**
 * Personas por segundo que entran a una estación de importancia 1 (sumando
 * los dos andenes) con demanda 1, en una línea de volumen 1 (la L3). Con
 * ~21 estaciones da del orden de 20.000 entradas en la hora punta de la
 * mañana, más los transbordos.
 */
const BASE_RATE = 0.3;
/** Personas por segundo y por puerta al bajar y al subir (puerta doble de 1,4 m). */
const ALIGHT_PER_DOOR = 1.5, BOARD_PER_DOOR = 1.25;
/** Máximo de personas que caben esperando en un andén de 125 m. */
const PLATFORM_CAPACITY = 1200;
/** Capacidad real de un tren AS-2014 de 5 coches a 6 personas/m² (sentados + de pie). */
export const TRAIN_CAPACITY = STOCK.capacity;

/** Emisión y atracción de viajes de una estación según el periodo (c = centralidad 0..1). */
const EMIT = { am: (c) => 1.6 - 1.3 * c, pm: (c) => 0.35 + 1.25 * c, off: () => 1 };
const ATTRACT = { am: (c) => 0.3 + 1.8 * c, pm: (c) => 1.6 - 1.3 * c, off: () => 1 };
/** Los viajes muy cortos son poco frecuentes: peso según la distancia (m). */
const tripLength = (d) => 1 - Math.exp(-d / 2200);

export class PassengerFlow {
  /**
   * @param {object} line   línea (network.js) con sus estaciones y sentidos
   * @param {number} clock  hora inicial (para repartir la gente que ya espera)
   */
  constructor(line, clock) {
    this.line = line;
    this.stations = line.stations;
    this.scale = line.demand ?? 1;
    // waiting[índice de estación de la línea][lado] = personas esperando en ese andén
    this.waiting = this.stations.map(() => ({ 1: 0, "-1": 0 }));
    this.totals = { boarded: 0, alighted: 0, transferIn: 0, leftBehind: 0 };
    this.onAlight = null;                  // (estación, personas) → transbordos (lo conecta el motor)
    this.period = null;
    this.setPeriod(flowPeriodAt(clock));
    // Al empezar ya hay gente: la que llegó durante medio intervalo
    const half = headwayAt(clock, line) / 2;
    for (const st of this.stations) for (const side of [1, -1]) {
      this.waiting[st.index][side] = Math.min(PLATFORM_CAPACITY, this.rate(st, side, clock) * half);
    }
  }

  /**
   * Recalcula el reparto origen-destino para un periodo ("am" | "pm" | "off"):
   *   split[i][lado]  parte de quienes entran en la estación i que van en ese sentido
   *   emit[i]         peso de emisión de la estación i
   *   alight[routeId][i]  parte de los que van a bordo que bajan en la estación i de la ruta
   */
  setPeriod(period) {
    if (period === this.period) return;
    this.period = period;
    const st = this.stations, n = st.length;
    const attract = st.map(s => s.weight * ATTRACT[period](s.centrality));
    this.emit = st.map(s => s.weight * EMIT[period](s.centrality));
    // Sentido de los viajes: hacia los destinos que atraen, pesando la distancia
    this.split = st.map((s, i) => {
      let up = 0, down = 0;                                   // up: hacia índices mayores (ida, lado +1)
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const w = attract[j] * tripLength(Math.abs(st[j].z - s.z));
        if (j > i) up += w; else down += w;
      }
      const total = up + down || 1;
      return { 1: up / total, "-1": down / total };
    });
    // Bajadas: en cada estación baja la parte de los que van a bordo cuyo destino es esa
    this.alight = {};
    for (const route of this.line.routes) {
      const rs = route.stations, shares = new Array(rs.length).fill(0);
      let remaining = 0;
      for (let k = rs.length - 1; k >= 0; k--) {
        const a = attract[rs[k].worldIndex];
        remaining += a;
        shares[k] = k === rs.length - 1 ? 1 : clamp(a / remaining, 0, 0.85);
      }
      this.alight[route.id] = shares;
    }
  }

  /** Personas por segundo que llegan a un andén (estación de la línea, lado +1 / −1). */
  rate(st, side, clock) {
    return BASE_RATE * this.scale * demandAt(clock) * this.emit[st.index] * this.split[st.index][side];
  }

  /** Llega gente que hace transbordo desde otra línea: se reparte según el sentido de los viajes. */
  addTransfer(st, n) {
    const s = this.split[st.index];
    for (const side of [1, -1]) {
      this.waiting[st.index][side] = Math.min(PLATFORM_CAPACITY, this.waiting[st.index][side] + n * s[side]);
    }
    this.totals.transferIn += n;
  }

  /** Personas esperando en un andén (estación de la línea y lado +1 / −1). */
  waitingAt(st, side) { return this.waiting[st.index][side]; }

  /** ¿El tren está en pleno intercambio de viajeros? */
  isBusy(u) { return !!u.pax?.exchanging && u.sim.doorState === "open"; }

  /**
   * Paso de simulación.
   * @param {number} dt
   * @param {number} clock
   * @param {Array} units  trenes de la red
   */
  update(dt, clock, units) {
    this.setPeriod(flowPeriodAt(clock));

    // 1. Llegada de gente a los andenes
    const k = BASE_RATE * this.scale * demandAt(clock) * dt;
    for (const st of this.stations) {
      const w = this.waiting[st.index], e = this.emit[st.index] * k, s = this.split[st.index];
      w[1] = Math.min(PLATFORM_CAPACITY, w[1] + e * s[1]);
      w[-1] = Math.min(PLATFORM_CAPACITY, w[-1] + e * s[-1]);
    }

    // 2. Intercambio en los trenes con puertas abiertas
    const doors = TRAIN_LAYOUT.doors.length;
    const cap = TRAIN_CAPACITY, comfort = STOCK.comfortCapacity;
    for (const u of units) {
      u.load ??= 0;
      const sim = u.sim;
      const rs = sim.isStopped && sim.doorState === "open" ? sim.dockedStation() : null;
      if (!rs) {
        if (u.pax?.exchanging === false && u.pax.full && !u.pax.counted) { this.totals.leftBehind += u.pax.full; u.pax.counted = true; }
        if (u.pax) u.pax.exchanging = false;
        continue;
      }

      const route = u.route, terminal = rs === route.last;
      // Al abrir puertas en una estación nueva: cuántos bajan aquí
      if (u.pax?.stationIndex !== rs.index || u.pax.routeId !== route.id) {
        const share = terminal ? 1 : (this.alight[route.id]?.[rs.index] ?? 0.2);
        u.pax = { stationIndex: rs.index, routeId: route.id, toAlight: u.load * share, boarded: 0, alighted: 0, exchanging: true, full: 0 };
      }
      const p = u.pax;

      // Primero bajan…
      const down = Math.min(doors * ALIGHT_PER_DOOR * dt, p.toAlight, u.load);
      u.load -= down; p.toAlight -= down; p.alighted += down;
      this.totals.alighted += down;
      if (down > 0) this.onAlight?.(rs.world, down);

      // …luego suben (nunca en el andén de llegada de una terminal). Con el tren muy
      // lleno cuesta más subir (la gente se acomoda) y a 6 p/m² no cabe nadie más.
      const w = this.waiting[rs.world.index];
      const side = route.side;
      if (!terminal && p.toAlight < 0.5) {
        const crowd = u.load <= comfort ? 1 : clamp(1 - 0.8 * (u.load - comfort) / (cap - comfort), 0.2, 1);
        const up = Math.min(doors * BOARD_PER_DOOR * crowd * dt, w[side], Math.max(0, cap - u.load));
        w[side] -= up; u.load += up; p.boarded += up;
        this.totals.boarded += up;
      }
      if (terminal) u.load = Math.max(0, u.load);
      const roomLeft = u.load < cap - 0.5;
      p.full = !terminal && !roomLeft && w[side] >= 1 ? Math.round(w[side]) : 0;
      p.exchanging = p.toAlight >= 0.5 || (!terminal && w[side] >= 1 && roomLeft);
    }
  }
}
