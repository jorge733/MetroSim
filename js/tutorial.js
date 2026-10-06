/* ==========================================================================
   MetroSim — 1.0 · tutorial.js
   Tutorial interactivo para el jugador nuevo (Conductor y Pasajero).

   Una tarjeta en pantalla explica un paso a la vez y AVANZA SOLA cuando el
   jugador hace lo que se le pide (abrir puertas, acelerar, bajar al Metro,
   pagar el torniquete...). Los pasos solo informativos tienen un botón
   "Siguiente" (o Enter). No toca la simulación: solo mira el estado del
   juego que le pasa main.js en cada fotograma.

   La primera vez que se juega cada modo el tutorial empieza solo; después
   se puede repetir con el botón "🎓 Tutorial" de cada modo en la portada.
   Progreso guardado en localStorage: metrosim.tutorial.<modo> = "done".
   ========================================================================== */

import { CONFIG, NOTCH_INDEX, formatCLP, spokenName } from "./config.js";

const KEY = (mode) => `metrosim.tutorial.${mode}`;

/** ¿Este modo ya tiene el tutorial terminado (o saltado)? */
export function tutorialDone(mode) {
  try { return localStorage.getItem(KEY(mode)) === "done"; } catch { return true; }
}
function markDone(mode) {
  try { localStorage.setItem(KEY(mode), "done"); } catch { /* sin almacenamiento */ }
}

const m = (n) => `${Math.max(0, Math.round(n))} m`;
const nice = spokenName;                 // "PLAZA DE ARMAS" → "Plaza de Armas"

/* ==========================================================================
   Pasos del Conductor
   c = { sim, info, game, touch, mem }   (info = getRouteInfo del tren del jugador)
   ========================================================================== */

