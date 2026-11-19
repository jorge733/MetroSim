/* ==========================================================================
   RedMoviSim — keys.js
   2.20.1 · Textos que nombran teclas. En el celular o la tablet no hay
   teclado: ahí no se dice «pulsa E», se nombra el botón táctil que hace lo
   mismo (o no se dice nada). No usa Three.js: lo importan también la intro y
   el motor.
   ========================================================================== */

let touch = null;

/** ¿Se juega con los controles táctiles? (pantalla táctil, o ?touch=1 / ?touch=0 para forzarlo) */
export function wantsTouch() {
  if (touch !== null) return touch;
  if (typeof window === "undefined") return false;
  const forced = new URLSearchParams(location.search).get("touch");
  touch = forced === "1" ? true : forced === "0" ? false : matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  return touch;
}

/** El texto para teclado (`pc`) o, en pantallas táctiles, el de los botones (`touch`, vacío si no hay). */
export const key = (pc, touch = "") => (wantsTouch() ? touch : pc);
