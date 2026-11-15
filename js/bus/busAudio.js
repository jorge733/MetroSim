/* ==========================================================================
   MetroSim — 1.13 · bus/busAudio.js
   MicroSim (beta): sonidos del bus, todos procedurales (Web Audio, sin
   archivos): motor diésel, rodado, bocina, puertas neumáticas, el «bip» del
   validador, el timbre de parada solicitada y el intermitente.
   ========================================================================== */

export class BusAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /** Se llama dentro del clic del jugador (los navegadores lo exigen para sonar). */
  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // Motor: dos dientes de sierra graves por un pasabajos
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 260;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc = [32, 64.5].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i ? "square" : "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i ? 0.25 : 0.7;
      o.connect(g).connect(this.engineFilter);
      o.start();
      return o;
    });

    // Rodado: ruido filtrado según la velocidad
    this.noiseBuf = this.makeNoise(2);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 500;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    n.connect(nf).connect(this.roadGain).connect(this.master);
    n.start();

    // Bocina (se mantiene mientras se aprieta)
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = "lowpass"; hf.frequency.value = 1400;
    hf.connect(this.hornGain).connect(this.master);
    for (const f of [311, 392]) {
      const o = ctx.createOscillator();
      o.type = "square"; o.frequency.value = f;
      o.connect(hf); o.start();
    }
  }

  makeNoise(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; }
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Cada fotograma: motor y rodado según la velocidad (m/s) y el acelerador (0..1). */
  update(v, throttle, running = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 30 + Math.min(v, 16) * 2.4 + throttle * 14;
    this.osc[0].frequency.setTargetAtTime(rpm, t, 0.15);
    this.osc[1].frequency.setTargetAtTime(rpm * 2.02, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(220 + throttle * 420 + v * 12, t, 0.2);
    this.engineGain.gain.setTargetAtTime(running ? 0.09 + throttle * 0.1 : 0, t, 0.2);
    this.roadGain.gain.setTargetAtTime(Math.min(0.16, v * 0.011), t, 0.3);
  }

  horn(on) {
    if (!this.ctx) return;
    this.hornGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.02);
  }

  tone(freq, dur, { type = "sine", gain = 0.2, at = 0, decay = true } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.setValueAtTime(0, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Puertas: soplido neumático y dos pitidos de aviso. */
  door(open) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.Q.value = 0.8;
    f.frequency.setValueAtTime(open ? 2400 : 1800, t);
    f.frequency.exponentialRampToValueAtTime(open ? 700 : 500, t + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 1.1);
    if (!open) for (let i = 0; i < 3; i++) this.tone(1450, 0.12, { type: "square", gain: 0.05, at: i * 0.22, decay: false });
  }

  /** El validador de la bip! al pasar la tarjeta. */
  validate(ok = true) {
    if (ok) this.tone(1950, 0.09, { type: "square", gain: 0.05, decay: false });
    else { this.tone(420, 0.25, { type: "square", gain: 0.05, decay: false }); }
  }

  /** Timbre de parada solicitada. */
  bell() {
    this.tone(1318, 0.9, { gain: 0.22 });
    this.tone(2637, 0.5, { gain: 0.05 });
  }

  blinker() {
    for (let i = 0; i < 4; i++) this.tone(i % 2 ? 2400 : 1900, 0.03, { type: "square", gain: 0.03, at: i * 0.38, decay: false });
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.8);
    this.tone(90, 0.4, { type: "sawtooth", gain: 0.3 });
  }

  /** Sonido corto de pago (sueldo del paradero). */
  coin() {
    this.tone(1568, 0.12, { type: "triangle", gain: 0.12 });
    this.tone(2093, 0.25, { type: "triangle", gain: 0.12, at: 0.09 });
  }

  /** Falta (multa de puntos). */
  fault() {
    this.tone(330, 0.18, { type: "sawtooth", gain: 0.08 });
    this.tone(247, 0.3, { type: "sawtooth", gain: 0.08, at: 0.16 });
  }

  stop() {
    try { this.ctx?.close(); } catch { /* ya cerrado */ }
    this.ctx = null;
  }
}
