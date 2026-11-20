/* ==========================================================================
   RedMoviSim — 2.2 · bus/taxiSim.js
   Conducir un TAXI por la misma calle del bus (Alameda o un recorrido de
   Red): mismo tráfico, semáforos, clima, pistas y faltas de busSim.js, pero
   en vez de paraderos hay CARRERAS:

     1. Alguien hace señas en la vereda (pickup): te detienes junto a la
        vereda (pista de la derecha) a su altura.
     2. 2.20 · Como en la vida real, la puerta la abre y la cierra el
        pasajero: camina hasta el taxi, tira la manilla (si tiene seguro,
        se lo quitas con Espacio), abre, se sienta y cierra. Te dice adónde
        va y lo llevas: el taxímetro corre por distancia y tiempo detenido.
     3. En el destino te detienes junto a la vereda: paga lo que marca el
        taxímetro (y propina si el viaje fue suave), le quitas el seguro, abre
        la puerta, se baja y la cierra desde afuera.
   El seguro se pone solo al pasar de 15 km/h (como en muchos autos).

   Si te pasas de largo de quien hace señas, toma otro taxi. El turno
   termina cuando se acaba la calle.

   Tarifa APROXIMADA de un taxi básico de Santiago (no oficial): bajada de
   bandera más un monto cada 200 m o cada minuto detenido.
   Sin Three.js: se puede probar en Node.
   ========================================================================== */

import { BusSim } from "./busSim.js";
import { LANES, CURB_X, busRouteFor } from "./busRoute.js";
import { key as keyText } from "../keys.js";

export const TAXI_LENGTH = 4.6;
export const TAXI_WIDTH = 1.85;
/** Potencia: acelera más que el bus y frena más fuerte. */
export const TAXI_SPEC = { accel: 2.6, brake: 6.2, vmax: 24 };
/** Taxímetro (pesos, aproximado): bajada de bandera y cada tramo de 200 m o de 60 s detenido. */
export const TAXI_FARE = { flag: 450, step: 210, meters: 200, seconds: 60 };

const PICK_WINDOW = 7;        // m alrededor de quien hace señas en que se puede recoger
const DROP_WINDOW = 18;       // m alrededor del destino en que se puede dejar (la esquina: más holgado)
const PASSED = 22;            // m pasado el punto de recogida: la persona toma otro taxi
/* 2.20 · Subir y bajar paso a paso (la puerta la mueve el pasajero; ver busPeople.js · taxiStep) */
const WALK_SPEED = 1.25;      // m/s al caminar hasta la puerta
const IN_TIME = 1.8;          // s en agacharse, entrar y sentarse
const OUT_TIME = 1.7;         // s en salir y pararse junto a la puerta
const PAY_TIME = 2.6;         // s que tarda en pagar
const STILL_TIME = 0.6;       // s detenido en el destino antes de que empiece a pagar
const AUTOLOCK_V = 4.2;       // m/s (15 km/h): el seguro se pone solo
const MOVED_V = 0.6;          // m/s: arrancaste en medio de la subida o del pago
/** Dónde se para el pasajero junto a la puerta trasera derecha (detrás de su borde, fuera del giro de la puerta). */
export const TAXI_DOOR_SPOT = { out: 0.35, z: 3.85 };
const TAXI_HALF_W = 0.925;
const MIN_TRIP = 450, MAX_TRIP = 1500;
const PATIENCE = 150;         // s que espera quien hace señas si el taxi se va para el otro lado
/** 2.3 · Eje del bandejón central: las pistas del otro sentido son las de este reflejadas (x → MIRROR_X − x). */
export const MIRROR_X = -10.8;
/* 2.25 · Vuelta en U de verdad (no instantánea) */
const UTURN_ALONG = 5.5;      // m que avanza hacia el cruce hasta quedar atravesado
const UTURN_CREEP = 1.8;      // m/s: sin pedales, anda solo (caja automática)
const UTURN_VMAX = 4.2;       // m/s con el acelerador a fondo (15 km/h en una curva cerrada)
const round10 = (n) => Math.max(0, Math.round(n / 10) * 10);

