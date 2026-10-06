/* ==========================================================================
   MetroSim — Motor · sim.js
   Simulación de un tren (lógica pura, sin gráficos) y conducción automática.

   Principio: el tren del jugador y los trenes automáticos usan EXACTAMENTE la
   misma simulación (TrainSim). Solo cambia quién da las órdenes: el jugador
   (mando + inversor) o el AutoDriver (ATO).

   Todo se calcula en las coordenadas de la RUTA del tren (route.js): en
   ellas el tren siempre avanza hacia -Z, sea cual sea su sentido real.
   Velocidad con signo: velocity > 0 = avanza, velocity < 0 = retrocede.

   1.1 · Física por FUERZAS (dinámica longitudinal de un tren real):
     · masa = tara del AS-2014 + viajeros a bordo (70 kg c/u) y masas rotativas;
     · tracción: el mando pide una aceleración; los motores dan como mucho el
       esfuerzo máximo hasta la velocidad base y luego potencia constante
       (F = P/v), y nunca más que la adherencia rueda-carril. Por eso un tren
       lleno, cuesta arriba o rápido acelera menos;
     · freno: compensado por carga. Primero el freno ELÉCTRICO (regenerativo,
       devuelve energía a la catenaria) y, cuando no alcanza o bajo ~6 km/h,
       el de FRICCIÓN. La emergencia es solo fricción;
     · resistencia al avance de Davis en túnel (A + B·v + C·v²);
     · pendiente de la vía (profile.js): cuesta arriba frena, cuesta abajo
       empuja; un tren sin freno en pendiente se va;
     · freno de mantenimiento automático al detenerse (anti-retroceso);
     · limitación de jerk (sacudida) para un arranque y frenado suaves;
     · consumo eléctrico: potencia, corriente de catenaria y energía
       (tracción, regenerada y auxiliares).
   ========================================================================== */

import { CONFIG, NOTCHES, NOTCH_INDEX, REVERSER } from "../config.js";
import { STOCK, trainMass } from "./consist.js";
import { clamp, formatStopError } from "./format.js";

