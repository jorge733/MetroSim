/* ==========================================================================
   MetroSim — Alpha 0.6 · card.js
   Tarjeta bip! del jugador: saldo, cobro de pasajes y cargas.

   · El saldo se guarda en el navegador (localStorage) y se conserva entre
     partidas. Si el navegador no permite guardar, funciona igual en memoria.
   · El pasaje se cobra al cruzar un torniquete según el tramo horario
     (config.js → FARES). Las combinaciones dentro de la red no se cobran
     de nuevo porque no hay que volver a pasar por torniquetes.
   ========================================================================== */

import { FARES, formatCLP } from "./config.js";

const KEY = "metrosim.bip";

export class BipCard {
  constructor() {
    const saved = this.read();
    this.hasCard = saved?.hasCard ?? true;
    this.balance = saved?.balance ?? FARES.startBalance;
    this.number = saved?.number ?? BipCard.newNumber();
    this.trips = saved?.trips ?? 0;
  }

  static newNumber() {
    let n = "";
    for (let i = 0; i < 10; i++) n += Math.floor(Math.random() * 10);
    return n;
  }

  read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ hasCard: this.hasCard, balance: this.balance, number: this.number, trips: this.trips }));
    } catch { /* sin almacenamiento: el saldo vive solo en esta partida */ }
  }

  get label() { return this.hasCard ? formatCLP(this.balance) : "sin tarjeta"; }
  get maskedNumber() { return `•••• ${this.number.slice(-4)}`; }

  /** Cobra un pasaje. Devuelve { ok, reason }. */
  pay(fare) {
    if (!this.hasCard) return { ok: false, reason: "nocard" };
    if (this.balance < fare) return { ok: false, reason: "balance" };
    this.balance -= fare;
    this.trips++;
    this.save();
    return { ok: true };
  }

  /** Carga saldo (respetando el máximo permitido). Devuelve el importe realmente cargado. */
  load(amount) {
    const room = FARES.maxBalance - this.balance;
    const loaded = Math.max(0, Math.min(amount, room));
    this.balance += loaded;
    this.save();
    return loaded;
  }

  /** Compra de una tarjeta nueva en boletería (sale sin saldo). */
  buyNew() {
    this.hasCard = true;
    this.balance = 0;
    this.number = BipCard.newNumber();
    this.save();
  }
}
