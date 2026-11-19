/* ==========================================================================
   RedMoviSim — 2.2 · bus/taxiSim.js
   Conducir un TAXI por la misma calle del bus (Alameda o un recorrido de
   Red): mismo tráfico, semáforos, clima, pistas y faltas de busSim.js, pero
   en vez de paraderos hay CARRERAS:

     1. Alguien hace señas en la vereda (pickup): te detienes junto a la
        vereda (pista de la derecha) a su altura y abres la puerta (Espacio).
     2. Sube y te dice adónde va (una esquina más adelante). Cierra la puerta
        y llévalo: el taxímetro corre por distancia y por tiempo detenido.
     3. En el destino te detienes junto a la vereda y abres la puerta: paga
        lo que marca el taxímetro y, si el viaje fue suave, deja propina.

   Si te pasas de largo de quien hace señas, toma otro taxi. El turno
   termina cuando se acaba la calle.

   Tarifa APROXIMADA de un taxi básico de Santiago (no oficial): bajada de
   bandera más un monto cada 200 m o cada minuto detenido.
   Sin Three.js: se puede probar en Node.
   ========================================================================== */

import { BusSim } from "./busSim.js";
import { LANES, busRouteFor } from "./busRoute.js";

export const TAXI_LENGTH = 4.6;
export const TAXI_WIDTH = 1.85;
/** Potencia: acelera más que el bus y frena más fuerte. */
export const TAXI_SPEC = { accel: 2.6, brake: 6.2, vmax: 24 };
/** Taxímetro (pesos, aproximado): bajada de bandera y cada tramo de 200 m o de 60 s detenido. */
export const TAXI_FARE = { flag: 450, step: 210, meters: 200, seconds: 60 };

