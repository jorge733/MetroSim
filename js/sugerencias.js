/* ==========================================================================
   RedMoviSim — 2.13 · sugerencias.js
   «RedMoviSim te escucha»: formulario de sugerencias y comentarios.

     · Se abre desde la portada (botón Opinar y el pie) y desde el menú de la
       partida. Desde la partida el tema se elige solo (Metro, bus, taxi…).
     · Cada mensaje es una fila de la tabla «sugerencias» de Supabase
       (supabase/sugerencias.sql). Las reglas (RLS) solo dejan INSERTAR: nadie
       puede leer los mensajes desde el juego, ni siquiera quien los mandó.
     · No hace falta cuenta. Con la sesión iniciada se adjunta el id del
       jugador y su correo queda como contacto (si quiere respuesta).
     · Sin internet el mensaje queda en el dispositivo y se envía solo cuando
       vuelve la conexión. El borrador se conserva si cierras la ventana.
   ========================================================================== */

import { VERSION } from "./config.js";
import { api, state as accountState } from "./cuenta.js";

const K_PEND = "redmovisim.sugerencias.pendientes";   // mensajes que no alcanzaron a salir
const K_LAST = "redmovisim.sugerencias.ultima";       // hora del último envío (evita enviar dos veces seguidas)
const MIN_LEN = 10, MAX_LEN = 2000, MAX_PEND = 5, COOLDOWN = 30000;

export const TIPOS = [
  { id: "sugerencia", label: "Sugerencia", hint: "Una idea para el juego" },
  { id: "error", label: "Algo falla", hint: "Un error o algo raro" },
  { id: "comentario", label: "Comentario", hint: "Lo que quieras contar" },
  { id: "felicitacion", label: "Felicitar", hint: "Lo que te gusta" },
];
export const TEMAS = [
  ["general", "El juego en general"], ["metro", "Conducir el Metro"], ["tren", "Tren Nos / Tren Rancagua"],
  ["bus", "Bus Red"], ["taxi", "Taxi"], ["viajar", "Viajar (pasajero, bip!, misiones)"],
  ["control", "Centro de Control"], ["multijugador", "Multijugador"], ["tienda", "Tienda RedMovi"],
  ["cuenta", "Cuenta y guardado en la nube"], ["celular", "Celular, app y controles"],
  ["estaciones", "Estaciones, recorridos y horarios"], ["otro", "Otro tema"],
];
const PLACEHOLDER = {
  sugerencia: "Ej.: me gustaría que se pudiera conducir la Línea 7 o que los buses tengan más recorridos…",
  error: "Cuéntanos qué pasó, dónde estabas (línea, estación, modo) y qué esperabas que pasara…",
  comentario: "Lo que quieras decirnos sobre RedMoviSim…",
  felicitacion: "¿Qué es lo que más te gusta del juego?",
};

/* ---------- almacenamiento local ---------- */
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/** Datos del dispositivo que ayudan a reproducir un error (sin nada personal). */
function device() {
  const app = matchMedia?.("(display-mode: standalone)").matches || /RedMoviSimApp|; wv\)/.test(navigator.userAgent);
  const touch = matchMedia?.("(pointer: coarse)").matches;
  return [app ? "app" : "web", touch ? "táctil" : "teclado", `${screen.width}×${screen.height}`, navigator.userAgent]
    .join(" · ").slice(0, 300);
}

/* ---------- envío ---------- */
async function post(row) {
  const signed = accountState().signedIn;
  await api("/rest/v1/sugerencias", { method: "POST", auth: signed, body: row, headers: { Prefer: "return=minimal" } });
}

/** Reintenta los mensajes que quedaron pendientes (sin internet o con el servidor caído). */
let flushing = false;
export async function flushPending() {
  const pend = ls.get(K_PEND);
  if (flushing || !Array.isArray(pend) || !pend.length || !navigator.onLine) return;
  flushing = true;
  try {
    const left = [];
    for (const row of pend) {
      try { await post(row); } catch (err) { if (retryable(err)) left.push(row); }   // los rechazados por el servidor se descartan
    }
    if (left.length) ls.set(K_PEND, left); else ls.del(K_PEND);
  } finally { flushing = false; }
}
const retryable = (err) => err.code === "offline" || !err.status || err.status >= 500 || err.status === 404 || err.status === 429;

/* ==========================================================================
   Interfaz
   ========================================================================== */

const ICON_CHAT = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
const ICON_CLOSE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_OK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>';
const STAR = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

let panel, busy = false, sent = null, msg = { text: "", kind: "" }, lastFocus = null;
const draft = { tipo: "sugerencia", tema: "general", nota: 0, mensaje: "", contacto: "", contexto: "" };

