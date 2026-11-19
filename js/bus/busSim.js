/* ==========================================================================
   MetroSim — 1.13 · bus/busSim.js
   MicroSim (beta): simulación del bus, el tráfico, los semáforos y los
   pasajeros de los paraderos. Sin Three.js (se puede probar en Node).

   El bus avanza por la distancia `s` del recorrido (como un tren) y se mueve
   de lado entre los carriles (x). Los autos siguen al de adelante con el
   modelo IDM (conductor inteligente) y respetan los semáforos.

   El juego (busGame.js) llama a step(dt) en cada fotograma y lee la cola de
   eventos (sim.drain()) para los mensajes, el sonido y el sueldo.

   1.20 · El clima del Metro (engine/weather.js) también pesa en la calle:
   con el piso mojado (`wet`, 0..1) el bus frena menos (el ABS recorta el
   freno, como el antideslizamiento del tren) y patina un poco al partir;
   los autos van más lento y dejan más distancia.
   ========================================================================== */

import { LANES, lightState, makeTimetable } from "./busRoute.js";

export const BUS_LENGTH = 12;
export const BUS_WIDTH = 2.55;
export const BUS_CAPACITY = 90;
const CAR_LEN = 4.4;
const CAR_WIDTH = 1.8;
const STOP_WINDOW = 9;            // m alrededor de la marca del paradero en que se puede atender
const SKIP_AFTER = 14;            // m pasada la marca: el paradero queda saltado
const DOOR_TIME = 1.1;            // s para abrir o cerrar
/**
 * 1.19 · Tipos de pasajero: cuánto tardan en subir (validar la bip!) y en bajar, en segundos [mín, máx].
 * Suben por la puerta delantera y, AL MISMO TIEMPO, bajan por la central y la trasera (como en los buses Red).
 */
export const PASSENGER_KINDS = {
  adulto:     { share: 0.55, board: [0.8, 1.3], alight: [0.5, 0.9] },
  estudiante: { share: 0.2,  board: [0.7, 1.1], alight: [0.45, 0.8] },
  mayor:      { share: 0.12, board: [1.8, 2.6], alight: [1.2, 1.8] },   // adulto mayor: sube despacio, de la baranda
  carga:      { share: 0.07, board: [2.0, 3.0], alight: [1.3, 2.0] },   // con bolsas, maleta o coche de guagua
  nino:       { share: 0.06, board: [0.7, 1.0], alight: [0.5, 0.8] },   // niño (no valida: va con un adulto)
};
const NO_BALANCE = 0.025;         // tarjeta sin saldo: el validador la rechaza y la persona se baja
const COMMERCIAL = 21 / 3.6;
/** 2.2 · Potencia del bus: aceleración al partir (m/s²), freno máximo (m/s²) y velocidad en que se acaba la tracción (m/s). */
export const BUS_SPEC = { accel: 1.45, brake: 3.4, vmax: 19 };      // velocidad comercial del horario (m/s)

