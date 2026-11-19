/* ==========================================================================
   MetroSim — 1.13 · bus/busGame.js
   MicroSim (beta): el modo «Conductor de bus». Une la simulación
   (busSim.js), el mundo 3D (busWorld.js), el sonido (busAudio.js), la
   interfaz y los mandos (teclado y táctiles).

   Es un modo aparte del metro: tiene su propia pantalla (#busScreen) y su
   propio ciclo de dibujo. Comparte con el resto del juego la cuenta
   bancaria (el sueldo del bus se gasta igual como pasajero) y el sonido
   silenciado.

   1.20 · Usa lo mismo que el Metro: el clima (engine/weather.js: lluvia,
   piso mojado, más gente), el cielo, las personas y el acceso al Metro en
   la calle (busWorld.js) y la voz de la locución para la próxima parada.

   Mandos: W/↑ acelerar · S/↓ frenar · A/← y D/→ cambiar de pista ·
   Espacio puertas · B bocina · C cámara · M sonido · Esc pausa.
   R radio · , y . cambian de emisora · Taxi: U vuelta en U.
   ========================================================================== */

import * as THREE from "three";
import { BUS_ROUTE, LANES } from "./busRoute.js";
import { autopilot } from "./busAutopilot.js";
import { clearTrackLift } from "../render/trackLift.js";
import { BusSim, BUS_CAPACITY } from "./busSim.js";
import { TaxiSim, TAXI_FARE } from "./taxiSim.js";
import { BusWorld } from "./busWorld.js";
import { BusAudio } from "./busAudio.js";
import { TaxiRadio, RADIO_STATIONS } from "./taxiRadio.js";
import { demandAt, dayTypeOf, formatCLP, lineLabel, isRail } from "../config.js";
import { WEATHER, weatherLabel, weatherDemandFactor } from "../engine/weather.js";
import { linesAtStation } from "../engine/network.js";
import { BANK_NAME } from "../economy.js";

const two = (n) => String(Math.floor(n)).padStart(2, "0");
const clockText = (t, secs = true) => {
  t = ((t % 86400) + 86400) % 86400;
  return `${two(t / 3600)}:${two((t % 3600) / 60)}${secs ? ":" + two(t % 60) : ""}`;
};
const mmss = (s) => `${Math.floor(Math.abs(s) / 60)}:${two(Math.abs(s) % 60)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  doors: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M9 12h.01M15 12h.01"/></svg>',
  horn: '<svg viewBox="0 0 24 24"><path d="M3 10v4h3l6 4V6L6 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  radio: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l10-5"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6.5 12.5h4M6.5 15.5h4"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v9M6.3 7a8 8 0 1 0 11.4 0"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M13 6l7 6-7 6zM4 6l7 6-7 6z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  // 2.10 · Luces testigo del tablero (símbolos como los de un tablero real)
  tDoors: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM12 4v16"/><path d="M9 12H6m0 0 1.5-1.5M6 12l1.5 1.5M15 12h3m0 0-1.5-1.5M18 12l-1.5 1.5"/></svg>',
  tBrake: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M12 9v3.5M12 15h.01M4.5 6.5a9 9 0 0 0 0 11M19.5 6.5a9 9 0 0 1 0 11"/></svg>',
  tLim: '<svg viewBox="0 0 24 24"><path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 13l3.5-4M8 20h8"/></svg>',
};

/**
 * Empieza una partida de MicroSim. Llamar dentro del clic del jugador (sonido).
 * @param {{bank:import("../economy.js").BankAccount, muted:boolean, touch:boolean,
 *          onMuteChange:(m:boolean)=>void, onExit:()=>void}} o
 * @returns {{requestExit:()=>void, destroy:()=>void}}
 */
/* 2.10 · Velocímetro de aguja, como el del tablero: 0 a 80 km/h en 240°, con la zona roja desde la velocidad máxima */
const GAUGE_MAX = 80;
const gaugeAngle = (kmh, max) => -120 + 240 * Math.max(0, Math.min(kmh, max)) / max;
function gaugeSvg(max, limit) {
  const pt = (a, r) => { const t = (a - 90) * Math.PI / 180; return [60 + r * Math.cos(t), 60 + r * Math.sin(t)].map(n => n.toFixed(2)); };
  const arc = (a0, a1, r) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  let ticks = "";
  for (let v = 0; v <= max; v += 5) {
    const a = gaugeAngle(v, max), major = v % 20 === 0, [x0, y0] = pt(a, major ? 43 : 46), [x1, y1] = pt(a, 51);
    ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="${major ? "maj" : ""}"/>`;
    if (major) { const [tx, ty] = pt(a, 34); ticks += `<text x="${tx}" y="${ty}">${v}</text>`; }
  }
  return `<svg class="bus-gauge-svg" viewBox="0 0 120 120" aria-hidden="true">
    <path class="track" d="${arc(-120, 120, 51)}"/>
    <path class="red" d="${arc(gaugeAngle(limit, max), 120, 51)}"/>
    <g class="ticks">${ticks}</g>
    <g data-k="needle" transform="rotate(-120 60 60)"><path class="needle" d="M58.6 62 L60 13 L61.4 62 Z"/></g>
    <circle class="hub" cx="60" cy="60" r="5"/>
  </svg>`;
}

export function startBusGame(o) {
  const game = new BusGame(o);
  return { requestExit: () => game.requestExit(), destroy: () => game.destroy(), get sim() { return game.sim; }, get debug() { return game; } };
}

