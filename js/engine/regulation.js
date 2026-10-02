/* ==========================================================================
   MetroSim — Motor · regulation.js
   Regulación de intervalos (lo que hace el Puesto de Mando del Metro).

   Problema: si un tren se atrasa, encuentra más gente, tarda más y se
   atrasa aún más, mientras el de atrás va vacío y lo alcanza ("trenes en
   racimo"). El horario solo no lo corrige.

   Solución (regulación por intervalo, la que usan los metros reales):
     · RETENER al tren que va demasiado pegado al de delante: en la
       estación espera con las puertas abiertas (sigue subiendo gente) hasta
       quedar entre el tren de delante y el de atrás en la MISMA proporción
       que marca el horario (si el horario pasa de 6 a 4 min, se respeta).
       Si todos van según el horario, no retiene a nadie.
     · APURAR al tren que va con mucho hueco por delante: parada mínima y
       sin esperas extra, para no seguir acumulando retraso.
   Nunca retiene más de MAX_HOLD segundos seguidos.

   Se puede activar o desactivar con la orden "control.regulation".
   ========================================================================== */

import { CONFIG } from "../config.js";
import { estimateArrival } from "./eta.js";

/** Retención máxima en una parada (s). */
const MAX_HOLD = 75;
/** Por debajo de este margen (s) no merece la pena retener. */
const MIN_HOLD = 5;
/** Se apura a un tren cuando su hueco por delante supera el intervalo previsto en este factor. */
const HURRY_FACTOR = 1.25;

export class Regulator {
  /**
   * @param {object} engine  sistema de UNA línea (LineSystem de engine.js: bus, time, trains, traffic, timetables, routes)
   */
  constructor(engine) {
    this.engine = engine;
    const ROUTES = engine.routes;
    this.routes = ROUTES;
    this.enabled = true;
    // Última salida de cada estación por ruta: lastDeparture[routeId][índice de estación de la ruta]
    this.lastDeparture = Object.fromEntries(ROUTES.map(r => [r.id, []]));
    // Intervalos reales entre salidas consecutivas (para medir la regularidad)
    this.headways = Object.fromEntries(ROUTES.map(r => [r.id, r.stations.map(() => [])]));
    this.stats = { holds: 0, holdSeconds: 0, hurries: 0 };

    engine.bus.on("train:event", ({ unit, type, data }) => {
      if (type !== "departedStation") return;
      const list = this.lastDeparture[unit.route.id];
      if (!list) return;                                   // tren de otra línea
      const prev = list[data.station.index];
      const now = engine.time;
      if (prev) this.headways[unit.route.id][data.station.index].push(now - prev.time);
      list[data.station.index] = { time: now, id: unit.id, trip: unit.trip };
      if (unit.ato) { unit.ato.regulateUntil = null; unit.ato.regulating = false; }
    });
  }

  /** Paso de simulación: decide retenciones y trenes apurados. */
  update(clock) {
    for (const route of this.routes) {
      const units = this.engine.trains.filter(u => u.route === route);
      for (const u of units) {
        const ato = u.ato;
        if (!ato) continue;
        if (!this.enabled) { ato.regulateUntil = null; ato.regulating = false; ato.hurry = false; continue; }
        if (ato.state !== "dwell" && ato.state !== "running") continue;
        const rs = ato.target;
        if (!rs || rs === route.last || rs === route.first) { ato.hurry = false; continue; }   // en terminales manda el horario

        const front = this.lastDeparture[route.id][rs.index];
        const scheduledGap = rs.index > 0 && u.trip ? this.scheduledHeadway(route, u.trip, rs.index) : CONFIG.schedule.peakHeadway;

        // ¿Va con mucho hueco por delante? → apurar
        const frontGap = front ? clock - front.time : 0;
        ato.hurry = !!front && frontGap > scheduledGap * HURRY_FACTOR;

        // ¿Va demasiado pegado? → retener en la parada (solo una vez abiertas las puertas)
        if (ato.state !== "dwell" || !front) continue;
        if (ato.regulateUntil !== null && ato.regulateUntil !== undefined) continue;     // ya decidido en esta parada
        const follower = this.followerArrival(route, u, rs, clock);
        if (!follower || !u.trip || !front.trip) continue;
        // Salida ideal: reparte el hueco real entre delante y detrás como lo reparte el horario
        const i = rs.index;
        const Fs = front.trip.dep[i], Ms = u.trip.dep[i], Bs = follower.trip.arr[i];
        if (!(Bs > Ms && Ms > Fs)) { ato.regulateUntil = 0; continue; }
        const ideal = (front.time * (Bs - Ms) + follower.at * (Ms - Fs)) / (Bs - Fs);
        const scheduled = Ms;
        const until = Math.min(ideal, ato.arrivedAt + MAX_HOLD);
        if (until - Math.max(clock, scheduled) < MIN_HOLD) { ato.regulateUntil = 0; continue; }
        ato.regulateUntil = until;
        ato.regulating = true;
        this.stats.holds++;
        this.stats.holdSeconds += until - Math.max(clock, scheduled);
      }
    }
  }

  /** Intervalo previsto por el horario entre este servicio y el anterior en una estación. */
  scheduledHeadway(route, trip, index) {
    const trips = this.engine.timetables.get(route.id).trips;
    const i = trips.indexOf(trip);
    return i > 0 ? trip.dep[index] - trips[i - 1].dep[index] : CONFIG.schedule.peakHeadway;
  }

  /** Tren de atrás: hora prevista de llegada a esta estación y su servicio (o el siguiente del horario). */
  followerArrival(route, u, rs, clock) {
    let best = null;
    for (const v of this.engine.trains) {
      if (v === u || v.route !== route || v.sim.position <= u.sim.position || !v.trip) continue;
      const at = estimateArrival(v, rs, clock);
      if (at !== null && (best === null || at < best.at)) best = { at, trip: v.trip };
    }
    if (best) return best;
    const next = this.engine.timetables.get(route.id).trips.find(t => !this.engine.traffic.started.has(t.id) && t.arr[rs.index] > clock);
    return next ? { at: next.arr[rs.index], trip: next } : null;
  }

  /** Regularidad de los intervalos en una estación: media y desviación (s). */
  regularity(routeId, index) {
    const h = this.headways[routeId][index];
    if (h.length < 2) return null;
    const mean = h.reduce((a, b) => a + b, 0) / h.length;
    const sd = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length);
    return { mean, sd, max: Math.max(...h), min: Math.min(...h), n: h.length };
  }
}