function driverSteps(k) {
  return [
    {
      title: "Bienvenido a la cabina",
      text: (c) => `Hoy conduces el servicio ${c.game.player.trip.id}, un tren AS-2014 de 5 coches y 120 m. Te enseñaremos a salir de ${nice(c.mem.origin.name)} y detenerte bien en la estación siguiente. ${k("Arrastra el ratón para mirar alrededor (C vuelve a centrar).", "Arrastra el dedo para mirar alrededor.")}`,
      next: true,
    },
    {
      title: "Tus instrumentos",
      text: "Abajo: el VELOCÍMETRO con el límite de velocidad, la PRÓXIMA ESTACIÓN con la distancia, SEÑAL Y HORARIO y las PUERTAS. A la derecha: el INVERSOR (F adelante · N neutro · R atrás) y el MANDO (frenos, neutro y tracción).",
      focus: ["#driverHud", "#selectorHud"],
      next: true,
    },
    {
      title: "Abre las puertas",
      text: (c) => `El tren está detenido en el andén de ${nice(c.mem.origin.name)}. Pulsa ${k("D", "🚪 Puertas")} para abrir las puertas y que suban los viajeros.`,
      focus: [".door-panel"],
      done: (c) => c.sim.doorState !== "closed",
    },
    {
      title: "Cierra cuando termine el embarque",
      text: () => `Espera a que suban y bajen los viajeros (lo dice PUERTAS: «Embarque completo»). Entonces pulsa ${k("D", "🚪 Puertas")} para cerrar: tu horario se adelanta y puedes salir de inmediato, sin perder puntos.`,
      live: (c) => c.info.schedule ? `${c.info.schedule.label} · ${c.info.schedule.delayText}` : "",
      focus: [".signal-panel", ".door-panel"],
      done: (c) => c.sim.doorState === "closed",
    },
    {
      title: "El inversor",
      text: `El inversor ya está en F (adelante). Se cambia con ${k("Q (adelante) y E (atrás)", "Inv. ▶ e ◀ Inv.")}, solo con el tren parado. En R (atrás) el tren va lento: sirve para corregir si te pasas de la marca.`,
      focus: ["#selectorHud"],
      next: true,
    },
    {
      title: "Suelta el freno y acelera",
      text: `El mando empieza en FRENO 3. Pulsa ${k("W (o ↑)", "▲")} varias veces: FRENO 3 → 2 → 1 → NEUTRO → TRACCIÓN 1…4. Más tracción, más aceleración.`,
      live: (c) => `Mando: ${c.sim.notchData.label}`,
      focus: ["#selectorHud"],
      done: (c) => c.sim.notchData.type === "power" && c.sim.speedKmh > 3,
    },
    {
      title: "Respeta el límite",
      text: (c) => `Sube hasta unos ${c.mem.target = Math.min(40, c.info.limit - 5)} km/h. El número del cartel junto al velocímetro es el límite: pasarte resta puntos y sueldo.`,
      live: (c) => `${Math.round(c.sim.speedKmh)} km/h · límite ${c.info.limit} km/h`,
      focus: [".speed-panel"],
      done: (c) => c.sim.speedKmh >= (c.mem.target ?? 35),
    },
    {
      title: "Rueda en neutro",
      text: `Baja el mando con ${k("S (o ↓)", "▼")} hasta NEUTRO: el tren deja de acelerar y sigue rodando casi sin perder velocidad. Así se ahorra energía.`,
      live: (c) => `Mando: ${c.sim.notchData.label} · ${Math.round(c.sim.speedKmh)} km/h`,
      focus: ["#selectorHud"],
      done: (c) => c.sim.notch === NOTCH_INDEX.N && c.sim.speedKmh > 5,
    },
    {
      title: "Las señales",
      text: "VERDE: vía libre. AMARILLO: la siguiente señal está en rojo, prepárate para frenar. ROJO: detente antes de llegar. Si rebasas una roja, se activa el freno de emergencia.",
      live: (c) => c.info.signal ? `Próxima señal S${c.info.signal.id} a ${m(c.info.signal.distance)} · ${{ green: "verde", yellow: "amarilla", red: "roja" }[c.info.signal.aspect] || c.info.signal.aspect}` : "",
      focus: [".signal-panel"],
      next: true,
    },
    {
      title: "Prepara la llegada",
      text: (c) => `Vas hacia ${nice(c.mem.dest.name)}. Cuando falten unos 300 m, frena con ${k("S", "▼")} hasta FRENO 1 o FRENO 2. Frenar suave da más puntos (sin tirones).`,
      live: (c) => `Faltan ${m(c.sim.position - c.mem.dest.stopZ)} · ${Math.round(c.sim.speedKmh)} km/h`,
      focus: [".station-panel"],
      usesDest: true,
      done: (c) => c.sim.notchData.type === "brake" && c.sim.position - c.mem.dest.stopZ < 420,
    },
    {
      title: "Detente en la marca",
      text: `Ajusta el freno (${k("W/S", "▲/▼")}) para que el frente del tren pare justo en la marca del andén. Al acercarte aparece la barra de PRECISIÓN: el centro es la marca.`,
      live: (c) => {
        const err = c.sim.position - c.mem.dest.stopZ;
        if (!c.sim.isStopped) return `Faltan ${err > 0 ? m(err) : "0 m (¡te pasas!)"} · ${Math.round(c.sim.speedKmh)} km/h`;
        if (Math.abs(err) <= CONFIG.station.stopTolerance) return "¡En la marca!";
        return err > 0
          ? `Te faltan ${m(err)}: suelta el freno y avanza despacio con ${k("W", "▲")}`
          : `Te pasaste ${m(-err)}: pon el inversor en R (${k("E", "◀ Inv.")}) y retrocede despacio`;
      },
      focus: [".station-panel"],
      usesDest: true,
      done: (c) => c.sim.isStopped && Math.abs(c.sim.position - c.mem.dest.stopZ) <= CONFIG.station.stopTolerance,
    },
    {
      title: "Abre las puertas",
      text: (c) => `¡Bien detenido en ${nice(c.mem.dest.name)}! Si el inversor quedó en R, vuelve a F con ${k("Q", "Inv. ▶")}. Abre las puertas con ${k("D", "🚪 Puertas")}: cada estación bien servida te paga al instante en tu cuenta.`,
      focus: [".door-panel", "#bankPill"],
      done: (c) => c.sim.doorState === "open" || c.sim.doorState === "opening",
    },
    {
      title: "¡Ya eres conductor!",
      text: `Así se sirve cada estación: abrir, esperar el embarque, cerrar, acelerar, rodar y frenar a tiempo. Al final de la línea verás tu puntaje y harás la maniobra de retorno (${k("T", "⇄ Cabina")}). ${k("H muestra los controles · V cambia la vista.", "👁 Vista cambia la cámara.")}`,
      next: "Terminar",
    },
  ];
}

