/* ==========================================================================
   MetroSim — Motor · traffic.js
   Gestor de tráfico: todos los trenes de la Línea 3 en ambos sentidos.

   · Cada ruta (sentido) tiene su horario y sus señales. Los servicios entran
     desde las cocheras de su terminal de origen y se retiran tras la de destino.
   · Cada tren es una "unidad": simulación (TrainSim, en coordenadas de su
     ruta) + conductor (AutoDriver o el jugador).
   · Este módulo es SOLO lógica. Avisa por el bus de eventos cuando un tren
     se crea ("train:created"), cambia de vía ("train:rebuilt") o se retira
     ("train:removed"); render/trainViews.js escucha y dibuja su modelo 3D.
   · Maniobra de retorno: al llegar al fondo de la cola de maniobras tras una
     terminal, el tren cambia de cabina, pasa por el cambio de vía a la vía
     contraria y toma el siguiente servicio del sentido opuesto. Si no hay
     servicio próximo, se retira a cocheras.
   ========================================================================== */

import { CONFIG } from "../config.js";
import { ROUTES, oppositeRoute } from "./route.js";
import { TrainSim, AutoDriver } from "./sim.js";
import { TRAIN_LAYOUT } from "./consist.js";
import { EventBus } from "./events.js";

const L = CONFIG.train.length;

export class TrafficManager {
  /**
   * @param {object} opts
   * @param {Map<string, import("./schedule.js").Timetable>} opts.timetables  por id de ruta
   * @param {Map<string, import("./signals.js").SignalSystem>} opts.signals  por id de ruta
   * @param {EventBus} opts.bus  bus de eventos del motor (ciclo de vida de los trenes)
   * @param {(unit, type:string, data?:object)=>void} opts.onUnitEvent
   */
  constructor({ timetables, signals, bus = new EventBus(), onUnitEvent = () => {} }) {
    this.bus = bus;
    this.timetables = timetables;
    this.signals = signals;
    this.onUnitEvent = onUnitEvent;
    this.units = [];
    this.started = new Set();          // servicios ya iniciados (o reservados para el jugador)
    this.isBusyFor = () => false;      // lo conecta el sistema de viajeros
  }

  /* ----- Creación y retirada ----- */

  /**
   * @param {object} trip   servicio del horario (lleva su ruta)
   * @param {object} opts
   * @param {boolean} opts.isPlayer      tren conducido por el jugador
   * @param {object|number} opts.start   estación de la ruta o coordenada de la ruta
   * @param {number} opts.targetIndex    primera estación objetivo del ATO
   * @param {number|null} opts.holdUntil espera en cocheras hasta esta hora
   */
  createUnit(trip, { isPlayer = false, start = null, targetIndex = 0, holdUntil = null } = {}) {
    const route = trip.route;
    const unit = {
      id: trip.id, trip, route, isPlayer,
      load: 0,
      materialized: false,
      delay: 0,
      dockedIdx: null,
      arrivedIdx: null,
    };
    unit.sim = new TrainSim(route, (type, data) => this.onUnitEvent(unit, type, data), start ?? route.track.depotZ);
    unit.prevPos = unit.sim.position;
    unit.ato = isPlayer ? null : this.makeDriver(unit, targetIndex, holdUntil);
    this.started.add(trip.id);
    this.units.push(unit);
    this.bus.emit("train:created", unit);
    return unit;
  }

  makeDriver(unit, targetIndex = 0, holdUntil = null) {
    return new AutoDriver(unit.sim, {
      trip: unit.trip, signals: this.signals.get(unit.route.id), targetIndex, holdUntil,
      onEvent: (type, data) => this.onUnitEvent(unit, `ato:${type}`, data),
      isBoardingBusy: () => this.isBusyFor(unit),
    });
  }

  /** Próximo servicio libre del sentido contrario para un tren que termina. */
  nextTripFor(route, clock, minLead = 90, maxLead = 420) {
    return this.timetables.get(route.id).trips.find(t => !this.started.has(t.id) && t.departure - clock >= minLead && t.departure - clock <= maxLead) || null;
  }

  /** ¿Está libre el punto de entrada (cocheras) de una ruta? */
  depotFree(route) {
    return !this.units.some(u => u.route === route && u.sim.position > route.first.stopZ + 40);
  }

  /**
   * Maniobra de retorno: el tren pasa a la vía contraria con un nuevo servicio.
   * El extremo trasero pasa a ser el delantero (cambio de cabina).
   */
  turnback(unit, trip) {
    const route = trip.route;
    this.onUnitEvent(unit, "turnbackStart");
    unit.route = route;
    unit.trip = trip;
    unit.id = trip.id;
    unit.delay = 0;
    unit.dockedIdx = unit.arrivedIdx = null;
    unit.announced = null;
    unit.exchangeIdx = null;
    unit.sim.route = route;
    unit.sim.reset(route.track.depotZ);
    unit.prevPos = unit.sim.position;
    this.bus.emit("train:rebuilt", unit);          // el dibujo cambia de vía y de cabina
    unit.ato = unit.isPlayer ? null : this.makeDriver(unit, 0, trip.departure - 150);
    this.started.add(trip.id);
    this.onUnitEvent(unit, "turnback", { trip });
  }

  removeUnit(unit) {
    this.onUnitEvent(unit, "removed");
    this.units = this.units.filter(u => u !== unit);
    this.bus.emit("train:removed", unit);
  }