export class TaxiSim extends BusSim {
  constructor(o) {
    super({ ...o, startStop: 0, vehicle: { len: TAXI_LENGTH, wid: TAXI_WIDTH, spec: TAXI_SPEC } });
    // 2.3 · Los dos sentidos de la calle: la ida (como se dibuja) y la vuelta (busRoute.js · reversed)
    this.ida = o.route;
    this.back = busRouteFor("vuelta", o.route.id);
    this.span = this.ida.stops[0].s + this.ida.stops.at(-1).s;
    this._dir = 1;
    // El taxi parte en la pista del medio, no en la Solo Bus
    this.bus.lane = this.bus.targetLane = 1;
    this.bus.x = LANES[1];
    this.cars = this.cars.filter(c => Math.abs(c.s - this.bus.s) > 25);   // 2.15.4 · nadie encima del taxi al partir
    // 2.25.1 · El tráfico del otro sentido también es de verdad (antes era decorado): al dar la vuelta en U se
    // intercambian las dos listas y ningún auto desaparece. Se guarda en el sistema de su propio sentido.
    this.opp = [];
    this.withOpp(() => this.spawnCars());
    this.fare = null;             // carrera en curso: { phase: "pickup" | "ride" | "done", ... } (posiciones ws: de la ida)
    this.fareN = 0;
    this.taxi = { fares: 0, lost: 0, km: 0, earned: 0, tips: 0, uturns: 0, log: [] };   // 2.23 · log: cada carrera, para el informe del turno
    this.totals.maxPoints = 0;
    this.nextFareAt = 4;          // s hasta la primera persona que hace señas
    this.locked = true;           // 2.20 · seguro de las puertas (Espacio lo pone o lo quita)
  }

  /* --------- 2.3 · Sentido: la simulación va en el suyo; las carreras se guardan en el de la ida --------- */
  get dir() { return this._dir; }
  get idaS() { return this.toIdaS(this.bus.s); }
  toIdaS(s) { return this._dir > 0 ? s : this.span - s; }
  fromIdaS(ws) { return this._dir > 0 ? ws : this.span - ws; }
  toIdaX(x) { return this._dir > 0 ? x : MIRROR_X - x; }

  /** Vuelta en U: despacio, desde la pista junto al bandejón, en un cruce con semáforo (o al final de la calle).
   *  2.25 · Ya no es instantánea: el taxi gira de verdad, en una curva de media vuelta que cruza el bandejón por el
   *  cruce y termina en la pista junto al bandejón del otro sentido. Anda solo a paso de hombre (caja automática);
   *  el acelerador lo apura un poco y el freno lo detiene en medio de la curva. */
  uTurn() {
    const b = this.bus, R = this.route;
    if (this.finished || this.turn) return false;
    if (b.doors !== "closed" || this.fare?.step) return this.msg("Espera que tu pasajero termine de subir o bajar", "warn", "uturn", 2), false;
    if (b.v > 5.5) return this.msg("Para dar la vuelta en U baja a menos de 20 km/h", "warn", "uturn", 2), false;
    const atEnd = b.s > R.length - 45;
    const L = R.lights.find(l => Math.abs(b.s - (l.s + 8)) < 13);
    if (!L && !atEnd) return this.msg("La vuelta en U se da en un cruce con semáforo (o al final de la calle)", "warn", "uturn", 2), false;
    if (!atEnd && b.lane !== LANES.length - 1) return this.msg("Para dar la vuelta pásate a la pista de la izquierda, junto al bandejón", "warn", "uturn", 2), false;
    // La curva (en el sentido en que vas): de x0 a la pista junto al bandejón de enfrente, avanzando UTURN_ALONG en el medio
    const x1 = MIRROR_X - LANES.at(-1);
    this.turn = { th: 0, s0: b.s, x0: b.x, r: (b.x - x1) / 2, a: UTURN_ALONG, yaw: 0, steer: 0 };
    b.targetLane = b.lane;
    b.latV = 0;
    this.emit("uturnStart", {});
    this.msg("Dando la vuelta en U: gira despacio (frena si viene alguien)", "info", "uturnGo", 0);
    return true;
  }

