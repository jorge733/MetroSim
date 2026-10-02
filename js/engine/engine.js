/* ==========================================================================
   MetroSim — Motor · engine.js
   MetroEngine: el "cerebro" del Metro.

   Reúne el reloj, los horarios, las señales y todos los trenes de la red, y
   los hace avanzar con PASO FIJO, funcione o no la parte gráfica. No importa
   Three.js ni usa el navegador: se puede ejecutar en Node
   (ver tools/simular.mjs).

     ENTRADA DEL JUGADOR → MetroEngine → estado de la red → render / interfaz / audio

   Envuelve los sistemas del Metro (TrafficManager, SignalSystem, Timetable)
   y ofrece lo que necesita quien lo mira desde fuera:
     · bus de eventos (events.js):
         "train:created" / "train:rebuilt" / "train:removed"  ciclo de vida
         "train:event"  { unit, type, data }   sucesos de cada tren
         "train:state"  { unit, from, to, time } cambio de estado (state.js)
     · llegadas estimadas desde la posición real de los trenes (eta.js)
     · estado legible de toda la red (snapshot / report)
   Es la base para las siguientes fases: demanda de pasajeros, regulación,
   más líneas y el Centro de Control.
   ========================================================================== */

import { CONFIG, STATIONS } from "../config.js";
import { ROUTES, ROUTE_A, ROUTE_B } from "./route.js";
import { Timetable } from "./schedule.js";
import { SignalSystem } from "./signals.js";
import { TrafficManager } from "./traffic.js";
import { SimClock } from "./clock.js";
import { EventBus } from "./events.js";
import { formatClock } from "./format.js";
import { TRAIN_STATES } from "./state.js";
import { estimateArrival } from "./eta.js";

export class MetroEngine {
  /**
   * @param {object} opts
   * @param {number} opts.startTime   hora inicial (segundos desde medianoche)
   * @param {(unit, type:string, data?:object)=>void} opts.onUnitEvent  receptor directo de los sucesos de cada tren
   *        (opcional: también llegan por el bus como "train:event")
   */
  constructor({ startTime = CONFIG.startTime, onUnitEvent = () => {} } = {}) {
    this.bus = new EventBus();
    this.clock = new SimClock(startTime);
    this.signals = new Map(ROUTES.map(r => [r.id, new SignalSystem(r)]));
    this.timetables = new Map([
      [ROUTE_A.id, new Timetable(ROUTE_A, CONFIG.schedule.playerDeparture)],
      [ROUTE_B.id, new Timetable(ROUTE_B, CONFIG.schedule.playerDeparture + CONFIG.schedule.reverseOffset)],
    ]);
    this.onUnitEvent = onUnitEvent;
    this.traffic = new TrafficManager({
      timetables: this.timetables, signals: this.signals, bus: this.bus,
      onUnitEvent: (u, t, d) => this.onUnitEvent(u, t, d),
    });
  }

  /** Hora actual de la simulación (segundos desde medianoche). */
  get time() { return this.clock.time; }

  /** Todos los trenes de la red. */
  get trains() { return this.traffic.units; }

  /* ----- Avance del tiempo ----- */

  /** Un paso de simulación de duración fija. */
  step() {
    this.traffic.update(this.clock.step, this.clock.time);
    this.clock.tick();
  }

  /**
   * Avanza con el tiempo real de un fotograma (paso fijo, ver clock.js).
   * @param {number} realDt
   * @param {(dt:number, time:number)=>void} afterStep  se llama tras cada paso
   * @returns {number} pasos simulados
   */
  update(realDt, afterStep) {
    const n = this.clock.advance(realDt);
    for (let i = 0; i < n; i++) {
      this.step();
      afterStep?.(this.clock.step, this.clock.time);
    }
    return n;
  }

  /**
   * Simula rápidamente hasta una hora (por ejemplo, el servicio previo al
   * inicio de la partida), con pasos más largos.
   */
  runUntil(time, { step = 0.25, onStep } = {}) {
    while (this.clock.time < time) {
      this.traffic.update(step, this.clock.time);
      onStep?.(step, this.clock.time);
      this.clock.time += step;
    }
    this.clock.time = time;
  }

  /* ----- Llegadas ----- */

  /** Hora estimada de llegada de un tren a una estación del mundo (o null si ya la pasó). */
  eta(unit, worldStation) {
    return estimateArrival(unit, unit.route.stationOf(worldStation), this.time);
  }

  /**
   * Próximos trenes a una estación en un sentido (lo que muestran las pantallas del andén).
   * @param {object|string} station  estación del mundo o su nombre
   * @param {object} route           ruta (sentido)
   */
  arrivalsAt(station, route) {
    const st = typeof station === "string" ? STATIONS.find(s => s.name === station) : station;
    return this.traffic.arrivalsFor(st, route, this.time);
  }

  /* ----- Estado legible ----- */

  /** Descripción de cada tren de la red, en datos simples. */
  snapshot() {
    return this.trains.map(u => describeTrain(u)).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Estado de la red como texto (útil en la consola o en Node). */
  report() {
    const lines = [`${formatClock(this.time)} · ${this.trains.length} trenes en la red`];
    for (const t of this.snapshot()) {
      const delay = t.delay === null ? "" : ` · ${t.delay >= 0 ? "+" : "−"}${Math.abs(Math.round(t.delay))} s`;
      lines.push(`  ${t.id.padEnd(9)} ${t.direction.padEnd(34)} ${t.location.padEnd(42)} ${String(t.kmh).padStart(3)} km/h · ${t.state}${delay}`);
    }
    return lines.join("\n");
  }
}

/** Estado legible de un tren. */
export function describeTrain(u) {
  const sim = u.sim, route = u.route;
  const docked = sim.isStopped ? sim.dockedStation() : null;
  const next = sim.nextStation();
  let location;
  if (docked) location = `en ${docked.name}`;
  else if (sim.position > route.first.stopZ + 5) location = `cocheras de ${route.first.name}`;
  else if (!next) location = `cola de maniobras tras ${route.last.name}`;
  else location = `entre ${route.stations[next.index - 1].name} y ${next.name}`;

  const label = TRAIN_STATES[u.state] ?? "—";
  return {
    id: u.id,
    direction: `${route.first.name} → ${route.last.name}`,
    location,
    kmh: Math.round(sim.speedKmh),
    stateId: u.state,
    state: u.isPlayer ? `${label} (jugador)` : label,
    doors: sim.doorState,
    delay: u.arrivedIdx === null && u.dockedIdx === null ? null : u.delay,
    load: u.load,
    position: sim.position,
  };
}
