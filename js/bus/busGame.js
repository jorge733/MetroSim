/* ==========================================================================
   MetroSim — 1.13 · bus/busGame.js
   MicroSim (beta): el modo «Conductor de bus». Une la simulación
   (busSim.js), el mundo 3D (busWorld.js), el sonido (busAudio.js), la
   interfaz y los mandos (teclado y táctiles).

   Es un modo aparte del metro: tiene su propia pantalla (#busScreen) y su
   propio ciclo de dibujo. Comparte con el resto del juego la cuenta
   bancaria (el sueldo del bus se gasta igual como pasajero) y el sonido
   silenciado.

   Mandos: W/↑ acelerar · S/↓ frenar · A/← y D/→ cambiar de pista ·
   Espacio puertas · B bocina · C cámara · M sonido · Esc pausa.
   ========================================================================== */

import * as THREE from "three";
import { BUS_ROUTE, LANES } from "./busRoute.js";
import { autopilot } from "./busAutopilot.js";
import { clearTrackLift } from "../render/trackLift.js";
import { BusSim, BUS_CAPACITY } from "./busSim.js";
import { BusWorld } from "./busWorld.js";
import { BusAudio } from "./busAudio.js";
import { demandAt, dayTypeOf, formatCLP } from "../config.js";
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
};

/**
 * Empieza una partida de MicroSim. Llamar dentro del clic del jugador (sonido).
 * @param {{bank:import("../economy.js").BankAccount, muted:boolean, touch:boolean,
 *          onMuteChange:(m:boolean)=>void, onExit:()=>void}} o
 * @returns {{requestExit:()=>void, destroy:()=>void}}
 */
export function startBusGame(o) {
  const game = new BusGame(o);
  return { requestExit: () => game.requestExit(), destroy: () => game.destroy(), get sim() { return game.sim; }, get debug() { return game; } };
}

