/* ==========================================================================
   MetroSim — touch.js
   Controles táctiles para jugar en el celular o la tablet.

   Solo aparecen en pantallas táctiles (o con ?touch=1 en la dirección, para
   probarlos en el computador). No inventan acciones nuevas: cada botón hace
   lo mismo que su tecla, así que el Conductor sigue mandando ÓRDENES al
   motor exactamente igual que con el teclado.

     Conductor  ▲ / ▼ mando · EMERGENCIA · Puertas · Inversor adelante /
                atrás · Vista · Cambio de cabina. Arrastrar la pantalla: mirar.
     Pasajero   joystick a la izquierda para caminar (al borde: correr),
                arrastrar a la derecha para mirar · E interactuar · F sentarse ·
                Misiones (J).
   ========================================================================== */

/** ¿Hay que mostrar los controles táctiles? */
export function wantsTouch() {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  return matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

const CSS = `
.touch-ui { position: absolute; z-index: 12; pointer-events: none; user-select: none; -webkit-user-select: none;
  inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.touch-ui button { pointer-events: auto; touch-action: none; border: 1px solid #ffffff38; color: #fff; background: #0b141ecc;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 14px; font: 800 14px/1.1 system-ui, Arial, sans-serif; letter-spacing: .5px;
  display: grid; place-items: center; padding: 0; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.touch-ui button:active, .touch-ui button.pressed { background: #2a4d6dcc; transform: scale(.96); }
.touch-col { position: absolute; display: grid; gap: 10px; pointer-events: none; }
.touch-big { width: 74px; height: 74px; font-size: 30px !important; }
.touch-mid { min-width: 64px; height: 48px; padding: 0 10px !important; }
.touch-em { width: 74px; height: 56px; background: #7a1010dd !important; border-color: #ff6b6b99 !important; font-size: 12px !important; }
.touch-side button { height: 42px; min-width: 96px; font-size: 13px; }
.touch-run.on { background: #1d5a36dd; border-color: #3fd07a99; }
/* Mando e inversor actuales, junto a los botones (reemplaza al selector lateral en pantallas chicas) */
.touch-notch { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px; width: 74px; padding: 4px; border-radius: 12px;
  background: #0b141ecc; border: 1px solid #ffffff2a; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.touch-notch b { display: grid; place-items: center; height: 30px; border-radius: 8px; font: 900 16px/1 system-ui, Arial; color: #0a121b; background: var(--neutral, #e8eef5); }
.touch-notch b.power { background: var(--power, #4fd6ff); }
.touch-notch b.brake { background: var(--brake, #ffb547); }
.touch-notch b.emergency { background: var(--emergency, #ff4b4b); color: #fff; animation: blink .8s steps(2) infinite; }
.touch-notch i { display: grid; place-items: center; width: 22px; height: 30px; border-radius: 8px; font: 900 13px/1 system-ui, Arial; font-style: normal; color: #0a121b; background: #e8eef5; }
.touch-notch i[data-dir="1"] { background: var(--ok, #6fe39a); }
.touch-notch i[data-dir="-1"] { background: var(--brake, #ffb547); }
/* Joystick del pasajero */
.touch-stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
  border: 2px solid #ffffff40; background: #0b141e55; pointer-events: none; display: none; }
.touch-stick i { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
  background: #ffffffcc; box-shadow: 0 2px 10px #0008; }
.touch-stick-ghost { position: absolute; left: 70px; bottom: 70px; width: 96px; height: 96px; margin: 0 0 -48px -48px; border-radius: 50%;
  border: 2px dashed #ffffff30; pointer-events: none; transition: opacity .3s; }
.touch-stick-ghost::after { content: ""; position: absolute; inset: 30px; border-radius: 50%; background: #ffffff30; }
.touch-hint, .touch-rotate { position: absolute; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 10px;
  font: 600 12px system-ui, Arial; text-align: center; max-width: calc(100% - 24px); transition: opacity 1s; }
.touch-hint { top: 64px; background: #0b141ecc; color: #cfe0f1; }
.touch-rotate { display: none; bottom: 46%; background: #5a3d00e8; color: #ffe7a8; font-weight: 700; }
@media (orientation: portrait) { .touch-rotate { display: block; } }
/* Con controles táctiles se ocultan las ayudas de teclado */
body.touch-mode .controls-help, body.touch-mode .start-keys, body.touch-mode .end-shift-button { display: none !important; }
body.touch-mode #gameContainer, body.touch-mode #gameContainer canvas { touch-action: none; }
body.touch-mode .selector-hud { transform: scale(.78); transform-origin: right center; }
/* El HUD respeta la muesca y las esquinas redondeadas del teléfono */
body.touch-mode #hud { inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
/* Las ventanas (boletería, locales, misiones, resumen) quedan sobre los botones táctiles */
body.touch-mode .ticket-panel, body.touch-mode .summary { z-index: 14; }
body.touch-mode .fade { z-index: 15; }
.touch-left { left: 14px; bottom: 16px; }
.touch-right { right: 12px; top: 84px; gap: 7px; }

/* ---- Pantallas chicas (celular): HUD compacto, botones al alcance del pulgar ---- */
@media (max-height: 520px), (max-width: 720px) {
  body.touch-mode .selector-hud, body.touch-mode .line-strip, body.touch-mode .mode-pill, body.touch-mode .hud-route { display: none !important; }
  body.touch-mode .hud-top { top: 8px; left: 10px; right: 96px; gap: 6px; }
  body.touch-mode .hud-brand { padding: 4px; gap: 6px; }
  body.touch-mode .line-badge { width: 30px; height: 30px; font-size: 13px; }
  body.touch-mode .hud-right { gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  body.touch-mode .hud-right .hud-label { font-size: 8px; letter-spacing: 1px; }
  body.touch-mode .bank-pill, body.touch-mode .score-pill, body.touch-mode .hud-clock { padding: 4px 8px; border-radius: 10px; min-width: 0; }
  body.touch-mode .bank-pill strong, body.touch-mode #scoreTotal, body.touch-mode #clock { font-size: 14px; }
  body.touch-mode .score-best, body.touch-mode .score-streak { display: none; }
  body.touch-mode .card-pill { padding: 6px 9px; font-size: 12px; }
  body.touch-mode .sound-button { padding: 8px 10px; font-size: 15px; }
  body.touch-mode .sound-label { display: none; }
  body.touch-mode .back-button { top: calc(8px + env(safe-area-inset-top)); left: auto; right: calc(10px + env(safe-area-inset-right)); z-index: 13; padding: 8px 10px; }
  .touch-right { top: 50px; right: 10px; }
  .touch-left { left: 10px; bottom: 10px; }
  body.touch-mode .message { top: 58px; font-size: 12px; white-space: normal; width: max-content; max-width: calc(100% - 230px); text-align: center; }
  body.touch-mode .mission-tracker { top: 58px; left: 10px; width: min(250px, 42%); padding: 6px 10px; gap: 2px; }
  body.touch-mode .mission-tracker strong { font-size: 13px; }
  body.touch-mode .mission-tracker .hud-label { font-size: 8px; }
  body.touch-mode .mission-tracker ol { display: grid; font-size: 11px; }
  body.touch-mode .mission-tracker li:not(.current) { display: none; }
  .touch-hint { top: 58px; }
}
/* Celular en horizontal (pantalla baja) */
@media (max-height: 520px) {
  body.touch-mode .driver-hud { transform: translateX(-50%) scale(.62); transform-origin: bottom center; left: 50% !important; right: auto !important; bottom: 4px !important; }
  body.touch-mode .passenger-hud { left: 50%; right: auto; bottom: 6px; width: 360px; transform: translateX(-50%) scale(.72); transform-origin: bottom center; padding: 10px 14px; }
  body.touch-mode .passenger-hud strong { font-size: 18px; }
  .touch-big { width: 64px; height: 64px; }
  .touch-em { width: 64px; height: 48px; }
  .touch-notch { width: 64px; }
  .touch-side button { height: 38px; min-width: 92px; font-size: 12px; }
  .touch-col { gap: 8px; }
}
@media (max-height: 360px) {
  .touch-big { width: 56px; height: 56px; font-size: 24px !important; }
  .touch-em { width: 56px; height: 42px; }
  .touch-notch { width: 56px; }
  .touch-side button { height: 34px; min-width: 84px; }
  .touch-col { gap: 6px; }
}
/* Celular en vertical: el panel de conducción ocupa el ancho de abajo; los botones quedan sobre él */
@media (orientation: portrait) and (max-width: 720px) {
  body.touch-mode .hud-top { flex-direction: column; align-items: flex-start; right: 70px; }
  body.touch-mode .hud-right { justify-content: flex-start; max-width: calc(100vw - 150px); }
  .touch-right { top: 108px; }
  body.touch-mode .mission-tracker { top: 156px; width: calc(100% - 140px); }
  body.touch-mode .message { top: 156px; max-width: calc(100% - 140px); left: 10px; transform: none; }
  body.touch-mode .mission-tracker:not(.hidden) ~ .message { top: 250px; }
  .touch-hint { top: auto; bottom: 52%; }
  .touch-driver .touch-left { bottom: 150px; }
  .touch-stick-ghost { bottom: 240px; }
  .touch-rotate { bottom: 40%; }
}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
}

export class TouchControls {
  /**
   * @param {object} opts
   * @param {"driver"|"passenger"} opts.mode
   * @param {HTMLElement} opts.parent      contenedor de la pantalla de juego
   * @param {HTMLCanvasElement} opts.canvas  lienzo 3D (para el joystick y la mirada)
   * @param {(key:string) => void} opts.press  pulsa una tecla del juego (mismo efecto que el teclado)
   * @param {object} [opts.walker]         pasajero a pie (modo pasajero)
   */
  constructor({ mode, parent, canvas, press, walker = null }) {
    injectCss();
    document.body.classList.add("touch-mode");
    this.mode = mode;
    this.press = press;
    this.walker = walker;
    this.canvas = canvas;
    this.root = document.createElement("div");
    this.root.className = `touch-ui touch-${mode}`;
    parent.append(this.root);
    this.listeners = [];
    if (mode === "driver") this.buildDriver();
    else this.buildPassenger();
    const rotate = document.createElement("div");
    rotate.className = "touch-rotate";
    rotate.textContent = "Gira el teléfono para jugar mejor ↻";
    const hint = document.createElement("div");
    hint.className = "touch-hint";
    hint.textContent = mode === "driver" ? "Arrastra la pantalla para mirar" : "Joystick abajo a la izquierda para caminar · arrastra a la derecha para mirar";
    this.root.append(rotate, hint);
    setTimeout(() => { hint.style.opacity = "0"; rotate.style.opacity = "0"; }, 6000);
  }

  /** Botón que manda una tecla al tocarlo (con repetición si se mantiene, para el mando). */
  button(label, key, cls = "touch-mid", { repeat = false, onClick = false } = {}) {
    const b = document.createElement("button");
    b.className = cls;
    b.innerHTML = label;
    if (onClick) {
      // Abre una ventana: se espera al "click" para que el mismo toque no la cierre al soltar
      b.addEventListener("click", (ev) => { ev.preventDefault(); this.press(key); });
      return b;
    }
    let timer = null;
    const down = (ev) => {
      ev.preventDefault();
      b.classList.add("pressed");
      this.press(key);
      if (repeat) timer = setInterval(() => this.press(key), 260);
    };
    const up = () => { b.classList.remove("pressed"); clearInterval(timer); timer = null; };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("contextmenu", (ev) => ev.preventDefault());
    return b;
  }

  /* ----- Conductor ----- */
  buildDriver() {
    // Columna izquierda: mando actual, ▲ / ▼ y emergencia (abajo, al alcance del pulgar)
    const col = document.createElement("div");
    col.className = "touch-col touch-left";
    this.notch = document.createElement("div");
    this.notch.className = "touch-notch";
    this.notch.innerHTML = "<b>N</b><i>N</i>";
    col.append(
      this.notch,
      this.button("▲", "w", "touch-big", { repeat: true }),
      this.button("▼", "s", "touch-big", { repeat: true }),
      this.button("EMER-<br>GENCIA", " ", "touch-em"),
    );
    // Columna derecha: puertas, inversor, vista, cambio de cabina y tienda
    const row = document.createElement("div");
    row.className = "touch-col touch-side touch-right";
    row.append(
      this.button("🚪 Puertas", "d"),
      this.button("Inv. ▶", "q"),
      this.button("◀ Inv.", "e"),
      this.button("👁 Vista", "v"),
      this.button("⇄ Cabina", "t"),
      this.button("🛒 Tienda", "k", "touch-mid", { onClick: true }),
      this.button("🏁 Finalizar", "f", "touch-mid", { onClick: true }),
    );
    this.root.append(col, row);
    // El mando y el inversor se leen del HUD (el selector lateral se oculta en el celular)
    this.notchTimer = setInterval(() => this.syncNotch(), 120);
  }

  /** Copia el punto de mando y el inversor activos al indicador táctil. */
  syncNotch() {
    const li = document.querySelector("#notchList li.active");
    const rev = document.querySelector("#reverserPills span.active");
    const b = this.notch.firstChild, i = this.notch.lastChild;
    const label = li?.querySelector("b")?.textContent ?? "N";
    const cls = li ? ["power", "brake", "emergency"].find(c => li.classList.contains(c)) ?? "" : "";
    if (b.textContent !== label) b.textContent = label;
    if (b.className !== cls) b.className = cls;
    const dir = rev?.dataset.dir ?? "0";
    if (i.dataset.dir !== dir) { i.dataset.dir = dir; i.textContent = rev?.textContent ?? "N"; }
  }

  /* ----- Pasajero a pie ----- */
  buildPassenger() {
    const w = this.walker;
    this.stick = document.createElement("div");
    this.stick.className = "touch-stick";
    this.stick.innerHTML = "<i></i>";
    this.knob = this.stick.firstChild;

    const col = document.createElement("div");
    col.className = "touch-col touch-side touch-right";
    this.runBtn = this.button("🏃 Correr", "", "touch-mid touch-run");
    this.runBtn.addEventListener("pointerdown", () => {
      this.running = !this.running;
      this.runBtn.classList.toggle("on", this.running);
    });
    col.append(this.button("✋ Usar", "e"), this.button("🪑 Sentarse", "f"), this.button("🎯 Misiones", "j", "touch-mid", { onClick: true }), this.runBtn, this.button("🛒 Tienda", "k", "touch-mid", { onClick: true }));
    // Marca dónde va el joystick hasta que se usa por primera vez
    this.ghost = document.createElement("div");
    this.ghost.className = "touch-stick-ghost";
    this.root.append(this.ghost, this.stick, col);

    // Joystick (mitad izquierda) y mirada (mitad derecha) sobre el lienzo 3D
    const touches = new Map();          // pointerId → { kind, x0, y0, x, y }
    const on = (type, fn) => { this.canvas.addEventListener(type, fn, { passive: false }); this.listeners.push([type, fn]); };
    on("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && !new URLSearchParams(location.search).get("touch")) return;
      ev.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const left = ev.clientX - r.left < r.width * 0.42;
      const kind = left && ![...touches.values()].some(t => t.kind === "stick") ? "stick" : "look";
      touches.set(ev.pointerId, { kind, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY });
      try { this.canvas.setPointerCapture?.(ev.pointerId); } catch { /* puntero no capturable */ }
      if (kind === "stick") {
        this.ghost.style.opacity = "0";
        this.stick.style.display = "block";
        this.stick.style.left = `${ev.clientX - r.left}px`;
        this.stick.style.top = `${ev.clientY - r.top}px`;
        this.setKnob(0, 0);
      }
    });
    on("pointermove", (ev) => {
      const t = touches.get(ev.pointerId);
      if (!t) return;
      ev.preventDefault();
      if (t.kind === "look") {
        w.yaw -= (ev.clientX - t.x) * 0.006;
        w.pitch = Math.max(-1.3, Math.min(1.3, w.pitch - (ev.clientY - t.y) * 0.006));
      } else {
        this.setKnob(ev.clientX - t.x0, ev.clientY - t.y0);
      }
      t.x = ev.clientX; t.y = ev.clientY;
    });
    const end = (ev) => {
      const t = touches.get(ev.pointerId);
      if (!t) return;
      touches.delete(ev.pointerId);
      if (t.kind === "stick") { this.stick.style.display = "none"; this.setKnob(0, 0); }
    };
    on("pointerup", end);
    on("pointercancel", end);
  }

  /** Mueve la palanca y traduce su dirección a las teclas de caminar del pasajero. */
  setKnob(dx, dy) {
    const R = 50, d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const keys = this.walker.keys;
    for (const key of ["w", "a", "s", "d", "shift"]) keys.delete(key);
    if (d < 12) return;                                  // zona muerta
    const ang = Math.atan2(dy, dx);                      // 0 = derecha, −π/2 = arriba
    const sector = (a0, a1) => ang > a0 && ang < a1;
    if (sector(-2.75, -0.39)) keys.add("w");             // arriba (con diagonales)
    if (sector(0.39, 2.75)) keys.add("s");               // abajo
    if (Math.abs(ang) < 1.18) keys.add("d");             // derecha
    if (Math.abs(ang) > 1.96) keys.add("a");             // izquierda
    if (this.running || d > R * 1.15) keys.add("shift"); // al borde (o con "Correr"): correr
  }

  destroy() {
    clearInterval(this.notchTimer);
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    this.root.remove();
  }
}
