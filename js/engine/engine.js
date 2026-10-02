/* ==========================================================================
   MetroSim — Motor · engine.js
   MetroEngine: el "cerebro" del Metro.

   Simula TODA LA RED (varias líneas, network.js) con un único reloj de PASO
   FIJO, funcione o no la parte gráfica. No importa Three.js ni usa el
   navegador: se puede ejecutar en Node (ver tools/simular.mjs).

     ENTRADA DEL JUGADOR → MetroEngine → estado de la red → render / interfaz / audio

   Cada línea es un LineSystem con sus horarios, señales, trenes, pasajeros
   y regulación. El motor los hace avanzar juntos y conecta las líneas por
   sus combinaciones (transbordos de pasajeros).

   Ofrece a quien lo mira desde fuera:
     · bus de eventos (events.js), común a todas las líneas:
         "train:created" / "train:rebuilt" / "train:removed"  ciclo de vida
         "train:event"  { unit, type, data }   sucesos de cada tren
         "train:state"  { unit, from, to, time } cambio de estado (state.js)
         "command:result" { type, payload, result } respuesta a una orden
     · llegadas estimadas desde la posición real de los trenes (eta.js)
     · pasajeros lógicos (passengers.js) y transbordos entre líneas
     · regulación de intervalos (regulation.js)
     · buzón de órdenes (commands.js)
     · estado legible de toda la red (snapshot / report)

   Compatibilidad: engine.traffic, engine.signals, engine.timetables,
   engine.passengers y engine.regulator son los de la línea activa (la que
   se dibuja y se juega, route.js → setActiveLine).
   ========================================================================== */

import { CONFIG } from "../config.js";
import { LINES, TRANSFERS } from "./network.js";
import { ROUTE_A } from "./route.js";                 // crea los sentidos de cada línea y la línea activa
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

/** Parte de los que bajan en una estación de combinación que siguen viaje por la otra línea. */
const TRANSFER_SHARE = 0.35;

/** Una línea de la red con todos sus sistemas. */
class LineSystem {
  constructor(engine, line, startTime) {
    this.engine = engine;
    this.line = line;
    this.routes = line.routes;
    this.bus = engine.bus;
    this.signals = new Map(this.routes.map(r => [r.id, new SignalSystem(r)]));
    // Malla de servicio alrededor de la hora de inicio (3 h antes, 8 h después): se puede
    // empezar a cualquier hora, también de noche (frecuencia de valle).
    const anchorA = CONFIG.schedule.playerDeparture + line.scheduleOffset;
    const anchorB = anchorA + CONFIG.schedule.reverseOffset;
    const [A, B] = this.routes;
    this.timetables = new Map([
      [A.id, new Timetable(A, anchorA, anchorA - 3 * 3600, anchorA + 8 * 3600)],
      [B.id, new Timetable(B, anchorB, anchorB - 3 * 3600, anchorB + 8 * 3600)],
    ]);
    this.traffic = new TrafficManager({
      routes: this.routes, timetables: this.timetables, signals: this.signals, bus: this.bus,
      onUnitEvent: (u, t, d) => engine.onUnitEvent(u, t, d),
    });
    this.passengers = new PassengerFlow(line, startTime);
    this.traffic.boardingChecks.push(u => this.passengers.isBusy(u));
    this.regulator = new Regulator(this);
  }

  get time() { return this.engine.time; }
  get trains() { return this.traffic.units; }

