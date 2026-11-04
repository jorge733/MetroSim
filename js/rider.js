/* ==========================================================================
   MetroSim — 1.10 · rider.js
   Perfil del pasajero para las tarifas rebajadas de Metro.

   · La primera vez que se juega, el jugador puede poner su fecha de nacimiento
     (y si es estudiante con TNE). Se guarda solo en este dispositivo
     (localStorage). Se puede cambiar cuando quiera desde el panel de tarifas.
   · Tarifas (config.js → FARES.special), iguales a cualquier hora y día:
       - Adulto mayor (TAM): personas pensionadas, mujeres desde los 60 años y
         hombres desde los 65. Desde los 60 el jugador marca si tiene TAM (a los
         65 viene marcada).
       - Estudiante (TNE): estudiantes de básica, media o superior.
     Si no tiene ninguna, paga la tarifa general por tramo horario.
   ========================================================================== */

import { FARES, fareBandAt, CONFIG } from "./config.js";

const KEY = "metrosim.rider";
export const TAM_MIN_AGE = 60, TAM_DEFAULT_AGE = 65;

let profile = read();

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}

/** ¿Ya se le preguntó al jugador (aunque haya dicho «Ahora no»)? */
export const riderAsked = () => !!profile;
export const riderProfile = () => profile;

/**
 * Guarda el perfil.
 * @param {{birth?: string, student?: boolean, tam?: boolean, skipped?: boolean}} p  birth = "AAAA-MM-DD"
 */
export function setRider(p) {
  profile = { birth: p.birth || "", student: !!p.student, tam: !!p.tam, skipped: !!p.skipped };
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* sin almacenamiento: vale para esta sesión */ }
}

/** Edad cumplida en una fecha (por defecto, hoy) a partir de "AAAA-MM-DD"; null si no es válida. */
export function ageOf(birth, on = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || "");
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const born = new Date(y, mo - 1, d);
  if (born.getMonth() !== mo - 1 || born > on || y < 1900) return null;
  let age = on.getFullYear() - y;
  if (on.getMonth() < mo - 1 || (on.getMonth() === mo - 1 && on.getDate() < d)) age--;
  return age;
}

/** Categoría tarifaria de un perfil: "mayor", "estudiante" o "general". */
export function categoryOf(p = profile) {
  if (!p || p.skipped) return "general";
  const age = ageOf(p.birth);
  // (los perfiles de la 1.10 guardaban woman60 y daban la TAM sola a los 65)
  const tam = p.tam ?? p.woman60 ?? (age != null && age >= TAM_DEFAULT_AGE);
  if (age != null && age >= TAM_MIN_AGE && tam) return "mayor";
  if (p.student) return "estudiante";
  return "general";
}

export const riderCategory = () => categoryOf();
/** Tarifa rebajada del jugador (o null si paga la general). */
export const riderSpecial = (p = profile) => FARES.special[categoryOf(p)] || null;

/**
 * Lo que paga el jugador al pasar el torniquete a esta hora: su tarifa rebajada
 * o el tramo general vigente. Devuelve un objeto con { id, label, price }.
 */
export function riderFare(clockSeconds, dayType = CONFIG.dayType) {
  return riderSpecial() || fareBandAt(clockSeconds, dayType);
}
