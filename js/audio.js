/* ==========================================================================
   MetroSim — Alpha 0.6 · audio.js
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
     · gong + anuncios con las frases reales del Metro de Santiago
       (grabaciones propias en audio/voz/ o, si no hay, voz sintetizada)

   El navegador exige un gesto del usuario para iniciar audio: start() se
   llama desde el clic que inicia la partida.
   ========================================================================== */

import { clamp } from "./utils.js";

/**
 * Elige la voz en español más realista del navegador: primero español de
 * Chile, luego latinoamericano; las voces neuronales ("Natural", "Online")
 * suenan mucho mejor; y femenina, como la locución del Metro.
 */
export function bestSpanishVoice() {
  if (!("speechSynthesis" in window)) return null;
  const female = /catalina|helena|laura|elvira|dalia|paloma|sabina|luc[ií]a|elena|m[oó]nica|paulina|camila|ximena|valentina|female|mujer/i;
  const score = (v) => {
    const lang = (v.lang || "").toLowerCase();
    if (!lang.startsWith("es")) return -1;
    let s = 10;
    if (lang === "es-cl") s += 100;                                  // español de Chile
    else if (/es-(419|us|mx|ar|co|pe)/.test(lang)) s += 60;          // latinoamericano
    else if (lang === "es-es") s += 35;
    if (/natural|online|neural/i.test(v.name)) s += 70;              // voces neuronales
    if (/google/i.test(v.name)) s += 20;
    if (female.test(v.name)) s += 15;
    return s;
  };
  const ranked = speechSynthesis.getVoices().map(v => ({ v, s: score(v) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s);
  return ranked[0]?.v || null;
}

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
    // Calle: rumor del tránsito (grave) y siseo de neumáticos
    this.traffic = this.noiseLayer(this.white, "bandpass", 520, 0.5);   // rumor lejano (no grave, para no confundirse con el tren)
    this.trafficWander = 0;
    this.tyres = this.noiseLayer(this.white, "bandpass", 900, 0.4);

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
    this.loadVoiceClips();
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
     state: { velocity, speedKmh, accel, braking, inStation, view, overspeed, crowd, dt, level, street }
     street: el jugador está en la calle (sin túnel; se oye el tránsito).
     level (0..1): volumen del tren según la distancia (1 = vas dentro).
     --------------------------------------------------------------------- */
  update(s) {
    if (!this.ctx) return;
    // En la calle no se oye NADA del tren ni del túnel: solo la ciudad
    if (s.street) {
      for (const layer of [this.rolling, this.rumble, this.fan, this.motor, this.motor2, this.carrier, this.squeal]) this.set(layer.gain.gain, 0, 0.15);
      this.jointDistance = 0;
      this.overspeedTimer = 0;
      const busy = s.streetBusy ?? 1;
      this.trafficWander = clamp(this.trafficWander + (Math.random() - 0.5) * s.dt * 0.8, -0.3, 0.3);   // el tránsito sube y baja
      this.set(this.traffic.gain.gain, (0.03 + 0.05 * busy) * (1 + this.trafficWander), 0.5);
      this.set(this.tyres.gain.gain, (0.006 + Math.random() * 0.004) * (0.5 + busy), 0.3);
      this.set(this.crowdGain.gain, clamp(s.crowd, 0, 1) * 0.13, 0.4);
      return;
    }
    this.set(this.traffic.gain.gain, 0, 0.3);
    this.set(this.tyres.gain.gain, 0, 0.3);

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

  /** Validador de la tarjeta bip! en el torniquete. */
  bip() {
    if (!this.ctx) return;
    this.tone(2400, { duration: 0.09, gain: 0.09, wave: "square", attack: 0.002 });
    this.burst({ start: 0.12, duration: 0.25, gain: 0.05, type: "bandpass", freq: 900, q: 1.5, attack: 0.02 });   // aletas
  }

  /** Torniquete rechaza la tarjeta (saldo insuficiente). */
  deny() {
    if (!this.ctx) return;
    this.tone(420, { duration: 0.16, gain: 0.1, wave: 'square', attack: 0.003 });
    this.tone(420, { start: 0.22, duration: 0.16, gain: 0.1, wave: 'square', attack: 0.003 });
  }

  /** Carga aprobada: doble bip del lector y comprobante impreso. */
  loadOk() {
    if (!this.ctx) return;
    this.tone(1800, { duration: 0.08, gain: 0.08, wave: 'square', attack: 0.002 });
    this.tone(2400, { start: 0.12, duration: 0.1, gain: 0.08, wave: 'square', attack: 0.002 });
    this.burst({ start: 0.35, duration: 0.6, gain: 0.04, type: 'bandpass', freq: 3200, q: 3, attack: 0.02 });   // impresora
  }

  /** Caja registradora: pago aprobado en un local de la calle. */
  cash() {
    if (!this.ctx) return;
    this.tone(2200, { duration: 0.07, gain: 0.07, wave: "square", attack: 0.002 });
    this.tone(3300, { start: 0.09, duration: 0.25, gain: 0.06, wave: "triangle", attack: 0.002 });
    this.burst({ start: 0.05, duration: 0.18, gain: 0.05, type: "bandpass", freq: 1500, q: 2 });
  }

  /* ---------------------------------------------------------------------
     Sonidos de la calle (city/city.js los pide con city.sound)
     --------------------------------------------------------------------- */
  cityEvent(type, o = {}) {
    if (!this.ctx) return;
    if (type === "pass") return this.carPass(o);
    if (type === "horn") return this.horn(o.far);
    if (type === "birds") return this.birds();
    if (type === "siren") return this.siren();
  }

  /** Auto o micro que pasa: zumbido que sube y baja (más fuerte cuanto más cerca y rápido). */
  carPass({ bus = false, speed = 10, lateral = 4 }) {
    const near = clamp(1 - lateral / 18, 0.1, 1), v = clamp(speed / 14, 0.3, 1.2);
    const gain = 0.12 * near * near * v * (bus ? 1.4 : 1);
    this.burst({ duration: 1.8, gain, type: "bandpass", freq: 900 + speed * 25, endFreq: 260, q: 0.8, attack: 0.7, buffer: this.white });
    this.burst({ duration: 2.0, gain: gain * 1.6, type: "lowpass", freq: 260, endFreq: 120, q: 0.7, attack: 0.8, buffer: this.brown });
    if (bus) this.tone(62, { duration: 2.2, gain: 0.05 * near, wave: "sawtooth", attack: 0.8, endFreq: 48 });
  }

  /** Bocinazo (cerca: doble y fuerte; lejos: uno suave). */
  horn(far = false) {
    const g = far ? 0.018 : 0.05, f = 380 + Math.random() * 140;
    const honk = (start, dur) => {
      this.tone(f, { start, duration: dur, gain: g, wave: "square", attack: 0.01 });
      this.tone(f * 1.26, { start, duration: dur, gain: g * 0.8, wave: "square", attack: 0.01 });
    };
    honk(0, far ? 0.4 : 0.22);
    if (!far && Math.random() < 0.6) honk(0.32, 0.3);
  }

  /** Trinos de pájaros en los árboles. */
  birds() {
    const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const f = base * (0.9 + Math.random() * 0.25);
      this.tone(f, { start: i * 0.13, duration: 0.09, gain: 0.018, wave: "sine", attack: 0.005, endFreq: f * 1.35 });
    }
  }

  /** Sirena lejana (ambulancia o bomberos) que sube y baja. */
  siren() {
    for (let i = 0; i < 6; i++) {
      this.tone(i % 2 ? 960 : 720, { start: i * 0.7, duration: 0.7, gain: 0.012, wave: "triangle", attack: 0.15, endFreq: i % 2 ? 720 : 960 });
    }
  }

  /** Paso del pasajero: vereda (seco), baldosa de la estación (más brillante) o piso del tren (sordo). */
  footstep(surface = "tile", running = false) {
    if (!this.ctx) return;
    const f = { street: 900, tile: 1700, train: 600 }[surface] || 1200;
    const g = (running ? 0.07 : 0.045) * (0.8 + Math.random() * 0.4);
    this.burst({ duration: 0.07, gain: g, type: "bandpass", freq: f * (0.85 + Math.random() * 0.3), q: 1.2, attack: 0.003 });
    this.burst({ duration: 0.05, gain: g * 0.8, type: "lowpass", freq: 220, q: 0.7, attack: 0.002, buffer: this.brown });
  }

  /** Obturador de la cámara de fotos. */
  shutter() {
    if (!this.ctx) return;
    this.burst({ duration: 0.05, gain: 0.12, type: "highpass", freq: 2500, attack: 0.002 });
    this.burst({ start: 0.09, duration: 0.06, gain: 0.1, type: "highpass", freq: 1800, attack: 0.002 });
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
     Megafonía
     Cada anuncio es una lista de "fragmentos" { key, text }:
       · Si existen grabaciones en audio/voz/ (ver audio/voz/LEEME.md y
         manifest.json) se reproducen encadenadas, con un filtro que imita
         el altavoz del tren.
       · Si falta alguna, se usa la mejor voz sintetizada del navegador,
         priorizando voces neuronales de Chile y de Latinoamérica.
     --------------------------------------------------------------------- */

  /** Elige la voz más realista disponible (las neuronales "Natural"/"Online" suenan mucho mejor). */
  pickVoice() {
    this.voice = bestSpanishVoice();
  }

  /** Lee audio/voz/manifest.json para saber qué grabaciones hay disponibles. */
  async loadVoiceClips() {
    this.clipKeys = new Set();
    this.clips = new Map();
    try {
      const res = await fetch("audio/voz/manifest.json", { cache: "no-store" });
      if (!res.ok) return;
      const manifest = await res.json();
      const ext = manifest.extension || "mp3";
      (manifest.clips || []).forEach(k => this.clipKeys.add(k));
      // Precarga en segundo plano
      for (const key of this.clipKeys) {
        fetch(`audio/voz/${key}.${ext}`)
          .then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
          .then(buf => this.ctx?.decodeAudioData(buf))
          .then(audio => audio && this.clips.set(key, audio))
          .catch(() => this.clipKeys.delete(key));
      }
    } catch { /* sin grabaciones: se usa voz sintetizada */ }
  }

  /** Cadena de "altavoz de tren": banda telefónica, algo de compresión y un leve eco. */
  paChain() {
    if (this.pa) return this.pa;
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 260;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200;
    const peak = ctx.createBiquadFilter(); peak.type = "peaking"; peak.frequency.value = 2000; peak.gain.value = 4;
    const gain = ctx.createGain(); gain.gain.value = 0.9;
    const delay = ctx.createDelay(); delay.delayTime.value = 0.045;
    const fb = ctx.createGain(); fb.gain.value = 0.18;
    hp.connect(lp).connect(peak).connect(gain).connect(this.master);
    gain.connect(delay).connect(fb).connect(this.master);
    this.pa = hp;
    return hp;
  }

  /**
   * Anuncio por megafonía.
   * @param {Array<{key:string,text:string}>|string} parts  fragmentos del anuncio (o texto libre)
   * @param {object} opts
   * @param {boolean} opts.chime  tocar el gong antes
   */
  announce(parts, { chime = true } = {}) {
    if (!this.ctx || this.muted) return;
    if (typeof parts === "string") parts = [{ key: null, text: parts }];
    const lead = chime ? 1.3 : 0.05;
    if (chime) this.chime();

    // 1. Grabaciones (si están todas los fragmentos)
    if (parts.every(p => p.key && this.clips?.has(p.key))) {
      let t = this.ctx.currentTime + lead;
      const out = this.paChain();
      for (const p of parts) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.clips.get(p.key);
        src.connect(out);
        src.start(t);
        t += src.buffer.duration + 0.08;
      }
      return;
    }

    // 2. Voz sintetizada
    if (!("speechSynthesis" in window)) return;
    const text = parts.map(p => p.text).join(" ");
    setTimeout(() => {
      if (this.muted || !this.ctx) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice?.lang || "es-CL";
      if (this.voice) u.voice = this.voice;
      u.rate = 0.9;                       // ritmo pausado y tranquilo, como en el Metro
      u.pitch = 1.05;
      u.volume = 0.95;
      speechSynthesis.speak(u);
    }, lead * 1000);
  }
}
