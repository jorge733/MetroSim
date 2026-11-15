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
import { LANES } from "./busRoute.js";

export const TAXI_LENGTH = 4.6;
export const TAXI_WIDTH = 1.85;
/** Potencia: acelera más que el bus y frena más fuerte. */
export const TAXI_SPEC = { accel: 2.6, brake: 6.2, vmax: 24 };
/** Taxímetro (pesos, aproximado): bajada de bandera y cada tramo de 200 m o de 60 s detenido. */
export const TAXI_FARE = { flag: 450, step: 210, meters: 200, seconds: 60 };

const PICK_WINDOW = 7;        // m alrededor del punto en que se puede recoger o dejar
const PASSED = 22;            // m pasado el punto de recogida: la persona toma otro taxi
const BOARD_TIME = 2.4;       // s que tarda en subir (abrir, sentarse, cerrar)
const PAY_TIME = 2.6;         // s que tarda en pagar y bajar
const MIN_TRIP = 450, MAX_TRIP = 1500;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round10 = (n) => Math.max(0, Math.round(n / 10) * 10);

export class TaxiSim extends BusSim {
  constructor(o) {
    super({ ...o, startStop: 0, vehicle: { len: TAXI_LENGTH, wid: TAXI_WIDTH, spec: TAXI_SPEC } });
    // El taxi parte en la pista del medio, no en la Solo Bus
    this.bus.lane = this.bus.targetLane = 1;
    this.bus.x = LANES[1];
    this.fare = null;             // carrera en curso: { phase: "pickup" | "ride", ... }
    this.fareN = 0;
    this.taxi = { fares: 0, lost: 0, km: 0, earned: 0, tips: 0 };
    this.totals.maxPoints = 0;
    this.nextFareAt = 4;          // s hasta la primera persona que hace señas
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

  /** La esquina más cercana a `s` (para nombrar dónde está la persona y adónde va). */
  placeName(s) {
    const R = this.route;
    let best = null;
    for (const L of R.lights) if (!best || Math.abs(L.s - s) < Math.abs(best.s - s)) best = L;
    for (const st of R.stops) if (!best || Math.abs(st.s - s) < Math.abs(best.s - s)) best = st;
    if (!best) return R.name;
    return best.street ? `${R.street ?? R.name} con ${best.street}` : `paradero ${best.name}`;
  }

  tick(dt) {
    super.tick(dt);
    this.updateFare(dt);
  }

  updateFare(dt) {
    const b = this.bus, R = this.route, f = this.fare;
    if (!f) {
      // Siguiente persona que hace señas, más adelante en la calle (si queda calle para un viaje)
      if ((this.nextFareAt -= dt) > 0) return;
      const s = b.s + 140 + this.rng() * 220;
      if (s + MIN_TRIP > R.length - 20) return this.endOfStreet();
      this.fareN++;
      this.fare = { phase: "pickup", n: this.fareN, s, name: this.placeName(s), since: this.elapsed };
      this.emit("fareHail", { fare: { ...this.fare } });
      this.msg(`Alguien hace señas en ${this.fare.name} (a ${Math.round(s - b.s)} m): acércate a la vereda y detente a su lado`, "ok");
      return;
    }
    if (f.phase === "pickup") {
      if (b.s > f.s + PASSED && !f.boardT) {
        this.taxi.lost++;
        this.emit("fareLost", { fare: { ...f } });
        this.msg("Te pasaste: la persona tomó otro taxi", "warn");
        this.fare = null;
        this.nextFareAt = 3 + this.rng() * 4;
        return;
      }
      if (f.boardT != null && b.doors === "open" && (f.boardT += dt) >= BOARD_TIME) this.board();
      return;
    }
    // Viaje: el taxímetro corre por distancia o por tiempo detenido
    if (b.doors === "closed") {
      if (b.v > 1) f.dist += b.v * dt;
      else f.idle += dt;
      const steps = Math.floor(f.dist / TAXI_FARE.meters) + Math.floor(f.idle / TAXI_FARE.seconds);
      f.meter = TAXI_FARE.flag + steps * TAXI_FARE.step;
      if (b.v > 1) this.taxi.km += b.v * dt / 1000;
    }
    if (b.s > f.dest + PASSED * 3 && !f.passedWarn) {
      f.passedWarn = true;
      f.smooth = false;
      this.msg("¡Te pasaste del destino! El pasajero no quedó contento: da la vuelta… o déjalo en la próxima esquina", "warn");
      f.dest = Math.min(R.length - 15, b.s + 120);
      f.destName = this.placeName(f.dest);
      this.emit("fareDest", { fare: { ...f } });
    }
    if (f.payT != null && b.doors === "open" && (f.payT += dt) >= PAY_TIME) this.pay();
  }

  board() {
    const f = this.fare, R = this.route;
    const room = R.length - 20 - f.s;
    const trip = clamp(MIN_TRIP + this.rng() * (MAX_TRIP - MIN_TRIP), MIN_TRIP, room);
    const dest = f.s + trip;
    this.fare = { phase: "ride", n: f.n, from: f.s, fromName: f.name, dest, destName: this.placeName(dest), dist: 0, idle: 0, meter: TAXI_FARE.flag, smooth: true, waited: this.elapsed - f.since, start: this.elapsed };
    this.onboard = [dest];                 // para los avisos de frenada brusca de busSim
    this.closeDoor();                      // el pasajero cierra la puerta al subir
    this.emit("fareBoard", { fare: { ...this.fare } });
    this.msg(`«Hola, voy a ${this.fare.destName}, por favor» · ${(trip / 1000).toFixed(1).replace(".", ",")} km`, "ok");
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
  atCurb(s) {
    const b = this.bus;
    return { near: Math.abs(b.s - s) <= PICK_WINDOW, curb: Math.abs(b.x - LANES[0]) < 1.0, error: b.s - s };
  }

  onDoorsOpen() {
    const f = this.fare;
    if (f?.phase === "pickup") {
      const at = this.atCurb(f.s);
      if (at.near && at.curb) { f.boardT = 0; this.emit("fareBoarding", { fare: { ...f } }); return; }
      if (at.near) return this.msg("Acércate a la vereda (pista de la derecha) para que pueda subir", "warn");
    } else if (f?.phase === "ride") {
      const at = this.atCurb(f.dest);
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

  /* --------- Final --------- */
  endOfStreet() {
    if (this.endWarned) return;
    this.endWarned = true;
    this.msg("Se acaba la calle: ya no hay más carreras en este recorrido. Fin del turno", "info");
    this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const grade = this.taxi.fares ? this.grade() : "D";
    const bonus = this.taxi.fares >= 2 ? { S: 2500, A: 1800, B: 1100, C: 600, D: 0 }[grade] : 0;
    this.totals.wage += bonus;
    this.emit("finished", { grade, bonus, totals: { ...this.totals }, taxi: { ...this.taxi }, points: this.points });
  }

  /** Para la interfaz: adónde hay que ir ahora (recoger o dejar), o null. */
  get target() {
    const f = this.fare;
    if (f?.phase === "pickup") return { kind: "pickup", s: f.s, name: f.name };
    if (f?.phase === "ride") return { kind: "dest", s: f.dest, name: f.destName };
    return null;
  }
}