const G = 9.81;
/** Sacudida máxima (m/s³) en servicio y al aplicar la emergencia. */
const JERK = 0.9, JERK_EMERGENCY = 4;
/** Freno de mantenimiento automático (m/s² equivalentes) con el tren detenido. */
const HOLD_BRAKE = 0.7;
/** Deceleración máxima de servicio que usa la conducción automática (m/s²). */
const ATO_MAX_BRAKE = 0.95;


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
    this.load = 0;                   // viajeros a bordo (lo actualiza el tráfico): cambian la masa
    this.energy = { traction: 0, regen: 0, aux: 0 };   // kWh acumulados
    this.reset(start);
  }

  reset(start = this.route.first) {
    this.position = typeof start === "number" ? start : start.stopZ;   // z del testero delantero
    this.velocity = 0;               // m/s con signo
    this.accel = 0;                  // esfuerzo PEDIDO tras limitar el jerk (m/s²): + tracción, − freno
    this.netAccel = 0;               // aceleración real resultante (m/s²) en el sentido de avance
    this.notch = NOTCH_INDEX.B3;     // se empieza frenado
    this.reverser = 1;               // inversor en ADELANTE
    this.doorState = "closed";       // closed | opening | open | closing
    this.doorProgress = 0;           // 0 = cerradas, 1 = abiertas
    this.autoDemand = null;          // si no es null, la conducción automática manda
    this.overspeedWarned = false;
    this.grade = 0;                  // pendiente bajo el tren (fracción, + cuesta arriba)
    this.forces = { traction: 0, electricBrake: 0, frictionBrake: 0, resistance: 0, gravity: 0 };   // N
    this.power = 0;                  // potencia eléctrica tomada de la catenaria (W, negativa si regenera)
    this.current = 0;                // corriente de catenaria (A)
    this.voltage = STOCK.lineVoltage;
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
  /** Masa real (kg) con los viajeros a bordo. */
  get mass() { return trainMass(this.load); }
  /** Esfuerzo aplicado para mostrar (−1 freno máximo … +1 tracción máxima). */
  get effort() {
    const f = this.forces;
    if (f.traction > 0) return clamp(f.traction / STOCK.maxTractive, 0, 1);
    const brake = f.electricBrake + f.frictionBrake;
    return -clamp(brake / (this.mass * STOCK.rotary * 1.3), 0, 1);
  }
  /** Ocupación del tren (0..1 respecto de la capacidad a 6 p/m²). */
  get occupancy() { return clamp(this.load / STOCK.capacity, 0, 1.2); }

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

    // 1. Esfuerzo pedido: emergencia > automático > mando manual
    let demand = this.emergency ? NOTCHES[NOTCH_INDEX.EM].accel : (this.autoDemand ?? this.notchData.accel);

    // 2. Enclavamientos: sin tracción con puertas abiertas o inversor en neutro
    if (demand > 0 && (!this.doorsClosed || this.reverser === 0)) demand = 0;
    if (!this.doorsClosed) demand = Math.min(demand, -0.6);   // freno de estacionamiento con puertas abiertas

    // 3. Limitación de jerk (la emergencia se aplica de golpe)
    const jerk = this.emergency ? JERK_EMERGENCY : JERK;
    this.accel += clamp(demand - this.accel, -jerk * dt, jerk * dt);

    // 4. Fuerzas (N) en el sentido de avance de la ruta
    const v = this.velocity, speed = Math.abs(v);
    const dir = this.reverser;
    const cap = dir === -1 ? T.reverseMaxSpeed : T.maxSpeed;
    const m = this.mass, mEq = m * STOCK.rotary;
    this.grade = this.route.gradeAt ? this.route.gradeAt(this.position + T.length / 2) : 0;

    // Tracción: pedida (compensada por carga) ≤ curva esfuerzo-velocidad ≤ adherencia
    let traction = 0;
    if (this.accel > 0 && dir !== 0) {
      const goingThatWay = Math.sign(v) === dir || speed < 0.05;
      const available = Math.min(STOCK.maxTractive, STOCK.maxPower / Math.max(speed, 0.5));
      const adhesion = STOCK.adhesion * G * m * (STOCK.motorCars / STOCK.cars);
      traction = Math.min(this.accel * mEq, available, adhesion);
      if (goingThatWay && speed >= cap - 0.05) traction = 0;            // corte de tracción a la velocidad máxima
    }

    // Freno: pedido (compensado por carga), con freno de mantenimiento automático al detenerse
    let brakeDecel = this.accel < 0 ? -this.accel : 0;
    if (speed < 0.08 && traction === 0) brakeDecel = Math.max(brakeDecel, HOLD_BRAKE);
    const brakeTotal = Math.min(brakeDecel * mEq, STOCK.adhesion * G * m * 1.0);
    // Reparto: eléctrico (regenerativo) primero, la fricción completa lo que falta
    let electric = 0;
    if (!this.emergency && speed > 0.05) {
      const fade = clamp(speed / STOCK.electricFadeSpeed, 0, 1);
      electric = Math.min(brakeTotal, STOCK.maxElectricBrake, STOCK.maxElectricBrakePower / Math.max(speed, 0.5)) * fade;
    }
    const friction = brakeTotal - electric;

    const resistance = speed > 0.01 ? STOCK.rollingPerKg * m + STOCK.davisB * speed + STOCK.davisC * speed * speed : 0;
    const gravity = -m * G * this.grade;                                 // + empuja hacia delante (cuesta abajo)

    // 5. Integración: las fuerzas "motrices" (tracción con signo y gravedad) cambian la velocidad;
    //    el freno y la resistencia solo se oponen al movimiento (y pueden retener el tren)
    const drive = traction * dir + gravity;
    let newV = v + (drive / mEq) * dt;
    const opposing = ((brakeTotal + resistance + (speed <= 0.01 ? STOCK.rollingPerKg * m : 0)) / mEq) * dt;
    newV = Math.abs(newV) <= opposing ? 0 : newV - Math.sign(newV) * opposing;
    newV = clamp(newV, -T.reverseMaxSpeed - 1, T.maxSpeed + 3 / 3.6);

    this.position -= ((v + newV) / 2) * dt;
    this.netAccel = (newV - v) / dt;
    this.velocity = newV;
    this.forces.traction = traction;
    this.forces.electricBrake = electric;
    this.forces.frictionBrake = friction;
    this.forces.resistance = resistance;
    this.forces.gravity = gravity;

    // 6. Electricidad: potencia de tracción, regeneración y auxiliares
    const vAvg = (Math.abs(v) + Math.abs(newV)) / 2;
    const pTraction = (traction * vAvg) / STOCK.tractionEfficiency;
    const pRegen = electric * vAvg * STOCK.regenEfficiency * STOCK.regenReceptivity;
    this.power = pTraction + STOCK.auxPower - pRegen;
    this.current = this.power / STOCK.lineVoltage;
    this.voltage = STOCK.lineVoltage - STOCK.lineDropPerAmp * this.current;
    const toKWh = dt / 3.6e6;
    this.energy.traction += pTraction * toKWh;
    this.energy.regen += pRegen * toKWh;
    this.energy.aux += STOCK.auxPower * toKWh;

    // 7. Límites físicos de la vía
    const track = this.route.track;
    if (this.position <= track.bumperZ) {
      if (this.speed > 0.5) this.onEvent("bumper", { kmh: this.speedKmh });
      this.position = track.bumperZ; this.velocity = 0; this.accel = Math.min(this.accel, 0);
    }
    if (this.position >= track.rearLimitZ) {
      if (this.speed > 0.5) this.onEvent("bumper", { kmh: this.speedKmh });
      this.position = track.rearLimitZ; this.velocity = 0; this.accel = Math.min(this.accel, 0);
    }

    // 8. Detección de parada
    if (prevSpeed > 0 && this.velocity === 0) {
      const st = this.nearestStation();
      const error = this.position - st.stopZ;
      this.onEvent("halt");
      if (Math.abs(error) < 40) this.onEvent("stopped", { station: st, error });
    }

    // 9. Puertas
    const step = dt / T.doorTime;
    if (this.doorState === "opening") {
      this.doorProgress = Math.min(1, this.doorProgress + step);
      if (this.doorProgress === 1) { this.doorState = "open"; this.onEvent("doorsOpen", { station: this.dockedStation() }); }
    } else if (this.doorState === "closing") {
      this.doorProgress = Math.max(0, this.doorProgress - step);
      if (this.doorProgress === 0) { this.doorState = "closed"; this.onEvent("doorsClosed", { station: this.dockedStation() }); }
    }

    // 10. Vigilancia de velocidad
    const limit = this.currentLimit();
    if (this.speedKmh > limit + 2 && !this.overspeedWarned) { this.overspeedWarned = true; this.onEvent("overspeed", { limit }); }
    if (this.speedKmh < limit) this.overspeedWarned = false;
  }
}