/* ==========================================================================
   Pasos del Pasajero a pie
   c = { walker, game, card, fare, touch, mem, hud }
   ========================================================================== */

function passengerSteps(k) {
  return [
    {
      title: "Bienvenido a Santiago",
      text: (c) => `Estás en la calle de ${nice(c.walker.station.name)}. ${k("Camina con W/S, gira con A/D o arrastrando el ratón y corre con Shift.", "Camina con el joystick (izquierda) y mira arrastrando a la derecha. 🏃 Correr alterna la carrera.")} Da unos pasos.`,
      done: (c) => c.mem.start && c.walker.pos.distanceTo(c.mem.start) > 4,
    },
    {
      title: "Tu primera misión",
      text: `Arriba a la izquierda está tu misión activa con sus pasos. ${k("J", "🎯 Misiones")} abre el tablero con más misiones: cada una paga en tu cuenta.`,
      focus: ["#missionTracker", "#bankPill"],
      next: true,
    },
    {
      title: "Baja al Metro",
      text: "Busca la boca del Metro (el cartel rojo con el rombo) y camina hacia su escalera para bajar a la mezanina. Abajo a la derecha verás pistas de lo que tienes cerca.",
      focus: ["#passengerHud"],
      done: (c) => c.walker.space !== "street",
    },
    {
      title: "Tu tarjeta bip!",
      text: (c) => c.card.hasCard
        ? `Para pasar el torniquete necesitas saldo. Ve a la BOLETERÍA (izquierda) o a un TÓTEM (derecha), acércate y pulsa ${k("E", "E · Usar")} para cargar con tu débito.`
        : `Necesitas una tarjeta bip!. Ve a la BOLETERÍA (a la izquierda), acércate y pulsa ${k("E", "E · Usar")}: compra la tarjeta y cárgala con tu tarjeta de débito.`,
      live: (c) => `bip! ${c.card.label} · pasaje ahora ${formatCLP(c.fare)}`,
      focus: ["#cardPill", "#bankPill"],
      done: (c) => c.card.hasCard && c.card.balance >= c.fare && !c.hud.ticketOpen,
    },
    {
      title: "Pasa el torniquete",
      text: "Camina hacia un torniquete: tu bip! se valida sola (¡bip!) y se cobra el pasaje según la hora (punta, valle o bajo).",
      done: (c) => c.walker.paid || c.walker.space === "train",
    },
    {
      title: "Baja al andén",
      text: "Cada andén va en una dirección: los carteles de la mezanina dicen hacia qué terminal va cada uno. Baja por la escalera (o el ascensor) al andén que te sirva.",
      done: (c) => (c.walker.space === "world" && !!c.walker.platformSide()) || c.walker.space === "train",
    },
    {
      title: "Espera el tren",
      text: `Abajo a la derecha ves en cuántos minutos llega el próximo tren y cuánta gente espera. Puedes sentarte en un banco con ${k("F", "F · Sentarse")}. Cuando el tren abra las puertas, camina hacia adentro.`,
      focus: ["#passengerHud"],
      done: (c) => c.walker.space === "train",
    },
    {
      title: "Viaja y bájate",
      text: (c) => `Escucha la megafonía: anuncia la próxima estación y las combinaciones. ${k("F", "F · Sentarse")} te sienta en un asiento libre.${c.game.missions?.step?.station ? ` Tu misión te lleva a ${nice(c.game.missions.step.station)}.` : ""} Cuando el tren se detenga y abra las puertas, camina hacia afuera.`,
      live: (c) => c.walker.unit ? `${Math.round(c.walker.unit.sim.speedKmh)} km/h · próxima: ${c.walker.unit.sim.nextStation()?.name ?? "—"}` : "",
      done: (c) => c.walker.space === "world",
    },
    {
      title: "Sal a la calle",
      text: "Sube a la mezanina, cruza los torniquetes hacia la salida y sigue los carteles de SALIDA hasta la escalera de la calle. Si la estación tiene combinación, el pasillo te lleva a la otra línea sin pagar de nuevo.",
      done: (c) => c.walker.space === "street",
    },
    {
      title: "¡Ya conoces el Metro!",
      text: `En la calle hay locales (${k("E", "E · Usar")} para comprar), un hito para fotografiar y un cajero con tu saldo. ${k("J misiones · K Tienda Metro · H controles.", "🎯 Misiones para el tablero.")} Si te falta dinero, haz un turno como Conductor.`,
      next: "Terminar",
    },
  ];
}

