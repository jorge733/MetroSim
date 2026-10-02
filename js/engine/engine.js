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
     · pasajeros lógicos (passengers.js): gente esperando en cada andén,
       subidas y bajadas que alargan las paradas
     · regulación de intervalos (regulation.js): retiene o apura trenes
       para que no se formen racimos
     · buzón de órdenes (commands.js): los roles mandan órdenes con
       engine.command(tipo, datos) y el resultado llega por "command:result"
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
import { CommandQueue } from "./commands.js";
import { PassengerFlow } from "./passengers.js";
import { Regulator } from "./regulation.js";

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
    // Malla de servicio alrededor de la hora de inicio (3 h antes, 8 h después): se puede
    // empezar a cualquier hora, también de noche (frecuencia de valle).
    const anchorA = CONFIG.schedule.playerDeparture, anchorB = anchorA + CONFIG.schedule.reverseOffset;
    this.timetables = new Map([
      [ROUTE_A.id, new Timetable(ROUTE_A, anchorA, anchorA - 3 * 3600, anchorA + 8 * 3600)],
      [ROUTE_B.id, new Timetable(ROUTE_B, anchorB, anchorB - 3 * 3600, anchorB + 8 * 3600)],
    ]);
    this.onUnitEvent = onUnitEvent;
    this.traffic = new TrafficManager({
      timetables: this.timetables, signals: this.signals, bus: this.bus,
      onUnitEvent: (u, t, d) => this.onUnitEvent(u, t, d),
    });
    this.commands = new CommandQueue(this);
    this.passengers = new PassengerFlow(startTime);
    this.traffic.boardingChecks.push(u => this.passengers.isBusy(u));
    this.regulator = new Regulator(this);
  }

  /** ¿Está subiendo o bajando gente de este tren (lógica o visible)? */
  isBoarding(unit) { return this.traffic.isBoarding(unit); }

  /* ----- Órdenes (roles) ----- */

  /**
   * Deja una orden en el buzón del motor; se cumple al comienzo del próximo paso.
   * Ejemplos:
   *   engine.command("driver.notchUp", { trainId: "L3-0801" })
   *   engine.command("control.hold",   { trainId: "L3-0745" })
   */
  command(type, payload = {}) { this.commands.push(type, payload); }

  /** Tren por su id de servicio (o null). */
  findTrain(id) { return this.trains.find(u => u.id === id) || null; }

  /** Hora actual de la simulación (segundos desde medianoche). */
  get time() { return this.clock.time; }

  /** Todos los trenes de la red. */
  get trains() { return this.traffic.units; }

  /* ----- Avance del tiempo ----- */

  /** Un paso de simulación de duración fija. */
  step() {
    this.commands.process();
    this.traffic.update(this.clock.step, this.clock.time);
    this.passengers.update(this.clock.step, this.clock.time, this.trains);
    this.regulator.update(this.clock.time);
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
      this.commands.process();
      this.traffic.update(step, this.clock.time);
      this.passengers.update(step, this.clock.time, this.trains);
      this.regulator.update(this.clock.time);
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
      lines.push(`  ${t.id.padEnd(9)} ${t.direction.padEnd(34)} ${t.location.padEnd(42)} ${String(t.kmh).padStart(3)} km/h · ${String(t.load).padStart(3)} pax · ${t.state}${delay}`);
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
    load: Math.round(u.load || 0),
    position: sim.position,
  };
}
