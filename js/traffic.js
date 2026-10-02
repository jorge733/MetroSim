/* ==========================================================================
   MetroSim — Alpha 0.5 · traffic.js
   Gestor de tráfico: todos los trenes de la Línea 3 en ambos sentidos.

   · Cada ruta (sentido) tiene su horario y sus señales. Los servicios entran
     desde las cocheras de su terminal de origen y se retiran tras la de destino.
   · Cada tren es una "unidad": simulación (TrainSim, en coordenadas de su
     ruta) + conductor (AutoDriver o el jugador) + modelo 3D + plazas.
   · syncVisuals() convierte la posición de la ruta a coordenadas del mundo:
     la vía 2 circula hacia +Z, así que su tren va girado 180°.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { ROUTES } from "./route.js";
import { TrainSim, AutoDriver } from "./sim.js";
import { buildTrain, buildTrainSlots, TRAIN_LAYOUT } from "./train.js";

const L = CONFIG.train.length;

export class TrafficManager {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {Map<string, import("./schedule.js").Timetable>} opts.timetables  por id de ruta
   * @param {Map<string, import("./signals.js").SignalSystem>} opts.signals  por id de ruta
   * @param {(unit, type:string, data?:object)=>void} opts.onUnitEvent
   */
  constructor({ scene, timetables, signals, onUnitEvent = () => {} }) {
    this.scene = scene;
    this.timetables = timetables;
    this.signals = signals;
    this.onUnitEvent = onUnitEvent;
    this.units = [];
    this.started = new Set();          // servicios ya iniciados (o reservados para el jugador)
    this.isBusyFor = () => false;      // lo conecta el sistema de viajeros
    this.tmp = new THREE.Vector3();
  }

  /* ----- Creación y retirada ----- */

  /**
   * @param {object} trip   servicio del horario (lleva su ruta)
   * @param {object} opts
   * @param {boolean} opts.isPlayer      tren conducido por el jugador
   * @param {object|number} opts.start   estación de la ruta o coordenada de la ruta
   * @param {number} opts.targetIndex    primera estación objetivo del ATO
   */
  createUnit(trip, { isPlayer = false, start = null, targetIndex = 0 } = {}) {
    const route = trip.route;
    const unit = {
      id: trip.id, trip, route, isPlayer,
      slots: buildTrainSlots(),
      load: 0,
      materialized: false,
      delay: 0,
      dockedIdx: null,
      arrivedIdx: null,
    };
    unit.sim = new TrainSim(route, (type, data) => this.onUnitEvent(unit, type, data), start ?? route.track.depotZ);
    unit.prevPos = unit.sim.position;
    unit.model = buildTrain({ routeId: route.id, cab: isPlayer });
    unit.group = unit.model.group;
    unit.group.rotation.y = route.dir === 1 ? 0 : Math.PI;
    this.placeGroup(unit);
    this.scene.add(unit.group);
    unit.ato = isPlayer ? null : new AutoDriver(unit.sim, {
      trip, signals: this.signals.get(route.id), targetIndex,
      onEvent: (type, data) => this.onUnitEvent(unit, `ato:${type}`, data),
      isBoardingBusy: () => this.isBusyFor(unit),
    });
    this.started.add(trip.id);
    this.units.push(unit);
    return unit;
  }

  removeUnit(unit) {
    this.onUnitEvent(unit, "removed");
    this.scene.remove(unit.group);
    // Las geometrías y materiales son compartidos por todos los trenes: no se liberan aquí
    this.units = this.units.filter(u => u !== unit);
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

    for (const u of [...this.units]) if (u.ato?.state === "retired") this.removeUnit(u);
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

  /* ----- Mundo ----- */

  placeGroup(u) {
    u.group.position.set(u.route.trackX, 0, u.route.toWorldZ(u.sim.position));
  }

  /** Centro del tren en coordenadas del mundo. */
  worldCenterZ(u) { return u.route.toWorldZ(u.sim.position + L / 2); }

  /** Posición, puertas y visibilidad de los modelos. */
  syncVisuals(cameraZ) {
    for (const u of this.units) {
      this.placeGroup(u);
      u.model.setDoors(u.sim.doorProgress);
      u.group.visible = u.isPlayer || Math.abs(this.worldCenterZ(u) - cameraZ) < CONFIG.renderRadius + L / 2;
      u.group.updateMatrixWorld(true);
    }
  }

  /** Posición de mundo de un punto local del tren. */
  toWorld(u, local, out = new THREE.Vector3()) { return u.group.localToWorld(out.copy(local)); }

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

  /** ¿Hay un hueco de puerta del tren en esta coordenada z del mundo? */
  doorAtWorldZ(u, z, tolerance = 0.55) {
    for (const dz of TRAIN_LAYOUT.doors) {
      if (Math.abs(this.toWorld(u, this.tmp.set(0, 0, dz)).z - z) < tolerance) return dz;
    }
    return null;
  }
}
