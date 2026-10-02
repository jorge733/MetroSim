/* ==========================================================================
   MetroSim — Motor · events.js
   Bus de eventos del motor. La simulación avisa de lo que pasa ("tren
   creado", "tren retirado"...) y quien quiera (render 3D, interfaz, sonido)
   se suscribe, sin que el motor sepa quién escucha.
   ========================================================================== */

export class EventBus {
  constructor() { this.handlers = new Map(); }

  /** Suscribe una función a un tipo de evento. Devuelve la función para darse de baja. */
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) { this.handlers.get(type)?.delete(fn); }

  emit(type, data) {
    for (const fn of this.handlers.get(type) || []) fn(data);
  }
}
