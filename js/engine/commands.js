/* ==========================================================================
   MetroSim — Motor · commands.js
   Órdenes al motor (el "buzón").

   Los roles (Conductor, Pasajero, Centro de Control) NO tocan la
   simulación directamente: dejan una orden con engine.command(tipo, datos).
   El motor las cumple al comienzo del siguiente paso, comprueba si se
   pueden cumplir (enclavamientos, estado del tren...) y avisa del resultado
   por el bus con "command:result" { type, payload, result }.

   Así cualquier fuente de órdenes (teclado, botones táctiles, consola,
   Centro de Control, pruebas en Node) usa las mismas reglas.

   Los trenes se identifican por su id de servicio (por ejemplo "L3-0805").
   ========================================================================== */

import { nextStopIndex } from "./express.js";

/** Resultado estándar: { ok, text, level } (text puede ser null si no hay nada que decir). */
const ok = (text = null, level = "info") => ({ ok: true, text, level });
const fail = (text, level = "warn") => ({ ok: false, text, level });

/** Convierte el mensaje que devuelve TrainSim ({text, level} o null) en resultado. */
const fromSim = (r) => (r ? { ok: r.level !== "warn", ...r } : ok());

/**
 * Manejadores por tipo de orden.
 * Cada uno recibe (engine, payload, unit) — unit es el tren de payload.trainId.
 */