  /** 2.25 · Avanza por la curva de la vuelta en U (reemplaza el paso normal del bus mientras dura). */
  updateBus(dt) {
    const U = this.turn;
    if (!U) return super.updateBus(dt);
    const b = this.bus, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const wantT = clamp(+this.input.throttle || 0, 0, 1), wantB = clamp(+this.input.brake || 0, 0, 1);
    b.throttle += clamp(wantT - b.throttle, -3 * dt, 1.8 * dt);
    b.brake += clamp(wantB - b.brake, -3.2 * dt, 2.6 * dt);
    // Sin pedales avanza solo, despacio; con el acelerador, algo más rápido (pero la curva es cerrada); el freno lo detiene
    const vT = b.brake > 0.05 ? 0 : UTURN_CREEP + b.throttle * (UTURN_VMAX - UTURN_CREEP);
    const a = b.v < vT ? Math.min(1.6, (vT - b.v) * 2) : -(b.brake * this.spec.brake + Math.max(0, b.v - vT) * 1.5);
    const v0 = b.v;
    b.v = Math.max(0, b.v + a * dt);
    b.accel = (b.v - v0) / dt;
    b.decel += ((b.v > 0.05 ? -b.accel : 0) - b.decel) * Math.min(1, dt * 6);
    // Media elipse: s = s0 + a·sen θ, x = x0 − r·(1 − cos θ); θ avanza según lo recorrido
    const tan = Math.hypot(U.r * Math.sin(U.th), U.a * Math.cos(U.th));
    U.th = Math.min(Math.PI, U.th + b.v * dt / Math.max(0.5, tan));
    b.s = U.s0 + U.a * Math.sin(U.th);
    b.x = U.x0 - U.r * (1 - Math.cos(U.th));
    U.yaw = Math.atan2(U.r * Math.sin(U.th), U.a * Math.cos(U.th));      // 0 → π/2 (cruzando) → π (ya del otro lado)
    U.steer = Math.min(1, U.th / 0.4, (Math.PI - U.th) / 0.4);           // volante: se gira al entrar y se endereza al salir
    if (U.th >= Math.PI) this.endTurn();
  }

  /** Terminó la curva: ahora la simulación sigue en el otro sentido. */
  endTurn() {
    const b = this.bus;
    const ws = this.toIdaS(b.s), wx = this.toIdaX(b.x);
    this.turn = null;
    this._dir = -this._dir;
    this.route = this._dir > 0 ? this.ida : this.back;
    b.s = this.fromIdaS(ws);
    b.x = this._dir > 0 ? wx : MIRROR_X - wx;
    b.lane = b.targetLane = LANES.length - 1;
    b.latV = 0;
    this.waiting.reverse();          // los paraderos del otro sentido son los mismos, al revés
    this.arrivalAcc.reverse();
    // 2.25.1 · Los autos no desaparecen: los de enfrente pasan a ser los de tu sentido y los tuyos, los de enfrente
    [this.cars, this.opp] = [this.opp, this.cars];
    this.cars = this.cars.filter(c => Math.abs(c.x - b.x) > 2.2 || c.s - c.len > b.s + 0.5 || c.s < b.s - this.len - 0.5);   // nadie encima del taxi
    this.lead = null;
    this.taxi.uturns++;
    this.emit("uturn", { dir: this._dir });
    this.msg(`Vuelta en U: ahora vas hacia ${this.route.to}`, "ok");
  }

