/* ==========================================================================
   MetroSim — 1.2 · shiftReport.js
   Informe de fin de turno del Conductor: ventana animada e interactiva que
   reemplaza a la lista de datos del resumen de servicio.

     1. El recorrido se "dibuja" estación por estación y el tren avanza.
     2. Cae el timbre con la nota (S, A, B, C, D) y el puntaje cuenta hacia
        arriba, comparado con tu récord; confeti si hay récord o nota S/A.
     3. Cada estación del recorrido se puede tocar (o recorrer con ← →)
        para ver su llegada, parada, puntos y sueldo.
     4. Pestañas: Conducción (puntualidad, precisión y faltas) y Sueldo
        (boleta que suma estación a estación hasta el saldo de la cuenta).

   Clic o cualquier tecla durante la entrada la salta. Enter = acción
   principal. Con "reducir movimiento" todo aparece directamente.
   Solo DOM; vive dentro de #summary para que el juego se pause igual que
   con el resumen de siempre (hud.summaryOpen).
   ========================================================================== */

import { formatCLP } from "./config.js";
import { formatDelay } from "./engine/schedule.js";
import { confetti } from "./celebration.js";
import { icon, textOn } from "./icons.js";

const GRADES = {
  S: { label: "Excelente", color: "#ffd23f" },
  A: { label: "Muy bien", color: "#34d17c" },
  B: { label: "Bien", color: "#5cc8ff" },
  C: { label: "Regular", color: "#ffb547" },
  D: { label: "Por mejorar", color: "#ff6b6b" },
};

const fmtInt = (n) => Math.round(n).toLocaleString("es-CL");
/** "UNIVERSIDAD DE CHILE" → "Universidad de Chile" (los conectores van en minúscula). */
const SMALL = new Set(["de", "del", "la", "las", "los", "el", "y"]);
const titleCase = (s) => s.toLowerCase().split(" ").map((w, i) =>
  i > 0 && SMALL.has(w) ? w : w.replace(/^(\P{L}*)(\p{L})/u, (m, a, b) => a + b.toUpperCase())).join(" ");

/**
 * Pinta el informe dentro de `host` y devuelve una función para limpiarlo.
 * @param {HTMLElement} host
 * @param {object} r  datos del turno (ver showDriverSummary en main.js)
 * @param {object} o  { onAction(fn), sound: { tick, stamp, record, cash } }
 */