export const COMMANDS = {
  /* ----- Conductor: mando del tren ----- */
  "driver.notchUp":   (e, p, u) => fromSim(u.sim.notchUp()),
  "driver.notchDown": (e, p, u) => fromSim(u.sim.notchDown()),
  "driver.emergency": (e, p, u) => fromSim(u.sim.emergencyBrake(p.reason ?? null)),
  "driver.reverser":  (e, p, u) => fromSim(u.sim.shiftReverser(p.step > 0 ? 1 : -1)),
  "driver.doors":     (e, p, u) => fromSim(u.sim.toggleDoors()),

  /* ----- Centro de Control: regulación de trenes automáticos ----- */

  /**
   * Retener un tren en la estación: no cierra puertas ni sale hasta que se libere.
   * Con payload.seconds se libera solo pasado ese tiempo (contado desde ahora).
   */
  "control.hold": (e, p, u) => {
    if (!u.ato) return fail(`${u.id} lo conduce una persona: avísale por radio`);
    if (u.ato.outOfService) return fail(`${u.id} está fuera de servicio`, "info");
    const s = Number(p.seconds) > 0 ? Number(p.seconds) : null;
    const docked = ["dwell", "closing", "ready"].includes(u.ato.state);
    u.ato.held = true;
    // En el andén cuenta desde ahora; en marcha, desde que llegue a la próxima parada
    u.ato.heldUntil = s !== null && docked ? e.time + s : null;
    u.ato.holdFor = s !== null && !docked ? s : null;
    const time = s ? ` durante ${Math.round(s)} s` : " hasta nueva orden";
    return ok(docked ? `${u.id} retenido en ${u.ato.target.name}${time}` : `${u.id} retenido en su próxima parada${time}`, "warn");
  },

  /** Pasar sin detenerse por la próxima parada (para recuperar retraso). Nunca la terminal. */
  "control.skip": (e, p, u) => {
    const ato = u.ato;
    if (!ato) return fail(`${u.id} lo conduce una persona: avísale por radio`);
    if (ato.outOfService) return fail(`${u.id} está fuera de servicio`, "info");
    const last = u.route.stations.length - 1;
    let idx;
    if (ato.state === "running") {
      // Solo si aún le da para no frenar (si no, se salta la siguiente)
      const d = u.sim.position - ato.target.stopZ, v = u.sim.speed;
      idx = d > (v * v) / (2 * 0.8) + 60 ? ato.targetIndex : nextStopIndex(u.trip, ato.targetIndex, last);
    } else if (ato.state === "dwell" || ato.state === "closing" || ato.state === "ready") {
      idx = nextStopIndex(u.trip, ato.targetIndex, last);
    } else return fail(`${u.id} no está en servicio comercial`, "info");
    if (idx >= last) return fail(`${u.id}: la próxima parada es la terminal, no se puede saltar`);
    if (ato.evacuateAt === idx) return fail(`${u.id} se retira del servicio en ${u.route.stations[idx].name}: ahí deben bajar todos`);
    // Copia propia: los conjuntos de la Ruta Expresa son compartidos entre servicios
    u.trip.skip = new Set([...(u.trip.skip ?? []), idx]);
    if (ato.state === "running" && idx === ato.targetIndex) {
      ato.targetIndex = nextStopIndex(u.trip, idx - 1, last);
      ato.brakeTarget = null;
    }
    return ok(`${u.id} pasará sin detenerse por ${u.route.stations[idx].name}`, "warn");
  },

  /**
   * Autorizar a un tren a rebasar en marcha a la vista la señal averiada que tiene
   * por delante (hasta 1,5 km). Solo si el cantón que protege está libre.
   */
  "control.authorize": (e, p, u) => {
    if (!u.ato) return fail(`${u.id} lo conduce una persona: avísale por radio`);
    const sys = e.line(u.route).signals.get(u.route.id);
    const first = sys.nextAhead(u.sim.position);
    const signal = first && sys.signals.slice(first.index).find(s => s.fault || u.sim.position - s.z > 1500);
    if (!signal?.fault) return fail(`${u.id} no tiene ninguna señal averiada por delante`, "info");
    if (signal.occupied) return fail(`Cantón de S${signal.id} ocupado por otro tren: espera a que lo deje libre`);
    if (signal.permit && signal.permit !== u) return fail(`S${signal.id}: ya autorizaste a ${signal.permit.id}, espera a que pase`);
    signal.permit = u;
    u.ato.permit = signal;
    return ok(`${u.id} autorizado a rebasar S${signal.id} en marcha a la vista`, "ok");
  },

  /** Autorizar a un tren detenido en plena vía a reanudar la marcha. */
  "control.resume": (e, p, u) => {
    if (!u.ato?.lineStop) return fail(`${u.id} no está detenido en la vía`, "info");
    u.ato.lineStop.until = e.time;
    return ok(`${u.id} autorizado a reanudar la marcha`, "ok");
  },

  /** Retirar un tren del servicio: en su próxima parada bajan todos y sigue vacío hasta la terminal. */
  "control.withdraw": (e, p, u) => {
    const ato = u.ato;
    if (!ato) return fail(`${u.id} lo conduce una persona: avísale por radio`);
    if (ato.outOfService || ato.evacuateAt != null) return fail(`${u.id} ya se retira del servicio`, "info");
    const last = u.route.stations.length - 1;
    const idx = ato.state === "running" ? ato.targetIndex : nextStopIndex(u.trip, ato.targetIndex, last);
    if (idx >= last || ato.state === "depot" || ato.state === "retire" || ato.state === "retired") return fail(`${u.id} ya termina su recorrido`, "info");
    if (u.trip.skip?.has(idx)) u.trip.skip = new Set([...u.trip.skip].filter(i => i !== idx));
    ato.evacuateAt = idx;
    return ok(`${u.id} se retira del servicio en ${u.route.stations[idx].name}: bajan todos`, "warn");
  },

  /** Activar o desactivar la regulación automática de intervalos. */
  "control.regulation": (e, p) => {
    for (const l of e.lines.values()) if (!p.line || l.line.id === String(p.line)) l.regulator.enabled = !!p.on;
    return ok(`Regulación de intervalos ${p.on ? "activada" : "desactivada"}`, p.on ? "ok" : "warn");
  },

  /** Liberar un tren retenido. */
  "control.release": (e, p, u) => {
    if (!u.ato?.held) return fail(`${u.id} no estaba retenido`, "info");
    u.ato.held = false;
    u.ato.heldUntil = u.ato.holdFor = null;
    return ok(`${u.id} liberado`, "ok");
  },
};

/** Órdenes que no necesitan tren. */
const NO_TRAIN = new Set(["control.regulation"]);

export class CommandQueue {
  constructor(engine) {
    this.engine = engine;
    this.pending = [];
  }

  /** Deja una orden en el buzón. */
  push(type, payload = {}) {
    this.pending.push({ type, payload });
  }

  /** Cumple todas las órdenes pendientes (al comienzo de un paso del motor). */
  process() {
    if (!this.pending.length) return;
    const list = this.pending;
    this.pending = [];
    for (const { type, payload } of list) {
      const result = this.execute(type, payload);
      this.engine.bus.emit("command:result", { type, payload, result });
    }
  }

  execute(type, payload) {
    const handler = COMMANDS[type];
    if (!handler) return fail(`Orden desconocida: ${type}`, "alert");
    const unit = NO_TRAIN.has(type) ? null : this.engine.findTrain(payload.trainId);
    if (!unit && !NO_TRAIN.has(type)) return fail(`No hay ningún tren ${payload.trainId ?? ""} en la red`);
    return handler(this.engine, payload, unit);
  }
}