  /* --------- 2.25.1 · Tráfico del otro sentido --------- */
  /** Corre `fn` con la simulación mirando el otro sentido: sus autos, su recorrido y un taxi «fantasma» lejos de sus
   *  pistas (solo marca la ventana en que se reciclan los autos, que queda adelante del taxi, de donde vienen). */
  withOpp(fn) {
    const keep = [this.cars, this.route, this.bus];
    this.cars = this.opp;
    this.route = this._dir > 0 ? this.back : this.ida;
    this.bus = { s: this.span - keep[2].s - 330, x: 1e4, v: 0 };
    this.oppOf = keep[2];
    try { return fn(); } finally {
      this.opp = this.cars;
      [this.cars, this.route, this.bus] = keep;
      this.oppOf = null;
    }
  }

  updateCars(dt) {
    super.updateCars(dt);
    this.withOpp(() => super.updateCars(dt));
  }

  /** Los de enfrente frenan por el taxi mientras cruza sus pistas en la vuelta en U. */
  leaderOf(car) {
    const lead = super.leaderOf(car), b = this.oppOf;
    if (!b || !this.turn) return lead;
    const s = this.span - b.s + this.len / 2, x = MIRROR_X - b.x;       // el taxi visto desde el otro sentido
    if (Math.abs(x - car.x) > 3.4 || s < car.s - 1) return lead;
    const gap = Math.max(0, s - 3 - car.s);
    return !lead || gap < lead.gap ? { gap, v: 0 } : lead;
  }

  /* --------- Textos: los avisos heredados del bus hablan del taxi --------- */
  msg(text, level, key, every) {
    super.msg(this.taxiText(text), level, key, every);
  }
  penalty(points, text, key) {
    if (this.fare?.phase === "ride") this.fare.smooth = false;     // una falta con el pasajero arriba: sin propina
    super.penalty(points, this.taxiText(text), key);
  }
  taxiText(t) {
    return String(t)
      .replace("los pasajeros de pie se van para adelante", "tu pasajero se va para adelante")
      .replace("Con las puertas abiertas el bus no acelera (enclavamiento)", "Espera que se cierre la puerta para avanzar")
      .replace("Detén el bus antes de abrir las puertas", "Detén el taxi antes de abrir la puerta")
      .replace(/(?<!Solo )\bel bus\b/g, "el taxi").replace(/(?<!Solo )\bbus\b/g, "taxi");
  }

  /* --------- El bus atiende paraderos; el taxi no --------- */
  checkSkip() {}
  updateBell() {}
  updateBoarding() {}
  predictedDelay() { return 0; }

  /** La esquina o el paradero más cercano a `ws` (posición de la ida), para nombrar dónde está o adónde va. */
  placeName(ws) {
    const R = this.ida;
    let best = null;
    for (const L of R.lights) if (L.street && L.street !== "Semáforo" && (!best || Math.abs(L.s + 8 - ws) < Math.abs(best.s - ws))) best = { s: L.s + 8, street: L.street };
    for (const st of R.stops) if (!best || Math.abs(st.s - ws) < Math.abs(best.s - ws)) best = st;
    if (!best) return R.name;
    return best.street ? `${R.name} con ${best.street}` : `${R.name}, paradero ${best.name}`;
  }

  tick(dt) {
    super.tick(dt);
    this.updateFare(dt);
  }

