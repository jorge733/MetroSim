/* ==========================================================================
   MetroSim — 2.8 · bus/taxiRadio.js
   La radio del taxi: emisoras reales de Santiago EN VIVO, por internet.

   Cada emisora suena desde la transmisión pública que la propia radio
   ofrece en su sitio (el juego no guarda ni retransmite nada: el
   navegador la toca directo desde su servidor, con un <audio>). Por eso
   necesita internet; sin conexión la radio queda «sin señal».

   Las direcciones son HTTPS (el juego se sirve por HTTPS y el navegador no
   deja tocar audio por HTTP). Si una radio cambia su transmisión, basta
   corregir su `url` aquí (radio-browser.info sirve para buscar la nueva).

   Recuerda en este dispositivo si estaba encendida, la emisora y el volumen.
   ========================================================================== */

const STW = "https://playerservices.streamtheworld.com/api/livestream-redirect/";
const MDS = "https://mdstrm.com/audio/";

/** Emisoras de Santiago, de izquierda a derecha en el dial. */
export const RADIO_STATIONS = [
  { fm: "88.1", name: "Imagina", genre: "Románticas", url: STW + "IMAGINA_SC" },
  { fm: "88.5", name: "Concierto", genre: "Clásicos del pop y rock", url: STW + "CONCIERTO_SC" },
  { fm: "88.9", name: "Futuro", genre: "Rock", url: STW + "FUTURO_SC" },
  { fm: "90.5", name: "Pudahuel", genre: "Música en español", url: STW + "PUDAHUEL_SC" },
  { fm: "91.7", name: "ADN", genre: "Noticias y deportes", url: STW + "ADN_SC" },
  { fm: "93.3", name: "Cooperativa", genre: "Noticias", url: "https://unlimited3-cl.dps.live/cooperativafm/mp3/icecast.audio" },
  { fm: "94.1", name: "Rock & Pop", genre: "Rock y pop", url: STW + "ROCK_AND_POP_SC" },
  { fm: "96.5", name: "Beethoven", genre: "Música clásica", url: "https://unlimited4-us.dps.live/beethovenfm/aac/icecast.audio" },
  { fm: "98.5", name: "FM Dos", genre: "Románticas", url: STW + "FMDOS_SC" },
  { fm: "99.7", name: "Bío-Bío", genre: "Noticias", url: "https://unlimited3-cl.dps.live/biobiosantiago/mp3/icecast.audio" },
  { fm: "100.9", name: "Play FM", genre: "Pop", url: MDS + "5c8d6406f98fbf269f57c82c/icecast.audio" },
  { fm: "101.3", name: "Corazón", genre: "Tropical y cumbia", url: STW + "CORAZON_SC" },
  { fm: "101.7", name: "Los 40", genre: "Éxitos", url: STW + "LOS40_CHILE_SC" },
  { fm: "105.3", name: "Sonar", genre: "Rock", url: MDS + "5c915724519bce27671c4d15/icecast.audio" },
];

const KEY = "metrosim.taxiRadio";
const NO_SIGNAL_MS = 20000;      // si en este tiempo no empieza a sonar, «sin señal»

export class TaxiRadio {
  /**
   * @param {{onChange?:(r:TaxiRadio)=>void, onTune?:()=>void, onError?:(st:object)=>void}} o
   *   onChange: cada vez que cambia algo que se muestra · onTune: al cambiar de emisora (ruido de sintonía)
   *   onError: no se pudo sintonizar la emisora
   */
  constructor({ onChange, onTune, onError } = {}) {
    this.onChange = onChange;
    this.onTune = onTune;
    this.onError = onError;
    this.on = false;
    this.index = 5;              // Cooperativa
    this.volume = 0.7;
    this.muted = false;
    this.status = "off";         // off · tuning · playing · nosignal
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s) {
        if (Number.isInteger(s.index) && RADIO_STATIONS[s.index]) this.index = s.index;
        if (typeof s.volume === "number") this.volume = Math.max(0, Math.min(1, s.volume));
        this.wasOn = !!s.on;
      }
    } catch { /* sin almacenamiento: valores de siempre */ }

    const a = this.el = new Audio();
    a.preload = "none";
    a.addEventListener("playing", () => this.setStatus("playing"));
    a.addEventListener("waiting", () => { if (this.on) this.setStatus("tuning"); });
    a.addEventListener("error", () => this.fail());
  }

  get station() { return RADIO_STATIONS[this.index]; }

  /** Al subir al taxi: si la dejaste encendida, sigue sonando. */
  resume() { if (this.wasOn) this.power(true); }

  power(on = !this.on) {
    this.on = on;
    if (on) this.tune(this.index);
    else this.halt("off");
    this.save();
  }

  next(step = 1) {
    const n = RADIO_STATIONS.length;
    this.index = (this.index + step + n) % n;
    if (this.on) this.tune(this.index);
    else this.power(true);
    this.save();
    this.onChange?.(this);
  }

  select(i) {
    if (!RADIO_STATIONS[i]) return;
    this.index = i;
    this.on = true;
    this.tune(i);
    this.save();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.el.volume = this.volume;
    this.save();
    this.onChange?.(this);
  }

  /** El sonido del juego (M o el parlante) también silencia la radio. */
  setMuted(m) {
    this.muted = m;
    this.el.muted = m;
  }

  tune(i) {
    const a = this.el;
    clearTimeout(this.timer);
    this.onTune?.();
    this.setStatus("tuning");
    a.src = RADIO_STATIONS[i].url;
    a.volume = this.volume;
    a.muted = this.muted;
    const p = a.play();
    p?.catch?.((err) => {
      // Sin un toque del jugador el navegador no deja sonar: queda lista para el próximo toque
      if (err?.name === "NotAllowedError") { this.on = false; this.halt("off"); }
      else if (err?.name !== "AbortError") this.fail();
    });
    this.timer = setTimeout(() => { if (this.on && this.status === "tuning") this.fail(); }, NO_SIGNAL_MS);
  }

  fail() {
    if (!this.on) return;
    clearTimeout(this.timer);
    this.el.removeAttribute("src");
    this.el.load();
    this.setStatus("nosignal");
    this.onError?.(this.station);
  }

  halt(status) {
    clearTimeout(this.timer);
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();                 // corta la descarga de la transmisión
    this.setStatus(status);
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.onChange?.(this);
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, index: this.index, volume: this.volume })); } catch { /* sin almacenamiento */ }
  }

  /** Al bajarse del taxi: se apaga sin olvidar si estaba encendida. */
  destroy() {
    this.onChange = this.onTune = this.onError = null;
    this.halt("off");
  }
}
