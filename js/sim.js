/* ==========================================================================
   MetroSim — Alpha 0.6 · sim.js
   Simulación de un tren (lógica pura, sin gráficos) y conducción automática.

   Principio: el tren del jugador y los trenes automáticos usan EXACTAMENTE la
   misma simulación (TrainSim). Solo cambia quién da las órdenes: el jugador
   (mando + inversor) o el AutoDriver (ATO).

   Todo se calcula en las coordenadas de la RUTA del tren (route.js): en
   ellas el tren siempre avanza hacia -Z, sea cual sea su sentido real.
   Velocidad con signo: velocity > 0 = avanza, velocity < 0 = retrocede.
   ========================================================================== */

import { CONFIG, NOTCHES, NOTCH_INDEX, REVERSER } from "./config.js";
import { clamp, formatStopError } from "./utils.js";


/* ==========================================================================
   TrainSim
   ========================================================================== */

export class TrainSim {
  /**
   * @param {object} route   ruta (sentido de circulación) del tren
   * @param {(type:string, data?:object)=>void} onEvent  receptor de eventos (mensajes, sonidos...)
   * @param {object|number} start  estación de la ruta (se coloca en su marca) o coordenada z
   */
  constructor(route, onEvent = () => {}, start = route.first) {
    this.route = route;
    this.onEvent = onEvent;
    this.reset(start);
  }

  reset(start = this.route.first) {
    this.position = typeof start === "number" ? start : start.stopZ;   // z del testero delantero
    this.velocity = 0;               // m/s con signo
    this.accel = 0;                  // esfuerzo aplicado (m/s²): + tracción, − freno. Con limitación de jerk
    this.notch = NOTCH_INDEX.B3;     // se empieza frenado
    this.reverser = 1;               // inversor en ADELANTE
    this.doorState = "closed";       // closed | opening | open | closing
    this.doorProgress = 0;           // 0 = cerradas, 1 = abiertas
    this.autoDemand = null;          // si no es null, la conducción automática manda
    this.overspeedWarned = false;
    this.onEvent("reset", { start });
  }

  /* ----- Consultas ----- */
  get speed() { return Math.abs(this.velocity); }
  get speedKmh() { return this.speed * 3.6; }
  get notchData() { return NOTCHES[this.notch]; }
  get reverserData() { return REVERSER[this.reverser]; }
  get emergency() { return this.notch === NOTCH_INDEX.EM; }
  get doorsClosed() { return this.doorState === "closed"; }
  get isStopped() { return this.speed < 0.01; }
  get movingBackwards() { return this.velocity < -0.01; }
  get isBraking() {
    if (this.emergency) return true;
    if (this.autoDemand !== null) return this.autoDemand < 0;
    return this.notchData.type === "brake";
  }

  /** Límite efectivo: el de la vía o el de marcha atrás. */
  currentLimit() {
    const track = this.route.speedLimitAt(this.position);
    return this.reverser === -1 || this.movingBackwards ? Math.min(track, Math.round(CONFIG.train.reverseMaxSpeed * 3.6)) : track;
  }

  dockedStation() {
    return this.route.stations.find(s => Math.abs(this.position - s.stopZ) <= CONFIG.station.stopTolerance) || null;
  }
  nearestStation() {
    return this.route.stations.reduce((best, s) =>
      Math.abs(this.position - s.stopZ) < Math.abs(this.position - best.stopZ) ? s : best);
  }
  /** Próxima estación cuyo punto de parada está por delante del tren. */
  nextStation() {
    return this.route.stations.find(s => s.stopZ < this.position - CONFIG.station.stopTolerance) || null;
  }

  /* ----- Órdenes del conductor ----- */
  notchUp() {
    if (this.emergency) {
      if (!this.isStopped) return { text: "Emergencia enclavada hasta la detención total del tren.", level: "alert" };
      this.notch = NOTCH_INDEX.B3;
      this.onEvent("notch");
      return { text: "Emergencia rearmada · mando en B3", level: "info" };
    }
    if (this.notch >= NOTCHES.length - 1) return null;
    this.notch++;
    this.onEvent("notch");
    if (this.notchData.type === "power") {
      if (!this.doorsClosed) return { text: "Tracción bloqueada: cierra las puertas", level: "warn" };
      if (this.reverser === 0) return { text: "Inversor en NEUTRO: selecciona sentido (Q adelante · E atrás)", level: "warn" };
    }
    return null;
  }