/* ==========================================================================
   Tarjeta del tutorial
   ========================================================================== */

export class Tutorial {
  /**
   * @param {object} opts
   * @param {"driver"|"passenger"} opts.mode
   * @param {HTMLElement} opts.parent       contenedor (pantalla de juego)
   * @param {boolean} opts.touch            pantalla táctil (textos con los botones en vez de teclas)
   * @param {number} [opts.step]            paso donde retomar (combinación entre líneas)
   * @param {() => void} [opts.onStep]      un paso se cumplió (sonido)
   * @param {() => void} [opts.onFinish]    terminado o saltado
   */
  constructor({ mode, parent, touch = false, step = 0, onStep = () => {}, onFinish = () => {} }) {
    this.mode = mode;
    this.onStep = onStep;
    this.onFinish = onFinish;
    this.touch = touch;
    const k = (keys, touchLabel) => touch ? touchLabel : keys;
    this.steps = mode === "driver" ? driverSteps(k) : passengerSteps(k);
    this.index = Math.min(step, this.steps.length - 1);
    this.mem = {};
    this.timer = 0;
    this.doneDelay = 0;          // pequeña pausa con "✔" antes de pasar al siguiente paso
    this.focused = [];

    const el = document.createElement("aside");
    el.className = `tutorial tutorial-${mode}`;
    el.innerHTML = `
      <header><span class="tutorial-badge">🎓 TUTORIAL</span><span class="tutorial-count"></span></header>
      <div class="tutorial-bar"><i></i></div>
      <strong class="tutorial-title"></strong>
      <p class="tutorial-text"></p>
      <p class="tutorial-live"></p>
      <footer>
        <button class="ghost-button tutorial-skip">Saltar tutorial</button>
        <button class="go-button tutorial-next">Siguiente ›</button>
        <span class="tutorial-wait">Hazlo para continuar…</span>
      </footer>`;
    parent.append(el);
    this.el = el;
    this.q = (s) => el.querySelector(s);
    // blur(): que Espacio (emergencia) no vuelva a "pulsar" el botón
    this.q(".tutorial-next").addEventListener("click", (ev) => { ev.currentTarget.blur(); this.advance(); });
    this.q(".tutorial-skip").addEventListener("click", (ev) => { ev.currentTarget.blur(); this.finish(); });
    this.render();
  }

  get step() { return this.steps[this.index]; }

  /** Enter avanza los pasos informativos. Devuelve true si usó la tecla. */
  onKey(key) {
    if (key === "enter" && this.step.next && !this.doneDelay) { this.advance(); return true; }
    return false;
  }