  updateFare(dt) {
    const b = this.bus, R = this.route, f = this.fare;
    // El seguro se pone solo al andar
    if (!this.locked && b.v > AUTOLOCK_V) this.setLock(true, true);
    if (!f) {
      // Siguiente persona que hace señas, más adelante en la calle (en la vereda del sentido en que vas)
      if ((this.nextFareAt -= dt) > 0) return;
      const s = b.s + 140 + this.rng() * 220;
      if (s > R.length - 30) {
        this.nextFareAt = 2;
        return this.msg(`Se acaba la calle: da la vuelta en U (${keyText("U", "Vuelta")}) para seguir buscando pasajeros`, "info", "endStreet", 25);
      }
      this.fareN++;
      const ws = this.toIdaS(s);
      this.fare = { phase: "pickup", n: this.fareN, ws, dir: this._dir, name: this.placeName(ws), since: this.elapsed, step: null, t: 0 };
      this.emit("fareHail", { fare: { ...this.fare } });
      this.msg(`Alguien hace señas en ${this.fare.name} (a ${Math.round(s - b.s)} m): acércate a la vereda y detente a su lado`, "ok");
      return;
    }
    f.t += dt;
    if (f.phase === "pickup") {
      const sameSide = f.dir === this._dir;
      const hs = this.fromIdaS(f.ws);
      if (!f.step) {
        const passed = sameSide && b.s > hs + PASSED;
        if (passed || (!sameSide && this.elapsed - f.since > PATIENCE)) {
          this.taxi.lost++;
          this.taxi.log.push({ lost: true, name: f.name, passed });
          this.emit("fareLost", { fare: { ...f } });
          this.msg(passed ? "Te pasaste: la persona tomó otro taxi" : "Se cansó de esperar y tomó otro taxi", "warn");
          this.fare = null;
          this.nextFareAt = 3 + this.rng() * 4;
          return;
        }
        if (!sameSide || b.v >= 0.3 || b.doors !== "closed") return;
        const at = this.atCurb(hs);
        if (!at.near) return;
        if (!at.curb) return this.msg("Acércate a la vereda (pista de la derecha) para que pueda subir", "warn", "curbPick", 4);
        // Te detuviste a su lado: camina hasta la puerta trasera derecha
        const along = Math.abs(hs - (b.s - TAXI_DOOR_SPOT.z));
        const across = Math.max(0.5, Math.abs((CURB_X + 0.75) - (b.x + TAXI_HALF_W + TAXI_DOOR_SPOT.out)));
        this.setStep("walk", { walkT: (along + across) / WALK_SPEED + 0.3 });
        this.emit("fareBoarding", { fare: { ...f } });
        return;
      }
      if (f.step === "walk") {
        if (b.v > MOVED_V) return this.cancelWalk();
        if (f.t >= f.walkT) this.setStep("handle");
        return;
      }
      if (f.step === "handle") return this.tryHandle(f, "subir");
      if (f.step === "in" && f.t >= IN_TIME) { this.setStep("closing"); this.closeDoor(); }
      return;
    }
    if (f.phase === "ride") {
      // Viaje: el taxímetro corre por distancia o por tiempo detenido
      if (b.doors === "closed" && f.step !== "pay") {
        if (b.v > 1) f.dist += b.v * dt;
        else f.idle += dt;
        const steps = Math.floor(f.dist / TAXI_FARE.meters) + Math.floor(f.idle / TAXI_FARE.seconds);
        f.meter = TAXI_FARE.flag + steps * TAXI_FARE.step;
        if (b.v > 1) this.taxi.km += b.v * dt / 1000;
      }
      if (f.step === "pay") {
        if (b.v > MOVED_V) { f.step = null; f.still = 0; return this.msg("Detente: tu pasajero estaba pagando", "warn"); }
        if (f.t >= PAY_TIME) this.pay();
        return;
      }
      // Detenido junto a la vereda en el destino: paga
      const at = this.atCurb(this.fromIdaS(f.dws), DROP_WINDOW);
      if (b.v >= 0.3 || !at.near) { f.still = 0; return; }
      if (!at.curb) return this.msg("Acércate a la vereda para que tu pasajero baje seguro", "warn", "curbDrop", 4);
      if ((f.still = (f.still ?? 0) + dt) >= STILL_TIME) {
        this.setStep("pay");
        this.emit("farePaying", { fare: { ...f } });
        this.msg("«Aquí está bien, gracias. ¿Cuánto es?»", "info");
      }
      return;
    }
    // Pagó y se baja
    if (f.step === "handle") return this.tryHandle(f, "bajar");
    if (f.step === "out" && f.t >= OUT_TIME) { this.setStep("closing"); this.closeDoor(); }
  }