const round10 = (n) => Math.max(0, Math.round(n / 10) * 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Pago por paradero bien atendido y bono final (pesos), en la misma escala que el sueldo del metro. */
export const BUS_WAGE = {
  base: 450, perPoint: 2.5, perfect: 400, deduction: 1.0,
  finish: { S: 9000, A: 6000, B: 3500, C: 1800, D: 600 },
};

/** Generador pseudoaleatorio con semilla (mulberry32): la partida es reproducible en las pruebas. */
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BusSim {
  /**
   * @param {{route:object, clock:number, demand:number, seed?:number}} o
   *   clock: hora del día en segundos al empezar · demand: 0..1 (curva de demanda de Santiago)
   */
  constructor({ route, clock, demand = 0.5, seed, startStop = 0, wet = 0, vehicle = null }) {
    this.route = route;
    // 2.2 · Tamaño y potencia del vehículo (el taxi, taxiSim.js, pasa los suyos en `vehicle`)
    this.len = vehicle?.len ?? BUS_LENGTH;
    this.wid = vehicle?.wid ?? BUS_WIDTH;
    this.spec = vehicle?.spec ?? BUS_SPEC;
    this.wet = clamp(wet, 0, 1);
    /** Freno máximo que deja el ABS (fracción del freno en seco) y tracción al partir. */
    this.grip = 1 - 0.3 * this.wet;
    this.rng = makeRng(seed);
    this.demand = clamp(demand, 0.15, 1);       // de noche igual hay gente: los buses siguen pasando
    this.elapsed = 0;
    this.clockStart = clock;
    this.departure = clock + 45;
    this.timetable = makeTimetable(route, this.departure);
    // 1.15 · Viaje de pasajero: el bus parte en un paradero intermedio (el horario se cuenta desde ahí)
    const shift = this.timetable[startStop].time - this.departure;
    this.timetable.forEach(t => { t.time -= shift; });
    this.events = [];
    this.finished = false;

    const first = route.stops[startStop];
    this.bus = {
      s: first.s, v: 0, x: LANES[0], lane: 0, targetLane: 0, latV: 0,
      throttle: 0, brake: 0, accel: 0, decel: 0,
      doors: "closed", doorT: 0,
    };
    /* Pedales: true/false (teclado) o un número 0..1 (pedal táctil analógico, freno suave). */
    this.input = { throttle: false, brake: false };
    this.limiter = false;              // 1.18 · limitador de velocidad (L): corta el acelerador en el máximo de la calle
    this.lead = null;                  // 1.18 · lo que va adelante en la pista del bus: { gap, v, ttc }

    const n = route.stops.length;
    this.stopIndex = startStop;        // próximo paradero por atender
    this.waiting = route.stops.map((_, i) => i === n - 1 || i < startStop ? 0 : this.initialWaiting(i));
    this.arrivalAcc = new Array(n).fill(0);
    this.onboard = [];                 // destino (índice de paradero) de cada pasajero a bordo
    // 1.20 · Si el viaje parte a mitad del recorrido (el pasajero sube ahí), el bus ya viene con gente
    if (startStop > 0) {
      const k = Math.round(this.demand * 34 * (0.6 + this.rng() * 0.8));
      for (let j = 0; j < k && startStop < n - 1; j++) this.onboard.push(this.pickDestination(startStop));
    }
    this.bell = false;                 // «parada solicitada» para el próximo paradero
    this.bellAt = null;
    this.serving = null;               // atención en curso: { index, timer, boarded, alighted, error, arrival }

    this.points = 0;
    this.pendingDeduction = 0;         // faltas desde el último paradero (se descuentan del sueldo)
    this.totals = { boarded: 0, alighted: 0, served: 0, skipped: 0, penalties: 0, wage: 0, onTime: 0, crashes: 0, reds: 0, evasions: 0, maxPoints: 0 };
    this.results = [];
    this.cool = {};                    // enfriamiento de mensajes repetidos

    this.cars = [];
    this.nextCarId = 1;
    this.spawnCars();
  }

  /** Hora del día (segundos). */
  get time() { return this.clockStart + this.elapsed; }
  /* 2.3 · Sentido respecto del recorrido dibujado (el taxi puede dar la vuelta, taxiSim.js): el bus va siempre «de ida» */
  get dir() { return 1; }
  get idaS() { return this.bus.s; }
  toIdaS(s) { return s; }
  toIdaX(x) { return x; }
  get nextStop() { return this.route.stops[this.stopIndex] ?? null; }

  initialWaiting(i) {
    const base = 2 + this.demand * 11 * (0.6 + this.rng() * 0.8);
    return Math.round(base + (i === 0 ? 4 : 0));
  }

  /** Un tipo de pasajero al azar (según su proporción). */
  personKind() {
    let r = this.rng();
    for (const [k, v] of Object.entries(PASSENGER_KINDS)) { r -= v.share; if (r <= 0) return k; }
    return "adulto";
  }
  personTime(kind, what) {
    const [a, b] = PASSENGER_KINDS[kind][what];
    return a + this.rng() * (b - a);
  }
  /** Paradero donde se bajará quien sube en `from`: más gente va a las estaciones de Metro (combinación) y a la terminal. */
  pickDestination(from) {
    const st = this.route.stops, n = st.length;
    const w = [];
    for (let j = from + 1; j < n; j++) w.push((st[j].metro ? 2.2 : 1) * (j === n - 1 ? 1.6 : 1) * (j === from + 1 ? 0.6 : 1));
    let r = this.rng() * w.reduce((a, x) => a + x, 0);
    for (let k = 0; k < w.length; k++) { r -= w[k]; if (r <= 0) return from + 1 + k; }
    return n - 1;
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  msg(text, level = "info", key = null, every = 3) {
    if (key) {
      if (this.cool[key] > this.elapsed) return;
      this.cool[key] = this.elapsed + every;
    }
    this.emit("msg", { text, level });
  }
  penalty(points, text, key = null) {
    if (key && this.cool["pen:" + key] > this.elapsed) return;
    if (key) this.cool["pen:" + key] = this.elapsed + 3;
    this.points -= points;
    this.pendingDeduction += points;
    this.totals.penalties += points;
    this.emit("penalty", { points, text });
  }
  /** Saca los eventos acumulados desde la última llamada. */
  drain() { const e = this.events; this.events = []; return e; }

  /* ----------------------------- Mandos ----------------------------- */

  /** 1.15 · El pasajero (jugador) toca el timbre: el bus para en el próximo paradero. */
  requestStop() {
    if (this.bell || !this.nextStop) return false;
    this.bell = true;
    this.bellAt = null;
    this.emit("bell", { player: true });
    return true;
  }

  changeLane(dir) {
    const b = this.bus;
    const target = clamp(b.targetLane + dir, 0, LANES.length - 1);
    if (target === b.targetLane) return;
    if (b.doors !== "closed") return this.msg("Cierra las puertas antes de moverte", "warn", "laneDoors");
    if (b.v < 0.8) return this.msg("Para cambiar de pista el bus tiene que ir avanzando", "warn", "laneSlow");
    const tx = LANES[target];
    const blocked = this.cars.some(c => Math.abs(c.x - tx) < 2.4 && c.s > b.s - this.len - 5 && c.s - CAR_LEN < b.s + 4);
    if (blocked) return this.msg("Pista ocupada: espera que pase el auto", "warn", "laneBusy", 2);
    b.targetLane = target;
    this.emit("blinker", { dir });
  }

  /** 1.18 · Limitador de velocidad: el motor no pasa del máximo de la calle (el freno sigue siendo tuyo). */
  toggleLimiter() {
    this.limiter = !this.limiter;
    this.emit("limiter", { on: this.limiter });
    this.msg(this.limiter ? `Limitador encendido: máximo ${Math.round(this.route.speedLimit * 3.6)} km/h` : "Limitador apagado", "info");
    return this.limiter;
  }

  toggleDoors() {
    const b = this.bus;
    if (b.doors === "closed") {
      if (b.v > 0.3) return this.msg("Detén el bus antes de abrir las puertas", "warn", "doorsMoving");
      b.doors = "opening"; b.doorT = 0;
      this.emit("door", { open: true });
    } else if (b.doors === "open") {
      b.doors = "closing"; b.doorT = 0;
      this.emit("door", { open: false });
    }
  }

  /* ----------------------------- Paso ----------------------------- */

  step(dt) {
    // 1.20 · Un cuadro de 0 s (el primero suele serlo) daba aceleración 0/0 = NaN y el bus dejaba de dibujarse
    if (this.finished || !(dt > 0)) return;
    const sub = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / sub;
    for (let i = 0; i < sub && !this.finished; i++) this.tick(h);
  }

  tick(dt) {
    this.elapsed += dt;
    this.updateBus(dt);
    this.updateDoors(dt);
    this.updateCars(dt);
    this.checkCollisions();
    this.updateLead(dt);
    this.updateWaiting(dt);
    this.updateBell();
    this.checkSkip();
  }

  updateBus(dt) {
    const b = this.bus, R = this.route;
    const closed = b.doors === "closed";
    if (this.input.throttle && !closed) this.msg("Con las puertas abiertas el bus no acelera (enclavamiento)", "warn", "interlock", 4);
    let wantT = closed ? clamp(+this.input.throttle || 0, 0, 1) : 0;
    const wantB = clamp(+this.input.brake || 0, 0, 1);
    // Limitador: el acelerador se va soltando solo al acercarse al máximo
    if (this.limiter) wantT = Math.min(wantT, clamp((R.speedLimit - 0.4 - b.v) / 1.6, 0, 1));
    // Pedales: suben y bajan de a poco (al soltar el freno vuelve más rápido que al pisarlo)
    b.throttle += clamp(wantT - b.throttle, -3 * dt, 1.8 * dt);
    b.brake += clamp(wantB - b.brake, -3.2 * dt, (wantB < 0.6 ? 1.6 : 2.6) * dt);
    // Tracción: más fuerza al partir (caja automática), cae con la velocidad
    // 1.20 · Piso mojado: el ABS no deja pasar del agarre disponible (frenada más larga) y la partida patina un poco
    const B = this.spec.brake;
    const brakeDecel = Math.min(b.brake * B, B * this.grip);
    if (this.wet > 0.3 && b.brake * B > brakeDecel + 0.15 && b.v > 3) {
      this.absT = (this.absT ?? 0) + dt;
      if (this.absT > 0.4) { this.absT = 0; this.emit("abs"); this.msg("ABS: el piso está mojado y el bus frena menos. Frena antes", "warn", "abs", 9); }
    } else this.absT = 0;
    const launch = b.v < 4 ? 1 - 0.18 * this.wet : 1;
    let a = b.throttle * launch * (this.spec.accel - 0.55 * Math.min(1, b.v / 8)) * Math.max(0, 1 - b.v / this.spec.vmax) - brakeDecel;
    if (b.v > 0) a -= 0.06 + 0.0006 * b.v * b.v;
    // Retardador: al soltar el acelerador sobre 15 km/h el motor frena un poco (como en un bus real)
    if (wantT === 0 && b.throttle < 0.05 && b.v > 4.2) a -= 0.28;
    if (!closed) a = Math.min(a, -2);                     // freno de parada con puertas abiertas
    const v0 = b.v;
    b.v = Math.max(0, b.v + a * dt);
    b.accel = (b.v - v0) / dt;
    b.decel += ((b.v > 0.05 ? -b.accel : 0) - b.decel) * Math.min(1, dt * 6);   // frenada suavizada (para la predicción)
    const prevS = b.s;
    b.s += b.v * dt;

    // Movimiento lateral hacia la pista elegida
    // 1.18: con una curva suave (el bus acelera y frena de lado, como al girar el volante y enderezarlo)
    const tx = LANES[b.targetLane];
    const rate = Math.min(2.2, 0.5 + b.v * 0.35);
    const want = b.v > 0.05 ? clamp((tx - b.x) * 2.4, -rate, rate) : 0;
    b.latV += clamp(want - b.latV, -4.5 * dt, 4.5 * dt);
    if (Math.abs(tx - b.x) < 0.04 && Math.abs(b.latV) < 0.12) { b.x = tx; b.latV = 0; }
    else b.x += b.latV * dt;
    b.lane = LANES.reduce((best, x, i) => Math.abs(x - b.x) < Math.abs(LANES[best] - b.x) ? i : best, 0);

    // Semáforos en rojo
    for (const L of R.lights) {
      if (prevS < L.s && b.s >= L.s && lightState(L, this.time) === "red") {
        const p = ((this.time + L.offset) % L.cycle + L.cycle) % L.cycle;
        if (p - L.green - L.amber > 0.6) {
          this.totals.reds++;
          this.penalty(200, `Te pasaste una luz roja en ${L.street}`);
          this.emit("redLight");
        }
      }
    }

    // Velocidad máxima
    if (b.v > R.speedLimit * 1.1) {
      this.overTime = (this.overTime ?? 0) + dt;
      if (this.overTime > 2) { this.overTime = 0; this.penalty(20, `Exceso de velocidad: máximo ${Math.round(R.speedLimit * 3.6)} km/h`); }
    } else this.overTime = 0;

    // Frenada brusca con pasajeros a bordo
    if (b.brake > 0.92 && b.v > 7 && this.onboard.length > 0) {
      this.hardBrake = (this.hardBrake ?? 0) + dt;
      if (this.hardBrake > 0.6) { this.hardBrake = 0; this.penalty(15, "Frenada brusca: los pasajeros de pie se van para adelante", "hardBrake"); }
    } else this.hardBrake = 0;

    // Fin de la calle: después del último paradero
    if (b.s > R.length) { b.s = R.length; b.v = 0; }
  }

  updateDoors(dt) {
    const b = this.bus;
    if (b.doors === "opening") {
      b.doorT += dt;
      if (b.doorT >= DOOR_TIME) { b.doors = "open"; b.doorT = 0; this.onDoorsOpen(); }
    } else if (b.doors === "closing") {
      b.doorT += dt;
      if (b.doorT >= DOOR_TIME) { b.doors = "closed"; b.doorT = 0; this.onDoorsClosed(); }
    } else if (b.doors === "open" && this.serving) this.updateBoarding(dt);
  }

  /** ¿En qué paradero está detenido el bus (y qué tan bien)? */
  stopHere() {
    const b = this.bus;
    for (let i = Math.max(0, this.stopIndex - 1); i < this.route.stops.length; i++) {
      const st = this.route.stops[i];
      if (Math.abs(b.s - st.s) <= STOP_WINDOW) return { index: i, error: b.s - st.s, curb: Math.abs(b.x - LANES[0]) < 1.0 };
    }
    return null;
  }

  onDoorsOpen() {
    const here = this.stopHere();
    if (!here) return this.penalty(50, "Abriste las puertas fuera de un paradero");
    if (here.index < this.stopIndex) return;                       // el paradero que recién atendiste: no pasa nada
    if (here.index > this.stopIndex) return;                       // (no ocurre: checkSkip avanza antes)
    if (!here.curb) {
      this.penalty(30, "Estás lejos de la vereda: los pasajeros no pueden subir. Acércate a la pista Solo Bus");
      return;
    }
    if (!this.serving) {
      this.serving = { index: here.index, boarded: 0, alighted: 0, error: here.error, arrival: this.time, done: false };
      this.emit("arrive", { index: here.index });
    }
  }

  /**
   * 1.19 · Subida y bajada: por la puerta delantera suben de a uno (cada uno valida su bip!, unos más lentos
   * que otros) y a la vez bajan por las puertas central y trasera. Al terminar, a veces alguien viene corriendo.
   */
  updateBoarding(dt) {
    const sv = this.serving;
    const i = sv.index;
    const last = i === this.route.stops.length - 1;
    if (sv.done) {
      // Alguien corre al paradero: si las puertas siguen abiertas cuando llega, sube
      if (sv.runner && (sv.runner.eta -= dt) <= 0) {
        sv.runner = null;
        this.waiting[i]++;
        sv.done = false;
        this.emit("runnerArrive", { index: i });
        this.msg("Llegó corriendo y alcanzó a subir: espera que valide", "ok");
      }
      return;
    }
    let busy = false;
    // Bajan (puertas central y trasera)
    if (this.onboard.some(d => d === i)) {
      busy = true;
      sv.alight ??= { kind: this.personKind(), t: 0 };
      sv.alight.need ??= this.personTime(sv.alight.kind, "alight");
      if ((sv.alight.t += dt) >= sv.alight.need) {
        this.onboard.splice(this.onboard.indexOf(i), 1);
        sv.alighted++;
        this.emit("alight", { index: i, kind: sv.alight.kind, door: this.rng() < 0.45 ? "mid" : "rear" });
        sv.alight = null;
      }
    }
    // Suben (puerta delantera)
    if (!last && this.waiting[i] > 0 && this.onboard.length < BUS_CAPACITY) {
      busy = true;
      sv.board ??= { kind: this.personKind(), t: 0 };
      sv.board.need ??= this.personTime(sv.board.kind, "board");
      if ((sv.board.t += dt) >= sv.board.need) {
        const kind = sv.board.kind;
        sv.board = null;
        this.waiting[i]--;
        if (kind !== "nino" && this.rng() < NO_BALANCE) {
          this.emit("boardFail", { index: i, kind });
        } else {
          this.onboard.push(this.pickDestination(i));
          sv.boarded++;
          const evaded = kind !== "nino" && this.rng() < 0.04;
          if (evaded) this.totals.evasions++;
          this.emit("board", { index: i, kind, evaded });
        }
      }
    }
    if (busy) return;
    sv.done = true;
    const full = this.onboard.length >= BUS_CAPACITY && this.waiting[i] > 0;
    // A veces alguien viene corriendo justo cuando terminan de subir (más en hora punta)
    if (!last && !full && !sv.hadRunner && this.rng() < 0.12 + this.demand * 0.15) {
      sv.hadRunner = true;
      sv.runner = { eta: 3.5 + this.rng() * 3 };
      this.emit("runner", { index: i, eta: sv.runner.eta });
    }
    this.emit("boardingDone", { index: i, full });
    const early = this.timetable[i].time - this.time;
    this.msg(last ? "Fin del recorrido: todos abajo. Cierra las puertas para terminar el servicio"
      : full ? "Bus lleno: el resto espera el próximo. Cierra las puertas"
      : sv.runner ? "Todos arriba… ¡pero alguien viene corriendo! Si lo esperas, alcanza a subir"
      : early > 60 ? `Todos arriba. Vas ${Math.round(early)} s adelantado: espera con las puertas abiertas antes de seguir`
      : "Todos arriba: cierra las puertas y sigue", "ok");
  }

  onDoorsClosed() {
    const sv = this.serving;
    if (!sv) return;
    this.serving = null;
    const i = sv.index;
    if (sv.runner) { this.emit("runnerMissed", { index: i }); this.msg("Un pasajero corría al bus y no alcanzó", "info"); }
    const left = this.onboard.length < BUS_CAPACITY ? this.waiting[i] : 0;
    const stuck = this.onboard.filter(d => d === i).length;
    if (stuck) {
      this.penalty(30 * stuck, `Cerraste antes de tiempo: ${stuck === 1 ? "un pasajero no alcanzó" : `${stuck} pasajeros no alcanzaron`} a bajar`);
      this.onboard = this.onboard.map(d => d === i ? Math.min(i + 1, this.route.stops.length - 1) : d);
    }
    if (left > 0 && i < this.route.stops.length - 1) this.penalty(Math.min(200, 25 * left), `Dejaste ${left === 1 ? "a un pasajero" : `${left} pasajeros`} abajo en ${this.route.stops[i].name}`);
    this.finishStop(i, sv);
  }

  /** Cierra la atención de un paradero: puntos, sueldo y siguiente paradero. */
  finishStop(i, sv, { free = false } = {}) {
    const st = this.route.stops[i];
    const due = this.timetable[i].time;
    let precision = 0, punctual = 0, delay = null;
    if (sv) {
      const err = Math.abs(sv.error);
      precision = err <= 1.5 ? 100 : err <= 3.5 ? 70 : err <= 6 ? 40 : 15;
      // Atrasado: cuenta la llegada. Adelantado: cuenta la SALIDA (esperar con las puertas abiertas lo corrige,
      // como hacen los conductores para no adelantarse al horario). En el primer paradero, siempre la salida.
      delay = i === 0 || sv.arrival < due ? this.time - due : sv.arrival - due;
      punctual = Math.abs(delay) <= 60 ? 100 : Math.abs(delay) <= 180 ? 50 : 0;
      if (punctual === 100) this.totals.onTime++;
      this.totals.boarded += sv.boarded;
      this.totals.alighted += sv.alighted;
      this.totals.served++;
    }
    const moved = sv ? sv.boarded + sv.alighted : 0;
    const gained = sv ? precision + punctual + moved * 5 : 0;
    const perfect = precision === 100 && punctual === 100;
    const gross = sv ? round10((BUS_WAGE.base + gained * BUS_WAGE.perPoint + (perfect ? BUS_WAGE.perfect : 0))) : 0;
    const discount = Math.min(gross, round10(this.pendingDeduction * BUS_WAGE.deduction));
    const pay = gross - discount;
    this.pendingDeduction = 0;
    this.points += gained;
    if (!free) this.totals.maxPoints += 200 + moved * 5;     // pasar de largo un paradero vacío no baja la nota
    this.totals.wage += pay;
    const result = { index: i, name: st.name, served: !!sv, precision, punctual, delay, moved, gained, perfect, pay, discount, error: sv?.error ?? null };
    this.results.push(result);
    this.emit("stopDone", result);

    this.stopIndex = i + 1;
    this.bell = false;
    this.bellAt = null;
    if (this.stopIndex >= this.route.stops.length) return this.finish();
    if (this.onboard.some(d => d === this.stopIndex)) this.bellAt = this.elapsed + 3 + this.rng() * 12;
  }

  checkSkip() {
    const st = this.nextStop;
    if (!st || this.serving) return;
    if (this.bus.s <= st.s + SKIP_AFTER) return;
    const i = this.stopIndex;
    const wanted = this.waiting[i] > 0 || this.onboard.some(d => d === i);
    if (wanted || i === this.route.stops.length - 1) {
      this.totals.skipped++;
      this.penalty(150, `Te saltaste el paradero ${st.name}${this.waiting[i] ? ` (${this.waiting[i]} esperando)` : ""}`);
      this.onboard = this.onboard.map(d => d === i ? Math.min(i + 1, this.route.stops.length - 1) : d);
      this.emit("complaint");
    } else this.msg(`Nadie en ${st.name} y nadie pidió parada: sigues de largo`, "ok");
    if (!wanted) this.totals.served++;
    this.finishStop(i, null, { free: !wanted && i !== this.route.stops.length - 1 });
  }

  updateWaiting(dt) {
    // Siguen llegando personas a los paraderos que el bus todavía no atiende
    const rate = (0.4 + this.demand * 2.6) / 60;
    for (let i = this.stopIndex; i < this.route.stops.length - 1; i++) {
      if (this.serving?.index === i) continue;
      this.arrivalAcc[i] += rate * dt * (0.5 + this.rng());
      if (this.arrivalAcc[i] >= 1) { this.arrivalAcc[i] -= 1; if (this.waiting[i] < 28) this.waiting[i]++; }
    }
  }

  updateBell() {
    if (this.bell || this.bellAt == null) return;
    const st = this.nextStop;
    if (this.elapsed >= this.bellAt || (st && st.s - this.bus.s < 60)) {
      this.bell = true;
      this.bellAt = null;
      this.emit("bell");
    }
  }

  /** 1.18 · Distancia al auto de adelante en la pista del bus y aviso si se viene encima. */
  updateLead(dt) {
    const b = this.bus;
    let gap = Infinity, v = 0;
    for (const c of this.cars) {
      if (Math.abs(c.x - b.x) > (this.wid + CAR_WIDTH) / 2 - 0.1) continue;
      const g = c.s - c.len - b.s;
      if (g > -0.5 && g < gap) { gap = g; v = c.v; }
    }
    if (gap === Infinity || gap > 80) { this.lead = null; return; }
    const closing = b.v - v;
    const ttc = closing > 0.3 ? gap / closing : Infinity;
    this.lead = { gap, v, ttc };
    this.closeT = (b.v > 2.5 && (ttc < 2.6 || gap < b.v * 0.8)) ? (this.closeT ?? 0) + dt : 0;
    if (this.closeT > 0.25) {
      this.closeT = 0;
      if (!(this.cool.headway > this.elapsed)) {
        this.cool.headway = this.elapsed + 3;
        this.emit("headway", { gap });
        this.msg(`¡Distancia! Auto adelante a ${Math.max(0, Math.round(gap))} m: frena`, "warn");
      }
    }
  }

  /**
   * 1.18 · Dónde quedaría detenido el bus si sigue frenando igual (metros desde la puerta delantera),
   * o null si no está frenando. Sirve para clavar la parada en el paradero o en la línea del semáforo.
   */
  stopPrediction() {
    const b = this.bus;
    if (b.v < 0.3 || b.brake < 0.05) return null;
    const d = Math.max(b.decel, Math.min(b.brake * this.spec.brake, this.spec.brake * this.grip) * 0.9);
    return d > 0.15 ? (b.v * b.v) / (2 * d) : null;
  }

  /* ----------------------------- Tráfico ----------------------------- */

  spawnCars() {
    const s0 = this.bus.s;
    for (const lane of [1, 2]) {
      let s = s0 - 110 + this.rng() * 20;
      while (s < s0 + 420) {
        this.addCar(lane, s);
        s += 18 + this.rng() * 45;
      }
    }
  }

  addCar(lane, s) {
    const v0 = (38 + this.rng() * 16) / 3.6 * (1 - 0.15 * this.wet);   // con lluvia los autos van más lento
    const car = { id: this.nextCarId++, lane, x: LANES[lane], s, v: v0 * 0.7, v0, len: CAR_LEN, tint: Math.floor(this.rng() * 1e6), kind: this.rng() < 0.18 ? "van" : "car", braking: false };
    this.cars.push(car);
    return car;
  }

  laneFree(lane, s, back = 12, front = 12) {
    const x = LANES[lane], b = this.bus;
    if (Math.abs(b.x - x) < 2.6 && s - CAR_LEN < b.s + front && s > b.s - this.len - back) return false;
    return !this.cars.some(c => Math.abs(c.x - x) < 2 && c.s > s - CAR_LEN - back && c.s - CAR_LEN < s + front);
  }

  /** Lo que tiene adelante un auto en su pista: { gap, v } (o null). */
  leaderOf(car) {
    let gap = Infinity, v = 0;
    for (const o of this.cars) {
      if (o === car || Math.abs(o.x - car.x) > 2.2 || o.s <= car.s) continue;
      const g = o.s - o.len - car.s;
      if (g < gap) { gap = g; v = o.v; }
    }
    const b = this.bus, rear = b.s - this.len;
    if (Math.abs(b.x - car.x) < (this.wid + CAR_WIDTH) / 2 + 0.2 && b.s > car.s) {
      const g = rear - car.s;
      if (g < gap) { gap = g; v = b.v; }
    }
    // Semáforo en rojo o en amarillo (si alcanza a frenar)
    for (const L of this.route.lights) {
      const d = L.s - 1 - car.s;
      if (d < 0 || d > 140) continue;
      const st = lightState(L, this.time);
      if (st === "red" || (st === "amber" && d > car.v * car.v / (2 * 3.5))) {
        if (d < gap) { gap = d; v = 0; }
      }
      break;
    }
    return gap === Infinity ? null : { gap, v };
  }

  updateCars(dt) {
    const b = this.bus;
    for (const car of this.cars) {
      const lead = this.leaderOf(car);
      let a;
      if (lead) {
        const sStar = 2 + car.v * (1.2 + 0.5 * this.wet) + car.v * (car.v - lead.v) / (2 * Math.sqrt(1.5 * 2.5));
        a = 1.5 * (1 - (car.v / car.v0) ** 4 - (Math.max(0, sStar) / Math.max(0.1, lead.gap)) ** 2);
        // Atascado detrás de algo lento: se cambia a la otra pista si está libre
        if (lead.gap < 25 && lead.v < car.v0 * 0.45 && !car.changing && this.rng() < dt * 0.8) {
          const other = car.lane === 1 ? 2 : 1;
          if (this.laneFree(other, car.s, 10, 14)) { car.lane = other; car.changing = true; }
        }
      } else a = 1.5 * (1 - (car.v / car.v0) ** 4);
      a = Math.max(-8, a);
      car.braking = a < -0.6;
      car.v = Math.max(0, car.v + a * dt);
      car.s += car.v * dt;
      const tx = LANES[car.lane];
      car.x += clamp(tx - car.x, -2 * dt, 2 * dt);
      if (Math.abs(car.x - tx) < 0.01) car.changing = false;
    }
    // Los que quedan muy atrás o muy adelante reaparecen al otro lado de la ventana visible
    for (const car of this.cars) {
      if (car.s < b.s - 170 || car.s > b.s + 500) {
        const ahead = car.s < b.s;
        for (let k = 0; k < 6; k++) {
          const lane = this.rng() < 0.5 ? 1 : 2;
          const s = ahead ? b.s + 320 + this.rng() * 160 : b.s - 150 + this.rng() * 20;
          if (this.laneFree(lane, s, 14, 14)) {
            Object.assign(car, { lane, x: LANES[lane], s, v: car.v0 * (ahead ? 0.8 : 1), changing: false });
            break;
          }
        }
      }
    }
  }

  checkCollisions() {
    const b = this.bus, rear = b.s - this.len;
    for (const car of this.cars) {
      if (Math.abs(car.x - b.x) > (this.wid + CAR_WIDTH) / 2 - 0.15) continue;
      const cRear = car.s - car.len;
      if (car.s < rear || cRear > b.s) continue;
      // Se tocan: el que va atrás se detiene pegado al de adelante
      if (cRear > b.s - 2.5) {                  // el bus le pega por atrás al auto
        if (b.v > 0.6 && !(this.cool.crash > this.elapsed)) {
          this.cool.crash = this.elapsed + 2.5;
          this.totals.crashes++;
          this.penalty(300, "¡Chocaste a un auto! Mira la distancia con el de adelante");
          this.emit("crash");
        }
        b.s = cRear - 0.15;
        b.v = Math.min(b.v, car.v * 0.5);
      } else if (car.s < rear + 2.5) {          // un auto le pega por atrás al bus: se detiene detrás
        car.s = rear - 0.2;
        car.v = Math.min(car.v, b.v);
      } else {                                  // roce de lado al cambiar de pista
        if (!(this.cool.crash > this.elapsed)) {
          this.cool.crash = this.elapsed + 2.5;
          this.totals.crashes++;
          this.penalty(300, "¡Rozaste a un auto al cambiar de pista!");
          this.emit("crash");
        }
        b.targetLane = LANES.indexOf(LANES.reduce((best, x) => Math.abs(x - b.x) < Math.abs(best - b.x) ? x : best));
        b.latV = 0;
        car.s = rear - 0.4;
        car.v = 0;
      }
    }
  }

  /* ----------------------------- Final ----------------------------- */

  grade() {
    const ratio = this.totals.maxPoints > 0 ? this.points / this.totals.maxPoints : 0;
    return ratio >= 0.9 ? "S" : ratio >= 0.75 ? "A" : ratio >= 0.6 ? "B" : ratio >= 0.4 ? "C" : "D";
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const grade = this.grade();
    const bonus = this.totals.served - this.totals.skipped > 0 && this.results.some(r => r.served) ? BUS_WAGE.finish[grade] : 0;
    this.totals.wage += bonus;
    this.emit("finished", { grade, bonus, totals: { ...this.totals }, points: this.points, results: this.results.slice() });
  }

  /* ----------------------------- Lecturas para la interfaz ----------------------------- */

  /** Adelanto (−) o atraso (+) previsto en el próximo paradero, en segundos. */
  predictedDelay() {
    const st = this.nextStop;
    if (!st) return 0;
    const i = this.stopIndex;
    if (i === 0) return Math.max(0, this.time - this.timetable[0].time);
    const eta = this.time + Math.max(0, st.s - this.bus.s) / COMMERCIAL;
    return eta - this.timetable[i].time;
  }

  /** El semáforo que viene (y su estado) dentro de `range` metros. */
  nextLight(range = 160) {
    for (const L of this.route.lights) {
      const d = L.s - this.bus.s;
      if (d >= -1 && d <= range) return { light: L, d, state: lightState(L, this.time) };
    }
    return null;
  }
}