  notchDown() {
    if (this.emergency) return null;
    if (this.notch - 1 === NOTCH_INDEX.EM) return this.emergencyBrake();
    this.notch--;
    this.onEvent("notch");
    return null;
  }

  emergencyBrake(reason = null) {
    if (this.emergency) return null;
    this.notch = NOTCH_INDEX.EM;
    this.onEvent("emergency", { reason });
    return { text: reason || "FRENO DE EMERGENCIA", level: "alert" };
  }

  /** Mueve el inversor un paso (+1 hacia ADELANTE, −1 hacia ATRÁS). Solo parado y sin tracción. */
  shiftReverser(step) {
    const target = clamp(this.reverser + step, -1, 1);
    if (target === this.reverser) return null;
    if (!this.isStopped) return { text: "El inversor solo puede moverse con el tren parado", level: "warn" };
    if (this.notchData.type === "power") return { text: "Lleva el mando a N o freno antes de mover el inversor", level: "warn" };
    this.reverser = target;
    this.onEvent("reverser");
    const extra = target === -1 ? ` · máx. ${Math.round(CONFIG.train.reverseMaxSpeed * 3.6)} km/h` : "";
    return { text: `Inversor: ${this.reverserData.label}${extra}`, level: target === -1 ? "warn" : "info" };
  }

  toggleDoors({ automatic = false } = {}) {
    if (this.doorState === "open" || this.doorState === "opening") {
      this.doorState = "closing";
      return { text: "Cerrando puertas", level: "info" };
    }
    if (this.doorState === "closing") {
      this.doorState = "opening";
      return { text: "Reapertura de puertas", level: "info" };
    }
    if (!this.isStopped) return { text: "Detén completamente el tren para operar las puertas", level: "warn" };

    const station = this.dockedStation();
    if (!station) {
      const near = this.nearestStation();
      const err = this.position - near.stopZ;
      if (Math.abs(err) < 45) {
        return { text: `Fuera de posición (${formatStopError(err)}) · tolerancia ±${CONFIG.station.stopTolerance} m`, level: "warn" };
      }
      return { text: "Las puertas solo pueden abrirse junto a un andén", level: "warn" };
    }
    if (!automatic && !this.isBraking) return { text: "Aplica freno (B1–B3) antes de abrir puertas", level: "warn" };

    this.doorState = "opening";
    return { text: `Abriendo puertas · ${station.name}`, level: "ok" };
  }

