/* ==========================================================================
   MetroSim — 1.9 · fareInfo.js
   Panel «Tarifas según el horario»: se abre al tocar la hora (en la portada y
   en el HUD de la partida). Muestra, para cada tipo de día, la franja de
   servicio pintada por tramo tarifario, la lista de horarios con su precio y
   cuánto falta para el próximo cambio. Todo sale de config.js (FARES,
   SERVICE_HOURS, fareBandAt), así que si cambian las tarifas el panel las sigue.
   ========================================================================== */

import { FARES, SERVICE_HOURS, DAY_TYPE_LABEL, fareBandAt, inService, formatCLP } from "./config.js";

const DAYS = ["laboral", "sabado", "domingo"];
const DAY_TAB = { laboral: "Lun a vie", sabado: "Sábado", domingo: "Dom y festivos" };
const STEP = 5 / 60;                      // resolución (h) con la que se recorre el día: todos los cortes son múltiplos de 5 min

const $ = (id) => document.getElementById(id);

/** "HH:MM" de una hora decimal. */
function hhmm(h) {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Tramos seguidos de un tipo de día dentro de su horario: [{ from, to, band }]. */
export function daySegments(day) {
  const [open, close] = SERVICE_HOURS[day];
  const out = [];
  for (let h = open; h < close - 1e-9; h += STEP) {
    const band = fareBandAt(h * 3600 + 1, day);
    const last = out.at(-1);
    if (last && last.band === band) last.to = Math.min(close, h + STEP);
    else out.push({ from: h, to: Math.min(close, h + STEP), band });
  }
  return out;
}

/** "1 h 20 min" / "35 min". */
function span(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

let state = null;                         // { clock, today, shown, onClose }

export const fareInfoOpen = () => !!state;

/**
 * Abre el panel.
 * @param {object} o
 * @param {number} o.clock     hora vigente en segundos desde medianoche
 * @param {string} o.dayType   "laboral" | "sabado" | "domingo"
 * @param {Function} [o.onClose]
 */
export function openFareInfo({ clock, dayType, onClose }) {
  const panel = $("fareInfoPanel");
  if (!panel) return;
  state = { clock, today: dayType, shown: dayType, onClose };
  render();
  panel.classList.remove("hidden");
  $("fareInfoClose").focus();
}

export function closeFareInfo() {
  if (!state) return;
  const { onClose } = state;
  state = null;
  $("fareInfoPanel").classList.add("hidden");
  onClose?.();
}

/** Actualiza la hora mientras el panel está abierto (la partida sigue andando). */
export function tickFareInfo(clock) {
  if (!state) return;
  const before = Math.floor(state.clock / 60);
  state.clock = clock;
  if (Math.floor(clock / 60) !== before) render();
}

function render() {
  const { clock, today, shown } = state;
  const h = (((clock / 3600) % 24) + 24) % 24;
  const isToday = shown === today;
  const open = inService(clock, today);
  const band = fareBandAt(clock, today);

  // Cabecera: la hora y lo que se cobra ahora
  $("fareInfoTime").textContent = hhmm(h);
  const chip = $("fareInfoBand");
  chip.className = `clock-band ${open ? band.id : "closed"}`;
  $("fareInfoBandLabel").textContent = open ? band.label : "Metro cerrado";
  $("fareInfoBandPrice").textContent = formatCLP(band.price);

  let next = "";
  if (open) {
    for (let m = 1; m <= 24 * 60; m++) {
      const u = clock - (clock % 60) + m * 60;
      if (!inService(u, today)) { next = `Cierra a las ${hhmm(u / 3600)} (en ${span(m)})`; break; }
      const b = fareBandAt(u, today);
      if (b !== band) {
        const diff = b.price - band.price;
        next = `A las ${hhmm(u / 3600)} (en ${span(m)}) pasa a ${b.label.toLowerCase()}: ${formatCLP(b.price)}, ${diff > 0 ? `${formatCLP(diff)} más` : `${formatCLP(-diff)} menos`}`;
        break;
      }
    }
  } else {
    next = `Fuera de horario. Si juegas igual, se cobra ${band.label.toLowerCase()}.`;
  }
  $("fareInfoNext").textContent = `${DAY_TYPE_LABEL[today]} · ${next}`;

  // Pestañas de tipo de día
  $("fareInfoDays").replaceChildren(...DAYS.map(d => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(d === shown));
    b.className = d === shown ? "selected" : "";
    b.textContent = DAY_TAB[d] + (d === today ? " · hoy" : "");
    b.addEventListener("click", () => { state.shown = d; render(); });
    return b;
  }));

  // Franja del día: cada tramo con su ancho proporcional y la marca de "ahora"
  const segs = daySegments(shown);
  const [o, c] = SERVICE_HOURS[shown];
  const bar = $("fareInfoBar");
  const pieces = segs.map(s => {
    const el = document.createElement("span");
    el.className = `fare-bar-seg ${s.band.id}`;
    el.style.flexGrow = String(s.to - s.from);
    el.title = `${hhmm(s.from)}–${hhmm(s.to)} · ${s.band.label} ${formatCLP(s.band.price)}`;
    return el;
  });
  if (isToday && open) {
    const mark = document.createElement("i");
    mark.className = "fare-bar-now";
    mark.style.left = `${((h - o) / (c - o)) * 100}%`;
    pieces.push(mark);
  }
  bar.replaceChildren(...pieces);
  $("fareInfoBarFrom").textContent = hhmm(o);
  $("fareInfoBarTo").textContent = hhmm(c);

  // Lista de horarios del día elegido
  $("fareInfoList").replaceChildren(...segs.map(s => {
    const row = document.createElement("div");
    const now = isToday && open && h >= s.from && h < s.to;
    row.className = `fare-row fare-slot ${s.band.id}${now ? " current" : ""}`;
    const label = document.createElement("span");
    label.innerHTML = `<i></i><span class="fare-slot-time">${hhmm(s.from)} – ${hhmm(s.to)}</span> ${s.band.label}${now ? " <em>ahora</em>" : ""}`;
    const price = document.createElement("b");
    price.textContent = formatCLP(s.band.price);
    row.append(label, price);
    return row;
  }));

  // Resumen de precios por tramo (con cuánto se ahorra frente a la punta)
  const punta = FARES.bands.find(b => b.id === "punta");
  $("fareInfoPrices").replaceChildren(...FARES.bands.map(b => {
    const el = document.createElement("div");
    el.className = `fare-price ${b.id}`;
    const save = [punta && b !== punta ? `ahorras ${formatCLP(punta.price - b.price)}` : "", b.weekdaysOnly ? "lun a vie" : "todos los días"].filter(Boolean).join(" · ");
    el.innerHTML = `<small>${b.label}</small><b>${formatCLP(b.price)}</b><span>${save}</span>`;
    return el;
  }));

  const [so, sc] = SERVICE_HOURS[shown];
  $("fareInfoNotes").replaceChildren(...[
    `Horario de ${DAY_TYPE_LABEL[shown].toLowerCase()}: de ${hhmm(so)} a ${hhmm(sc)}.`,
    shown === "laboral" ? "Las horas punta y baja solo rigen de lunes a viernes no festivos." : `${shown === "sabado" ? "Los sábados" : "Los domingos y festivos"} se cobra hora valle todo el día: no hay punta ni baja.`,
    "Tarifas adulto con tarjeta bip! vigentes desde el 22 de febrero de 2026 (metro.cl).",
    "El pasaje se cobra al pasar el torniquete, según la hora de entrada. Las combinaciones entre líneas no se vuelven a cobrar.",
  ].map(t => { const li = document.createElement("li"); li.textContent = t; return li; }));
}

/** Engancha los botones del panel (una vez). */
export function setupFareInfo() {
  $("fareInfoClose")?.addEventListener("click", closeFareInfo);
  $("fareInfoOk")?.addEventListener("click", closeFareInfo);
  $("fareInfoPanel")?.addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeFareInfo(); });
}
