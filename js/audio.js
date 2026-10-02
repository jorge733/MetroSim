/* ==========================================================================
   MetroSim — Alpha 0.4 · audio.js
   Sonido procedural con Web Audio API (sin archivos externos).

   Capas continuas (se ajustan cada fotograma según el estado del tren):
     · rodadura (ruido filtrado según velocidad)
     · retumbo del túnel (ruido marrón grave)
     · motor de tracción + portadora del inversor VVVF (silbido característico)
     · chirrido de freno a baja velocidad
     · ventilación de cabina/salón
     · murmullo de viajeros en el andén
   Sonidos puntuales:
     · golpeteo de juntas de carril (por distancia recorrida)
     · clic del manipulador, golpe del inversor
     · avisador y motor de puertas, golpe de cierre
     · escape de aire del freno, alarma de emergencia, impacto
     · gong + voz sintetizada para anuncios de estación

   El navegador exige un gesto del usuario para iniciar audio: start() se
   llama desde el clic que inicia la partida.
   ========================================================================== */

import { clamp } from "./utils.js";

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.jointDistance = 0;
    this.overspeedTimer = 0;
    this.voice = null;
  }

  get ready() { return !!this.ctx; }

  /* ---------------------------------------------------------------------
     Inicialización
     --------------------------------------------------------------------- */
  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.white = this.makeNoise(3, "white");
    this.brown = this.makeNoise(4, "brown");

    // --- Capas continuas ---
    this.rolling = this.noiseLayer(this.white, "lowpass", 400, 0.8);
    this.rumble = this.noiseLayer(this.brown, "lowpass", 150, 0.7);
    this.fan = this.noiseLayer(this.white, "bandpass", 480, 0.7);

    // Motor de tracción: diente de sierra grave + armónico, filtrados
    this.motor = this.toneLayer("sawtooth", 60, "lowpass", 900, 1.2);
    this.motor2 = this.toneLayer("triangle", 120, "lowpass", 1400, 0.8);
    // Portadora VVVF: tono agudo con "escalones" típicos de los metros
    this.carrier = this.toneLayer("square", 700, "bandpass", 1000, 6);
    // Chirrido de freno con vibrato
    this.squeal = this.toneLayer("sine", 2850, "bandpass", 2850, 4);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5; lfoGain.gain.value = 45;
    lfo.connect(lfoGain).connect(this.squeal.osc.frequency); lfo.start();

    // Murmullo de gente: tres bandas de voz con modulación de amplitud
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0; this.crowdGain.connect(this.master);
    [480, 1050, 1900].forEach((f, i) => {
      const src = this.loopSource(this.white);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 1.4;
      const am = ctx.createGain(); am.gain.value = 0.5;
      const mod = ctx.createOscillator(), modGain = ctx.createGain();
      mod.frequency.value = 2.3 + i * 1.7 + Math.random(); modGain.gain.value = 0.45;
      mod.connect(modGain).connect(am.gain); mod.start();
      src.connect(bp).connect(am).connect(this.crowdGain);
    });

    this.pickVoice();
    if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => this.pickVoice();
  }

  stop() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.ctx?.close();
    this.ctx = null;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
  }

  /* ---------------------------------------------------------------------
     Bloques de construcción
     --------------------------------------------------------------------- */
  makeNoise(seconds, color) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  }

  loopSource(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    src.start(0, Math.random() * buffer.duration);
    return src;
  }

  noiseLayer(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = this.loopSource(buffer);
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    return { src, filter, gain };
  }

  toneLayer(wave, freq, filterType, filterFreq, q) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = wave; osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.value = filterFreq; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    return { osc, filter, gain };
  }

  /** Ajuste suave de un parámetro continuo. */
  set(param, value, smooth = 0.08) { param.setTargetAtTime(value, this.ctx.currentTime, smooth); }

  /** Tono breve con envolvente (base de pitidos, gongs y clics). */
  tone(freq, { start = 0, duration = 0.2, gain = 0.2, wave = "sine", attack = 0.005, endFreq = null } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = wave; osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + duration + 0.05);
  }

  /** Ráfaga de ruido filtrado con envolvente (aire, golpes, juntas). */
  burst({ start = 0, duration = 0.3, gain = 0.2, type = "highpass", freq = 2000, q = 0.7, attack = 0.01, endFreq = null, buffer = null } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const src = ctx.createBufferSource(); src.buffer = buffer || this.white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + duration + 0.05);
  }

  /* ---------------------------------------------------------------------
     Actualización continua
     state: { velocity, speedKmh, accel, braking, inStation, view, overspeed, crowd, dt, level }
     level (0..1): volumen del tren según la distancia (1 = vas dentro).
     --------------------------------------------------------------------- */
  update(s) {
    if (!this.ctx) return;
    const kmh = s.speedKmh, k = clamp(kmh / 70, 0, 1);
    const inside = s.view !== "exterior";
    const L = s.level ?? 1;                                                          // atenuación por distancia
    const underfloor = (s.view === "saloon" ? 1.25 : s.view === "cab" ? 0.8 : 1.0) * L;   // el salón está sobre los motores

    // Rodadura y túnel
    this.set(this.rolling.gain.gain, k > 0 ? (0.04 + k * 0.32) * (inside ? 0.85 : 1.1) * L : 0);
    this.set(this.rolling.filter.frequency, 220 + kmh * 24);
    this.set(this.rumble.gain.gain, (0.05 + k * 0.5 * L) * (s.inStation ? 0.45 : 1));
    this.set(this.fan.gain.gain, inside ? 0.022 : 0.004);

    // Motor: activo con tracción o con freno eléctrico (regenerativo) por encima de ~4 km/h
    const effort = Math.abs(s.accel);
    const electric = s.accel > 0.03 || (s.accel < -0.03 && kmh > 4);
    const motorLevel = electric ? clamp(effort, 0.15, 1) : 0;
    const motorFreq = 30 + kmh * 11;
    this.set(this.motor.osc.frequency, motorFreq, 0.05);
    this.set(this.motor2.osc.frequency, motorFreq * 2.02, 0.05);
    this.set(this.motor.gain.gain, motorLevel * 0.07 * underfloor);
    this.set(this.motor2.gain.gain, motorLevel * 0.035 * underfloor);

    // Portadora VVVF: escalones de frecuencia a baja velocidad, luego síncrona con el motor
    let carrierFreq;
    if (kmh < 7) carrierFreq = 620 + kmh * 18;
    else if (kmh < 18) carrierFreq = 1150;
    else if (kmh < 30) carrierFreq = motorFreq * 5;
    else carrierFreq = motorFreq * 3;
    const carrierLevel = electric ? motorLevel * clamp(1 - kmh / 55, 0.15, 1) : 0;
    this.set(this.carrier.osc.frequency, carrierFreq, 0.03);
    this.set(this.carrier.filter.frequency, carrierFreq, 0.03);
    this.set(this.carrier.gain.gain, carrierLevel * 0.03 * underfloor);

    // Chirrido de freno en los últimos metros de frenada
    const squealing = s.braking && kmh > 0.4 && kmh < 14;
    this.set(this.squeal.gain.gain, squealing ? 0.022 * (1 - kmh / 14) * (0.6 + Math.random() * 0.4) * L : 0, 0.05);

    // Viajeros en el andén
    this.set(this.crowdGain.gain, clamp(s.crowd, 0, 1) * 0.13, 0.4);

    // Juntas de carril: un golpe por eje cada 18 m (dos bogies, dos ejes por bogie)
    if (kmh > 3 && L > 0.05) {
      this.jointDistance += Math.abs(s.velocity) * s.dt;
      if (this.jointDistance >= 18) {
        this.jointDistance -= 18;
        const v = Math.abs(s.velocity), vol = clamp(kmh / 55, 0.15, 1) * (inside ? 0.16 : 0.22) * L;
        [2.5, 4.3, 13.7, 15.5].forEach(d => this.clack(d / v, vol));
      }
    }

    // Aviso acústico de exceso de velocidad
    if (s.overspeed) {
      this.overspeedTimer -= s.dt;
      if (this.overspeedTimer <= 0) { this.tone(1450, { duration: 0.18, gain: 0.08, wave: "square" }); this.overspeedTimer = 0.5; }
    } else this.overspeedTimer = 0;
  }

  /* ---------------------------------------------------------------------
     Sonidos puntuales
     --------------------------------------------------------------------- */
  clack(delay, vol) {
    if (!this.ctx || delay > 3) return;
    this.burst({ start: delay, duration: 0.07, gain: vol, type: "bandpass", freq: 1700, q: 1.2, attack: 0.002 });
    this.tone(95, { start: delay, duration: 0.09, gain: vol * 0.9, attack: 0.002 });
  }

  /** Clic del manipulador al cambiar de posición. */
  notchClick() {
    if (!this.ctx) return;
    this.tone(2200, { duration: 0.025, gain: 0.05, wave: "square", attack: 0.001 });
    this.burst({ duration: 0.04, gain: 0.06, type: "bandpass", freq: 3500, q: 2, attack: 0.001 });
  }

  /** Golpe metálico del inversor. */
  reverserClunk() {
    if (!this.ctx) return;
    this.tone(170, { duration: 0.15, gain: 0.12, endFreq: 90, attack: 0.002 });
    this.burst({ duration: 0.08, gain: 0.07, type: "bandpass", freq: 1200, q: 1.5, attack: 0.002 });
  }

  /** Escape de aire comprimido (freno). */
  airHiss(strength = 1) {
    if (!this.ctx) return;
    this.burst({ duration: 0.6 + strength * 0.8, gain: 0.05 + strength * 0.05, type: "highpass", freq: 3000, attack: 0.02, endFreq: 1800 });
  }

  /** Apertura: gong de dos tonos + motor neumático. */
  doorsOpening(duration) {
    if (!this.ctx) return;
    this.tone(880, { duration: 0.5, gain: 0.08 });
    this.tone(660, { start: 0.28, duration: 0.7, gain: 0.08 });
    this.doorMotor(duration);
  }

  /** Cierre: pitidos de aviso + motor + golpe final. */
  doorsClosing(duration) {
    if (!this.ctx) return;
    for (let i = 0; i < 6; i++) this.tone(2050, { start: i * 0.2, duration: 0.11, gain: 0.06, wave: "triangle" });
    this.doorMotor(duration, 0.3);
    this.burst({ start: duration + 0.2, duration: 0.18, gain: 0.16, type: "lowpass", freq: 380, attack: 0.003 });
    this.tone(70, { start: duration + 0.2, duration: 0.2, gain: 0.14, attack: 0.003 });
  }

  doorMotor(duration, start = 0) {
    this.burst({ start, duration: 0.35, gain: 0.07, type: "highpass", freq: 2500, attack: 0.01 });               // válvula
    this.burst({ start, duration, gain: 0.05, type: "bandpass", freq: 320, q: 2, attack: 0.15, endFreq: 650 });  // deslizamiento
  }

  emergency() {
    if (!this.ctx) return;
    this.airHiss(2.5);
    for (let i = 0; i < 3; i++) this.tone(950, { start: i * 0.45, duration: 0.3, gain: 0.1, wave: "square" });
  }

  impact() {
    if (!this.ctx) return;
    this.burst({ duration: 0.9, gain: 0.5, type: "lowpass", freq: 600, attack: 0.002, buffer: this.brown });
    this.tone(55, { duration: 0.6, gain: 0.4, attack: 0.002 });
  }

  /** Gong de megafonía (ding-dong). */
  chime() {
    if (!this.ctx) return;
    [[659, 0], [523, 0.55]].forEach(([f, t]) => {
      this.tone(f, { start: t, duration: 1.2, gain: 0.12 });
      this.tone(f * 2, { start: t, duration: 0.6, gain: 0.03 });
    });
  }

  /* ---------------------------------------------------------------------
     Megafonía con voz sintetizada
     --------------------------------------------------------------------- */
  pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    this.voice = voices.find(v => v.lang === "es-ES") || voices.find(v => v.lang?.startsWith("es")) || null;
  }

  announce(text) {
    if (!this.ctx || this.muted) return;
    this.chime();
    if (!("speechSynthesis" in window)) return;
    setTimeout(() => {
      if (this.muted || !this.ctx) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-ES";
      if (this.voice) u.voice = this.voice;
      u.rate = 0.95; u.pitch = 1; u.volume = 0.9;
      speechSynthesis.speak(u);
    }, 1300);
  }
}
