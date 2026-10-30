/* ==========================================================================
   MetroSim — civics.js
   Civismo del modo Pasajero: puntos por ayudar a los demás viajeros
   (encounters.js: ceder el asiento, orientar a un turista, entregar un
   objeto olvidado, avisar por el citófono…).

   Los puntos suben de nivel (Buen vecino, Pasajero ejemplar, Orgullo del
   Metro) y cada nivel nuevo trae un premio. También guarda el objeto
   olvidado que llevas para entregarlo en una boletería, aunque cambies de
   línea o cierres el juego.

   Se guarda en localStorage ("metrosim.civismo"); sin almacenamiento
   funciona en memoria. Sin Three.js.
   ========================================================================== */

const KEY = "metrosim.civismo";

export const CIVIC_LEVELS = [
  { min: 0, name: "Pasajero", reward: 0 },
  { min: 25, name: "Buen vecino", reward: 3000 },
  { min: 70, name: "Pasajero ejemplar", reward: 8000 },
  { min: 150, name: "Orgullo del Metro", reward: 20000 },
];

export class Civics {
  constructor() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { s = null; }
    this.points = s?.points ?? 0;
    this.counts = s?.counts ?? {};        // ayudas por tipo (seat, tourist, lost, faint…)
    this.rewarded = s?.rewarded ?? 0;      // nivel más alto ya premiado
    this.carrying = s?.carrying ?? null;   // objeto olvidado que llevas: { name, reward }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ points: this.points, counts: this.counts, rewarded: this.rewarded, carrying: this.carrying })); }
    catch { /* sin almacenamiento */ }
  }

  get levelIndex() {
    let i = 0;
    CIVIC_LEVELS.forEach((l, k) => { if (this.points >= l.min) i = k; });
    return i;
  }
  get level() { return CIVIC_LEVELS[this.levelIndex]; }
  get next() { return CIVIC_LEVELS[this.levelIndex + 1] || null; }

  /** Texto corto: "Buen vecino · 31 pts (faltan 39 para Pasajero ejemplar)". */
  get label() {
    const n = this.next;
    return `${this.level.name} · ${this.points} pts${n ? ` (faltan ${n.min - this.points} para ${n.name})` : ""}`;
  }

  /**
   * Suma (o resta) puntos.
   * @returns {{ delta, levelUp: object|null }}  levelUp: el nivel nuevo, si trae premio que aún no se pagó
   */
  add(delta, kind = null) {
    this.points = Math.max(0, this.points + delta);
    if (kind && delta > 0) this.counts[kind] = (this.counts[kind] || 0) + 1;
    let levelUp = null;
    const i = this.levelIndex;
    if (i > this.rewarded) { this.rewarded = i; levelUp = CIVIC_LEVELS[i]; }
    this.save();
    return { delta, levelUp };
  }

  setCarrying(item) { this.carrying = item; this.save(); }
}
