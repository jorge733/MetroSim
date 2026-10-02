/* ==========================================================================
   MetroSim — Alpha 0.4 · traffic.js
   Gestor de tráfico: todos los trenes de la Línea 3.

   · Los servicios entran desde las cocheras de Plaza Quilicura según el
     horario (schedule.js) y se retiran tras Fernando Castillo Velasco.
   · Cada tren es una "unidad": simulación (TrainSim) + conductor (AutoDriver
     o el jugador) + modelo 3D + plazas para viajeros.
   · Las señales (signals.js) se recalculan con la posición de todos los trenes.
   · Lleva la cuenta de retrasos reales frente al horario.
   ========================================================================== */

import { CONFIG, STATIONS } from "./config.js";
import { TrainSim, AutoDriver } from "./sim.js";
import { buildTrainModel, buildTrainSlots } from "./train.js";

export class TrafficManager {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {import("./schedule.js").Timetable} opts.timetable
   * @param {import("./signals.js").SignalSystem} opts.signals
   * @param {(unit, type:string, data?:object)=>void} opts.onUnitEvent
   */
  constructor({ scene, timetable, signals, onUnitEvent = () => {} }) {
    this.scene = scene;
    this.timetable = timetable;
    this.signals = signals;
    this.onUnitEvent = onUnitEvent;
    this.units = [];
    this.started = new Set();          // ids de servicios ya iniciados (o reservados para el jugador)
    this.isBusyFor = () => false;      // lo conecta el sistema de viajeros
  }

  /* ----- Creación y retirada de trenes ----- */

  /**
   * @param {object} trip     servicio del horario
   * @param {object} opts
   * @param {boolean} opts.isPlayer  tren conducido por el jugador (cabina completa, sin ATO)
   * @param {object|number} opts.start  estación o coordenada inicial
   * @param {number} opts.targetIndex   primera estación objetivo del ATO
   */
  createUnit(trip, { isPlayer = false, start = CONFIG.track.depotZ, targetIndex = 0 } = {}) {
    const unit = {
      id: trip ? trip.id : `TREN-${this.units.length + 1}`,
      trip, isPlayer,
      slots: buildTrainSlots(),
      load: 0,                        // viajeros "abstractos" (cuando no se dibujan)
      materialized: false,
      delay: 0,                       // retraso actual frente al horario (s)
      dockedIdx: null,
      arrivedIdx: null,
    };
    unit.sim = new TrainSim((type, data) => this.onUnitEvent(unit, type, data), start);
    unit.prevPos = unit.sim.position;
    unit.model = buildTrainModel({ cab: isPlayer });
    unit.group = unit.model.group;
    unit.group.position.z = unit.sim.position;
    this.scene.add(unit.group);
    unit.ato = isPlayer ? null : new AutoDriver(unit.sim, {
      trip, signals: this.signals, targetIndex,
      onEvent: (type, data) => this.onUnitEvent(unit, `ato:${type}`, data),
      isBoardingBusy: () => this.isBusyFor(unit),
    });
    if (trip) this.started.add(trip.id);
    this.units.push(unit);
    return unit;
  }

  removeUnit(unit) {
    this.onUnitEvent(unit, "removed");
    this.scene.remove(unit.group);
    unit.group.traverse(obj => {
      obj.geometry?.dispose();
      // Los materiales son propios de cada tren; las texturas compartidas no se liberan
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach(m => m.dispose());
    });
    this.units = this.units.filter(u => u !== unit);
  }

  /** Inicia los servicios cuya hora de salida de cocheras ha llegado (si la cochera está libre). */
  spawnDue(clock) {
    const depotBusy = this.units.some(u => u.sim.position > STATIONS[0].stopZ + 40);
    if (depotBusy) return;
    const due = this.timetable.trips.find(t => !this.started.has(t.id) && clock >= t.departure - 150 && clock < t.departure + 600);
    if (due) this.createUnit(due);
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

    // Alcance entre trenes: nadie puede atravesar la cola del tren de delante
    const L = CONFIG.train.length;
    const ordered = [...this.units].sort((a, b) => b.sim.position - a.sim.position);   // del último al primero
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

    // Señales rebasadas en rojo (con el aspecto del paso anterior)
    for (const u of this.units) {
      for (const s of this.signals.passedBetween(u.prevPos, u.sim.position)) {
        if (s.aspect === "red") this.onUnitEvent(u, "redSignal", { signal: s });
      }
    }

    this.signals.update(this.units, clock);

    for (const u of [...this.units]) if (u.ato?.state === "retired") this.removeUnit(u);
  }

  /** Llegadas y salidas reales frente al horario. */
  trackSchedule(u, clock) {
    const sim = u.sim;
    const docked = sim.isStopped ? sim.dockedStation() : null;
    if (docked && u.arrivedIdx !== docked.index) {
      u.arrivedIdx = docked.index;
      u.dockedIdx = docked.index;
      if (u.trip) u.delay = clock - u.trip.arr[docked.index];
      this.onUnitEvent(u, "arrivedStation", { station: docked, delay: u.delay });
    }
    if (u.dockedIdx !== null && sim.position < STATIONS[u.dockedIdx].stopZ - 3) {
      const st = STATIONS[u.dockedIdx];
      if (u.trip) u.delay = clock - u.trip.dep[st.index];
      this.onUnitEvent(u, "departedStation", { station: st, delay: u.delay });
      u.dockedIdx = null;
    }
  }

  /** Posición, puertas y visibilidad de los modelos. */
  syncVisuals(cameraZ) {
    for (const u of this.units) {
      u.group.position.z = u.sim.position;
      const p = u.sim.doorProgress, eased = p * p * (3 - 2 * p);
      u.model.doors.forEach(d => { d.mesh.position.z = d.closedZ + (d.openZ - d.closedZ) * eased; });
      u.group.visible = u.isPlayer || Math.abs(u.sim.position + CONFIG.train.length / 2 - cameraZ) < CONFIG.renderRadius;
    }
  }

  /* ----- Consultas ----- */

  /** Tren detenido con puertas en una estación (o null). */
  unitDockedAt(st) {
    return this.units.find(u => u.sim.isStopped && Math.abs(u.sim.position - st.stopZ) <= CONFIG.station.stopTolerance) || null;
  }

  /** Próximos trenes a una estación para la pantalla del andén. */
  arrivalsFor(st, clock) {
    const list = [];
    for (const u of this.units) {
      if (u.sim.position < st.stopZ - 1) continue;                // ya pasó
      const here = Math.abs(u.sim.position - st.stopZ) <= CONFIG.station.stopTolerance && u.sim.isStopped;
      let eta;
      if (here) eta = 0;
      else if (u.trip) eta = Math.max(0, u.trip.arr[st.index] + Math.max(0, u.delay) - clock);
      else eta = (u.sim.position - st.stopZ) / 12;
      list.push({ here, eta, minutes: Math.floor(eta / 60) });
    }
    for (const t of this.timetable.upcomingAt(st.index, clock, this.started)) {
      const eta = t.arr[st.index] - clock;
      list.push({ here: false, eta, minutes: Math.floor(eta / 60) });
    }
    return list.sort((a, b) => a.eta - b.eta);
  }

  /** Tren más cercano a una coordenada (por su centro). */
  nearestUnit(z) {
    let best = null, bestD = Infinity;
    for (const u of this.units) {
      const d = Math.abs(u.sim.position + CONFIG.train.length / 2 - z);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best ? { unit: best, distance: bestD } : null;
  }
}
