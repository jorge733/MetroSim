/* ==========================================================================
   MetroSim — 1.10 · riderPanel.js
   Ventana «Tu tarifa»: fecha de nacimiento y si es estudiante con TNE.
   Sale sola la primera vez que se empieza a jugar; después se abre desde el
   panel de tarifas (tocando la hora) o desde la boletería.
   ========================================================================== */

import { FARES, formatCLP } from "./config.js";
import { riderProfile, setRider, ageOf, categoryOf, riderSpecial, TAM_MIN_AGE, TAM_DEFAULT_AGE } from "./rider.js";

const $ = (id) => document.getElementById(id);
let onDone = null;
let tamTouched = false;                   // si el jugador tocó la casilla TAM, ya no se marca sola al cambiar la fecha

export const riderPanelOpen = () => !!onDone;

/** Lo que se le muestra al jugador según el perfil que está escribiendo. */
function preview(p) {
  const age = ageOf(p.birth);
  const special = riderSpecial(p);
  const general = FARES.bands.map(b => b.price);
  const range = `${formatCLP(Math.min(...general))} a ${formatCLP(Math.max(...general))} según el horario`;
  if (p.birth && age == null) return { cls: "error", text: "Esa fecha no es válida." };
  if (special) {
    const why = categoryOf(p) === "mayor"
      ? "Con tu tarjeta TAM de adulto mayor"
      : "Con tu TNE de estudiante";
    return { cls: "ok", text: `${why}: pagas ${formatCLP(special.price)} por viaje, a cualquier hora y todos los días (la tarifa general es de ${range}).` };
  }
  if (age == null) return { cls: "", text: `Si no lo indicas, pagas la tarifa general: ${range}.` };
  return { cls: "", text: `Con ${age} años pagas la tarifa general: ${range}.` };
}

function read() {
  // Las casillas ocultas no cuentan (p. ej. «estudiante» marcada antes de poner una edad de adulto mayor)
  const on = (id) => $(id).checked && !$(`${id}Row`).classList.contains("hidden");
  return { birth: $("riderBirth").value, student: on("riderStudent"), tam: on("riderTam") };
}

function refresh() {
  const age = ageOf($("riderBirth").value);
  // TAM: desde los 60 se puede tener (mujeres desde 60, hombres desde 65); a los 65 viene marcada
  const canTam = age != null && age >= TAM_MIN_AGE;
  if (canTam && !tamTouched) $("riderTam").checked = age >= TAM_DEFAULT_AGE;
  $("riderTamRow").classList.toggle("hidden", !canTam);
  $("riderStudentRow").classList.toggle("hidden", canTam && $("riderTam").checked);
  const pv = preview(read()), el = $("riderPreview");     // se vuelve a leer: las casillas acaban de cambiar
  el.className = `ticket-status ${pv.cls}`;
  el.textContent = pv.text;
  $("riderSave").disabled = pv.cls === "error";
}

/**
 * Abre la ventana.
 * @param {object} [o]
 * @param {boolean} [o.first]  primera vez: se explica para qué es y el botón secundario dice «Ahora no»
 * @param {() => void} [o.done]  se llama al cerrar (guardando o no)
 */
export function openRiderPanel({ first = false, done } = {}) {
  const p = riderProfile() || {};
  $("riderKicker").textContent = first ? "ANTES DE TU PRIMER VIAJE" : "TU TARIFA";
  $("riderSkip").textContent = first ? "Ahora no" : "Cancelar";
  $("riderBirth").max = new Date().toISOString().slice(0, 10);
  $("riderBirth").value = p.skipped ? "" : (p.birth || "");
  $("riderStudent").checked = !!p.student;
  const age = ageOf(p.birth);
  $("riderTam").checked = !!(p.tam ?? p.woman60 ?? (age != null && age >= TAM_DEFAULT_AGE));
  tamTouched = p.tam != null || p.woman60 != null;
  onDone = { done, first };
  refresh();
  $("riderPanel").classList.remove("hidden");
  setTimeout(() => $("riderBirth").focus(), 50);
}

function close(save) {
  if (!onDone) return;
  const { done, first } = onDone;
  onDone = null;
  if (save) setRider(read());
  else if (first) setRider({ skipped: true });          // no se vuelve a preguntar sola; se puede cambiar desde las tarifas
  $("riderPanel").classList.add("hidden");
  done?.();
}

export const closeRiderPanel = () => close(false);

export function setupRiderPanel() {
  $("riderBirth").addEventListener("input", refresh);
  $("riderStudent").addEventListener("change", refresh);
  $("riderTam").addEventListener("change", () => { tamTouched = true; refresh(); });
  $("riderSave").addEventListener("click", () => close(true));
  $("riderSkip").addEventListener("click", () => close(false));
  $("riderPanel").addEventListener("keydown", (ev) => {
    ev.stopPropagation();                                 // que las teclas no muevan al pasajero
    if (ev.key === "Escape") close(false);
    else if (ev.key === "Enter" && !$("riderSave").disabled) close(true);
  });
}
