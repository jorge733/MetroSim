/* ==========================================================================
   MetroSim — Motor · clock.js
   Reloj de la simulación con PASO FIJO.

   El Metro avanza a su propio ritmo, no al de la pantalla: cada fotograma
   entrega el tiempo real transcurrido y el reloj lo convierte en un número
   entero de pasos de simulación de duración fija. Así un computador lento
   dibuja menos fotogramas, pero los trenes se mueven igual.

   Para no congelar el navegador tras una pausa larga (pestaña oculta,
   ventana minimizada), cada fotograma se pone al día como máximo
   `maxCatchUp` segundos.
   ========================================================================== */

export class SimClock {
  /**
   * @param {number} start      hora inicial (segundos desde medianoche)
   * @param {object} opts
   * @param {number} opts.step        duración de cada paso (s)
   * @param {number} opts.maxCatchUp  máximo de tiempo simulado por fotograma (s)
   */
  constructor(start, { step = 1 / 60, maxCatchUp = 0.25 } = {}) {
    this.time = start;
    this.step = step;
    this.maxCatchUp = maxCatchUp;
    this.speed = 1;            // multiplicador de tiempo (×1 = tiempo real)
    this.paused = false;
    this.accumulator = 0;
  }

  /**
   * Avanza el reloj con el tiempo real de un fotograma.
   * @returns {number} cuántos pasos fijos hay que simular ahora
   */
  advance(realDt) {
    if (this.paused) return 0;
    this.accumulator += Math.min(Math.max(realDt, 0), this.maxCatchUp) * this.speed;
    const steps = Math.floor(this.accumulator / this.step);
    this.accumulator -= steps * this.step;
    return steps;
  }

  /** Marca un paso como simulado. */
  tick() { this.time += this.step; }
}