  /** Inicia los servicios cuya hora ha llegado (si la cochera de su ruta está libre). */
  spawnDue(clock) {
    for (const route of ROUTES) {
      const depotBusy = this.units.some(u => u.route === route && u.sim.position > route.first.stopZ + 40);
      if (depotBusy) continue;
      const tt = this.timetables.get(route.id);
      const due = tt.trips.find(t => !this.started.has(t.id) && clock >= t.departure - 150 && clock < t.departure + 600);
      if (due) this.createUnit(due);
    }
  }

  /* ----- Paso de simulación ----- */
  update(dt, clock) {
    this.spawnDue(clock);

    for (const u of this.units) {
      u.prevPos = u.sim.position;
      u.ato?.update(dt, clock);
      u.sim.update(dt);
      this.trackSchedule(u, clock);
    }

    for (const route of ROUTES) {
      const units = this.units.filter(u => u.route === route);

      // Alcance: nadie atraviesa la cola del tren de delante (misma vía)
      const ordered = [...units].sort((a, b) => b.sim.position - a.sim.position);
      for (let i = 0; i < ordered.length - 1; i++) {
        const behind = ordered[i], ahead = ordered[i + 1];
        const rear = ahead.sim.position + L;
        if (behind.sim.position < rear + 0.2) {
          if (behind.sim.speed > 0.5) this.onUnitEvent(behind, "collision", { kmh: behind.sim.speedKmh, other: ahead });
          behind.sim.position = rear + 0.2;
          behind.sim.velocity = Math.min(0, behind.sim.velocity);
          behind.sim.accel = Math.min(behind.sim.accel, 0);
        }
      }

      // Señales rebasadas en rojo (aspecto del paso anterior) y recálculo
      const sig = this.signals.get(route.id);
      for (const u of units) {
        for (const s of sig.passedBetween(u.prevPos, u.sim.position)) {
          if (s.aspect === "red") this.onUnitEvent(u, "redSignal", { signal: s });
        }
      }
      sig.update(units, clock);
    }

    // Trenes al final de la cola de maniobras: cambio de cabina y de vía, o a cocheras
    for (const u of [...this.units]) {
      if (u.ato?.state !== "retired") continue;
      u.retiredFor = (u.retiredFor || 0) + dt;
      if (u.retiredFor < CONFIG.turnback.cabChangeTime) continue;
      const other = oppositeRoute(u.route);
      const trip = this.depotFree(other) ? this.nextTripFor(other, clock) : null;
      if (trip) { u.retiredFor = 0; this.turnback(u, trip); }
      else this.removeUnit(u);              // sin servicio próximo o vía contraria ocupada: a cocheras (libera la cola)
    }
  }

  /** Llegadas y salidas reales frente al horario. */
  trackSchedule(u, clock) {
    const sim = u.sim;
    const docked = sim.isStopped ? sim.dockedStation() : null;
    if (docked && u.arrivedIdx !== docked.index) {
      u.arrivedIdx = docked.index;
      u.dockedIdx = docked.index;
      u.delay = clock - u.trip.arr[docked.index];
      this.onUnitEvent(u, "arrivedStation", { station: docked, delay: u.delay });
    }
    if (u.dockedIdx !== null && sim.position < u.route.stations[u.dockedIdx].stopZ - 3) {
      const st = u.route.stations[u.dockedIdx];
      u.delay = clock - u.trip.dep[st.index];
      this.onUnitEvent(u, "departedStation", { station: st, delay: u.delay });
      u.dockedIdx = null;
    }
  }

  /* ----- Mundo (solo matemáticas, sin dibujo) ----- */

  /** Centro del tren en coordenadas del mundo. */
  worldCenterZ(u) { return u.route.toWorldZ(u.sim.position + L / 2); }

  /* ----- Consultas ----- */

  /** Tren detenido en el andén de una estación del mundo, en una ruta. */
  unitDockedAt(worldStation, route) {
    const rs = route.stationOf(worldStation);
    return this.units.find(u => u.route === route && u.sim.isStopped && Math.abs(u.sim.position - rs.stopZ) <= CONFIG.station.stopTolerance) || null;
  }

  /** Próximos trenes a una estación por un andén (side = +1 vía 1 · −1 vía 2). */
  arrivalsFor(worldStation, route, clock) {
    const rs = route.stationOf(worldStation);
    const list = [];
    for (const u of this.units) {
      if (u.route !== route || u.sim.position < rs.stopZ - 1) continue;
      const here = Math.abs(u.sim.position - rs.stopZ) <= CONFIG.station.stopTolerance && u.sim.isStopped;
      const eta = here ? 0 : Math.max(0, u.trip.arr[rs.index] + Math.max(0, u.delay) - clock);
      list.push({ here, eta, minutes: Math.floor(eta / 60) });
    }
    for (const t of this.timetables.get(route.id).upcomingAt(rs.index, clock, this.started)) {
      const eta = t.arr[rs.index] - clock;
      list.push({ here: false, eta, minutes: Math.floor(eta / 60) });
    }
    return list.sort((a, b) => a.eta - b.eta);
  }

  /**
   * ¿Hay un hueco de puerta del tren en esta coordenada z del mundo?
   * Una puerta a dz metros del testero está en la coordenada de ruta
   * (posición + dz), sea cual sea el sentido.
   */
  doorAtWorldZ(u, z, tolerance = 0.55) {
    for (const dz of TRAIN_LAYOUT.doors) {
      if (Math.abs(u.route.toWorldZ(u.sim.position + dz) - z) < tolerance) return dz;
    }
    return null;
  }
}