  setStep(step, extra = {}) {
    Object.assign(this.fare, { step, t: 0 }, extra);
    this.emit("taxiStep", { step, phase: this.fare.phase });
  }

  /** Arrancaste mientras caminaba hacia el taxi: vuelve a la vereda a hacer señas. */
  cancelWalk() {
    const f = this.fare;
    f.step = null; f.t = 0;
    this.emit("taxiStep", { step: null, phase: f.phase });
    this.msg("Arrancaste antes de que llegara a la puerta: vuelve a la vereda", "warn");
  }

  /** Tira la manilla: si hay seguro, espera a que se lo quites; si no, abre la puerta. */
  tryHandle(f, verb) {
    const b = this.bus;
    if (b.v > MOVED_V) {
      if (f.phase === "pickup") return this.cancelWalk();
      if (!f.fled) { f.fled = true; this.penalty(20, "Arrancaste con tu pasajero queriendo bajarse"); }
      return;
    }
    if (b.v >= 0.3) return;
    if (this.locked) {
      if (f.t > 0.5 && !f.tugged) { f.tugged = true; this.emit("taxiHandle", {}); }
      if (f.t > 0.7) this.msg(`Tiene seguro: quítalo (${keyText("Espacio", "Seguro")}) para que pueda ${verb}`, "warn", "locked", 5);
      return;
    }
    if (f.t < 0.5) return;                 // alcanza la manilla
    this.setStep("opening");
    b.doors = "opening"; b.doorT = 0;
    this.emit("door", { open: true });
  }

  board() {
    const f = this.fare, I = this.ida;
    const lo = 40, hi = I.length - 25;
    // El destino puede quedar adelante o atrás (entonces hay que dar la vuelta en U)
    const trip = MIN_TRIP + this.rng() * (MAX_TRIP - MIN_TRIP);
    let sign = (this.rng() < 0.6 ? 1 : -1) * f.dir;
    if (f.ws + sign * MIN_TRIP > hi || f.ws + sign * MIN_TRIP < lo) sign = -sign;
    const dws = Math.max(lo, Math.min(hi, f.ws + sign * trip));
    this.fare = { phase: "ride", n: f.n, fromWs: f.ws, fromName: f.name, dws, destName: this.placeName(dws), dist: 0, idle: 0, meter: TAXI_FARE.flag, smooth: true, waited: this.elapsed - f.since, start: this.elapsed, step: null, t: 0 };
    this.onboard = [dws];                  // para los avisos de frenada brusca de busSim
    this.emit("fareBoard", { fare: { ...this.fare } });
    const km = `${(Math.abs(dws - f.ws) / 1000).toFixed(1).replace(".", ",")} km`;
    const behind = this.fromIdaS(dws) < this.bus.s;
    this.msg(`«Hola, voy a ${this.fare.destName}, por favor» · ${km}${behind ? ` · queda para atrás: da la vuelta en U en un cruce (${keyText("U", "Vuelta")})` : ""}`, "ok");
  }

