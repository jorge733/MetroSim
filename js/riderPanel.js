/* ==========================================================================
   MetroSim — 1.10 · riderPanel.js
   Ventana «Tu tarifa»: fecha de nacimiento y si es estudiante con TNE.
   Sale sola la primera vez que se empieza a jugar; después se abre desde el
   panel de tarifas (tocando la hora) o desde la boletería.
   ========================================================================== */

import { FARES, formatCLP } from "./config.js";
import { riderProfile, setRider, ageOf, categoryOf, riderSpecial, SENIOR_AGE, SENIOR_AGE_TAM_WOMEN } from "./rider.js";

const $ = (id) => document.getElementById(id);
let onDone = null;

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
      ? `Con ${age} años tienes tarjeta TAM de adulto mayor`
      : "Con tu TNE de estudiante";
    return { cls: "ok", text: `${why}: pagas ${formatCLP(special.price)} por viaje, a cualquier hora y todos los días (la tarifa general es de ${range}).` };
  }
  if (age == null) return { cls: "", text: `Si no lo indicas, pagas la tarifa general: ${range}.` };
  return { cls: "", text: `Con ${age} años pagas la tarifa general: ${range}.` };
}

function read() {
  // Las casillas ocultas no cuentan (p. ej. «estudiante» marcada antes de poner una edad de adulto mayor)
  const on = (id) => $(id).checked && !$(`${id}Row`).classList.contains("hidden");
  return { birth: $("riderBirth").value, student: on("riderStudent"), woman60: on("riderWoman60") };
}

function refresh() {
  const p = read(), age = ageOf(p.birth);
  const senior = age != null && age >= SENIOR_AGE;
  // TAM desde los 60 para las mujeres: la casilla solo tiene sentido entre los 60 y los 64
  $("riderWoman60Row").classList.toggle("hidden", !(age != null && age >= SENIOR_AGE_TAM_WOMEN && !senior));
  $("riderStudentRow").classList.toggle("hidden", senior);
  const pv = preview(p), el = $("riderPreview");
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
  $("riderWoman60").checked = !!p.woman60;
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
  ["riderBirth", "riderStudent", "riderWoman60"].forEach(id => $(id).addEventListener("input", refresh));
  $("riderStudent").addEventListener("change", refresh);
  $("riderWoman60").addEventListener("change", refresh);
  $("riderSave").addEventListener("click", () => close(true));
  $("riderSkip").addEventListener("click", () => close(false));
  $("riderPanel").addEventListener("keydown", (ev) => {
    ev.stopPropagation();                                 // que las teclas no muevan al pasajero
    if (ev.key === "Escape") close(false);
    else if (ev.key === "Enter" && !$("riderSave").disabled) close(true);
  });
}