export function renderShiftReport(host, r, o = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = o.sound || {};
  const g = GRADES[r.score.grade] || GRADES.D;
  const log = r.stations;
  const w = r.punctualWindow;
  const timers = new Set(), finishers = [];
  let intro = !reduced, stopConfetti = null;

  const el = document.createElement("div");
  el.className = "report" + (reduced ? " report-instant" : "");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "reportTitle");
  el.style.setProperty("--grade", g.color);
  el.style.setProperty("--line", r.line.color);
  el.style.setProperty("--on-line", textOn(r.line.color));
  el.innerHTML = `
    <canvas class="report-confetti" aria-hidden="true"></canvas>
    <header class="report-head">
      <span class="line-badge"></span>
      <div class="report-head-text"><span class="small-label report-kicker"></span><h2 id="reportTitle"></h2></div>
      <div class="report-grade" aria-label="Nota ${r.score.grade}: ${g.label}"><b>${r.score.grade}</b><small>${g.label}</small></div>
    </header>

    <section class="report-score">
      <div class="report-points"><span class="small-label">Puntaje</span><strong><span class="report-total">0</span> <small>pts</small></strong></div>
      <div class="report-recordbar" aria-hidden="true"><i class="report-recordfill"></i><i class="report-recordmark"></i></div>
      <p class="report-record"></p>
    </section>

    <section class="report-trip">
      <div class="report-trip-head">
        <span class="small-label">Tu recorrido · ${log.length} de ${r.totalStations} estaciones</span>
        <span class="report-legend"><i class="ok"></i>puntual <i class="warn"></i>desfase <i class="bad"></i>muy tarde ${icon("star", "star")}perfecta</span>
      </div>
      <div class="trip-track" role="listbox" aria-label="Estaciones servidas"><span class="trip-line"></span><span class="trip-fill"></span><span class="trip-train">${icon("train")}</span></div>
      <div class="trip-detail" aria-live="polite"></div>
    </section>

    <nav class="report-tabs" role="tablist">
      <button role="tab" data-tab="drive" aria-selected="true">${icon("train")} Conducción</button>
      <button role="tab" data-tab="pay" aria-selected="false">${icon("coins")} Sueldo</button>
    </nav>
    <section class="report-panel" data-panel="drive"></section>
    <section class="report-panel" data-panel="pay" hidden></section>

    <footer class="report-actions">
      <span class="report-hint"><kbd>←</kbd><kbd>→</kbd> estaciones · <kbd>Enter</kbd> ${r.actions.continueLabel.toLowerCase()}</span>
      <div class="report-buttons"></div>
    </footer>`;
  host.append(el);
  const $ = (s) => el.querySelector(s);

  /* ---------- Encabezado ---------- */
  $(".line-badge").textContent = r.line.id;
  $(".report-kicker").textContent = r.kicker;
  $("#reportTitle").textContent = titleCase(r.title);

  /* ---------- Puntaje y récord ---------- */
  const { total, prevBest, record } = r.score;
  const scale = Math.max(total, prevBest, 1) * 1.08;
  $(".report-recordmark").style.left = `${(prevBest / scale) * 100}%`;
  $(".report-recordmark").hidden = !prevBest;
  const recordText = $(".report-record");
  if (record) recordText.innerHTML = `<b class="report-newrecord">${icon("star")} ¡Nuevo récord!</b> Antes ${fmtInt(prevBest)} pts`;
  else if (prevBest) recordText.textContent = `Tu récord en este servicio: ${fmtInt(prevBest)} pts · te faltaron ${fmtInt(prevBest - total)}`;
  else recordText.textContent = "Primer servicio en esta línea y sentido";

  /* ---------- Recorrido ---------- */
  const track = $(".trip-track");
  const cls = (d) => Math.abs(d) <= w ? "ok" : Math.abs(d) <= 4 * w ? "warn" : "bad";
  const stops = log.map((st, i) => {
    const b = document.createElement("button");
    b.className = `trip-stop ${cls(st.delay)}` + (st.perfect ? " perfect" : "");
    b.setAttribute("role", "option");
    b.setAttribute("aria-label", `${titleCase(st.name)} · llegada ${formatDelay(st.delay)}`);
    b.style.left = log.length > 1 ? `${(i / (log.length - 1)) * 100}%` : "50%";
    b.style.animationDelay = `${0.25 + i * stepOf(log.length)}s`;
    if (st.perfect) b.innerHTML = icon("star");
    b.addEventListener("click", () => select(i));
    track.append(b);
    return b;
  });
  const tripTime = 0.25 + log.length * stepOf(log.length);
  el.style.setProperty("--trip-time", `${tripTime}s`);
  if (!log.length) {
    el.classList.add("report-empty");
    track.insertAdjacentHTML("beforeend", `<p class="trip-empty">No alcanzaste a servir ninguna estación en este turno.</p>`);
  }

  let selected = -1;
  function select(i) {
    if (!log.length) return;
    selected = Math.max(0, Math.min(log.length - 1, i));
    stops.forEach((b, k) => b.setAttribute("aria-selected", String(k === selected)));
    const st = log[selected], c = cls(st.delay);
    const when = c === "ok" ? "puntual" : st.delay > 0 ? "con retraso" : "adelantado";
    $(".trip-detail").innerHTML = `
      <div class="trip-detail-name"><span class="small-label">Estación ${selected + 1} de ${log.length}</span><strong></strong></div>
      <dl>
        <div><dt class="small-label">Llegada</dt><dd class="${c}">${formatDelay(st.delay)} <small>${when}</small></dd></div>
        <div><dt class="small-label">Parada</dt><dd>${st.stop.toFixed(2)} m</dd></div>
        <div><dt class="small-label">Puntos</dt><dd>+${fmtInt(st.points)}</dd></div>
        <div><dt class="small-label">Sueldo</dt><dd class="money">+${formatCLP(st.pay)}</dd></div>
      </dl>
      ${st.perfect ? `<span class="trip-perfect">${icon("star")} Estación perfecta</span>` : ""}`;
    $(".trip-detail-name strong").textContent = titleCase(st.name);
    const b = stops[selected];
    b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse");
  }

  /* ---------- Pestaña Conducción ---------- */
  const punctual = log.filter(s => Math.abs(s.delay) <= w).length;
  const pct = log.length ? Math.round((punctual / log.length) * 100) : 0;
  const avgStop = log.length ? log.reduce((a, s) => a + s.stop, 0) / log.length : 0;
  const faults = [
    ["Señales en rojo", r.faults.redSignals],
    ["Excesos de velocidad", r.faults.overspeeds],
    ["Frenos de emergencia", r.faults.emergencies],
    ["Tirones", r.score.jerks],
    ["Paradas bruscas", r.score.harshStops],
  ];
  $('[data-panel="drive"]').innerHTML = `
    <div class="report-tiles">
      <div class="report-tile">
        <svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18"/><circle class="ring-fill" cx="22" cy="22" r="18" style="--p:${pct}"/></svg>
        <div><span class="small-label">Puntualidad</span><b>${log.length ? `<span data-count="${pct}">0</span> %` : "—"}</b><small>${log.length ? `${punctual} de ${log.length} a ±${w} s` : "sin llegadas"}</small></div>
      </div>
      <div class="report-tile">
        <div class="report-tile-big">${icon("target")}</div>
        <div><span class="small-label">Parada media</span><b>${log.length ? `${avgStop.toFixed(2)} m` : "—"}</b><small>${!log.length ? "sin paradas" : avgStop <= 0.5 ? "muy precisa" : avgStop <= 1.5 ? "precisa" : "mejorable"}</small></div>
      </div>
      <div class="report-tile">
        <div class="report-tile-big">${icon("star")}</div>
        <div><span class="small-label">Perfectas · racha</span><b><span data-count="${r.score.perfects}">0</span> · ${r.score.bestStreak}</b><small>mejor racha seguida</small></div>
      </div>
    </div>
    <ul class="report-faults">${faults.map(([k, v]) =>
      `<li class="${v ? "bad" : "ok"}"><span>${v ? icon("close") : icon("check")}${k}</span><b>${v}</b></li>`).join("")}</ul>`;

  /* ---------- Pestaña Sueldo (boleta) ---------- */
  const p = r.pay;
  const payRows = [
    ...log.map(s => [titleCase(s.name), s.pay]),
  ];
  const bonusRow = p.bonusOk ? [`Bono de servicio · nota ${r.score.grade}`, p.bonus] : [`Bono (desde ${p.minStations} estaciones)`, 0];
  $('[data-panel="pay"]').innerHTML = `
    <div class="receipt">
      <div class="receipt-head"><span class="small-label">Liquidación del turno</span><span class="small-label">${p.bank}</span></div>
      <ol class="receipt-rows">${payRows.map(([k, v]) => `<li><span></span><b>+${formatCLP(v)}</b></li>`).join("") || `<li class="muted"><span>Sin estaciones servidas</span><b>$0</b></li>`}</ol>
      <div class="receipt-sums">
      <div class="receipt-sub"><span>Sueldo por estaciones</span><b>${formatCLP(p.stations)}</b></div>
      <div class="receipt-sub ${p.bonusOk ? "" : "muted"}"><span></span><b>+${formatCLP(bonusRow[1])}</b></div>
      <div class="receipt-total"><span>Ganaste en este turno</span><b class="receipt-amount">$0</b></div>
      <div class="receipt-balance"><span>Saldo en tu cuenta</span><b>${p.balance}</b></div>
      </div>
    </div>`;
  const rowEls = [...el.querySelectorAll(".receipt-rows li:not(.muted)")];
  rowEls.forEach((li, i) => { li.firstChild.textContent = payRows[i][0]; li.style.animationDelay = `${i * 0.05}s`; });
  el.querySelectorAll(".receipt-sub span")[1].textContent = bonusRow[0];
  let payShown = false;

  /* ---------- Pestañas ---------- */
  const tabs = [...el.querySelectorAll(".report-tabs button")];
  function showTab(name) {
    tabs.forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    el.querySelectorAll(".report-panel").forEach(pn => { pn.hidden = pn.dataset.panel !== name; });
    if (name === "pay" && !payShown) {
      payShown = true;
      countUp($(".receipt-amount"), p.stations + p.bonus, 1100, formatCLP, 0.25, () => { if (p.stations + p.bonus > 0) sound.cash?.(); });
    }
  }
  tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));

  /* ---------- Botones ---------- */
  const a = r.actions;
  const btns = [
    a.altLabel && ["ghost-button", a.altLabel, a.onAlt],
    ["ghost-button", "Menú", a.onMenu],
    ["go-button", a.continueLabel, a.onContinue],
  ].filter(Boolean).map(([c, label, fn]) => {
    const b = document.createElement("button");
    b.className = c;
    b.textContent = label;
    b.addEventListener("click", () => o.onAction?.(fn));
    return b;
  });
  $(".report-buttons").append(...btns);
  const primary = btns.at(-1);

  /* ---------- Animación de entrada ---------- */
  function later(fn, s) { const t = setTimeout(() => { timers.delete(t); fn(); }, s * 1000); timers.add(t); }
  function countUp(target, to, ms, fmt, delay = 0, done) {
    const run = () => {
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        target.textContent = fmt(to * (1 - (1 - k) ** 3));
        if (k < 1 && el.isConnected && !target.dataset.final) requestAnimationFrame(step);
        else { target.textContent = fmt(to); done?.(); }
      };
      requestAnimationFrame(step);
    };
    finishers.push(() => { target.dataset.final = "1"; target.textContent = fmt(to); });
    if (reduced) { target.textContent = fmt(to); done?.(); } else later(run, delay);
  }

  // Tics del recorrido, el timbre de la nota y el récord
  if (!reduced) stops.forEach((b, i) => later(() => intro && sound.tick?.(), 0.25 + i * stepOf(log.length)));
  const stampAt = reduced ? 0 : tripTime + 0.15;
  later(() => { el.classList.add("stamped"); if (intro) sound.stamp?.(); }, stampAt);
  countUp($(".report-total"), total, 1300, fmtInt, reduced ? 0 : 0.35);
  el.querySelectorAll("[data-count]").forEach(n => countUp(n, Number(n.dataset.count), 900, fmtInt, reduced ? 0 : tripTime));
  later(() => {
    $(".report-recordfill").style.width = `${(total / scale) * 100}%`;
  }, reduced ? 0 : 0.35);
  const party = record || r.score.grade === "S" || r.score.grade === "A";
  later(() => {
    el.classList.add("revealed");
    intro = false;
    if (record) sound.record?.();
    if (party && !reduced) {
      const c = $(".report-confetti");
      stopConfetti = confetti(c, [g.color, r.line.color, "#ffffff", "#5cc8ff", "#ff5d8f"], record ? 3 : 1.5);
    }
    select(log.length - 1);
    primary.focus({ preventScroll: true });
  }, stampAt + (reduced ? 0 : 0.6));

  /** Salta la entrada: todo queda en su estado final. */
  function skip() {
    if (!intro) return;
    intro = false;
    timers.forEach(t => clearTimeout(t)); timers.clear();
    finishers.forEach(f => f());
    el.classList.add("report-instant", "stamped", "revealed");
    $(".report-recordfill").style.width = `${(total / scale) * 100}%`;
    select(log.length - 1);
    primary.focus({ preventScroll: true });
  }
  el.addEventListener("pointerdown", skip, true);

  const onKey = (ev) => {
    if (intro) { ev.preventDefault(); skip(); return; }
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      ev.preventDefault();
      select((selected < 0 ? log.length - 1 : selected) + (ev.key === "ArrowLeft" ? -1 : 1));
      stops[selected]?.focus({ preventScroll: true });
    } else if (ev.key === "Enter" && !ev.target.closest?.("button")) {
      ev.preventDefault();
      primary.click();
    }
  };
  window.addEventListener("keydown", onKey);

  return () => {
    window.removeEventListener("keydown", onKey);
    timers.forEach(t => clearTimeout(t));
    stopConfetti?.();
    el.remove();
  };
}

/** Tiempo entre estaciones al dibujar el recorrido: la entrada completa no pasa de ~1,4 s. */
function stepOf(n) { return n ? Math.min(0.09, 1.15 / n) : 0; }