function build() {
  panel = document.createElement("div");
  panel.id = "feedbackPanel";
  panel.className = "ticket-panel feedback-panel hidden";
  panel.innerHTML = `
    <div class="ticket-card feedback-card" role="dialog" aria-modal="true" aria-labelledby="feedbackTitle">
      <header class="ticket-head">
        <span class="account-avatar">${ICON_CHAT}</span>
        <div class="ticket-head-text">
          <span class="small-label">REDMOVISIM TE ESCUCHA</span>
          <strong id="feedbackTitle">Sugerencias y comentarios</strong>
        </div>
        <button class="ticket-close" data-fb="close" type="button" aria-label="Cerrar">${ICON_CLOSE}</button>
      </header>
      <div class="feedback-body"></div>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener("click", (ev) => {
    if (ev.target === panel) return closeFeedback();
    const el = ev.target.closest("[data-fb]");
    if (!el) return;
    const act = el.dataset.fb;
    if (act === "close") return closeFeedback();
    if (act === "tipo") { save(); draft.tipo = el.dataset.v; return render(); }
    if (act === "nota") { save(); draft.nota = draft.nota === +el.dataset.v ? 0 : +el.dataset.v; return render(); }
    if (act === "again") { sent = null; return render(); }
  });
  panel.addEventListener("submit", (ev) => { ev.preventDefault(); submit(); });
  panel.addEventListener("input", (ev) => {
    if (ev.target.id === "feedbackMsg") {
      draft.mensaje = ev.target.value;
      const n = draft.mensaje.trim().length, c = panel.querySelector(".feedback-count");
      c.textContent = n < MIN_LEN ? `Mínimo ${MIN_LEN} caracteres` : `${n} / ${MAX_LEN}`;
      c.classList.toggle("short", n < MIN_LEN);
    } else save();
  });
  // Las teclas no llegan al juego mientras se escribe (M, H, flechas…)
  panel.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape") closeFeedback(); });
  panel.addEventListener("keyup", (ev) => ev.stopPropagation());
}

/** Guarda en el borrador lo que hay escrito en el formulario. */
function save() {
  const q = (s) => panel.querySelector(s);
  if (!q("#feedbackMsg")) return;
  draft.mensaje = q("#feedbackMsg").value;
  draft.tema = q("#feedbackTema").value;
  draft.contacto = q("#feedbackContact").value;
}

function render() {
  if (!panel) return;
  const body = panel.querySelector(".feedback-body");
  panel.classList.toggle("busy", busy);
  if (sent) {
    body.innerHTML = `
      <div class="feedback-done">
        <span class="feedback-done-ico">${ICON_OK}</span>
        <b>${sent.queued ? "¡Gracias! Lo enviaremos en un rato" : "¡Gracias por escribirnos!"}</b>
        <p class="account-lead">${sent.queued
          ? "No pudimos enviarlo ahora (¿sin internet?). Tu mensaje quedó guardado en este dispositivo y se envía solo apenas se pueda."
          : "Leemos todos los mensajes. Muchas de las novedades de RedMoviSim nacieron de ideas de jugadores como tú."}
          ${sent.contacto ? ` Si hace falta, te responderemos a <b>${esc(sent.contacto)}</b>.` : ""}</p>
      </div>
      <div class="ticket-actions"><button class="ghost-button" data-fb="again" type="button">Enviar otro</button><button class="go-button" data-fb="close" type="button">Listo</button></div>`;
    setTimeout(() => panel.querySelector('.feedback-done [data-fb], .ticket-actions .go-button')?.focus(), 30);
    return;
  }
  const acc = accountState();
  if (!draft.contacto && acc.signedIn) draft.contacto = acc.email || "";
  const n = draft.mensaje.trim().length;
  body.innerHTML = `
    <p class="account-lead">¿Una idea, algo que no funciona o algo que te encanta? Cuéntanos: <b>leemos cada mensaje</b> y con ellos decidimos qué viene en las próximas versiones.</p>
    <form class="feedback-form" novalidate>
      <div class="feedback-field"><span class="small-label" id="feedbackTipoLabel">¿Qué nos quieres contar?</span>
        <div class="seg feedback-tipos" role="radiogroup" aria-labelledby="feedbackTipoLabel">
          ${TIPOS.map(t => `<button type="button" role="radio" data-fb="tipo" data-v="${t.id}" aria-checked="${draft.tipo === t.id}"><b>${t.label}</b><span>${t.hint}</span></button>`).join("")}
        </div>
      </div>
      <label class="field"><span class="small-label">Sobre</span>
        <select id="feedbackTema">${TEMAS.map(([id, l]) => `<option value="${id}"${draft.tema === id ? " selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field"><span class="small-label">Tu mensaje</span>
        <textarea id="feedbackMsg" rows="5" maxlength="${MAX_LEN}" required placeholder="${esc(PLACEHOLDER[draft.tipo])}">${esc(draft.mensaje)}</textarea>
        <small class="feedback-count${n < MIN_LEN ? " short" : ""}" aria-live="polite">${n < MIN_LEN ? `Mínimo ${MIN_LEN} caracteres` : `${n} / ${MAX_LEN}`}</small>
      </label>
      <div class="feedback-field"><span class="small-label" id="feedbackNotaLabel">¿Qué nota le pones al juego? <i>(opcional)</i></span>
        <div class="feedback-stars" role="radiogroup" aria-labelledby="feedbackNotaLabel">
          ${[1, 2, 3, 4, 5].map(v => `<button type="button" role="radio" data-fb="nota" data-v="${v}" aria-checked="${draft.nota === v}" aria-label="${v} de 5" class="${v <= draft.nota ? "on" : ""}">${STAR}</button>`).join("")}
          <span class="feedback-stars-label">${["Sin nota", "Muy mal", "Mal", "Regular", "Bien", "¡Excelente!"][draft.nota]}</span>
        </div>
      </div>
      <label class="field"><span class="small-label">Tu correo, si quieres respuesta <i>(opcional)</i></span>
        <input id="feedbackContact" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="tu@correo.cl" value="${esc(draft.contacto)}">
      </label>
      <input class="feedback-hp" name="web" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${msg.text ? `<p class="ticket-status ${msg.kind}" role="status">${esc(msg.text)}</p>` : ""}
      <button class="go-button account-main" type="submit">${busy ? "Enviando…" : "Enviar"}</button>
    </form>
    <p class="account-fine">Junto con el mensaje se envían la versión del juego (v${VERSION}) y el tipo de dispositivo, para poder revisar los errores. Tu correo solo se usa para responderte.</p>`;
}

async function submit() {
  if (busy) return;
  save();
  const mensaje = draft.mensaje.trim(), contacto = draft.contacto.trim();
  const fail = (text) => { msg = { text, kind: "error" }; render(); panel.querySelector("#feedbackMsg")?.focus(); };
  if (panel.querySelector(".feedback-hp")?.value) { sent = { queued: false }; return render(); }   // robot: se finge el envío
  if (mensaje.length < MIN_LEN) return fail(`Cuéntanos un poco más: el mensaje necesita al menos ${MIN_LEN} caracteres.`);
  if (contacto && !validEmail(contacto)) return fail("Ese correo no parece válido. Corrígelo o déjalo en blanco.");
  const last = Number(ls.get(K_LAST)) || 0;
  if (Date.now() - last < COOLDOWN) return fail("Acabas de enviar un mensaje. Espera unos segundos antes de mandar otro.");

  const row = {
    tipo: draft.tipo, tema: draft.tema, nota: draft.nota || null, mensaje: mensaje.slice(0, MAX_LEN),
    contacto: contacto || null, version: VERSION, contexto: draft.contexto.slice(0, 120) || null, dispositivo: device(),
  };
  busy = true; msg = { text: "", kind: "" }; render();
  let queued = false;
  try {
    await post(row);
  } catch (err) {
    if (!retryable(err)) { busy = false; return fail("No pudimos enviar tu mensaje. Revisa el texto e inténtalo de nuevo."); }
    const pend = ls.get(K_PEND);
    ls.set(K_PEND, [...(Array.isArray(pend) ? pend : []), row].slice(-MAX_PEND));
    queued = true;
  }
  busy = false;
  ls.set(K_LAST, Date.now());
  sent = { queued, contacto: contacto || "" };
  Object.assign(draft, { mensaje: "", nota: 0 });
  render();
}

/**
 * Abre el formulario. `opts.tema` preselecciona el tema y `opts.contexto` describe dónde
 * estaba el jugador (p. ej. «Conduciendo · Línea 1 · Los Héroes»), que se adjunta al mensaje.
 */
export function openFeedback(opts = {}) {
  if (!panel) build();
  lastFocus = document.activeElement;
  if (opts.tema && TEMAS.some(([id]) => id === opts.tema) && !draft.mensaje) draft.tema = opts.tema;
  draft.contexto = opts.contexto || "";
  sent = null; msg = { text: "", kind: "" };
  panel.classList.remove("hidden");
  render();
  setTimeout(() => panel.querySelector('.feedback-tipos [aria-checked="true"]')?.focus(), 30);
  flushPending();
}
export function closeFeedback() {
  if (!panel || panel.classList.contains("hidden")) return;
  save();
  panel.classList.add("hidden");
  lastFocus?.focus?.();
}
export const feedbackOpen = () => !!panel && !panel.classList.contains("hidden");

/** Botones que abren el formulario (portada). Además reintenta lo pendiente al arrancar y al volver internet. */
export function setupFeedbackButtons(...buttons) {
  for (const b of buttons) b?.addEventListener("click", () => openFeedback());
  window.addEventListener("online", flushPending);
  setTimeout(flushPending, 4000);
}
