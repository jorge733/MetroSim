/* ==========================================================================
   MetroSim — Motor · passengers.js
   Pasajeros LÓGICOS: la demanda real de la línea, en números.

   Para el motor un pasajero no es un muñeco, es una cifra:
     · en cada andén llega gente sin parar según la hora (demandAt) y la
       importancia de la estación (las de combinación mueven más gente);
     · cuando un tren abre las puertas, primero bajan y luego suben, a un
       ritmo limitado por el número de puertas;
     · mientras hay intercambio, el tren no cierra puertas (hasta un límite).

   De ahí sale la causa y efecto: un tren que llega tarde encuentra más
   gente esperando → tarda más en la parada → llega aún más tarde, y el de
   atrás encuentra menos gente y se le acerca (trenes "en racimo").

   Los viajeros dibujados (people.js) son solo una muestra visual de estas
   cifras: el motor no depende de ellos.
   ========================================================================== */

import { CONFIG, demandAt } from "../config.js";
import { TRAIN_LAYOUT } from "./consist.js";
import { clamp } from "./format.js";

/** Llegadas a un andén por segundo con demanda 1 (hora punta) en una estación normal. */
const BASE_RATE = 0.45;
/** Personas por segundo y por puerta al subir o bajar. */
const PER_DOOR = 1.4;
/** Máximo de personas que caben esperando en un andén. */
const PLATFORM_CAPACITY = 450;
/** Capacidad real de un tren AS-2014 de 5 coches (sentados + de pie). */
export const TRAIN_CAPACITY = 1000;

export class PassengerFlow {
  /**
   * @param {object} line   línea (network.js) con sus estaciones y sentidos
   * @param {number} clock  hora inicial (para repartir la gente que ya espera)
   */
  constructor(line, clock) {
    this.line = line;
    this.stations = line.stations;
    // waiting[índice de estación de la línea][lado] = personas esperando en ese andén
    this.waiting = this.stations.map(() => ({ 1: 0, "-1": 0 }));
    this.totals = { boarded: 0, alighted: 0, transferIn: 0 };
    this.onAlight = null;                  // (estación, personas) → transbordos (lo conecta el motor)
    // Al empezar ya hay gente: la que llegó durante medio intervalo
    for (const st of this.stations) for (const side of [1, -1]) {
      this.waiting[st.index][side] = this.rate(st, side, clock) * CONFIG.schedule.offPeakHeadway / 2;
    }
  }

  /** Peso de una estación: las de combinación y las terminales de origen mueven más gente. */
  weight(st) {
    return 1 + 0.6 * st.combos.length + (st.index === 0 || st.index === this.stations.length - 1 ? 0.3 : 0);
  }

  /** Personas por segundo que llegan a un andén. Nadie espera en el andén de llegada de una terminal. */
  rate(st, side, clock) {
    return BASE_RATE * demandAt(clock) * this.baseWeight(st, side);
  }

  /** Peso de un andén (0 en el andén de llegada de una terminal); se calcula una sola vez. */
  baseWeight(st, side) {
    this.weights ??= this.stations.map(s => {
      const w = {};
      for (const sd of [1, -1]) {
        const route = this.line.routes.find(r => r.side === sd);
        w[sd] = route.stationOf(s) === route.last ? 0 : this.weight(s);
      }
      return w;
    });
    return this.weights[st.index][side];
  }

  /** Llega gente que hace transbordo desde otra línea: se reparte entre los dos andenes con servicio. */
  addTransfer(st, n) {
    const open = [1, -1].filter(side => {
      const route = this.line.routes.find(r => r.side === side);
      return route.stationOf(st) !== route.last;          // en una terminal, solo el andén de salida
    });
    for (const side of open) this.waiting[st.index][side] += n / open.length;
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
    // 1. Llegada de gente a los andenes
    const k = BASE_RATE * demandAt(clock) * dt;
    for (const st of this.stations) {
      const w = this.waiting[st.index];
      w[1] = Math.min(PLATFORM_CAPACITY, w[1] + k * this.baseWeight(st, 1));
      w[-1] = Math.min(PLATFORM_CAPACITY, w[-1] + k * this.baseWeight(st, -1));
    }

    // 2. Intercambio en los trenes con puertas abiertas
    const doors = TRAIN_LAYOUT.doors.length;
    const cap = TRAIN_CAPACITY;
    for (const u of units) {
      u.load ??= 0;
      const sim = u.sim;
      const rs = sim.isStopped && sim.doorState === "open" ? sim.dockedStation() : null;
      if (!rs) { if (u.pax) u.pax.exchanging = false; continue; }

      const route = u.route, terminal = rs === route.last;
      // Al abrir puertas en una estación nueva: cuántos bajan aquí
      if (u.pax?.stationIndex !== rs.index || u.pax.routeId !== route.id) {
        const remaining = route.last.index - rs.index;
        const share = terminal ? 1 : clamp((1.6 / Math.max(1, remaining)) * (1 + 0.3 * rs.combos.length), 0, 0.7);
        u.pax = { stationIndex: rs.index, routeId: route.id, toAlight: u.load * share, boarded: 0, alighted: 0, exchanging: true };
      }
      const p = u.pax;
      let flow = doors * PER_DOOR * dt;

      // Primero bajan…
      const down = Math.min(flow, p.toAlight, u.load);
      u.load -= down; p.toAlight -= down; p.alighted += down; flow -= down;
      this.totals.alighted += down;
      if (down > 0) this.onAlight?.(rs.world, down);

      // …luego suben (nunca en el andén de llegada de una terminal)
      const w = this.waiting[rs.world.index];
      const side = route.side;
      if (!terminal && p.toAlight < 0.5) {
        const up = Math.min(flow, w[side], cap - u.load);
        w[side] -= up; u.load += up; p.boarded += up;
        this.totals.boarded += up;
      }
      if (terminal) u.load = Math.max(0, u.load);
      p.exchanging = p.toAlight >= 0.5 || (!terminal && w[side] >= 2 && u.load < cap - 0.5);
    }
  }
}