  /* ----- Paso de simulación ----- */
  update(dt) {
    const T = CONFIG.train;
    const prevSpeed = this.speed;

    // 1. Demanda de esfuerzo: emergencia > automático > mando manual
    let demand = this.emergency ? NOTCHES[NOTCH_INDEX.EM].accel : (this.autoDemand ?? this.notchData.accel);

    // 2. Enclavamientos: sin tracción con puertas abiertas o inversor en neutro
    if (demand > 0 && (!this.doorsClosed || this.reverser === 0)) demand = 0;
    if (!this.doorsClosed) demand = Math.min(demand, -0.6);   // freno de mantenimiento con puertas abiertas

    // 3. Limitación de jerk
    const jerk = this.emergency ? 5 : 1.4;
    this.accel += clamp(demand - this.accel, -jerk * dt, jerk * dt);

    // 4. Fuerzas: tracción en el sentido del inversor; freno y resistencia se oponen al movimiento
    const v = this.velocity, speed = Math.abs(v);
    const dir = this.reverser;
    const cap = dir === -1 ? T.reverseMaxSpeed : T.maxSpeed;
    let traction = 0;
    if (this.accel > 0 && dir !== 0) {
      const curve = Math.min(1, T.tractionBaseSpeed / Math.max(speed, 0.1));
      const goingThatWay = Math.sign(v) === dir;
      traction = goingThatWay && speed >= cap - 0.01 ? 0 : this.accel * curve * dir;
    }
    const brake = this.accel < 0 ? -this.accel : 0;
    const resistance = speed > 0 ? 0.01 + 0.0006 * speed + 0.00009 * speed * speed : 0;

    let newV = v + traction * dt;
    const opposing = (brake + resistance) * dt;
    newV = Math.abs(newV) <= opposing ? 0 : newV - Math.sign(newV) * opposing;
    newV = clamp(newV, -T.reverseMaxSpeed - 0.3, T.maxSpeed);

    this.position -= ((v + newV) / 2) * dt;
    this.velocity = newV;

    // 5. Límites físicos de la vía
    const track = this.route.track;
    if (this.position <= track.bumperZ) {
      if (this.speed > 0.5) this.onEvent("bumper", { kmh: this.speedKmh });
      this.position = track.bumperZ; this.velocity = 0; this.accel = Math.min(this.accel, 0);
    }
    if (this.position >= track.rearLimitZ) {
      if (this.speed > 0.5) this.onEvent("bumper", { kmh: this.speedKmh });
      this.position = track.rearLimitZ; this.velocity = 0; this.accel = Math.min(this.accel, 0);
    }

    // 6. Detección de parada
    if (prevSpeed > 0 && this.velocity === 0) {
      const st = this.nearestStation();
      const error = this.position - st.stopZ;
      this.onEvent("halt");
      if (Math.abs(error) < 40) this.onEvent("stopped", { station: st, error });
    }

    // 7. Puertas
    const step = dt / T.doorTime;
    if (this.doorState === "opening") {
      this.doorProgress = Math.min(1, this.doorProgress + step);
      if (this.doorProgress === 1) { this.doorState = "open"; this.onEvent("doorsOpen", { station: this.dockedStation() }); }
    } else if (this.doorState === "closing") {
      this.doorProgress = Math.max(0, this.doorProgress - step);
      if (this.doorProgress === 0) { this.doorState = "closed"; this.onEvent("doorsClosed", { station: this.dockedStation() }); }
    }

    // 8. Vigilancia de velocidad
    const limit = this.currentLimit();
    if (this.speedKmh > limit + 2 && !this.overspeedWarned) { this.overspeedWarned = true; this.onEvent("overspeed", { limit }); }
    if (this.speedKmh < limit) this.overspeedWarned = false;
  }
}


/* ==========================================================================
   AutoDriver — conducción automática (ATO)
   Respeta señales, horario y espera a que suban/bajen los viajeros.

   Estados:
     depot    → esperando en la cola de maniobras/cocheras hasta su hora de entrada
     running  → hacia la parada de la estación objetivo (frena ante señales rojas)
     dwell    → puertas abiertas en estación
     closing  → cerrando puertas
     ready    → puertas cerradas, esperando hora de salida y señal de salida
     retire   → tras la última estación, hacia el fondo de la cola de maniobras
     retired  → al final de la cola: el tráfico le cambia de cabina y de vía
                (maniobra de retorno) o lo retira a cocheras
   ========================================================================== */

export class AutoDriver {
  /**
   * @param {TrainSim} sim
   * @param {object} opts
   * @param {object|null} opts.trip              servicio con horario (schedule.js)
   * @param {import("./signals.js").SignalSystem|null} opts.signals
   * @param {(type:string, data?:object)=>void} opts.onEvent
   * @param {() => boolean} opts.isBoardingBusy  true mientras suben o bajan viajeros
   * @param {number} opts.targetIndex            estación hacia la que se dirige
   * @param {number|null} opts.holdUntil         hora hasta la que espera en cocheras antes de arrancar
   */
  constructor(sim, { trip = null, signals = null, onEvent = () => {}, isBoardingBusy = () => false, targetIndex = 0, holdUntil = null } = {}) {
    this.sim = sim;
    this.trip = trip;
    this.signals = signals;
    this.onEvent = onEvent;
    this.isBoardingBusy = isBoardingBusy;
    this.targetIndex = targetIndex;
    this.state = holdUntil !== null ? "depot" : "running";
    this.holdUntil = holdUntil;
    this.timer = 0;
    this.extraWait = 0;
    this.brakeTarget = null;
    sim.notch = NOTCH_INDEX.N;
    sim.reverser = 1;
  }

  get stations() { return this.sim.route.stations; }
  get target() { return this.stations[this.targetIndex]; }

  /** Hora de salida programada en la estación actual (o null si no hay horario). */
  scheduledDeparture() {
    return this.trip ? this.trip.dep[this.targetIndex] : null;
  }