class BusGame {
  constructor({ bank, muted, touch, onMuteChange, onExit, ride = null, route = null, taxi = false, audio = null, loading = null }) {
    /* 2.2 · taxi: conducir un taxi por la misma calle (taxiSim.js): carreras en vez de paraderos */
    this.taxi = !ride && taxi;
    /* 1.15 · ride: el jugador viaja como PASAJERO (maneja el piloto automático):
       { route, from, onArrive(stop), line } · onArrive se llama al bajarse en un paradero */
    this.ride = ride;
    this.route = ride ? ride.route : (route ?? BUS_ROUTE);
    this.bank = bank;
    this.touch = touch;
    this.onMuteChange = onMuteChange;
    this.onExit = onExit;
    /* 2.19.1 · audio: ya encendido en el clic (main.js), antes de la pantalla de carga · loading: esa pantalla */
    this.loading = loading;
    this.audio = audio ?? new BusAudio();
    if (!audio) {
      this.audio.muted = muted;
      this.audio.start({ rain: WEATHER.rain });
    }
    /* 2.8 · La radio: emisoras de Santiago en vivo (taxiRadio.js) · 2.8.1 · también al conducir el bus (no al viajar de pasajero) */
    if (!this.ride) {
      this.radio = new TaxiRadio({
        onChange: () => this.renderRadio(),
        onTune: () => this.audio.radioStatic(),
        onError: (st) => this.toast(`${st.fm} ${st.name}: sin señal. La radio necesita internet; prueba otra emisora`, "warn", 4200),
      });
      this.radio.setMuted(muted);
    }
    this.camMode = ride ? "seat" : "chase";
    this.paused = false;
    this.keys = new Set();
    this.touchPedal = { throttle: 0, brake: 0 };
    this.earned = 0;

    clearTrackLift();           // la Alameda es plana: sin las pendientes de la última línea de Metro jugada
    this.buildDom();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });   // 2.15.2 · stencil: la boca del Metro no la tapa el terreno
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1 : 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.el.canvas.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1400);

    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keyUp(e);
    this.onResize = () => this.resize();
    this.onBlur = () => { this.releaseControls(); this.syncInput(); };
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    addEventListener("resize", this.onResize);
    addEventListener("blur", this.onBlur);

    this.newRun();
    this.radio?.resume();
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  /** 2.19.1 · «Otra vuelta» / «Otro turno»: rearmar la calle traba unos segundos, con la pantalla de carga delante. */
  again() {
    if (!this.loading || this.rebuilding) return this.newRun();
    this.rebuilding = true;
    this.loading.show(this.taxi ? "Buscando pasajeros para otro turno" : `Volviendo a ${this.route.from}`).then(() => {
      this.rebuilding = false;
      if (!this.dead) this.newRun();
      this.loading.hide();
    });
  }

  /** Arma (o vuelve a armar) el recorrido: mundo 3D y simulación nuevos. */
  newRun() {
    if (this.world) { this.world.dispose(); }
    this.scene = new THREE.Scene();
    const now = new Date();
    const clock = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    // 1.20 · La misma curva de demanda y el mismo clima que el Metro (con lluvia viaja más gente y el piso está mojado)
    const simOpts = { route: this.route, clock, demand: demandAt(clock, dayTypeOf(now)) * weatherDemandFactor(), startStop: this.ride?.from ?? 0, wet: WEATHER.wet };
    this.sim = this.taxi ? new TaxiSim(simOpts) : new BusSim(simOpts);
    this.world = new BusWorld({ scene: this.scene, route: this.route, clock, ride: !!this.ride, vehicle: this.taxi ? "taxi" : "bus", renderer: this.renderer });
    this.scene.add(this.camera);
    this.camPos = null;
    this.earned = 0;
    this.bellLater = false;
    const R0 = this.route;               // 2.15.4 · tras una vuelta en U el título quedaba al revés en el turno nuevo
    if (this.el?.routeTitle) this.el.routeTitle.textContent = `${R0.name.toUpperCase()} · ${R0.from.toUpperCase()} → ${R0.to.toUpperCase()}`;
    this.renderStrip();
    this.el.summary.classList.add("hidden");
    this.el.pause.classList.add("hidden");
    this.paused = false;
    if (this.taxi) {
      this.toast(`Taxi por ${this.route.name} · busca a quien haga señas en la vereda, detente a su lado junto a la vereda y quítale el seguro a la puerta (${this.touch ? "Seguro" : "Espacio"}): la abre y la cierra el pasajero${WEATHER.wet > 0.3 ? ". Llueve: frena antes" : ""}`, "info", 7000);
    } else if (this.ride) {
      this.wantOff = null;
      this.toast(`Subiste al bus ${this.route.id} hacia ${this.route.to} · ${this.ride.fareText} · toca el timbre (${this.touch ? "🔔" : "Espacio"}) antes de tu parada`, "ok", 7000);
    } else this.toast(`Servicio ${this.route.id} · sale a las ${clockText(this.sim.departure, false)} desde ${this.route.from}. ${this.touch ? "Toca Puertas" : "Abre las puertas con Espacio"} para que suban los pasajeros${WEATHER.wet > 0.3 ? ". Llueve: el piso está mojado, frena antes" : ""}`, "info", 7000);
    this.updateBank();
  }

  /* ----------------------------- Interfaz ----------------------------- */
  buildDom() {
    const R = this.route;
    const el = document.createElement("section");
    el.id = "busScreen";
    el.className = "screen bus-screen" + (this.touch ? " bus-touch-mode" : "") + (this.ride ? " bus-ride-mode" : "");
    el.innerHTML = `
      <div class="bus-canvas"></div>
      <header class="bus-top">
        <div class="bus-brand">
          <span class="bus-badge${this.taxi ? " taxi" : ""}">${this.taxi ? "TAXI" : R.id}</span>
          <div class="bus-route"><span class="bus-label">${this.taxi ? "TAXI · CONDUCIENDO" : this.ride ? "BUS RED · VIAJANDO" : "BUS RED · CONDUCIENDO"}</span><strong data-k="routeTitle">${esc(R.name.toUpperCase())} · ${esc(R.from.toUpperCase())} → ${esc(R.to.toUpperCase())}</strong></div>
        </div>
        <div class="bus-right">
          <div class="bus-pill"><span class="bus-label">CUENTA</span><strong data-k="bank">$0</strong><span class="bus-float" data-k="float"></span></div>
          <div class="bus-pill"><span class="bus-label">HORA</span><strong data-k="clock">--:--</strong></div>
          <div class="bus-pill bus-weather"><span class="bus-label">CLIMA</span><strong>${esc(weatherLabel())}</strong></div>
          ${this.radio ? `<button class="bus-pill taxi-radio-btn" data-k="radioBtn" aria-label="Radio" title="Radio (R enciende · , y . cambian de emisora)">${ICON.radio}<span class="taxi-radio-btn-text"><span class="bus-label">RADIO</span><strong data-k="radioNow">Apagada</strong></span></button>` : ""}
          <button class="bus-icon-btn" data-k="sound" aria-label="Sonido">${ICON.sound}</button>
          <button class="bus-icon-btn bus-menu-btn" data-k="menu" aria-label="Pausa y menú" title="Menú (Esc)">${ICON.menu}<span>Menú</span></button>
        </div>
      </header>
      <div class="bus-strip" data-k="strip"></div>
      ${this.radio ? this.radioPanelHtml() : ""}
      <div class="bus-bell hidden" data-k="bell">PARADA SOLICITADA</div>
      <div class="bus-toast hidden" data-k="toast"></div>
      <div class="bus-guide hidden" data-k="guide"><span data-k="guideText"></span><div class="bus-guide-bar"><i data-k="guideMark"></i><u data-k="guidePred"></u><b></b></div><small data-k="guideSub"></small></div>
      <div class="bus-lead hidden" data-k="lead"><span class="bus-label">AUTO ADELANTE</span><strong data-k="leadGap">—</strong></div>
      <footer class="bus-bottom">
        <div class="bus-panel bus-speed bus-cluster">
          <div class="bus-gauge">${gaugeSvg(GAUGE_MAX, R.speedLimit * 3.6)}
            <div class="bus-speed-num"><strong data-k="speed">0</strong><span class="bus-label">KM/H</span></div>
          </div>
          <div class="bus-cluster-side">
            <div class="bus-limit" data-k="limit" title="Limitador (L)">${Math.round(R.speedLimit * 3.6)}<small>LIM</small></div>
            <div class="bus-tells">
              <i data-k="tDoors" title="${this.taxi ? "Puerta abierta" : "Puertas abiertas"}">${ICON.tDoors}</i>
              <i data-k="tBrake" class="brk" title="Frenando">${ICON.tBrake}</i>
              <i data-k="tLim" class="lim" title="Limitador">${ICON.tLim}</i>
            </div>
          </div>
          <div class="bus-pedals"><span class="bus-label">ACEL</span><i><b data-k="thr"></b></i><span class="bus-label">FRENO</span><i class="brk"><b data-k="brk"></b></i></div>
        </div>
        <div class="bus-panel bus-next${this.taxi ? " taxi" : ""}">
          <div class="bus-next-head">
            <span class="bus-label" data-k="nextLabel">${this.taxi ? "CARRERA" : "PRÓXIMO PARADERO"}</span>
            ${this.taxi ? `<span class="taxi-meter" title="Taxímetro"><small>TAXÍMETRO</small><b data-k="meter">—</b></span>` : `<span class="bus-next-badge" style="--c:${R.color}">${esc(R.id)}</span>`}
          </div>
          <strong data-k="stopName">—</strong>
          <div class="bus-next-row">
            <span data-k="stopDist">—</span>
            <span data-k="stopWait">—</span>
            <span data-k="delay" class="bus-delay">—</span>
          </div>
          <div class="bus-next-row bus-next-sub">
            ${this.taxi ? "" : `<span>A bordo <b data-k="onboard">0</b>/${BUS_CAPACITY}</span>`}
            <span data-k="doors">Puertas cerradas</span>
            <span data-k="light"></span>
          </div>
          <p class="bus-hint" data-k="hint"></p>
        </div>
      </footer>
      <div class="bus-keys">
        <span><kbd>W</kbd><kbd>S</kbd> acelerar / frenar</span>
        <span><kbd>Shift</kbd> freno suave</span>
        <span><kbd>L</kbd> limitador</span>
        <span><kbd>A</kbd><kbd>D</kbd> cambiar de pista</span>
        <span><kbd>Espacio</kbd> ${this.taxi ? "seguro de la puerta (para que suba o baje tu pasajero)" : "puertas"}</span>
        ${this.taxi ? `<span><kbd>U</kbd> vuelta en U (en un cruce)</span>` : ""}
        <span><kbd>R</kbd> radio · <kbd>,</kbd><kbd>.</kbd> emisora</span>
        <span><kbd>B</kbd> bocina</span>
        <span><kbd>C</kbd> cámara</span>
        <span><kbd>Esc</kbd> pausa</span>
      </div>
      <div class="bus-ride-bar">
        <button data-r="bell" class="bus-ride-btn bell">🔔<span>Timbre</span><small>${this.touch ? "" : "Espacio"}</small></button>
        <button data-r="off" class="bus-ride-btn off" disabled>🚶<span>Bajarse aquí</span><small>${this.touch ? "" : "E"}</small></button>
        <button data-r="cam" class="bus-ride-btn cam">${ICON.cam}<span>Cámara</span><small>${this.touch ? "" : "C"}</small></button>
      </div>
      <div class="bus-touch">
        <div class="bus-touch-left">
          <button data-t="left" aria-label="Pista a la izquierda">${ICON.left}</button>
          <button data-t="right" aria-label="Pista a la derecha">${ICON.right}</button>
        </div>
        <div class="bus-touch-mid">
          <button data-t="doors" aria-label="${this.taxi ? "Seguro de la puerta" : "Puertas"}">${ICON.doors}<span>${this.taxi ? "Seguro" : "Puertas"}</span></button>
          <button data-t="horn" aria-label="Bocina">${ICON.horn}<span>Bocina</span></button>
          <button data-t="cam" aria-label="Cámara">${ICON.cam}<span>Cámara</span></button>
          <button data-t="limiter" aria-label="Limitador"><b class="bus-lim-ico">50</b><span>Limitador</span></button>
          ${this.taxi ? `<button data-t="uturn" aria-label="Vuelta en U"><svg viewBox="0 0 24 24"><path d="M8 20V9a5 5 0 0 1 10 0v6M14 12l4 4 4-4"/></svg><span>Vuelta</span></button>` : ""}
        </div>
        <div class="bus-touch-right">
          <button data-t="brake" class="bus-pedal brake"><i data-k="brkFill"></i><span>FRENO</span></button>
          <button data-t="throttle" class="bus-pedal gas"><i data-k="thrFill"></i><span>ACELERAR</span></button>
        </div>
      </div>
      <div class="bus-overlay bus-pause hidden" data-k="pause">
        <div class="bus-card bus-menu-card ticket-card game-menu-card" role="dialog" aria-modal="true" aria-label="Menú">
          <header class="ticket-head">
            <div class="ticket-head-text">
              <span class="small-label">${this.taxi ? "TAXI · PAUSA" : this.ride ? "VIAJANDO EN BUS · PAUSA" : "CONDUCIENDO · PAUSA"}</span>
              <strong>Menú</strong>
            </div>
          </header>
          <p class="bus-menu-route"><b${this.taxi ? ' class="taxi"' : ""}>${this.taxi ? "TAXI" : R.id}</b> ${esc(R.name)} · ${esc(R.from)} → ${esc(R.to)}</p>
          <div class="game-menu-list">
            <button class="go-button game-menu-resume" data-k="resume"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg> ${this.ride ? "Seguir el viaje" : "Seguir manejando"}</button>
            ${this.taxi ? `<button class="game-menu-item" data-k="pmEnd"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg><span>Terminar el turno y ver el resumen</span></button>` : ""}
            ${this.ride ? "" : `<button class="game-menu-item" data-k="pmKeys"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg><span>Controles · <b data-k="pmKeysState">ocultos</b></span></button>`}
            <button class="game-menu-item" data-k="pmSound"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg><span>Sonido · <b data-k="pmSoundState">activado</b></span><kbd>M</kbd></button>
          </div>
          <footer class="game-menu-exit">
            <button class="ghost-button" data-k="quit"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6"/></svg> Volver a la portada</button>
            <p class="game-menu-note">${this.taxi ? "Lo que cobraste en cada carrera ya está en tu cuenta." : this.ride ? "Para bajarte, toca el timbre antes de tu parada y, con las puertas abiertas, elige «Bajarse aquí»." : "El sueldo de cada paradero ya está en tu cuenta. Si terminas ahora no recibes el bono del servicio."}</p>
          </footer>
        </div>
      </div>
      <div class="bus-overlay bus-summary hidden" data-k="summary"><div class="bus-card" data-k="summaryCard"></div></div>
    `;
    document.body.append(el);
    this.root = el;
    this.el = { canvas: el.querySelector(".bus-canvas") };
    el.querySelectorAll("[data-k]").forEach(n => { this.el[n.dataset.k] = n; });
    this.el.sound.innerHTML = this.audio.muted ? ICON.mute : ICON.sound;
    this.el.sound.addEventListener("click", (e) => { e.currentTarget.blur(); this.toggleMute(); });
    this.el.menu.addEventListener("click", (e) => { e.currentTarget.blur(); this.setPaused(true); });
    this.el.resume.addEventListener("click", () => this.setPaused(false));
    this.el.quit.addEventListener("click", () => this.exit());
    // 2.0 · Menú: sonido y lista de teclas (que se oculta sola a los 12 s)
    const syncMenu = () => {
      this.el.pmSoundState.textContent = this.audio.muted ? "desactivado" : "activado";
      if (this.el.pmKeysState) this.el.pmKeysState.textContent = this.root.classList.contains("bus-keys-on") ? "a la vista" : "ocultos";
    };
    this.syncMenu = syncMenu;
    this.el.pmSound.addEventListener("click", () => this.toggleMute());
    this.el.pmKeys?.addEventListener("click", () => { this.root.classList.toggle("bus-keys-on"); syncMenu(); });
    this.el.pmEnd?.addEventListener("click", () => { this.setPaused(false); this.sim.finish(); });
    this.root.classList.add("bus-keys-on");
    this.keysTimer = setTimeout(() => { this.root.classList.remove("bus-keys-on"); syncMenu(); }, 12000);
    syncMenu();
    if (this.radio) this.bindRadio();
    this.bindTouch();
    this.root.querySelectorAll("[data-r]").forEach(btn => btn.addEventListener("click", (e) => {
      e.currentTarget.blur();
      if (btn.dataset.r === "bell") this.ringBell();
      else if (btn.dataset.r === "off") this.getOff();
      else this.toggleCam();
    }));
  }

  /* ----------------------------- 1.15 · Viaje como pasajero ----------------------------- */
  /** Paradero donde el bus está detenido con las puertas abiertas (se puede bajar), o null. */
  exitStop() {
    const sim = this.sim, b = sim.bus;
    if (b.doors !== "open") return null;
    const here = sim.stopHere();
    return here ? { index: here.index, stop: this.route.stops[here.index] } : null;
  }
  ringBell() {
    if (!this.ride || this.paused) return;
    const st = this.sim.nextStop;
    if (this.exitStop()) return this.toast("Las puertas están abiertas: bájate ahora («Bajarse aquí») o espera la próxima parada", "info");
    // 2.15.4 · Con las puertas cerrándose el bus todavía está en este paradero: el timbre queda para el próximo
    if (this.sim.serving && this.sim.bus.doors !== "closed") {
      const nx = this.route.stops[this.sim.stopIndex + 1];
      if (!nx) return this.toast("Es el fin del recorrido", "info", 2200);
      this.bellLater = true;
      return this.toast(`Parada solicitada: ${nx.name}`, "ok", 2600);
    }
    if (this.sim.requestStop()) { this.wantOff = this.sim.stopIndex; this.toast(`Parada solicitada: ${st.name}`, "ok", 2600); }
    else this.toast(st ? `Ya está solicitada la parada ${st.name}` : "Es el fin del recorrido", "info", 2200);
  }
  getOff() {
    if (!this.ride || this.paused) return;
    const here = this.exitStop();
    if (!here) return this.toast(this.sim.bus.v > 0.3 ? "Espera que el bus se detenga y abra las puertas" : "Las puertas están cerradas: toca el timbre para bajarte en la próxima parada", "info");
    // 2.15.4 · En el terminal sin Metro también se baja (antes el pasajero quedaba atrapado): sale en la calle de la
    // estación de Metro más cercana del recorrido
    if (!here.stop.metro && here.index === this.route.stops.length - 1) {
      const near = this.route.stops.filter(s => s.metro).sort((a, b) => Math.abs(a.s - here.stop.s) - Math.abs(b.s - here.stop.s))[0];
      if (near) {
        const onArrive = this.ride.onArrive;
        this.destroy();
        return onArrive?.(near, this.route);
      }
    }
    if (!here.stop.metro) return this.toast(`En ${here.stop.name} no hay estación de Metro: bájate en un paradero con Metro (el juego te deja en su calle)`, "info", 4200);
    const onArrive = this.ride.onArrive;
    this.destroy();
    onArrive?.(here.stop, this.route);
  }

  bindTouch() {
    const hold = { horn: "b" };
    /* 1.18 · Pedales táctiles ANALÓGICOS: cuanto más arriba apoyas el dedo, más fuerte (abajo = suave).
       Se puede deslizar el dedo sin soltar para dosificar. */
    const level = (btn, e) => {
      const r = btn.getBoundingClientRect();
      return Math.max(0.15, Math.min(1, 1 - (e.clientY - r.top) / r.height + 0.15));
    };
    this.root.querySelectorAll("[data-t]").forEach(btn => {
      const t = btn.dataset.t;
      const pedal = t === "throttle" || t === "brake";
      const down = (e) => {
        e.preventDefault();
        btn.classList.add("on");
        try { btn.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
        if (pedal) { this.touchPedal[t] = level(btn, e); this.syncInput(); return; }
        if (hold[t]) { this.keys.add(hold[t]); this.syncInput(); return; }
        if (t === "left") this.sim.changeLane(1);
        else if (t === "right") this.sim.changeLane(-1);
        else if (t === "doors") this.sim.toggleDoors();
        else if (t === "cam") this.toggleCam();
        else if (t === "limiter") this.sim.toggleLimiter();
        else if (t === "uturn") this.sim.uTurn?.();
      };
      const move = (e) => {
        if (!pedal || !btn.classList.contains("on")) return;
        this.touchPedal[t] = level(btn, e);
        this.syncInput();
      };
      const up = () => {
        btn.classList.remove("on");
        if (pedal) { this.touchPedal[t] = 0; this.syncInput(); }
        if (hold[t]) { this.keys.delete(hold[t]); this.syncInput(); }
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointermove", move);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("lostpointercapture", up);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  renderStrip() {
    const R = this.route, span = R.stops.at(-1).s - R.stops[0].s;
    if (this.taxi) {
      // Taxi: la calle completa con el punto de la carrera (recoger o destino) y el taxi
      const pct = (s) => ((s - R.stops[0].s) / span) * 100;
      this.el.strip.innerHTML = `<div class="bus-strip-track"></div><span class="taxi-strip-pin" data-k="stripPin" hidden></span><span class="bus-strip-bus taxi" data-k="stripBus"></span>`;
      this.el.stripBus = this.el.strip.querySelector("[data-k=stripBus]");
      this.el.stripPin = this.el.strip.querySelector("[data-k=stripPin]");
      this.stripPct = pct;
      return;
    }
    const pct = (s) => ((s - R.stops[0].s) / span) * 100;
    this.el.strip.innerHTML = `<div class="bus-strip-track"></div>` +
      R.stops.map((st, i) => `<span class="bus-strip-stop" data-i="${i}" style="left:${pct(st.s)}%"><i></i><em>${esc(st.name)}</em></span>`).join("") +
      `<span class="bus-strip-bus" data-k="stripBus"></span>`;
    this.el.stripBus = this.el.strip.querySelector("[data-k=stripBus]");
    this.stripPct = pct;
  }

  /* ----------------------------- 2.8 · Radio (taxi y, desde 2.8.1, bus) ----------------------------- */
  radioPanelHtml() {
    return `
      <div class="taxi-radio hidden" data-k="radioPanel" role="dialog" aria-label="Radio">
        <header class="taxi-radio-head">
          <span class="bus-label">RADIO · EN VIVO</span>
          <button class="taxi-radio-x" data-k="radioClose" aria-label="Cerrar la radio">${ICON.close}</button>
        </header>
        <div class="taxi-radio-lcd">
          <button class="taxi-radio-round" data-k="radioPrev" aria-label="Emisora anterior">${ICON.prev}</button>
          <div class="taxi-radio-dial"><strong data-k="radioFm">—</strong><span data-k="radioName">Apagada</span><small data-k="radioState"></small></div>
          <button class="taxi-radio-round" data-k="radioNext" aria-label="Emisora siguiente">${ICON.next}</button>
        </div>
        <div class="taxi-radio-row">
          <button class="taxi-radio-power" data-k="radioPower">${ICON.power}<span data-k="radioPowerText">Encender</span></button>
          <label class="taxi-radio-vol">${ICON.sound}<input type="range" min="0" max="100" step="5" data-k="radioVol" aria-label="Volumen de la radio"></label>
        </div>
        <div class="taxi-radio-list" data-k="radioList">
          ${RADIO_STATIONS.map((st, i) => `<button data-st="${i}"><b>${st.fm}</b><span>${esc(st.name)}</span><small>${esc(st.genre)}</small></button>`).join("")}
        </div>
        <p class="taxi-radio-note">Cada radio suena en vivo desde su propia transmisión por internet.</p>
      </div>`;
  }

  bindRadio() {
    const el = this.el, r = this.radio;
    const tap = (node, fn) => node.addEventListener("click", (e) => { e.currentTarget.blur(); fn(e); });
    tap(el.radioBtn, () => this.toggleRadioPanel());
    tap(el.radioClose, () => this.toggleRadioPanel(false));
    tap(el.radioPower, () => r.power());
    tap(el.radioPrev, () => r.next(-1));
    tap(el.radioNext, () => r.next(1));
    el.radioList.querySelectorAll("[data-st]").forEach(b => tap(b, () => r.select(+b.dataset.st)));
    el.radioVol.value = Math.round(r.volume * 100);
    el.radioVol.addEventListener("input", () => r.setVolume(el.radioVol.value / 100));
    el.radioVol.addEventListener("change", () => el.radioVol.blur());
    // Tocar fuera del panel lo cierra (sin perder el toque: los pedales siguen funcionando)
    this.root.addEventListener("pointerdown", (e) => {
      if (el.radioPanel.classList.contains("hidden")) return;
      if (!el.radioPanel.contains(e.target) && !el.radioBtn.contains(e.target)) this.toggleRadioPanel(false);
    }, true);
    this.renderRadio();
  }

  toggleRadioPanel(open = this.el.radioPanel.classList.contains("hidden")) {
    this.el.radioPanel.classList.toggle("hidden", !open);
    this.el.radioBtn.classList.toggle("open", open);
  }

  renderRadio() {
    const r = this.radio, el = this.el;
    if (!r || !el?.radioBtn) return;
    const st = r.station;
    const state = { off: "", tuning: "Sintonizando…", playing: st.genre, nosignal: "Sin señal · revisa tu conexión" }[r.status];
    el.radioBtn.classList.toggle("on", r.on);
    el.radioNow.textContent = !r.on ? "Apagada" : r.status === "nosignal" ? `${st.fm} · sin señal` : r.status === "tuning" ? `${st.fm} · …` : `${st.fm} ${st.name}`;
    el.radioFm.textContent = r.on ? st.fm : "— —";
    el.radioName.textContent = r.on ? st.name : "Apagada";
    el.radioState.textContent = state;
    el.radioPanel.dataset.status = r.status;
    el.radioPowerText.textContent = r.on ? "Apagar" : "Encender";
    el.radioPower.classList.toggle("on", r.on);
    el.radioList.querySelectorAll("[data-st]").forEach(b => b.classList.toggle("on", r.on && +b.dataset.st === r.index));
  }

  toast(text, level = "info", ms = 3200) {
    const t = this.el.toast;
    t.textContent = text;
    t.className = `bus-toast ${level}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }

  moneyFloat(amount) {
    const f = this.el.float;
    f.textContent = `+${formatCLP(amount)}`;
    f.classList.remove("show");
    void f.offsetWidth;
    f.classList.add("show");
  }

  updateBank() { this.el.bank.textContent = formatCLP(this.bank.balance); }

  toggleMute() {
    const m = !this.audio.muted;
    this.audio.setMuted(m);
    this.radio?.setMuted(m);
    this.el.sound.innerHTML = m ? ICON.mute : ICON.sound;
    this.onMuteChange?.(m);
    this.syncMenu?.();
    this.toast(m ? "Sonido desactivado" : "Sonido activado", "info", 1200);
  }

  toggleCam() {
    const modes = this.ride ? ["seat", "chase"] : ["chase", "cab"];
    this.camMode = modes[(modes.indexOf(this.camMode) + 1) % modes.length];
    this.camPos = null;
    this.toast({ cab: "Vista desde el asiento del conductor", chase: "Vista desde atrás del bus", seat: "Vista desde tu asiento" }[this.camMode], "info", 1400);
  }

  setPaused(p) {
    if (this.sim.finished) return;
    this.paused = p;
    this.el.pause.classList.toggle("hidden", !p);
    this.syncMenu?.();
    if (p) this.el.resume.focus();
    this.releaseControls();
    this.syncInput();
    this.audio.horn(false);
  }

  /* ----------------------------- Teclado ----------------------------- */
  keyDown(e) {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (k === "escape") {
      if (this.sim.finished) return;
      return this.setPaused(!this.paused);
    }
    if (k === "m") return this.toggleMute();
    if (this.paused || this.sim.finished) return;
    if (this.ride) {
      if (k === " " || k === "t") return this.ringBell();
      if (k === "e" || k === "enter") return this.getOff();
      if (k === "c") return this.toggleCam();
      return;
    }
    if (k === "a" || k === "arrowleft") return this.sim.changeLane(1);
    if (k === "d" || k === "arrowright") return this.sim.changeLane(-1);
    if (k === " " || k === "e") return this.sim.toggleDoors();
    if (k === "u" && this.taxi) return this.sim.uTurn();
    if (this.radio && k === "r") return this.radio.power();
    if (this.radio && (k === "," || k === ".")) return this.radio.next(k === "," ? -1 : 1);
    if (k === "c") return this.toggleCam();
    if (k === "l") return this.sim.toggleLimiter();
    this.keys.add(k);
    this.syncInput();
  }
  keyUp(e) {
    this.keys.delete(e.key.toLowerCase());
    this.syncInput();
  }
  /** Suelta todo (teclas y pedales táctiles): al pausar, al perder el foco y al terminar. */
  releaseControls() {
    this.keys.clear();
    this.touchPedal.throttle = this.touchPedal.brake = 0;
    this.root?.querySelectorAll(".bus-touch .on").forEach(b => b.classList.remove("on"));
  }
  syncInput() {
    const k = this.keys, tp = this.touchPedal;
    // Teclado: W/S a fondo; Shift (solo o con S) freno suave para clavar la parada. Táctil: el nivel del dedo.
    this.sim.input.throttle = k.has("w") || k.has("arrowup") ? 1 : tp.throttle;
    this.sim.input.brake = k.has("s") || k.has("arrowdown") ? (k.has("shift") ? 0.35 : 1) : k.has("shift") ? 0.35 : tp.brake;
    this.audio.horn(k.has("b") || k.has("h"));
  }

  /* ----------------------------- Ciclo ----------------------------- */
  loop(now) {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));   // nunca negativo (la marca del fotograma puede ser anterior)
    this.last = now;
    if (!this.paused) {
      if (this.ride) autopilot(this.sim, dt, { hold: this.wantOff != null && this.wantOff === (this.sim.serving?.index ?? this.sim.stopHere()?.index) });
      this.sim.step(dt);
      if (this.bellLater && !this.sim.serving && this.sim.bus.doors === "closed") {
        this.bellLater = false;
        if (this.sim.requestStop()) this.wantOff = this.sim.stopIndex;
      }
    }
    this.handleEvents();
    this.world.update(this.sim, this.paused ? 0 : dt, now / 1000, this.camera.position);
    this.updateCamera(dt);
    this.audio.update(this.sim.bus.v, this.sim.bus.throttle, !this.paused);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt) {
    const g = this.world.bus, cam = this.camera;
    this.world.people.showDriver(this.camMode !== "cab");
    if (this.camMode === "seat") {
      g.updateMatrixWorld();
      cam.position.copy(new THREE.Vector3(0.7, 2.25, 4.45).applyMatrix4(g.matrixWorld));
      cam.lookAt(new THREE.Vector3(0.1, 1.75, -30).applyMatrix4(g.matrixWorld));
      cam.fov = 70;
    } else if (this.camMode === "cab") {
      g.updateMatrixWorld();
      const p = (this.taxi ? new THREE.Vector3(-0.4, 1.2, 2.05) : new THREE.Vector3(-0.72, 2.2, 1.55)).applyMatrix4(g.matrixWorld);
      const look = (this.taxi ? new THREE.Vector3(-0.3, 0.9, -30) : new THREE.Vector3(-0.4, 1.4, -30)).applyMatrix4(g.matrixWorld);
      cam.position.copy(p);
      cam.lookAt(look);
      cam.fov = 68;
    } else {
      g.updateMatrixWorld();
      const want = (this.taxi ? new THREE.Vector3(0, 3.1, 10.5) : new THREE.Vector3(0, 5.6, 25)).applyMatrix4(g.matrixWorld);
      if (!this.camPos || this.camPos.distanceTo(want) > 60) this.camPos = want.clone();
      this.camPos.lerp(want, Math.min(1, dt * 4));
      cam.position.copy(this.camPos);
      cam.lookAt((this.taxi ? new THREE.Vector3(0, 1.0, -8) : new THREE.Vector3(0, 1.8, -10)).applyMatrix4(g.matrixWorld));
      cam.fov = 60;
    }
    cam.updateProjectionMatrix();
  }

  handleEvents() {
    for (const e of this.sim.drain()) {
      this.world.people.onEvent(e, this.sim);                  // 1.19 · los pasajeros 3D suben, bajan y corren
      if (e.type === "stopDone" && this.ride) this.announceNext(e.index);   // 1.20 · locución: próxima parada (2.19.2: solo de pasajero, no al conducir)
      if (e.type === "abs") this.audio.abs();
      if (this.ride) { this.rideEvent(e); continue; }
      if (this.taxi && this.taxiEvent(e)) continue;
      switch (e.type) {
        case "msg": this.toast(e.text, e.level); break;
        case "penalty": this.toast(`${e.text} · −${e.points} pts`, "warn", 3600); this.audio.fault(); break;
        case "door": this.audio.door(e.open); break;
        case "board": this.audio.validate(!e.evaded); break;
        case "boardFail": this.audio.validate(false); this.toast("El validador rechazó la tarjeta: sin saldo. El pasajero se baja", "info", 2600); break;
        case "bell": this.audio.bell(); break;
        case "blinker": this.audio.blinker(); break;
        case "crash": this.audio.crash(); break;
        case "headway": this.audio.fault(); break;
        case "limiter": break;
        case "redLight": break;
        case "stopDone": this.onStopDone(e); break;
        case "finished": this.onFinished(e); break;
      }
    }
  }

  /** 1.20 · Locución a bordo al salir de un paradero: la próxima parada y con qué se combina (como en el Metro). */
  announceNext(doneIndex) {
    const st = this.route.stops[doneIndex + 1];
    if (!st) return;
    let text = `Próxima parada: ${st.name}.`;
    const lines = st.metro ? linesAtStation(st.metro) : [];
    const metro = lines.filter(id => !isRail(id)).map(lineLabel), rail = lines.filter(isRail).map(lineLabel);
    const join = (a) => a.length > 1 ? `${a.slice(0, -1).join(", ")} y ${a.at(-1)}` : a[0];
    const combos = [metro.length ? `Metro ${join(metro)}` : null, ...rail].filter(Boolean);
    if (combos.length) text += ` Combinación con ${join(combos)}.`;
    if (doneIndex + 1 === this.route.stops.length - 1) text += " Fin del recorrido.";
    this.audio.announce(text);
  }

  /** Eventos durante el viaje como pasajero: sonidos y avisos (sin sueldo ni faltas). */
  rideEvent(e) {
    if (e.type === "door") {
      this.audio.door(e.open);
      if (e.open) setTimeout(() => {
        const at = this.exitStop();
        if (at && !this.dead && at.stop.metro) this.toast(at.index === this.wantOff ? `${at.stop.name}: es tu parada · «Bajarse aquí»` : `${at.stop.name} · puedes bajarte aquí`, at.index === this.wantOff ? "ok" : "info", 3500);
      }, 1200);
      return;
    }
    if (e.type === "board") this.audio.validate(!e.evaded);
    else if (e.type === "boardFail") this.audio.validate(false);
    else if (e.type === "bell") this.audio.bell();
    else if (e.type === "stopDone" && this.wantOff === e.index) {
      this.wantOff = null;
      this.toast(`Seguiste de largo en ${e.name}: toca el timbre otra vez para bajarte en la próxima`, "warn", 4000);
    }
  }

  onStopDone(r) {
    if (r.pay > 0) {
      this.bank.deposit(r.pay, `Bus ${this.route.id} · paradero ${r.name}`, { wage: true });
      this.earned += r.pay;
      this.updateBank();
      this.moneyFloat(r.pay);
      this.audio.coin();
    }
    if (r.served) {
      const parts = [];
      parts.push(r.precision === 100 ? "parada exacta" : `parada a ${Math.abs(r.error).toFixed(1)} m`);
      if (r.delay != null) parts.push(Math.abs(r.delay) <= 60 ? "a la hora" : r.delay > 0 ? `${mmss(r.delay)} atrasado` : `${mmss(r.delay)} adelantado`);
      parts.push(`${r.moved} pasajeros`);
      this.toast(`${r.perfect ? "¡Perfecto! " : ""}${r.name}: ${parts.join(" · ")}${r.pay ? ` · +${formatCLP(r.pay)}` : ""}`, r.perfect ? "ok" : "info", 4200);
    }
    this.el.strip.querySelector(`[data-i="${r.index}"]`)?.classList.add(r.served ? "done" : "skipped");
  }

  onFinished(e) {
    if (e.bonus) {
      this.bank.deposit(e.bonus, `Bus · bono del recorrido ${this.route.id} (nota ${e.grade})`, { wage: true });
      this.earned += e.bonus;
      this.updateBank();
      this.moneyFloat(e.bonus);
    }
    const t = e.totals, n = this.route.stops.length;
    const rows = [
      ["Paraderos atendidos", `${t.served} de ${n}`],
      ["Pasajeros que subieron", t.boarded],
      ["A la hora", `${t.onTime} paraderos`],
      ["Luces rojas", t.reds],
      ["Choques", t.crashes],
      ["Paraderos saltados", t.skipped],
      ["Faltas", `−${t.penalties} pts`],
      ["Bono del servicio", formatCLP(e.bonus)],
      ["Ganado en este recorrido", formatCLP(this.earned)],
    ];
    this.el.summaryCard.innerHTML = `
      <span class="bus-label">BUSES · FIN DEL RECORRIDO ${this.route.id}</span>
      <div class="bus-grade grade-${e.grade}">${e.grade}</div>
      <h2>${esc(this.route.from)} → ${esc(this.route.to)}</h2>
      <dl class="bus-stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <p>Lo ganado ya está en tu cuenta del ${esc(BANK_NAME)}: úsalo como pasajero en el Metro o en la Tienda.</p>
      <div class="bus-card-actions">
        <button class="bus-btn primary" data-a="again">Otra vuelta</button>
        <button class="bus-btn" data-a="quit">Volver a la portada</button>
      </div>`;
    this.el.summaryCard.querySelector("[data-a=again]").addEventListener("click", () => this.again());
    this.el.summaryCard.querySelector("[data-a=quit]").addEventListener("click", () => this.exit());
    setTimeout(() => this.el.summary.classList.remove("hidden"), 900);
    this.releaseControls();
    this.syncInput();
  }

  updateHud() {
    const sim = this.sim, b = sim.bus, el = this.el;
    el.clock.textContent = clockText(sim.time);
    el.speed.textContent = Math.round(b.v * 3.6);
    el.speed.parentElement.classList.toggle("over", b.v > this.route.speedLimit * 1.05);
    el.thr.style.width = `${b.throttle * 100}%`;
    el.brk.style.width = `${b.brake * 100}%`;
    if (el.thrFill) { el.thrFill.style.height = `${b.throttle * 100}%`; el.brkFill.style.height = `${b.brake * 100}%`; }
    el.limit.classList.toggle("on", sim.limiter);
    // 2.10 · Aguja del velocímetro y luces testigo del tablero
    el.needle.setAttribute("transform", `rotate(${gaugeAngle(b.v * 3.6, GAUGE_MAX)} 60 60)`);
    el.tDoors.classList.toggle("lit", b.doors !== "closed");
    el.tBrake.classList.toggle("lit", b.brake > 0.05);
    el.tLim.classList.toggle("lit", !!sim.limiter);
    this.root.querySelector('[data-t="limiter"]')?.classList.toggle("lit", sim.limiter);
    // Distancia al auto de adelante (solo si está cerca)
    const lead = !this.ride && sim.lead && sim.lead.gap < 45 && b.v > 1 ? sim.lead : null;
    el.lead.classList.toggle("hidden", !lead);
    if (lead) {
      el.leadGap.textContent = `${Math.max(0, Math.round(lead.gap))} m`;
      el.lead.classList.toggle("warn", lead.ttc < 4 || lead.gap < b.v * 1.2);
      el.lead.classList.toggle("bad", lead.ttc < 2.6 || lead.gap < b.v * 0.8);
    }
    if (this.taxi) return this.updateTaxiHud();
    el.onboard.textContent = sim.onboard.length;
    el.doors.textContent = { closed: "Puertas cerradas", opening: "Abriendo puertas…", open: "Puertas abiertas", closing: "Cerrando puertas…" }[b.doors];
    el.doors.classList.toggle("open", b.doors !== "closed");
    el.bell.classList.toggle("hidden", !sim.bell);
    el.stripBus.style.left = `${Math.max(0, Math.min(100, this.stripPct(b.s)))}%`;

    const st = sim.nextStop;
    if (st) {
      const d = st.s - b.s;
      el.stopName.textContent = st.name;
      el.stopDist.textContent = d > 1000 ? `${(d / 1000).toFixed(1)} km` : d > 0 ? `${Math.round(d)} m` : "aquí";
      const w = sim.waiting[sim.stopIndex];
      el.stopWait.textContent = sim.stopIndex === this.route.stops.length - 1 ? "Terminal" : w ? `${w} esperando` : "Nadie esperando";
      const dl = sim.predictedDelay();
      el.delay.textContent = Math.abs(dl) <= 60 ? "A la hora" : dl > 0 ? `Atrasado ${mmss(dl)}` : `Adelantado ${mmss(dl)}`;
      el.delay.className = `bus-delay ${Math.abs(dl) <= 60 ? "ok" : Math.abs(dl) <= 180 ? "warn" : "bad"}`;
    }
    const L = sim.nextLight(140);
    if (L) {
      el.light.innerHTML = `<i class="bus-dot ${L.state}"></i>${esc(L.light.street)} · ${Math.max(0, Math.round(L.d))} m`;
    } else el.light.textContent = "";

    // Guía de parada: aparece al acercarse al paradero (o a un semáforo en rojo/amarillo)
    const pred = sim.stopPrediction();
    const pct = (e) => `${50 + Math.max(-50, Math.min(50, e / 9 * 50))}%`;
    const near = !this.ride && st && st.s - b.s < 70 && st.s - b.s > -14 && !sim.serving;
    const red = !this.ride && !near && L && L.state !== "green" && L.d > 0.5 && L.d < 60 && b.v > 0.5;
    el.guide.classList.toggle("hidden", !near && !red);
    el.guide.classList.toggle("light", !!red);
    if (near) {
      const err = b.s - st.s;
      const curb = Math.abs(b.x - LANES[0]) < 1.0;
      const ok = Math.abs(err) <= 1.5;
      el.guideText.textContent = !curb ? "Acércate a la vereda: pista Solo Bus" : err < -1.5 ? `Marca del paradero en ${Math.round(-err)} m` : err > 1.5 ? `Te pasaste ${err.toFixed(1)} m` : "¡En la marca!";
      el.guide.classList.toggle("ok", ok && curb && b.v < 0.3);
      el.guideMark.style.left = pct(err);
      // Dónde quedarías detenido si sigues frenando igual
      const pe = pred != null ? err + pred : null;
      el.guidePred.style.display = pe != null && pe < 30 ? "" : "none";
      if (pe != null) el.guidePred.style.left = pct(pe);
      el.guideSub.textContent = pe == null ? (b.v > 0.3 && -err < 40 ? `Frena: a ${Math.round(b.v * 3.6)} km/h necesitas ~${Math.round(b.v * b.v / 3)} m` : "")
        : Math.abs(pe) <= 1.5 ? "Así frenando quedas en la marca ✓"
        : pe < 0 ? `Así quedas ${(-pe).toFixed(1)} m antes: suelta un poco el freno`
        : `Así te pasas ${pe.toFixed(1)} m: frena más`;
    } else if (red) {
      const pe = pred != null ? pred - (L.d - 1) : null;     // + = cruzarías la línea
      el.guideText.textContent = `Semáforo ${L.state === "red" ? "en rojo" : "en amarillo"} · línea en ${Math.round(L.d)} m`;
      el.guide.classList.remove("ok");
      el.guideMark.style.left = pct(-(L.d - 1));
      el.guidePred.style.display = pe != null && pe > -9 ? "" : "none";
      if (pe != null) el.guidePred.style.left = pct(pe);
      el.guideSub.textContent = pe == null ? (L.d < b.v * b.v / 3 + 8 ? "¡Frena!" : "") : pe > 0.3 ? `Así cruzas la línea: frena más` : "Así frenando te detienes antes de la línea ✓";
    }
    el.hint.textContent = this.ride ? this.rideHint() : this.hint();
    if (this.ride) {
      const off = this.root.querySelector('[data-r="off"]');
      off.disabled = !this.exitStop()?.stop.metro;
      this.root.querySelector('[data-r="bell"]').classList.toggle("on", sim.bell);
    }
  }

  /* ----------------------------- 2.2 · Taxi ----------------------------- */
  /** Eventos propios del taxi. Devuelve true si lo manejó (los demás siguen como en el bus). */
  taxiEvent(e) {
    switch (e.type) {
      case "fareHail": this.audio.bell(); return true;
      case "uturn": {
        this.audio.blinker();
        this.camPos = null;
        const R = this.sim.route;
        this.el.routeTitle.textContent = `${R.name.toUpperCase()} · ${R.from.toUpperCase()} → ${R.to.toUpperCase()}`;
        return true;
      }
      case "fareBoarding": case "farePaying": case "fareDest": case "fareBoard": case "fareGone": case "taxiStep": return true;
      case "door": this.audio.carDoor(e.open); return true;              // 2.20 · puerta de auto, no la neumática del bus
      case "taxiLock": this.audio.carLock(e.locked); return true;
      case "taxiHandle": this.audio.carHandle(); return true;
      case "fareLost": this.audio.fault(); return true;
      case "farePaid": {
        const total = e.amount + e.tip;
        this.bank.deposit(total, `Taxi · carrera a ${e.fare.destName}${e.tip ? ` (propina ${formatCLP(e.tip)})` : ""}`, { wage: true });
        this.earned += total;
        this.updateBank();
        this.moneyFloat(total);
        this.audio.coin();
        return true;
      }
      case "finished": this.onTaxiFinished(e); return true;
    }
    return false;
  }

  updateTaxiHud() {
    const sim = this.sim, b = sim.bus, el = this.el, f = sim.fare, t = sim.target;
    el.doors.textContent = b.doors === "closed" ? (sim.locked ? "Puerta con seguro" : "Puerta sin seguro") : { opening: "Abren la puerta…", open: "Puerta abierta", closing: "Cierran la puerta…" }[b.doors];
    el.doors.classList.toggle("open", b.doors !== "closed" || !sim.locked);
    el.bell.classList.add("hidden");
    el.meter.textContent = f?.phase === "ride" ? formatCLP(f.meter) : "libre";
    el.meter.parentElement.classList.toggle("on", f?.phase === "ride");
    // Esquema de la calle (siempre en el sentido de la ida): el taxi, su sentido y el punto de la carrera
    el.stripBus.style.left = `${Math.max(0, Math.min(100, this.stripPct(sim.idaS)))}%`;
    el.stripBus.classList.toggle("back", sim.dir < 0);
    el.stripPin.hidden = !t;
    if (t) { el.stripPin.style.left = `${Math.max(0, Math.min(100, this.stripPct(t.ws)))}%`; el.stripPin.classList.toggle("dest", t.kind === "dest"); }
    el.nextLabel.textContent = t?.kind === "pickup" ? "PASAJERO ESPERANDO" : t?.kind === "dest" ? "DESTINO" : "CARRERA";
    if (t) {
      const d = t.s - b.s;
      el.stopName.textContent = t.name;
      const km = (m) => m > 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`;
      el.stopDist.textContent = t.across ? `vereda de enfrente · ${km(Math.abs(d))}` : Math.abs(d) <= t.win ? "aquí" : d > 0 ? km(d) : `atrás · ${km(-d)} · da la vuelta`;
    } else {
      el.stopName.textContent = f?.phase === "done" ? "Tu pasajero se baja…" : "Buscando pasajeros…";
      el.stopDist.textContent = "";
    }
    el.stopWait.textContent = `${sim.taxi.fares} ${sim.taxi.fares === 1 ? "carrera" : "carreras"}`;
    el.delay.textContent = sim.taxi.earned ? `${formatCLP(sim.taxi.earned)} ganados` : "";
    el.delay.className = "bus-delay ok";
    const L = sim.nextLight(140);
    if (L) el.light.innerHTML = `<i class="bus-dot ${L.state}"></i>${esc(L.light.street)} · ${Math.max(0, Math.round(L.d))} m`;
    else el.light.textContent = "";

    // Guía para detenerse a la altura de la persona o del destino (o ante un semáforo en rojo)
    const pred = sim.stopPrediction();
    const pct = (e) => `${50 + Math.max(-50, Math.min(50, e / 9 * 50))}%`;
    const near = t && !t.across && t.s - b.s < 70 && t.s - b.s > -14 && b.doors === "closed";
    const red = !near && L && L.state !== "green" && L.d > 0.5 && L.d < 60 && b.v > 0.5;
    el.guide.classList.toggle("hidden", !near && !red);
    el.guide.classList.toggle("light", !!red);
    if (near) {
      const err = b.s - t.s;
      const curb = Math.abs(b.x - LANES[0]) < 1.0;
      el.guideText.textContent = !curb ? "Acércate a la vereda (pista de la derecha)" : err < -t.win ? `${t.kind === "pickup" ? "La persona" : "El destino"} en ${Math.round(-err)} m` : err > t.win ? `Te pasaste ${err.toFixed(0)} m` : "¡Aquí! Detente";
      el.guide.classList.toggle("ok", Math.abs(err) <= t.win && curb && b.v < 0.3);
      el.guideMark.style.left = pct(err * 9 / 14);
      const pe = pred != null ? err + pred : null;
      el.guidePred.style.display = pe != null && pe < 30 ? "" : "none";
      if (pe != null) el.guidePred.style.left = pct(pe * 9 / 14);
      el.guideSub.textContent = pe == null ? "" : Math.abs(pe) <= 7 ? "Así frenando quedas justo ✓" : pe < 0 ? "Así quedas antes: suelta un poco el freno" : "Así te pasas: frena más";
    } else if (red) {
      const pe = pred != null ? pred - (L.d - 1) : null;
      el.guideText.textContent = `Semáforo ${L.state === "red" ? "en rojo" : "en amarillo"} · línea en ${Math.round(L.d)} m`;
      el.guide.classList.remove("ok");
      el.guideMark.style.left = pct(-(L.d - 1));
      el.guidePred.style.display = pe != null && pe > -9 ? "" : "none";
      if (pe != null) el.guidePred.style.left = pct(pe);
      el.guideSub.textContent = pe == null ? (L.d < b.v * b.v / 6 + 8 ? "¡Frena!" : "") : pe > 0.3 ? "Así cruzas la línea: frena más" : "Así frenando te detienes antes de la línea ✓";
    }
    el.hint.textContent = this.taxiHint();
  }

  /** Consejo según lo que está pasando en la carrera (sirve de tutorial). */
  taxiHint() {
    const sim = this.sim, b = sim.bus, f = sim.fare, t = sim.target;
    const K = this.touch ? { doors: "toca Puerta", right: "▶", gas: "ACELERAR" } : { doors: "Espacio", right: "D", gas: "W" };
    if (sim.finished) return "";
    // 2.20 · Subir y bajar paso a paso: la puerta la abre y la cierra el pasajero; tú solo quitas el seguro
    const K2 = this.touch ? "toca Seguro" : "Espacio";
    if (f?.step === "walk") return "Viene caminando hacia el taxi: espera detenido";
    if (f?.step === "handle") return sim.locked ? `Está tirando la manilla: quita el seguro (${K2}) para que pueda ${f.phase === "pickup" ? "subir" : "bajarse"}` : "Abre la puerta…";
    if (f?.phase === "pickup" && f.step) return f.step === "in" ? "Se agacha, se sube y se sienta…" : f.step === "closing" ? "Cierra la puerta…" : "Abre la puerta…";
    if (f?.step === "pay") return "Te está pagando…";
    if (f?.phase === "done") return f.step === "out" ? "Se baja del taxi…" : f.step === "closing" ? "Cierra la puerta desde afuera…" : "Abre la puerta…";
    if (b.doors !== "closed") return "Espera que tu pasajero cierre la puerta";
    if (!t) return b.v < 0.5 ? `Acelera con ${K.gas} y busca a quien haga señas` : "Atento a la vereda: alguien te va a hacer señas";
    const d = t.s - b.s, curb = Math.abs(b.x - LANES[0]) < 1.0;
    if (t.across || t.behind) {
      // Hay que dar la vuelta: en el próximo cruce, desde la pista junto al bandejón
      const U = this.touch ? "Vuelta" : "U", left = this.touch ? "◀" : "A";
      const L = sim.route.lights.find(l => l.s + 8 > b.s - 13);
      const atCross = L && Math.abs(b.s - (L.s + 8)) < 13;
      if (b.lane !== LANES.length - 1) return `${t.across ? "Está en la vereda de enfrente" : "Quedó para atrás"}: pásate a la pista de la izquierda (${left}) para dar la vuelta en U en el cruce`;
      if (atCross && b.v < 5.5) return `Ahora: da la vuelta en U (${U})`;
      if (L) return `Frena en el cruce que viene (${Math.max(0, Math.round(L.s + 8 - b.s))} m) y da la vuelta en U (${U})`;
      return `Al final de la calle, detente y da la vuelta en U (${U})`;
    }
    if (Math.abs(d) <= t.win && curb) return b.v < 0.3 ? (t.kind === "pickup" ? "Ya viene hacia el taxi" : "Llegaron: espera que pague") : "¡Aquí! Detente junto a la vereda";
    if (d < 160 && !curb) return `Pásate a la pista de la derecha (${K.right}) para ${t.kind === "pickup" ? "recogerlo" : "dejarlo"} junto a la vereda`;
    const L = sim.nextLight(70);
    if (L && L.state === "red" && L.d > 0) return "Semáforo en rojo: detente antes de la línea blanca";
    if (t.kind === "dest") return f.smooth ? "Viaje suave = propina: sin frenadas bruscas ni faltas" : "Lleva a tu pasajero a su destino";
    return "";
  }

  onTaxiFinished(e) {
    if (e.bonus) {
      this.bank.deposit(e.bonus, `Taxi · bono del turno (nota ${e.grade})`, { wage: true });
      this.earned += e.bonus;
      this.updateBank();
      this.moneyFloat(e.bonus);
    }
    const x = e.taxi, t = e.totals;
    const rows = [
      ["Carreras", x.fares],
      ["Tomaron otro taxi", x.lost],
      ["Kilómetros con pasajero", x.km.toFixed(1).replace(".", ",")],
      ["Propinas", formatCLP(x.tips)],
      ["Luces rojas", t.reds],
      ["Choques", t.crashes],
      ["Bono del turno", formatCLP(e.bonus)],
      ["Ganado en este turno", formatCLP(this.earned)],
    ];
    this.el.summaryCard.innerHTML = `
      <span class="bus-label">TAXI · FIN DEL TURNO</span>
      <div class="bus-grade grade-${e.grade}">${e.grade}</div>
      <h2>${esc(this.route.name)}</h2>
      <dl class="bus-stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <p>Lo ganado ya está en tu cuenta del ${esc(BANK_NAME)}. Taxímetro aproximado: ${formatCLP(TAXI_FARE.flag)} la bajada de bandera y ${formatCLP(TAXI_FARE.step)} cada ${TAXI_FARE.meters} m o cada minuto detenido.</p>
      <div class="bus-card-actions">
        <button class="bus-btn primary" data-a="again">Otro turno</button>
        <button class="bus-btn" data-a="quit">Volver a la portada</button>
      </div>`;
    this.el.summaryCard.querySelector("[data-a=again]").addEventListener("click", () => this.again());
    this.el.summaryCard.querySelector("[data-a=quit]").addEventListener("click", () => this.exit());
    setTimeout(() => this.el.summary.classList.remove("hidden"), 900);
    this.releaseControls();
    this.syncInput();
  }


  rideHint() {
    const sim = this.sim, at = this.exitStop(), st = sim.nextStop;
    const K = this.touch ? { bell: "🔔 Timbre", off: "Bajarse aquí" } : { bell: "Espacio", off: "E" };
    if (at && at.stop.metro) return `${at.stop.name}${at.stop.hint ? ` · ${at.stop.hint}` : ""} · bájate con ${K.off}`;
    const metroNext = sim.route.stops.slice(sim.stopIndex).find(s => s.metro);
    if (!st) return "";
    if (sim.bell) return `Parada solicitada: el bus se detiene en ${st.name}`;
    if (!st.metro) return `Próximo: ${st.name} (sin Metro)${metroNext ? ` · después ${metroNext.name}` : ""}`;
    return `Toca el timbre (${K.bell}) para bajarte en ${st.name}${st.hint ? ` · ${st.hint}` : ""}`;
  }

  /** Consejo según lo que está pasando (sirve de tutorial). */
  hint() {
    const sim = this.sim, b = sim.bus, st = sim.nextStop;
    const K = this.touch
      ? { doors: "toca Puertas", gas: "ACELERAR", brake: "FRENO", right: "▶" }
      : { doors: "Espacio", gas: "W", brake: "S", right: "D" };
    if (sim.finished) return "";
    if (sim.serving && !sim.serving.done) return "Subiendo y bajando pasajeros…";
    if (sim.serving?.done && sim.serving.runner) return `Alguien viene corriendo: si esperas con las puertas abiertas alcanza a subir (${K.doors} para cerrar)`;
    if (sim.serving?.done) {
      const due = sim.timetable[sim.serving.index].time;
      if (due - sim.time > 60) return `Vas adelantado: espera con las puertas abiertas; puedes salir desde las ${clockText(due - 60)}`;
      return `Cierra las puertas (${K.doors}) y sigue`;
    }
    if (b.doors !== "closed") return `Cierra las puertas (${K.doors}) para poder avanzar`;
    if (!st) return "";
    const d = st.s - b.s;
    const here = Math.abs(d) <= 9;
    const curb = Math.abs(b.x - LANES[0]) < 1.0;
    if (here && b.v < 0.3 && curb) return `Abre las puertas (${K.doors})`;
    if (d < 160 && b.lane !== 0) return `Pásate a la pista Solo Bus (${K.right}) para el paradero`;
    const L = sim.nextLight(70);
    if (L && L.state === "red" && L.d > 0) return "Semáforo en rojo: detente antes de la línea blanca";
    if (d < 120 && d > 0) return `Frena con ${K.brake}${this.touch ? "" : " (Shift: freno suave)"} para dejar la puerta delantera junto al letrero azul «BUS»: la flecha amarilla muestra dónde quedarías`;
    if (sim.stopIndex === 0) return sim.time < sim.departure ? `Sales a las ${clockText(sim.departure, false)}` : "";
    if (b.v < 0.5) return `Acelera con ${K.gas}`;
    return "";
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  requestExit() {
    if (this.sim.finished || this.paused) return this.exit();
    this.setPaused(true);
  }

  exit() {
    this.destroy();
    this.onExit?.();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastTimer);
    removeEventListener("keydown", this.onKeyDown);
    removeEventListener("keyup", this.onKeyUp);
    removeEventListener("resize", this.onResize);
    removeEventListener("blur", this.onBlur);
    this.audio.stop();
    this.radio?.destroy();
    this.world?.dispose();
    this.renderer.forceContextLoss();     // 2.15.4 · si no, cada entrada al modo deja un contexto WebGL vivo
    this.renderer.dispose();
    this.root.remove();
  }
}