/* ==========================================================================
   AutoDriver — conducción automática (ATO, como la del CBTC de la L3)
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

   Marcha económica (1.1): al alcanzar la velocidad de crucero el ATO corta
   la tracción y deja el tren en DERIVA hasta perder unos 4 km/h; entonces
   vuelve a traccionar. Así ahorra energía, como los ATO reales. Si el tren
   va con retraso (hurry) no deriva. Al frenar compensa la pendiente.

   Retención (orden "control.hold" del Centro de Control): con held = true el
   tren no cierra puertas ni sale de la estación hasta que lo liberen.

   Regulación (regulation.js): regulateUntil retrasa la salida para igualar
   intervalos; hurry acorta la parada de un tren que va con mucho hueco.
   ========================================================================== */

/** Pérdida de velocidad permitida en deriva antes de volver a traccionar (m/s). */
const COAST_BAND = 4 / 3.6;

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
    this.coasting = false;
    this.backing = false;              // retrocediendo hasta la marca tras un rebase
    this.held = false;                 // retenido por el Centro de Control
    this.regulateUntil = null;         // regulación: no sale antes de esta hora
    this.regulating = false;
    this.hurry = false;                // regulación: parada mínima
    sim.notch = NOTCH_INDEX.N;
    sim.reverser = 1;
  }

  get stations() { return this.sim.route.stations; }
  get target() { return this.stations[this.targetIndex]; }

  /** Hora de salida programada en la estación actual (o null si no hay horario). */
  scheduledDeparture() {
    return this.trip ? this.trip.dep[this.targetIndex] : null;
  }

  /** Hora mínima de salida: la del horario o la de la regulación, la que sea más tarde. */
  leaveTime() {
    const dep = this.scheduledDeparture();
    const reg = this.regulateUntil || null;
    if (dep === null) return reg;
    return reg === null ? dep : Math.max(dep, reg);
  }

  update(dt, clock) {
    const sim = this.sim;
    const last = this.stations.length - 1;
    const HOLD = -1.0;
    switch (this.state) {
      case "depot":
        sim.autoDemand = HOLD;
        if (clock >= this.holdUntil) this.state = "running";
        break;
      case "running": {
        let d = sim.position - this.target.stopZ;
        // Rebase de la marca: retrocede a paso de hombre hasta ella (tolerancia ±2,5 m)
        if (this.backing || (sim.isStopped && d <= -1.0 && d > -60)) {
          sim.autoDemand = this.backDemand(d);
          if (this.backing) break;
        } else sim.autoDemand = this.runDemand(this.target.stopZ, true);
        d = sim.position - this.target.stopZ;
        if (sim.isStopped && Math.abs(d) < 1.0) {
          sim.autoDemand = HOLD;
          sim.toggleDoors({ automatic: true });
          this.state = "dwell";
          this.arrivedAt = clock;
          this.extraWait = 0;
          this.onEvent("arrived", { station: this.target });
        }
        break;
      }
      case "dwell": {
        sim.autoDemand = HOLD;
        let minDwell = this.targetIndex === last ? CONFIG.schedule.minDwell + 10 : CONFIG.schedule.minDwell;
        if (this.hurry) minDwell = Math.min(minDwell, 12);
        const leave = this.leaveTime();
        const timeOk = clock - this.arrivedAt >= minDwell && (leave === null || clock >= leave - CONFIG.train.doorTime - 3);
        if (!timeOk || sim.doorState !== "open" || this.held) break;
        // Mientras sube o baja gente se espera (hasta 45 s más): con mucha gente, la parada se alarga
        if (this.isBoardingBusy() && this.extraWait < (this.hurry ? 15 : 45)) { this.extraWait += dt; break; }
        sim.toggleDoors({ automatic: true });
        this.onEvent("doorsClosing", { station: this.target });
        this.state = "closing";
        break;
      }
      case "closing":
        sim.autoDemand = HOLD;
        if (sim.doorsClosed) this.state = "ready";
        break;
      case "ready": {
        sim.autoDemand = HOLD;
        if (this.targetIndex === last) { this.state = "retire"; break; }
        if (this.held) break;
        const leave = this.leaveTime();
        const sig = this.signals?.startingSignal(this.target);
        if ((leave === null || clock >= leave) && (!sig || sig.aspect !== "red")) {
          this.onEvent("departing", { station: this.target, next: this.stations[this.targetIndex + 1] });
          this.targetIndex++;
          this.brakeTarget = null;
          this.coasting = false;
          this.state = "running";
        }
        break;
      }
      case "retire":
        sim.autoDemand = this.runDemand(sim.route.track.retireZ, false);
        if (sim.isStopped && Math.abs(sim.position - sim.route.track.retireZ) < 2) { this.state = "retired"; this.onEvent("retired"); }
        break;
      case "retired":
        sim.autoDemand = HOLD;
        break;
    }
  }

  /** Retroceso lento hasta la marca tras un rebase (inversor atrás, ~3 km/h). */
  backDemand(d) {
    const sim = this.sim;
    if (!this.backing) { this.backing = true; sim.reverser = -1; }
    if (d > -0.6) {                                      // de vuelta en la marca: frena y vuelve el inversor
      if (sim.isStopped) { sim.reverser = 1; this.backing = false; this.brakeTarget = null; }
      return -0.8;
    }
    const v = sim.speed, want = Math.min(0.8, Math.sqrt(Math.max(0, -d - 0.5) * 0.6));
    return v < want ? 0.3 : -0.3;
  }

  /**
   * Demanda de esfuerzo hacia un punto de parada, frenando antes de señales rojas
   * y limitando a 45 km/h tras una señal amarilla.
   */
  runDemand(stopZ, isStation) {
    const sim = this.sim, v = sim.speed;
    const gGrade = 9.81 * sim.grade;                     // + cuesta arriba (ayuda a frenar)

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
    if (d <= 0.15) return -1.0;

    // Curva de frenado: deceleración neta necesaria, y freno que hay que pedir para lograrla.
    // Se anticipa lo que tarda el freno en llegar (limitación de jerk): mientras crece, el tren sigue avanzando.
    const ramp = this.brakeTarget.braking ? 0 : Math.max(0, sim.accel + 0.75) / JERK;
    const req = (v * v) / (2 * Math.max(d - 0.1, 0.05));
    const reqEarly = (v * v) / (2 * Math.max(d - 0.1 - v * ramp * 0.55, 0.05));
    const brakeNeeded = reqEarly - gGrade;
    if (brakeNeeded > ATO_MAX_BRAKE * 0.76 || this.brakeTarget.braking) {
      this.brakeTarget.braking = true;
      this.coasting = false;
      if (v < 0.4 && d > 1) return 0.35;                  // aproximación lenta si se quedó corto
      return -clamp(req * 1.05 - gGrade, 0, ATO_MAX_BRAKE + 0.05);
    }

    // Velocidad de crucero respetando límites presentes y futuros
    let cruise = Math.min((sim.route.speedLimitAt(sim.position) - 3) / 3.6, cruiseCap);
    for (const s of sim.route.limits) {
      if (s.from < sim.position && sim.position - s.from < 1500) {
        const dist = sim.position - s.from;
        const vTarget = (s.kmh - 3) / 3.6;
        cruise = Math.min(cruise, Math.sqrt(vTarget * vTarget + 2 * 0.6 * dist));
      }
    }
    for (const s of sim.route.restrictions) {
      if (s.from < sim.position && sim.position - s.from < 1500) {
        const vTarget = (s.kmh - 3) / 3.6;
        cruise = Math.min(cruise, Math.sqrt(vTarget * vTarget + 2 * 0.6 * (sim.position - s.from)));
      }
    }

    // Marcha económica: tracción hasta el crucero, deriva, y de nuevo tracción
    const band = this.hurry || !isStation ? 0.4 : COAST_BAND;
    if (v > cruise + 0.3) { this.coasting = true; return -clamp((v - cruise) * 0.8, 0.15, 0.6); }
    if (v >= cruise - 0.2) this.coasting = true;
    if (this.coasting && v > cruise - band) return 0;
    this.coasting = false;
    return v < cruise - 1.5 ? 1.0 : 0.6;
  }
}
