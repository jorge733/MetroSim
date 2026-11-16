/* ==========================================================================
   RedMoviSim — 2.5 · trip.js
   Tarifa integrada de Santiago (bip!): un viaje puede tener hasta 3 etapas
   (2 transbordos) dentro de 120 minutos desde el primer bip!, y en cada
   transbordo solo se paga la DIFERENCIA si la etapa nueva cuesta más que lo
   ya pagado (p. ej. bus $795 → Metro en punta $895: se cobran $100).

   Reglas (DTPM / red.cl):
     · Una sola etapa en Metro y una en Tren Nos por viaje: si sales del Metro
       y vuelves a entrar, es un viaje nuevo (las combinaciones entre líneas
       dentro de la zona pagada no cuentan como etapa).
     · No se puede repetir un recorrido de bus en el mismo viaje.
     · El Tren Rancagua (EFE) no está integrado: siempre es un pasaje aparte.
     · El pago con tarjeta bancaria (sin contacto) no está integrado con la bip!.

   Sin DOM: se prueba en Node (`node tools/probar-tarifa.mjs`).
   ========================================================================== */

export const TRIP_WINDOW_MS = 120 * 60 * 1000;
export const TRIP_MAX_STAGES = 3;

/** Modo tarifario de una línea del juego: "metro", "nos" o "ran" (sin integrar). */
export const fareModeOfLine = (lineId) => (lineId === "NOS" ? "nos" : lineId === "RAN" ? "ran" : "metro");

const MODE_NAME = { metro: "el Metro", nos: "el Tren Nos", bus: "el bus" };

/**
 * ¿Cuánto se cobra por esta etapa?
 * @param {object|null} trip  viaje en curso { at, paid, stages: [{ mode, route }] }
 * @param {{ mode: string, route?: string, price: number, now: number }} stage
 * @returns {{ transfer: boolean, charge: number, why?: string, from?: string }}
 *   why explica por qué NO fue transbordo cuando había un viaje vigente.
 */
export function quoteStage(trip, { mode, route = null, price, now }) {
  const full = (why) => ({ transfer: false, charge: price, why });
  if (mode === "ran") return full(trip && live(trip, now) ? "El Tren Rancagua no tiene tarifa integrada con la bip!" : undefined);
  if (!trip || !live(trip, now)) return full();
  if (trip.stages.length >= TRIP_MAX_STAGES) return full("ya hiciste los 2 transbordos de tu viaje");
  if (mode !== "bus" && trip.stages.some(s => s.mode === mode)) return full(`ya usaste ${MODE_NAME[mode]} en este viaje`);
  if (mode === "bus" && route && trip.stages.some(s => s.mode === "bus" && s.route === route)) return full(`no se puede repetir el recorrido ${route}`);
  const last = trip.stages.at(-1);
  return { transfer: true, charge: Math.max(0, price - trip.paid), from: MODE_NAME[last?.mode] || "" };
}

/** El viaje después de pagar la etapa (o null si no queda viaje integrado). */
export function commitStage(trip, quote, { mode, route = null, price, now }) {
  if (mode === "ran") return trip && live(trip, now) ? trip : null;
  if (!quote.transfer) return { at: now, paid: price, stages: [{ mode, route }] };
  return { at: trip.at, paid: Math.max(trip.paid, price), stages: [...trip.stages, { mode, route }] };
}

/** ¿Sigue vigente el viaje (dentro de los 120 minutos)? */
export function live(trip, now) {
  return !!trip && now - trip.at >= 0 && now - trip.at < TRIP_WINDOW_MS;
}

/** Minutos que le quedan al viaje para transbordar (0 si venció). */
export const minutesLeft = (trip, now) => (live(trip, now) ? Math.ceil((TRIP_WINDOW_MS - (now - trip.at)) / 60000) : 0);

/* ---------- Guardado (el viaje sigue aunque cambies de modo de juego o recargues) ---------- */
const KEY = "metrosim.trip";
export function loadTrip() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function saveTrip(trip) {
  try { trip ? localStorage.setItem(KEY, JSON.stringify(trip)) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

/* ---------- Medio de pago en el torniquete: bip! o tarjeta bancaria (Pago Ágil, desde el 13-02-2026) ---------- */
const PAY_KEY = "metrosim.payWith";
export function payWith() {
  try { return localStorage.getItem(PAY_KEY) === "banco" ? "banco" : "bip"; } catch { return "bip"; }
}
export function setPayWith(v) {
  try { localStorage.setItem(PAY_KEY, v === "banco" ? "banco" : "bip"); } catch { /* sin almacenamiento */ }
}
