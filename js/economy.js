/* ==========================================================================
   MetroSim — Alpha 0.9 · economy.js
   Economía del jugador: cuenta bancaria con tarjeta de débito, sueldo del
   Conductor y compras del Pasajero.

   Ciclo de juego:
     · En el modo CONDUCTOR cada estación bien servida paga al instante un
       sueldo que se deposita en la cuenta (más un bono al terminar el
       servicio). Las faltas desde la estación anterior se descuentan de ese
       pago: "cobras menos", nunca quedas debiendo.
     · En el modo PASAJERO la tarjeta de débito paga la tarjeta bip!, sus
       cargas y las compras en los locales de la calle (pan, almuerzo...).

   Módulo sin Three.js. La cuenta se guarda en el navegador (localStorage) y
   se comparte entre los dos modos; sin almacenamiento funciona en memoria.
   ========================================================================== */

import { formatCLP } from "./config.js";
import { isCreator } from "./creator.js";

const KEY = "metrosim.bank";

/** Banco ficticio del juego. */
export const BANK_NAME = "Banco Andino";
/** Dinero con el que empieza un jugador nuevo (alcanza para la bip! y una carga). */
export const START_BALANCE = 3000;

/** Sueldo del conductor (pesos). */
export const WAGE = {
  base: 800,                 // por cada estación servida
  perPoint: 2.5,             // por cada punto ganado en la estación
  perfect: 600,              // estación perfecta (parada, horario y confort)
  deduction: 1.0,            // pesos descontados por cada punto de falta desde la estación anterior
  shift: { S: 20000, A: 12500, B: 7500, C: 4000, D: 1500 },   // bono al completar el servicio, según la nota
};

const round10 = (n) => Math.max(0, Math.round(n / 10) * 10);

/**
 * Pago de una estación servida.
 * @param {{gained:number, perfect:boolean, deductions:number, mult?:number}} s
 *   gained: puntos de la estación · deductions: puntos de falta desde la anterior
 *   mult: multiplicador del contrato comprado en la Tienda Metro (shop.js)
 * @returns {{pay:number, gross:number, discount:number}}
 */
export function stationWage({ gained, perfect, deductions = 0, mult = 1 }) {
  const gross = round10((WAGE.base + gained * WAGE.perPoint + (perfect ? WAGE.perfect : 0)) * mult);
  const discount = Math.min(gross, round10(deductions * WAGE.deduction));
  return { pay: gross - discount, gross, discount };
}

/** Bono al terminar el servicio según la nota (S..D). */
export function shiftBonus(grade, mult = 1) { return round10((WAGE.shift[grade] ?? 0) * mult); }

export class BankAccount {
  constructor() {
    const s = this.read();
    this.balance = s?.balance ?? START_BALANCE;
    this.number = s?.number ?? BankAccount.newNumber();
    this.history = s?.history ?? [];       // últimos movimientos [{ amount, concept, date }]
    this.earned = s?.earned ?? 0;          // total ganado como conductor
    this.bag = s?.bag ?? [];               // compras hechas en la calle (las últimas)
  }

  static newNumber() {
    let n = "";
    for (let i = 0; i < 16; i++) n += Math.floor(Math.random() * 10);
    return n;
  }

  read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ balance: this.balance, number: this.number, history: this.history, earned: this.earned, bag: this.bag }));
    } catch { /* sin almacenamiento: la cuenta vive solo en esta partida */ }
  }

  get label() { return formatCLP(this.balance); }
  get maskedNumber() { return `•••• ${this.number.slice(-4)}`; }

  record(amount, concept) {
    const d = new Date(), two = (n) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;   // hora local
    this.history.unshift({ amount, concept, date });
    this.history.length = Math.min(this.history.length, 30);
  }

  /** Abono (sueldo, recompensa de misión...). */
  deposit(amount, concept, { wage = false } = {}) {
    amount = Math.round(amount);
    if (amount <= 0) return 0;
    this.balance += amount;
    if (wage) this.earned += amount;
    this.record(amount, concept);
    this.save();
    return amount;
  }

  canPay(amount) { return isCreator() || this.balance >= amount; }

  /** Cargo con la tarjeta de débito. Devuelve { ok, reason }. */
  charge(amount, concept) {
    amount = Math.round(amount);
    if (!this.canPay(amount)) return { ok: false, reason: "funds" };
    if (isCreator()) {                      // Modo Creador: queda registrado pero no se descuenta
      this.record(0, `${concept} · gratis (creador)`);
      this.save();
      return { ok: true };
    }
    this.balance -= amount;
    this.record(-amount, concept);
    this.save();
    return { ok: true };
  }

  /** Guarda una compra en la bolsa (se conservan las 20 últimas). */
  addToBag(item) {
    this.bag.unshift(item);
    this.bag.length = Math.min(this.bag.length, 20);
    this.save();
  }
}
