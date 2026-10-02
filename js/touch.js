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
                arrastrar a la derecha para mirar · E interactuar · F sentarse.
   ========================================================================== */

/** ¿Hay que mostrar los controles táctiles? */
export function wantsTouch() {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  return matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

const CSS = `
.touch-ui { position: absolute; inset: 0; z-index: 12; pointer-events: none; user-select: none; -webkit-user-select: none; }
.touch-ui button { pointer-events: auto; touch-action: none; border: 1px solid #ffffff38; color: #fff; background: #0b141ecc;
  backdrop-filter: blur(8px); border-radius: 14px; font: 800 14px/1.1 system-ui, Arial, sans-serif; letter-spacing: .5px;
  display: grid; place-items: center; padding: 0; -webkit-tap-highlight-color: transparent; }
.touch-ui button:active, .touch-ui button.pressed { background: #2a4d6dcc; transform: scale(.96); }
.touch-col { position: absolute; display: grid; gap: 10px; pointer-events: none; }
.touch-row { position: absolute; display: flex; gap: 8px; pointer-events: none; flex-wrap: wrap; }
.touch-big { width: 74px; height: 74px; font-size: 30px !important; }
.touch-mid { min-width: 64px; height: 48px; padding: 0 10px !important; }
.touch-em { width: 74px; height: 56px; background: #7a1010dd !important; border-color: #ff6b6b99 !important; font-size: 12px !important; }
.touch-side button { height: 42px; min-width: 96px; font-size: 13px; }
.touch-run.on { background: #1d5a36dd; border-color: #3fd07a99; }
/* Joystick del pasajero */
.touch-stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
  border: 2px solid #ffffff40; background: #0b141e55; pointer-events: none; display: none; }
.touch-stick i { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
  background: #ffffffcc; box-shadow: 0 2px 10px #0008; }
.touch-hint { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); padding: 6px 12px; border-radius: 10px;
  background: #0b141ecc; color: #cfe0f1; font: 600 12px system-ui, Arial; white-space: nowrap; transition: opacity 1s; }
.touch-rotate { display: none; }
@media (orientation: portrait) {
  .touch-rotate { display: block; position: absolute; left: 50%; top: 104px; transform: translateX(-50%); padding: 6px 12px;
    border-radius: 10px; background: #5a3d00e0; color: #ffe7a8; font: 700 12px system-ui, Arial; white-space: nowrap; }
}
/* Con controles táctiles se ocultan las ayudas de teclado y se compacta el HUD */
body.touch-mode .controls-help, body.touch-mode .start-keys { display: none !important; }
body.touch-mode #gameContainer, body.touch-mode #gameContainer canvas { touch-action: none; }
body.touch-mode .selector-hud { transform: scale(.78); transform-origin: right center; }
/* Celular en horizontal (pantalla baja): HUD compacto para que quepan los botones */
@media (max-height: 520px) {
  body.touch-mode .hud-route { display: none; }
  body.touch-mode .selector-hud { display: none; }
  body.touch-mode .driver-hud { transform: translateX(-50%) scale(.6); transform-origin: bottom center; left: 50% !important; right: auto !important; bottom: 4px !important; }
  body.touch-mode .passenger-hud { transform: scale(.75); transform-origin: bottom right; }
  body.touch-mode .message { top: 64px; font-size: 12px; }
  .touch-big { width: 62px; height: 62px; }
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
    this.root.className = "touch-ui";
    parent.append(this.root);
    this.listeners = [];
    if (mode === "driver") this.buildDriver();
    else this.buildPassenger();
    this.root.insertAdjacentHTML("beforeend", `<div class="touch-rotate">Gira el teléfono para jugar mejor ↻</div>`);
    const hint = document.createElement("div");
    hint.className = "touch-hint";
    hint.textContent = mode === "driver" ? "Arrastra la pantalla para mirar" : "Joystick para caminar · arrastra a la derecha para mirar";
    this.root.append(hint);
    setTimeout(() => (hint.style.opacity = "0"), 5000);
  }

  /** Botón que manda una tecla al tocarlo (con repetición si se mantiene, para el mando). */
  button(label, key, cls = "touch-mid", { repeat = false } = {}) {
    const b = document.createElement("button");
    b.className = cls;
    b.innerHTML = label;
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
    // Columna izquierda: mando y emergencia (al alcance del pulgar)
    const col = document.createElement("div");
    col.className = "touch-col";
    col.style.cssText = "left: 14px; top: 50%; transform: translateY(-50%);";
    col.append(
      this.button("▲", "w", "touch-big", { repeat: true }),
      this.button("▼", "s", "touch-big", { repeat: true }),
      this.button("EMER-<br>GENCIA", " ", "touch-em"),
    );
    // Columna derecha: puertas, inversor, vista y cambio de cabina
    const row = document.createElement("div");
    row.className = "touch-col touch-side";
    row.style.cssText = "right: 12px; top: 78px; gap: 7px;";
    row.append(
      this.button("🚪 Puertas", "d"),
      this.button("Inv. ▶", "q"),
      this.button("◀ Inv.", "e"),
      this.button("👁 Vista", "v"),
      this.button("⇄ Cabina", "t"),
    );
    this.root.append(col, row);
  }

  /* ----- Pasajero a pie ----- */
  buildPassenger() {
    const w = this.walker;
    this.stick = document.createElement("div");
    this.stick.className = "touch-stick";
    this.stick.innerHTML = "<i></i>";
    this.knob = this.stick.firstChild;

    const col = document.createElement("div");
    col.className = "touch-col touch-side";
    col.style.cssText = "right: 12px; top: 78px; gap: 7px;";
    this.runBtn = this.button("🏃 Correr", "", "touch-mid touch-run");
    this.runBtn.addEventListener("pointerdown", () => {
      this.running = !this.running;
      this.runBtn.classList.toggle("on", this.running);
    });
    col.append(this.button("E · Usar", "e"), this.button("F · Sentarse", "f"), this.runBtn);
    this.root.append(this.stick, col);

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
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    this.root.remove();
  }
}
