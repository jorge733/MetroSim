/* ==========================================================================
   MetroSim — Roles · driverRole.js
   Rol de Conductor: traduce el teclado en ÓRDENES para el motor.

   El rol no toca el tren: deja la orden en el buzón del motor
   (engine.command) y el motor decide si se puede cumplir. La respuesta
   llega por el bus ("command:result"). Mañana, unos botones táctiles o el
   Centro de Control podrán mandar exactamente las mismas órdenes.

     W / ↑   driver.notchUp       S / ↓   driver.notchDown
     Espacio driver.emergency     D       driver.doors
     Q / E   driver.reverser (adelante / atrás)
   ========================================================================== */

/** Tecla → orden (y datos extra). */
const KEYMAP = {
  "w": ["driver.notchUp"], "arrowup": ["driver.notchUp"],
  "s": ["driver.notchDown"], "arrowdown": ["driver.notchDown"],
  " ": ["driver.emergency"],
  "q": ["driver.reverser", { step: +1 }],
  "e": ["driver.reverser", { step: -1 }],
  "d": ["driver.doors"],
};

export class DriverRole {
  /**
   * @param {import("../engine/engine.js").MetroEngine} engine
   * @param {() => object} getUnit  tren que conduce el jugador (cambia tras la maniobra de retorno)
   */
  constructor(engine, getUnit) {
    this.engine = engine;
    this.getUnit = getUnit;
  }

  /** ¿Esta tecla es una orden de conducción? La envía y devuelve true. */
  handleKey(key, repeat = false) {
    const entry = KEYMAP[key];
    if (!entry) return false;
    if (repeat && key !== " ") return true;              // mantener pulsado no repite (salvo emergencia)
    this.send(entry[0], entry[1]);
    return true;
  }

  /** Envía una orden para el tren del jugador. */
  send(type, extra = {}) {
    const unit = this.getUnit();
    if (unit) this.engine.command(type, { trainId: unit.id, source: "conductor", ...extra });
  }

  /** ¿Es la respuesta a una orden de este rol? */
  owns({ payload }) {
    return payload?.source === "conductor" && payload.trainId === this.getUnit()?.id;
  }
}
