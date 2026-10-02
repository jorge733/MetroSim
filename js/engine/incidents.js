/* ==========================================================================
   MetroSim — Motor · incidents.js
   Incidentes aleatorios de la operación (uno por línea).

   Tipos:
     doorObstruction   un viajero bloquea una puerta mientras se cierran:
                       las puertas se reabren. El tren automático vuelve a
                       cerrar solo; el jugador debe cerrar otra vez (D).
     speedRestriction  limitación temporal de velocidad (trabajos o
                       inspección de vía) en un tramo, durante varios minutos.
                       Todos los trenes la respetan (route.speedLimitAt).
     signalFault       falla de una señal: queda en ROJO un tiempo. Los
                       trenes esperan ante ella; rebasarla es una falta.

   Avisa por el bus con "incident" { line, route, kind, phase: "start"|"end",
   text, ...datos }. No usa Three.js.
   ========================================================================== */

/** Probabilidad de puerta obstruida en cada cierre de puertas. */
const DOOR_CHANCE = { player: 0.12, auto: 0.03 };
/** Minutos (de simulación) entre incidentes de vía/señal: mínimo y máximo. */
const GAP_MIN = 4 * 60, GAP_MAX = 9 * 60;

const rand = (a, b) => a + Math.random() * (b - a);

export class IncidentManager {
  /** @param {object} lineSystem  LineSystem del motor (routes, signals, traffic, bus) */
  constructor(lineSystem, startTime) {
    this.ls = lineSystem;
    this.bus = lineSystem.bus;
    this.active = [];                // incidentes temporales en curso
    this.nextAt = startTime + rand(GAP_MIN / 2, GAP_MAX);
    this.recloses = [];              // trenes automáticos que deben volver a cerrar puertas
    for (const r of lineSystem.routes) r.restrictions = [];   // las rutas son compartidas entre partidas
  }

  update(dt, clock) {
    this.doors(clock);
    // Fin de los incidentes temporales
    for (const inc of [...this.active]) {
      if (clock < inc.until) continue;
      if (inc.kind === "speedRestriction") inc.route.restrictions.splice(inc.route.restrictions.indexOf(inc.zone), 1);
      if (inc.kind === "signalFault") inc.signal.fault = false;
      this.active.splice(this.active.indexOf(inc), 1);
      this.emit(inc, "end", inc.kind === "speedRestriction"
        ? `Fin de la limitación temporal de velocidad (${inc.zone.label})`
        : `Señal S${inc.signal.id} reparada · circulación normal`);
    }
    // Nuevo incidente
    if (clock >= this.nextAt) {
      this.nextAt = clock + rand(GAP_MIN, GAP_MAX);
      if (this.active.length < 2) (Math.random() < 0.55 ? this.startRestriction(clock) : this.startSignalFault(clock));
    }
  }

  /* ----- Puertas obstruidas ----- */
  doors(clock) {
    for (const u of this.ls.traffic.units) {
      const sim = u.sim;
      if (!sim) continue;
      if (sim.doorState !== "closing") { u.doorRolled = false; continue; }
      if (!u.doorRolled) {
        u.doorRolled = true;
        u.doorBlocked = sim.dockedStation() !== u.route.last && Math.random() < (u.isPlayer ? DOOR_CHANCE.player : DOOR_CHANCE.auto);
      }
      if (u.doorBlocked && sim.doorProgress < 0.55) {
        u.doorBlocked = false;
        sim.doorState = "opening";
        const car = 1 + Math.floor(Math.random() * 5);
        this.bus.emit("incident", {
          line: this.ls.line, route: u.route, kind: "doorObstruction", phase: "start", unit: u, car,
          text: `Puerta obstruida en el coche ${car} · reapertura automática${u.isPlayer ? " · vuelve a cerrar (D)" : ""}`,
        });
        if (!u.isPlayer) this.recloses.push({ unit: u, at: clock + rand(4, 8) });
      }
    }
    for (const r of [...this.recloses]) {
      if (clock < r.at) continue;
      this.recloses.splice(this.recloses.indexOf(r), 1);
      const sim = r.unit.sim;
      if (sim && (sim.doorState === "open" || sim.doorState === "opening")) sim.toggleDoors({ automatic: true });
    }
  }

  /** Tren del jugador en esta línea (para que los incidentes le toquen a él a menudo). */
  player() { return this.ls.traffic.units.find(u => u.isPlayer) || null; }

  /** Ruta y punto de referencia: delante del jugador (70 %) o al azar. */
  place(minAhead, maxAhead) {
    const p = this.player();
    if (p && Math.random() < 0.7) return { route: p.route, z: p.sim.position - rand(minAhead, maxAhead) };
    const route = this.ls.routes[Math.floor(Math.random() * this.ls.routes.length)];
    return { route, z: rand(route.last.stopZ + 300, route.first.stopZ - 300) };
  }

  /* ----- Limitación temporal de velocidad ----- */
  startRestriction(clock) {
    const { route, z } = this.place(700, 2500);
    if (z < route.last.stopZ + 100 || route.restrictions.length) return;
    const kmh = Math.random() < 0.5 ? 30 : 40, len = Math.round(rand(200, 400));
    const label = Math.random() < 0.5 ? "TRABAJOS EN VÍA" : "INSPECCIÓN DE VÍA";
    const zone = { from: z, to: z - len, kmh, label };
    route.restrictions.push(zone);
    const until = clock + rand(6, 12) * 60;
    const inc = { kind: "speedRestriction", route, zone, until };
    this.active.push(inc);
    const near = route.stations.find(s => s.stopZ < z) || route.last;
    this.emit(inc, "start", `Limitación temporal ${kmh} km/h por ${label.toLowerCase()} · ${len} m antes de ${near.name}`, { kmh, len, station: near });
  }

  /* ----- Falla de señal ----- */
  startSignalFault(clock) {
    const { route, z } = this.place(500, 1800);
    const sys = this.ls.signals.get(route.id);
    const signal = sys?.nextAhead(z);
    if (!signal || signal.fault) return;
    signal.fault = true;
    const until = clock + rand(40, 100);
    const inc = { kind: "signalFault", route, signal, until };
    this.active.push(inc);
    this.emit(inc, "start", `Falla de señal S${signal.id} · permanece en ROJO · espera ante ella la reparación`, { signal });
  }

  emit(inc, phase, text, extra = {}) {
    this.bus.emit("incident", { line: this.ls.line, route: inc.route, kind: inc.kind, phase, text, ...extra });
  }
}
