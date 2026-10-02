/* ==========================================================================
   MetroSim — Motor · commands.js
   Órdenes al motor (el "buzón").

   Los roles (Conductor, Pasajero, futuro Centro de Control) NO tocan la
   simulación directamente: dejan una orden con engine.command(tipo, datos).
   El motor las cumple al comienzo del siguiente paso, comprueba si se
   pueden cumplir (enclavamientos, estado del tren...) y avisa del resultado
   por el bus con "command:result" { type, payload, result }.

   Así cualquier fuente de órdenes (teclado, botones táctiles, consola,
   Centro de Control, pruebas en Node) usa las mismas reglas.

   Los trenes se identifican por su id de servicio (por ejemplo "L3-0805").
   ========================================================================== */

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

  /** Retener un tren en la estación: no cierra puertas ni sale hasta que se libere. */
  "control.hold": (e, p, u) => {
    if (!u.ato) return fail(`${u.id} lo conduce una persona: avísale por radio`);
    u.ato.held = true;
    return ok(`${u.id} retenido en su próxima parada`, "warn");
  },
  /** Activar o desactivar la regulación automática de intervalos. */
  "control.regulation": (e, p) => {
    e.regulator.enabled = !!p.on;
    return ok(`Regulación de intervalos ${p.on ? "activada" : "desactivada"}`, p.on ? "ok" : "warn");
  },

  /** Liberar un tren retenido. */
  "control.release": (e, p, u) => {
    if (!u.ato?.held) return fail(`${u.id} no estaba retenido`, "info");
    u.ato.held = false;
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