const PICK_WINDOW = 7;        // m alrededor de quien hace señas en que se puede recoger
const DROP_WINDOW = 18;       // m alrededor del destino en que se puede dejar (la esquina: más holgado)
const PASSED = 22;            // m pasado el punto de recogida: la persona toma otro taxi
const BOARD_TIME = 2.4;       // s que tarda en subir (abrir, sentarse, cerrar)
const PAY_TIME = 2.6;         // s que tarda en pagar y bajar
const MIN_TRIP = 450, MAX_TRIP = 1500;
const PATIENCE = 150;         // s que espera quien hace señas si el taxi se va para el otro lado
/** 2.3 · Eje del bandejón central: las pistas del otro sentido son las de este reflejadas (x → MIRROR_X − x). */
export const MIRROR_X = -10.8;
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
    this.fare = null;             // carrera en curso: { phase: "pickup" | "ride" | "done", ... } (posiciones ws: de la ida)
    this.fareN = 0;
    this.taxi = { fares: 0, lost: 0, km: 0, earned: 0, tips: 0, uturns: 0 };
    this.totals.maxPoints = 0;
    this.nextFareAt = 4;          // s hasta la primera persona que hace señas
  }

  /* --------- 2.3 · Sentido: la simulación va en el suyo; las carreras se guardan en el de la ida --------- */
  get dir() { return this._dir; }
  get idaS() { return this.toIdaS(this.bus.s); }
  toIdaS(s) { return this._dir > 0 ? s : this.span - s; }
  fromIdaS(ws) { return this._dir > 0 ? ws : this.span - ws; }
  toIdaX(x) { return this._dir > 0 ? x : MIRROR_X - x; }

  /** Vuelta en U: despacio, desde la pista junto al bandejón, en un cruce con semáforo (o al final de la calle). */
  uTurn() {
    const b = this.bus, R = this.route;
    if (this.finished) return false;
    if (b.doors !== "closed") return this.msg("Cierra la puerta antes de dar la vuelta", "warn", "uturn", 2), false;
    if (b.v > 5.5) return this.msg("Para dar la vuelta en U baja a menos de 20 km/h", "warn", "uturn", 2), false;
    const atEnd = b.s > R.length - 45;
    const L = R.lights.find(l => Math.abs(b.s - (l.s + 8)) < 13);
    if (!L && !atEnd) return this.msg("La vuelta en U se da en un cruce con semáforo (o al final de la calle)", "warn", "uturn", 2), false;
    if (!atEnd && b.lane !== LANES.length - 1) return this.msg("Para dar la vuelta pásate a la pista de la izquierda, junto al bandejón", "warn", "uturn", 2), false;
    const ws = this.toIdaS(L && !atEnd ? L.s + 8 : b.s);      // el centro del cruce, visto desde la ida
    this._dir = -this._dir;
    this.route = this._dir > 0 ? this.ida : this.back;
    b.s = this.fromIdaS(ws) + 2;
    b.lane = b.targetLane = LANES.length - 1;
    b.x = LANES.at(-1);
    b.latV = 0;
    b.v = Math.min(b.v, 2.5);
    this.waiting.reverse();          // los paraderos del otro sentido son los mismos, al revés
    this.arrivalAcc.reverse();
    this.cars = [];
    this.spawnCars();
    this.cars = this.cars.filter(c => Math.abs(c.s - b.s) > 25);     // nadie encima del taxi al salir de la vuelta
    this.lead = null;
    this.taxi.uturns++;
    this.emit("uturn", { dir: this._dir });
    this.msg(`Vuelta en U: ahora vas hacia ${this.route.to}`, "ok");
    return true;
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
    if (!f) {
      // Siguiente persona que hace señas, más adelante en la calle (en la vereda del sentido en que vas)
      if ((this.nextFareAt -= dt) > 0) return;
      const s = b.s + 140 + this.rng() * 220;
      if (s > R.length - 30) {
        this.nextFareAt = 2;
        return this.msg("Se acaba la calle: da la vuelta en U (U) para seguir buscando pasajeros", "info", "endStreet", 25);
      }
      this.fareN++;
      const ws = this.toIdaS(s);
      this.fare = { phase: "pickup", n: this.fareN, ws, dir: this._dir, name: this.placeName(ws), since: this.elapsed };
      this.emit("fareHail", { fare: { ...this.fare } });
      this.msg(`Alguien hace señas en ${this.fare.name} (a ${Math.round(s - b.s)} m): acércate a la vereda y detente a su lado`, "ok");
      return;
    }
    if (f.phase === "pickup") {
      const sameSide = f.dir === this._dir;
      const passed = sameSide && b.s > this.fromIdaS(f.ws) + PASSED;
      if (f.boardT == null && (passed || (!sameSide && this.elapsed - f.since > PATIENCE))) {
        this.taxi.lost++;
        this.emit("fareLost", { fare: { ...f } });
        this.msg(passed ? "Te pasaste: la persona tomó otro taxi" : "Se cansó de esperar y tomó otro taxi", "warn");
        this.fare = null;
        this.nextFareAt = 3 + this.rng() * 4;
        return;
      }
      if (f.boardT != null && b.doors === "open" && (f.boardT += dt) >= BOARD_TIME) this.board();
      return;
    }
    if (f.phase !== "ride") return;
    // Viaje: el taxímetro corre por distancia o por tiempo detenido
    if (b.doors === "closed") {
      if (b.v > 1) f.dist += b.v * dt;
      else f.idle += dt;
      const steps = Math.floor(f.dist / TAXI_FARE.meters) + Math.floor(f.idle / TAXI_FARE.seconds);
      f.meter = TAXI_FARE.flag + steps * TAXI_FARE.step;
      if (b.v > 1) this.taxi.km += b.v * dt / 1000;
    }
    if (f.payT != null && b.doors === "open" && (f.payT += dt) >= PAY_TIME) this.pay();
  }

  board() {
    const f = this.fare, I = this.ida;
    const lo = 40, hi = I.length - 25;
    // El destino puede quedar adelante o atrás (entonces hay que dar la vuelta en U)
    const trip = MIN_TRIP + this.rng() * (MAX_TRIP - MIN_TRIP);
    let sign = (this.rng() < 0.6 ? 1 : -1) * f.dir;
    if (f.ws + sign * MIN_TRIP > hi || f.ws + sign * MIN_TRIP < lo) sign = -sign;
    const dws = Math.max(lo, Math.min(hi, f.ws + sign * trip));
    this.fare = { phase: "ride", n: f.n, fromWs: f.ws, fromName: f.name, dws, destName: this.placeName(dws), dist: 0, idle: 0, meter: TAXI_FARE.flag, smooth: true, waited: this.elapsed - f.since, start: this.elapsed };
    this.onboard = [dws];                  // para los avisos de frenada brusca de busSim
    this.closeDoor();                      // el pasajero cierra la puerta al subir
    this.emit("fareBoard", { fare: { ...this.fare } });
    const km = `${(Math.abs(dws - f.ws) / 1000).toFixed(1).replace(".", ",")} km`;
    const behind = this.fromIdaS(dws) < this.bus.s;
    this.msg(`«Hola, voy a ${this.fare.destName}, por favor» · ${km}${behind ? " · queda para atrás: da la vuelta en U en un cruce (U)" : ""}`, "ok");
  }

  pay() {
    const f = this.fare;
    const fare = f.meter;
    const tip = f.smooth ? round10(fare * (0.08 + this.rng() * 0.07)) : 0;
    this.taxi.fares++;
    this.taxi.earned += fare + tip;
    this.taxi.tips += tip;
    this.points += 100 + (f.smooth ? 20 : 0);
    this.totals.maxPoints += 120;
    this.totals.wage += fare + tip;
    this.onboard = [];
    this.fare = { phase: "done" };
    this.closeDoor();                      // y la cierra al bajar
    this.emit("farePaid", { fare: { ...f }, amount: fare, tip, smooth: f.smooth });
    this.msg(f.smooth ? `Pagó ${fare} pesos y dejó ${tip} de propina: «¡Gracias, muy buen viaje!»` : `Pagó ${fare} pesos. Sin propina: el viaje no fue tan suave`, f.smooth ? "ok" : "info");
  }

  /* --------- Puerta --------- */
  /** La puerta la cierra el pasajero (al subir y al bajar). */
  closeDoor() {
    const b = this.bus;
    if (b.doors !== "open") return;
    b.doors = "closing"; b.doorT = 0;
    this.emit("door", { open: false });
  }

  /** ¿Está el taxi junto a la vereda y a la altura de `s`? */
  atCurb(s, win = PICK_WINDOW) {
    const b = this.bus;
    return { near: Math.abs(b.s - s) <= win, curb: Math.abs(b.x - LANES[0]) < 1.0, error: b.s - s };
  }

  onDoorsOpen() {
    const f = this.fare;
    if (f?.phase === "pickup") {
      if (f.dir !== this._dir) return this.msg("Esa persona está en la vereda de enfrente: da la vuelta en U para recogerla", "info");
      const at = this.atCurb(this.fromIdaS(f.ws));
      if (at.near && at.curb) { f.boardT = 0; this.emit("fareBoarding", { fare: { ...f } }); return; }
      if (at.near) return this.msg("Acércate a la vereda (pista de la derecha) para que pueda subir", "warn");
    } else if (f?.phase === "ride") {
      const at = this.atCurb(this.fromIdaS(f.dws), DROP_WINDOW);
      if (at.near && at.curb) { f.payT = 0; this.emit("farePaying", { fare: { ...f } }); return; }
      if (at.near) return this.msg("Acércate a la vereda para que tu pasajero baje seguro", "warn");
      return this.msg(`Todavía no llegan: el destino es ${f.destName}`, "info");
    }
  }

  onDoorsClosed() {
    const f = this.fare;
    if (f?.phase === "pickup" && f.boardT != null) { f.boardT = null; this.msg("Cerraste antes de que alcanzara a subir", "warn"); }
    if (f?.phase === "ride" && f.payT != null) { f.payT = null; this.msg("Cerraste antes de que alcanzara a pagar", "warn"); }
    if (f?.phase === "done") { this.fare = null; this.nextFareAt = 4 + this.rng() * 6; }
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