  update(dt, clock) {
    this.traffic.update(dt, clock);
    this.passengers.update(dt, clock, this.trains);
    this.regulator.update(clock);
  }
}

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
    this.onUnitEvent = onUnitEvent;
    this.lines = new Map(LINES.map(line => [line.id, new LineSystem(this, line, startTime)]));
    this.commands = new CommandQueue(this);

    // Transbordos: parte de los que bajan en una combinación pasa a esperar en la otra línea
    for (const t of TRANSFERS) {
      const A = this.lines.get(t.a.line.id), B = this.lines.get(t.b.line.id);
      const link = (from, to, toStation) => {
        const prev = from.passengers.onAlight;
        from.passengers.onAlight = (st, n) => {
          prev?.(st, n);
          if (st.name === t.name) to.passengers.addTransfer(toStation, n * TRANSFER_SHARE);
        };
      };
      link(A, B, t.b.station);
      link(B, A, t.a.station);
    }

    // Línea activa: la que se dibuja y se juega (nombres de siempre)
    const main = this.lines.get(ROUTE_A.line.id);
    this.main = main;
    this.traffic = main.traffic;
    this.signals = main.signals;
    this.timetables = main.timetables;
    this.passengers = main.passengers;
    this.regulator = main.regulator;
  }

  /** Sistema de una línea ("3", "6") o de la línea de una ruta. */
  line(idOrRoute) {
    return this.lines.get(typeof idOrRoute === "string" ? idOrRoute : idOrRoute.line.id) || null;
  }

  /** ¿Está subiendo o bajando gente de este tren (lógica o visible)? */
  isBoarding(unit) { return this.line(unit.route).traffic.isBoarding(unit); }

  /* ----- Órdenes (roles) ----- */

  /**
   * Deja una orden en el buzón del motor; se cumple al comienzo del próximo paso.
   * Ejemplos:
   *   engine.command("driver.notchUp", { trainId: "L3-0801" })
   *   engine.command("control.hold",   { trainId: "L6-0805" })
   */
  command(type, payload = {}) { this.commands.push(type, payload); }

  /** Tren por su id de servicio (o null), en cualquier línea. */
  findTrain(id) { return this.trains.find(u => u.id === id) || null; }

  /** Hora actual de la simulación (segundos desde medianoche). */
  get time() { return this.clock.time; }

  /** Todos los trenes de la red (todas las líneas). */
  get trains() { return [...this.lines.values()].flatMap(l => l.trains); }

  /* ----- Avance del tiempo ----- */

  /** Un paso de simulación de duración fija. */
  step() {
    this.commands.process();
    for (const l of this.lines.values()) l.update(this.clock.step, this.clock.time);
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
  runUntil(time, { step = 0.5, onStep } = {}) {
    while (this.clock.time < time) {
      this.commands.process();
      for (const l of this.lines.values()) l.update(step, this.clock.time);
      onStep?.(step, this.clock.time);
      this.clock.time += step;
    }
    this.clock.time = time;
  }

  /* ----- Llegadas ----- */

  /** Hora estimada de llegada de un tren a una estación de su línea (o null si ya la pasó). */
  eta(unit, lineStation) {
    return estimateArrival(unit, unit.route.stationOf(lineStation), this.time);
  }

  /**
   * Próximos trenes a una estación en un sentido (lo que muestran las pantallas del andén).
   * @param {object|string} station  estación de la línea o su nombre
   * @param {object} route           ruta (sentido): indica también la línea
   */
  arrivalsAt(station, route) {
    const ls = this.line(route);
    const st = typeof station === "string" ? ls.line.stations.find(s => s.name === station) : station;
    if (!st) return [];
    return ls.traffic.arrivalsFor(st, route, this.time);
  }

  /* ----- Estado legible ----- */

  /** Descripción de cada tren de la red, en datos simples. */
  snapshot(lineId = null) {
    return this.trains
      .filter(u => !lineId || u.route.line.id === lineId)
      .map(u => describeTrain(u)).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Estado de la red como texto (útil en la consola o en Node), agrupado por línea. */
  report() {
    const out = [`${formatClock(this.time)} · ${this.trains.length} trenes en la red`];
    for (const l of this.lines.values()) {
      out.push(`  ${l.line.name} · ${l.trains.length} trenes`);
      for (const t of this.snapshot(l.line.id)) {
        const delay = t.delay === null ? "" : ` · ${t.delay >= 0 ? "+" : "−"}${Math.abs(Math.round(t.delay))} s`;
        out.push(`    ${t.id.padEnd(9)} ${t.direction.padEnd(34)} ${t.location.padEnd(42)} ${String(t.kmh).padStart(3)} km/h · ${String(t.load).padStart(3)} pax · ${t.state}${delay}`);
      }
    }
    return out.join("\n");
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
    line: route.line.id,
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