  /**
   * Una vez por fotograma desde el bucle del juego.
   * @param {number} dt
   * @param {object} ctx  estado del juego (ver driverSteps / passengerSteps)
   */
  update(dt, ctx) {
    if (!this.el) return;
    const c = { ...ctx, mem: this.mem };
    // Lo que el tutorial necesita recordar desde el principio
    if (this.mode === "driver" && !this.mem.origin && c.sim) {
      this.mem.origin = c.sim.dockedStation() || c.sim.nearestStation();
      this.mem.dest = c.sim.nextStation() || this.mem.origin;
    }
    // Si se pasa de largo de la estación (más de lo que se corrige en marcha atrás), la meta pasa a ser la siguiente
    if (this.mode === "driver" && this.mem.dest && c.sim.position - this.mem.dest.stopZ < -60 && this.step.usesDest) {
      const next = c.sim.nextStation();
      if (next) { this.mem.missed = this.mem.dest; this.mem.dest = next; this.lastText = null; }
    }
    if (this.mode === "passenger" && !this.mem.start && c.walker) this.mem.start = c.walker.pos.clone();
    if (this.doneDelay) {
      this.doneDelay -= dt;
      if (this.doneDelay <= 0) { this.doneDelay = 0; this.advance(); }
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;                                 // 5 veces por segundo basta
    this.ctx = c;
    const s = this.step;
    if (s.done && s.done(c)) {
      this.doneDelay = 0.9;
      this.el.classList.add("passed");
      this.onStep();
      return;
    }
    this.renderDynamic(c);
  }

  advance() {
    if (this.index >= this.steps.length - 1) return this.finish();
    this.index++;
    this.el.classList.remove("passed");
    this.render();
  }

  render() {
    const s = this.step, el = this.el;
    this.q(".tutorial-count").textContent = `Paso ${this.index + 1} de ${this.steps.length}`;
    this.q(".tutorial-bar i").style.width = `${(this.index / (this.steps.length - 1)) * 100}%`;
    this.q(".tutorial-title").textContent = s.title;
    const next = this.q(".tutorial-next");
    next.hidden = !s.next;
    next.textContent = typeof s.next === "string" ? s.next : "Siguiente ›";
    this.q(".tutorial-wait").hidden = !!s.next;
    this.q(".tutorial-skip").hidden = this.index === this.steps.length - 1;   // en el último paso solo queda "Terminar"
    el.classList.remove("enter");
    void el.offsetWidth;                               // reinicia la animación de entrada
    el.classList.add("enter");
    this.setFocus(s.focus || []);
    this.lastText = null;
    this.timer = 0;
    if (this.ctx) this.renderDynamic(this.ctx);
  }

  /** Texto y línea "en vivo" del paso (distancias, horario, mando...). */
  renderDynamic(c) {
    const s = this.step;
    let text = s.text, live = "";
    try {
      if (typeof text === "function") text = text(c);
      if (s.live) live = s.live(c) || "";
    } catch { /* el estado aún no está listo */ }
    if (s.usesDest && c.mem.missed) live = `Te pasaste de ${nice(c.mem.missed.name)}: no pasa nada, detente en ${nice(c.mem.dest.name)} · ${live}`;
    // Aviso común: el freno de emergencia queda enclavado hasta que el tren se detiene
    if (c.sim?.emergency) live = `Freno de emergencia: espera a que el tren se detenga y pulsa ${this.touch ? "▲" : "W"} para rearmarlo`;
    if (typeof text === "string" && text !== this.lastText) { this.q(".tutorial-text").textContent = text; this.lastText = text; }
    const liveEl = this.q(".tutorial-live");
    if (liveEl.textContent !== live) liveEl.textContent = live;
    liveEl.hidden = !live;
  }

  /** Resalta las partes del HUD de las que habla el paso. */
  setFocus(selectors) {
    this.focused.forEach(e => e.classList.remove("tut-focus"));
    this.focused = selectors.flatMap(sel => [...document.querySelectorAll(sel)]);
    this.focused.forEach(e => e.classList.add("tut-focus"));
  }

  finish() {
    markDone(this.mode);
    this.destroy();
    this.onFinish();
  }

  destroy() {
    this.setFocus([]);
    this.el?.remove();
    this.el = null;
  }
}