  update(dt, clock) {
    const sim = this.sim;
    const last = this.stations.length - 1;
    switch (this.state) {
      case "depot":
        sim.autoDemand = -1.05;
        if (clock >= this.holdUntil) this.state = "running";
        break;
      case "running": {
        sim.autoDemand = this.runDemand(this.target.stopZ, true);
        const d = sim.position - this.target.stopZ;
        if (sim.isStopped && Math.abs(d) < 1.0) {
          sim.autoDemand = -1.05;
          sim.toggleDoors({ automatic: true });
          this.state = "dwell";
          this.arrivedAt = clock;
          this.extraWait = 0;
          this.onEvent("arrived", { station: this.target });
        }
        break;
      }
      case "dwell": {
        sim.autoDemand = -1.05;
        const minDwell = this.targetIndex === last ? CONFIG.schedule.minDwell + 10 : CONFIG.schedule.minDwell;
        const dep = this.scheduledDeparture();
        const timeOk = clock - this.arrivedAt >= minDwell && (dep === null || clock >= dep - CONFIG.train.doorTime - 3);
        if (!timeOk || sim.doorState !== "open") break;
        if (this.isBoardingBusy() && this.extraWait < 20) { this.extraWait += dt; break; }
        sim.toggleDoors({ automatic: true });
        this.onEvent("doorsClosing", { station: this.target });
        this.state = "closing";
        break;
      }
      case "closing":
        sim.autoDemand = -1.05;
        if (sim.doorsClosed) this.state = "ready";
        break;
      case "ready": {
        sim.autoDemand = -1.05;
        if (this.targetIndex === last) { this.state = "retire"; break; }
        const dep = this.scheduledDeparture();
        const sig = this.signals?.startingSignal(this.target);
        if ((dep === null || clock >= dep) && (!sig || sig.aspect !== "red")) {
          this.onEvent("departing", { station: this.target, next: this.stations[this.targetIndex + 1] });
          this.targetIndex++;
          this.brakeTarget = null;
          this.state = "running";
        }
        break;
      }
      case "retire":
        sim.autoDemand = this.runDemand(sim.route.track.retireZ, false);
        if (sim.isStopped && Math.abs(sim.position - sim.route.track.retireZ) < 2) { this.state = "retired"; this.onEvent("retired"); }
        break;
      case "retired":
        sim.autoDemand = -1.05;
        break;
    }
  }

  /**
   * Demanda de esfuerzo hacia un punto de parada, frenando antes de señales rojas
   * y limitando a 45 km/h tras una señal amarilla.
   */
  runDemand(stopZ, isStation) {
    const sim = this.sim, v = sim.speed;

    // ¿Hay una señal en rojo antes del punto de parada?
    let targetZ = stopZ;
    let cruiseCap = Infinity;
    const sig = this.signals?.nextAhead(sim.position);
    if (sig) {
      if (sig.aspect === "red" && sig.z > stopZ) targetZ = Math.min(sig.z + CONFIG.signals.stopMargin, sim.position);
      if (sig.aspect === "yellow" && sim.position - sig.z < 400) cruiseCap = 45 / 3.6;
    }
    if (this.brakeTarget === null || Math.abs(this.brakeTarget.z - targetZ) > 1) this.brakeTarget = { z: targetZ, braking: false };

    const d = sim.position - targetZ;
    if (d <= 0.15) return -1.05;

    const req = (v * v) / (2 * Math.max(d - 0.1, 0.05));
    if (req > 0.6 || this.brakeTarget.braking) {
      this.brakeTarget.braking = true;
      if (v < 0.4 && d > 1) return 0.25;                  // aproximación lenta si se quedó corto
      return -clamp(req * 1.05, 0, 1.05);
    }

    // Velocidad de crucero respetando límites presentes y futuros
    let cruise = Math.min((sim.route.speedLimitAt(sim.position) - 4) / 3.6, cruiseCap);
    for (const s of sim.route.limits) {
      if (s.from < sim.position && sim.position - s.from < 1500) {
        const dist = sim.position - s.from;
        const vTarget = (s.kmh - 4) / 3.6;
        cruise = Math.min(cruise, Math.sqrt(vTarget * vTarget + 2 * 0.5 * dist));
      }
    }
    if (v < cruise - 0.4) return 0.9;
    if (v > cruise + 0.2) return -0.6;
    return 0;
  }
}