class BusGame {
  constructor({ bank, muted, touch, onMuteChange, onExit, ride = null, route = null }) {
    /* 1.15 · ride: el jugador viaja como PASAJERO (maneja el piloto automático):
       { route, from, onArrive(stop), line } · onArrive se llama al bajarse en un paradero */
    this.ride = ride;
    this.route = ride ? ride.route : (route ?? BUS_ROUTE);
    this.bank = bank;
    this.touch = touch;
    this.onMuteChange = onMuteChange;
    this.onExit = onExit;
    this.audio = new BusAudio();
    this.audio.muted = muted;
    this.audio.start();
    this.camMode = ride ? "seat" : "chase";
    this.paused = false;
    this.keys = new Set();
    this.touchPedal = { throttle: 0, brake: 0 };
    this.earned = 0;

    clearTrackLift();           // la Alameda es plana: sin las pendientes de la última línea de Metro jugada
    this.buildDom();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  /** Arma (o vuelve a armar) el recorrido: mundo 3D y simulación nuevos. */
  newRun() {
    if (this.world) { this.world.dispose(); }
    this.scene = new THREE.Scene();
    const now = new Date();
    const clock = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    this.sim = new BusSim({ route: this.route, clock, demand: demandAt(clock, dayTypeOf(now)), startStop: this.ride?.from ?? 0 });
    this.world = new BusWorld({ scene: this.scene, route: this.route, hour: clock / 3600 });
    this.scene.add(this.camera);
    this.camPos = null;
    this.earned = 0;
    this.renderStrip();
    this.el.summary.classList.add("hidden");
    this.el.pause.classList.add("hidden");
    this.paused = false;
    if (this.ride) {
      this.wantOff = null;
      this.toast(`Subiste al bus ${this.route.id} hacia ${this.route.to} · ${this.ride.fareText} · toca el timbre (${this.touch ? "🔔" : "Espacio"}) antes de tu parada`, "ok", 7000);
    } else this.toast(`Servicio ${this.route.id} · sale a las ${clockText(this.sim.departure, false)} desde ${this.route.from}. ${this.touch ? "Toca Puertas" : "Abre las puertas con Espacio"} para que suban los pasajeros`, "info", 7000);
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
          <span class="bus-badge">${R.id}</span>
          <div class="bus-route"><span class="bus-label">${this.ride ? "BUS RED · VIAJAS COMO PASAJERO" : "BUSES · CONDUCTOR DE BUS · BETA"}</span><strong>${esc(R.name.toUpperCase())} · ${esc(R.from.toUpperCase())} → ${esc(R.to.toUpperCase())}</strong></div>
        </div>
        <div class="bus-right">
          <div class="bus-pill"><span class="bus-label">CUENTA</span><strong data-k="bank">$0</strong><span class="bus-float" data-k="float"></span></div>
          <div class="bus-pill"><span class="bus-label">HORA</span><strong data-k="clock">--:--</strong></div>
          <button class="bus-icon-btn" data-k="sound" aria-label="Sonido">${ICON.sound}</button>
          <button class="bus-icon-btn" data-k="menu" aria-label="Pausa y menú">${ICON.menu}</button>
        </div>
      </header>
      <div class="bus-strip" data-k="strip"></div>
      <div class="bus-bell hidden" data-k="bell">PARADA SOLICITADA</div>
      <div class="bus-toast hidden" data-k="toast"></div>
      <div class="bus-guide hidden" data-k="guide"><span data-k="guideText"></span><div class="bus-guide-bar"><i data-k="guideMark"></i><u data-k="guidePred"></u><b></b></div><small data-k="guideSub"></small></div>
      <div class="bus-lead hidden" data-k="lead"><span class="bus-label">AUTO ADELANTE</span><strong data-k="leadGap">—</strong></div>
      <footer class="bus-bottom">
        <div class="bus-panel bus-speed">
          <div class="bus-speed-num"><strong data-k="speed">0</strong><span class="bus-label">KM/H</span></div>
          <div class="bus-limit" data-k="limit" title="Limitador (L)">${Math.round(R.speedLimit * 3.6)}<small>LIM</small></div>
          <div class="bus-pedals"><span class="bus-label">ACEL</span><i><b data-k="thr"></b></i><span class="bus-label">FRENO</span><i class="brk"><b data-k="brk"></b></i></div>
        </div>
        <div class="bus-panel bus-next">
          <span class="bus-label">PRÓXIMO PARADERO</span>
          <strong data-k="stopName">—</strong>
          <div class="bus-next-row">
            <span data-k="stopDist">—</span>
            <span data-k="stopWait">—</span>
            <span data-k="delay" class="bus-delay">—</span>
          </div>
          <div class="bus-next-row bus-next-sub">
            <span>A bordo <b data-k="onboard">0</b>/${BUS_CAPACITY}</span>
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
        <span><kbd>Espacio</kbd> puertas</span>
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
          <button data-t="doors">${ICON.doors}<span>Puertas</span></button>
          <button data-t="horn">${ICON.horn}<span>Bocina</span></button>
          <button data-t="cam">${ICON.cam}<span>Cámara</span></button>
          <button data-t="limiter"><b class="bus-lim-ico">50</b><span>Limitador</span></button>
        </div>
        <div class="bus-touch-right">
          <button data-t="brake" class="bus-pedal brake"><i data-k="brkFill"></i><span>FRENO</span></button>
          <button data-t="throttle" class="bus-pedal gas"><i data-k="thrFill"></i><span>ACELERAR</span></button>
        </div>
      </div>
      <div class="bus-overlay bus-pause hidden" data-k="pause">
        <div class="bus-card">
          <span class="bus-label">${this.ride ? "VIAJE EN BUS · PAUSA" : "CONDUCTOR DE BUS · PAUSA"}</span>
          <h2>Recorrido ${R.id} · ${esc(R.name)}</h2>
          <p>${this.ride ? "Para bajarte, toca el timbre antes de tu parada y, con las puertas abiertas, elige «Bajarse aquí». Desde la portada puedes volver a empezar donde quieras." : "El sueldo de cada paradero ya está en tu cuenta. Si terminas ahora no recibes el bono del servicio."}</p>
          <div class="bus-card-actions">
            <button class="bus-btn primary" data-k="resume">${this.ride ? "Seguir el viaje" : "Seguir manejando"}</button>
            <button class="bus-btn" data-k="quit">Volver a la portada</button>
          </div>
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
    if (this.sim.requestStop()) { this.wantOff = this.sim.stopIndex; this.toast(`Parada solicitada: ${st.name}`, "ok", 2600); }
    else this.toast(st ? `Ya está solicitada la parada ${st.name}` : "Es el fin del recorrido", "info", 2200);
  }
  getOff() {
    if (!this.ride || this.paused) return;
    const here = this.exitStop();
    if (!here) return this.toast(this.sim.bus.v > 0.3 ? "Espera que el bus se detenga y abra las puertas" : "Las puertas están cerradas: toca el timbre para bajarte en la próxima parada", "info");
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
    const pct = (s) => ((s - R.stops[0].s) / span) * 100;
    this.el.strip.innerHTML = `<div class="bus-strip-track"></div>` +
      R.stops.map((st, i) => `<span class="bus-strip-stop" data-i="${i}" style="left:${pct(st.s)}%"><i></i><em>${esc(st.name)}</em></span>`).join("") +
      `<span class="bus-strip-bus" data-k="stripBus"></span>`;
    this.el.stripBus = this.el.strip.querySelector("[data-k=stripBus]");
    this.stripPct = pct;
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
    this.el.sound.innerHTML = m ? ICON.mute : ICON.sound;
    this.onMuteChange?.(m);
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
    }
    this.handleEvents();
    this.world.update(this.sim, this.paused ? 0 : dt, now / 1000);
    this.updateCamera(dt);
    this.audio.update(this.sim.bus.v, this.sim.bus.throttle, !this.paused);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt) {
    const g = this.world.bus, cam = this.camera;
    if (this.camMode === "seat") {
      g.updateMatrixWorld();
      cam.position.copy(new THREE.Vector3(0.7, 2.25, 4.45).applyMatrix4(g.matrixWorld));
      cam.lookAt(new THREE.Vector3(0.1, 1.75, -30).applyMatrix4(g.matrixWorld));
      cam.fov = 70;
    } else if (this.camMode === "cab") {
      g.updateMatrixWorld();
      const p = new THREE.Vector3(-0.72, 2.2, 1.55).applyMatrix4(g.matrixWorld);
      const look = new THREE.Vector3(-0.4, 1.4, -30).applyMatrix4(g.matrixWorld);
      cam.position.copy(p);
      cam.lookAt(look);
      cam.fov = 68;
    } else {
      g.updateMatrixWorld();
      const want = new THREE.Vector3(0, 5.6, 25).applyMatrix4(g.matrixWorld);
      if (!this.camPos || this.camPos.distanceTo(want) > 60) this.camPos = want.clone();
      this.camPos.lerp(want, Math.min(1, dt * 4));
      cam.position.copy(this.camPos);
      cam.lookAt(new THREE.Vector3(0, 1.8, -10).applyMatrix4(g.matrixWorld));
      cam.fov = 60;
    }
    cam.updateProjectionMatrix();
  }

  handleEvents() {
    for (const e of this.sim.drain()) {
      if (this.ride) { this.rideEvent(e); continue; }
      switch (e.type) {
        case "msg": this.toast(e.text, e.level); break;
        case "penalty": this.toast(`${e.text} · −${e.points} pts`, "warn", 3600); this.audio.fault(); break;
        case "door": this.audio.door(e.open); break;
        case "board": this.audio.validate(!e.evaded); break;
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
    this.el.summaryCard.querySelector("[data-a=again]").addEventListener("click", () => this.newRun());
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
    this.root.querySelector('[data-t="limiter"]')?.classList.toggle("lit", sim.limiter);
    // Distancia al auto de adelante (solo si está cerca)
    const lead = !this.ride && sim.lead && sim.lead.gap < 45 && b.v > 1 ? sim.lead : null;
    el.lead.classList.toggle("hidden", !lead);
    if (lead) {
      el.leadGap.textContent = `${Math.max(0, Math.round(lead.gap))} m`;
      el.lead.classList.toggle("warn", lead.ttc < 4 || lead.gap < b.v * 1.2);
      el.lead.classList.toggle("bad", lead.ttc < 2.6 || lead.gap < b.v * 0.8);
    }
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
    this.world?.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