  pay() {
    const f = this.fare;
    const fare = f.meter;
    const tip = f.smooth ? round10(fare * (0.08 + this.rng() * 0.07)) : 0;
    this.taxi.fares++;
    this.taxi.earned += fare + tip;
    this.taxi.tips += tip;
    this.taxi.log.push({ name: f.fromName, dest: f.destName, km: f.dist / 1000, min: (this.elapsed - f.start) / 60, waited: f.waited, amount: fare, tip, smooth: f.smooth });
    this.points += 100 + (f.smooth ? 20 : 0);
    this.totals.maxPoints += 120;
    this.totals.wage += fare + tip;
    this.onboard = [];
    this.fare = { phase: "done", n: f.n, step: null, t: 0 };
    this.setStep("handle");                // ahora quiere bajarse
    this.emit("farePaid", { fare: { ...f }, amount: fare, tip, smooth: f.smooth });
    this.msg(f.smooth ? `Pagó ${fare} pesos y dejó ${tip} de propina: «¡Gracias, muy buen viaje!»` : `Pagó ${fare} pesos. Sin propina: el viaje no fue tan suave`, f.smooth ? "ok" : "info");
  }

  /* --------- Puerta y seguro --------- */
  /** 2.20 · Espacio: el conductor no abre la puerta, solo pone o quita el seguro. */
  toggleDoors() {
    if (this.finished) return;
    if (this.bus.doors !== "closed") return this.msg("La puerta la abre y la cierra tu pasajero", "info", "doorPax", 3);
    this.setLock(!this.locked);
  }
  setLock(locked, auto = false) {
    if (this.locked === locked) return;
    this.locked = locked;
    this.emit("taxiLock", { locked, auto });
    if (!auto) this.msg(locked ? "Pusiste el seguro" : "Quitaste el seguro: ya pueden abrir la puerta", "info", "lock", 0);
  }

  /** La puerta la cierra el pasajero (adentro al subir, desde afuera al bajar). */
  closeDoor() {
    const b = this.bus;
    if (b.doors !== "open") return;
    b.doors = "closing"; b.doorT = 0;
    this.emit("door", { open: false });
  }

  /** ¿Está el taxi junto a la vereda y a la altura de `s`? */
  atCurb(s, win = PICK_WINDOW) {
    const b = this.bus;
    if (this.turn) return { near: false, curb: false, error: b.s - s };     // 2.25 · girando en U
    return { near: Math.abs(b.s - s) <= win, curb: Math.abs(b.x - LANES[0]) < 1.0, error: b.s - s };
  }

  onDoorsOpen() {
    const f = this.fare;
    if (f?.step === "opening") this.setStep(f.phase === "pickup" ? "in" : "out");
  }

  onDoorsClosed() {
    const f = this.fare;
    if (f?.step !== "closing") return;
    if (f.phase === "pickup") return this.board();
    if (f.phase === "done") {
      this.fare = null;
      this.nextFareAt = 4 + this.rng() * 6;
      this.emit("fareGone", {});
    }
  }

  /* --------- Final (desde el menú: el turno sigue mientras quieras, en los dos sentidos) --------- */

  finish() {
    if (this.finished) return;
    this.finished = true;
    const grade = this.taxi.fares ? this.grade() : "D";
    const bonus = this.taxi.fares >= 2 ? { S: 2500, A: 1800, B: 1100, C: 600, D: 0 }[grade] : 0;
    this.totals.wage += bonus;
    this.emit("finished", { grade, bonus, totals: { ...this.totals }, taxi: { ...this.taxi }, points: this.points });
  }

  /**
   * Para la interfaz: adónde hay que ir ahora (recoger o dejar), o null.
   * s: en el sentido en que vas · ws: en la ida (mundo dibujado) · behind: quedó atrás · across: vereda de enfrente
   */
  get target() {
    const f = this.fare;
    if (f?.phase === "pickup") {
      const s = this.fromIdaS(f.ws);
      return { kind: "pickup", s, ws: f.ws, dir: f.dir, name: f.name, across: f.dir !== this._dir, behind: s < this.bus.s - PICK_WINDOW, win: PICK_WINDOW };
    }
    if (f?.phase === "ride") {
      const s = this.fromIdaS(f.dws);
      return { kind: "dest", s, ws: f.dws, dir: this._dir, name: f.destName, across: false, behind: s < this.bus.s - DROP_WINDOW, win: DROP_WINDOW };
    }
    return null;
  }
}
