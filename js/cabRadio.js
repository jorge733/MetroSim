/* ==========================================================================
   RedMoviSim — 2.26 · cabRadio.js
   La radio de la cabina del Metro: se compra en la Tienda RedMovi
   (pestaña Conductor) y suena al conducir un tren. Son las mismas emisoras
   de Santiago en vivo que la radio del bus y del taxi (bus/taxiRadio.js),
   con el mismo panel (estilos .taxi-radio de css/bus.css).

   El botón va en la barra superior, junto al del sonido. Teclas: O enciende
   o apaga · , y . cambian de emisora.
   ========================================================================== */

import { TaxiRadio, RADIO_STATIONS } from "./bus/taxiRadio.js";
import { key as keyText } from "./keys.js";

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ICON = {
  radio: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l10-5"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6.5 12.5h4M6.5 15.5h4"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v9M6.3 7a8 8 0 1 0 11.4 0"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M13 6l7 6-7 6zM4 6l7 6-7 6z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
};

export class CabRadio {
  /**
   * @param {object} o
   * @param {HTMLElement} o.button  botón de la barra superior (se muestra al crear la radio)
   * @param {HTMLElement} o.parent  donde va el panel (la pantalla de juego)
   * @param {boolean} o.muted       sonido del juego desactivado
   * @param {(text:string, level?:string, ms?:number)=>void} o.notify
   */
  constructor({ button, parent, muted, notify }) {
    this.button = button;
    this.radio = new TaxiRadio({
      onChange: () => this.render(),
      onError: (st) => notify?.(`${st.fm} ${st.name}: sin señal. La radio necesita internet; prueba otra emisora`, "warn", 4200),
    });
    this.radio.setMuted(muted);

    button.innerHTML = ICON.radio;
    button.title = "Radio de cabina" + keyText(" (O enciende · , y . cambian de emisora)");
    button.classList.remove("hidden");

    const p = this.panel = document.createElement("div");
    p.className = "taxi-radio cab-radio hidden";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Radio de cabina");
    p.innerHTML = `
      <header class="taxi-radio-head">
        <span class="hud-label">RADIO DE CABINA · EN VIVO</span>
        <button class="taxi-radio-x" data-k="close" aria-label="Cerrar la radio">${ICON.close}</button>
      </header>
      <div class="taxi-radio-lcd">
        <button class="taxi-radio-round" data-k="prev" aria-label="Emisora anterior">${ICON.prev}</button>
        <div class="taxi-radio-dial"><strong data-k="fm">—</strong><span data-k="name">Apagada</span><small data-k="state"></small></div>
        <button class="taxi-radio-round" data-k="next" aria-label="Emisora siguiente">${ICON.next}</button>
      </div>
      <div class="taxi-radio-row">
        <button class="taxi-radio-power" data-k="power">${ICON.power}<span data-k="powerText">Encender</span></button>
        <label class="taxi-radio-vol">${ICON.sound}<input type="range" min="0" max="100" step="5" data-k="vol" aria-label="Volumen de la radio"></label>
      </div>
      <div class="taxi-radio-list" data-k="list">
        ${RADIO_STATIONS.map((st, i) => `<button data-st="${i}"><b>${st.fm}</b><span>${esc(st.name)}</span><small>${esc(st.genre)}</small></button>`).join("")}
      </div>
      <p class="taxi-radio-note">Cada radio suena en vivo desde su propia transmisión por internet.</p>`;
    parent.append(p);
    this.el = {};
    p.querySelectorAll("[data-k]").forEach(n => { this.el[n.dataset.k] = n; });

    const r = this.radio, el = this.el;
    const tap = (node, fn) => node.addEventListener("click", (e) => { e.currentTarget.blur(); fn(e); });
    this.onButton = (e) => { e.currentTarget.blur(); this.toggle(); };
    button.addEventListener("click", this.onButton);
    tap(el.close, () => this.toggle(false));
    tap(el.power, () => r.power());
    tap(el.prev, () => r.next(-1));
    tap(el.next, () => r.next(1));
    el.list.querySelectorAll("[data-st]").forEach(b => tap(b, () => r.select(+b.dataset.st)));
    el.vol.value = Math.round(r.volume * 100);
    el.vol.addEventListener("input", () => r.setVolume(el.vol.value / 100));
    el.vol.addEventListener("change", () => el.vol.blur());
    // Tocar fuera del panel lo cierra (sin perder el toque: los mandos siguen funcionando)
    this.onOutside = (e) => {
      if (p.classList.contains("hidden")) return;
      if (!p.contains(e.target) && !button.contains(e.target)) this.toggle(false);
    };
    document.addEventListener("pointerdown", this.onOutside, true);
    this.render();
    r.resume();                      // si la dejaste encendida, sigue sonando
  }

  get open() { return !this.panel.classList.contains("hidden"); }

  toggle(open = !this.open) {
    this.panel.classList.toggle("hidden", !open);
    this.button.classList.toggle("open", open);
  }

  /** Teclas de la radio. Devuelve true si la usó. */
  handleKey(key) {
    if (key === "o") { this.radio.power(); return true; }
    if (key === "," || key === ".") { this.radio.next(key === "," ? -1 : 1); return true; }
    return false;
  }

  setMuted(m) { this.radio.setMuted(m); }

  render() {
    const r = this.radio, el = this.el;
    if (!el?.fm) return;
    const st = r.station;
    const state = { off: "", tuning: "Sintonizando…", playing: st.genre, nosignal: "Sin señal · revisa tu conexión" }[r.status];
    this.button.classList.toggle("on", r.on);
    this.button.setAttribute("aria-label", r.on ? `Radio: ${st.fm} ${st.name}` : "Radio de cabina apagada");
    el.fm.textContent = r.on ? st.fm : "— —";
    el.name.textContent = r.on ? st.name : "Apagada";
    el.state.textContent = state;
    this.panel.dataset.status = r.status;
    el.powerText.textContent = r.on ? "Apagar" : "Encender";
    el.power.classList.toggle("on", r.on);
    el.list.querySelectorAll("[data-st]").forEach(b => b.classList.toggle("on", r.on && +b.dataset.st === r.index));
  }

  /** Al terminar el turno: se apaga sin olvidar si estaba encendida. */
  destroy() {
    this.radio.destroy();
    this.button.removeEventListener("click", this.onButton);
    document.removeEventListener("pointerdown", this.onOutside, true);
    this.button.classList.add("hidden");
    this.button.classList.remove("on", "open");
    this.panel.remove();
  }
}
