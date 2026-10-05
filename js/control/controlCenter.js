/* ==========================================================================
   MetroSim — Centro de Control · controlCenter.js
   Tercer rol del jugador: el Puesto Central de Control (PCC).

   No dibuja nada en 3D: muestra la red completa en un esquema (como los
   paneles de un PCC real) y deja actuar sobre ella con ÓRDENES al motor:
     · esquema de cada línea con sus dos vías, estaciones, señales y trenes
       (color según el estado: circulando, en andén, retenido, regulando,
       detenido ante señal...)
     · ficha del tren seleccionado (clic en el esquema) con Retener / Liberar
     · indicadores por línea: trenes, puntualidad, retraso máximo, gente
       esperando y regulación automática (activar / desactivar)
     · registro de incidencias en tiempo real (bus de eventos del motor)

   Igual que el Conductor, el Centro de Control nunca toca la simulación: usa
   engine.command(...) y escucha "command:result", "train:state" y
   "train:event".
   ========================================================================== */

import { CONFIG } from "../config.js";
import { describeTrain } from "../engine/engine.js";
import { TRAIN_STATES } from "../engine/state.js";
import { formatClock } from "../engine/format.js";
import { formatDelay } from "../engine/schedule.js";

/** Color de cada estado de tren en el esquema. */
const STATE_COLORS = {
  running: "#3fd07a", starting: "#3fd07a", approaching: "#9be37a",
  dwell: "#4aa3ff", closing: "#4aa3ff", ready: "#7cc0ff",
  held: "#ff4b4b", regulating: "#ffb020", signalStop: "#ff7a2a", stopped: "#ff7a2a",
  depot: "#6b7785", retiring: "#6b7785", cabChange: "#6b7785",
};
const ASPECT_COLORS = { red: "#ff3030", yellow: "#ffb000", green: "#27c96a" };
const L = CONFIG.train.length;

/** Estilos propios del Centro de Control (se inyectan una vez). */
const CSS = `
.pcc { position: fixed; inset: 0; z-index: 30; display: grid; grid-template-rows: auto 1fr; background: var(--pcc-bg); color: var(--pcc-fg);
  font-family: system-ui, "Segoe UI", Arial, sans-serif; --pcc-bg: #070b10; --pcc-fg: #dfe7ef; --pcc-panel: #0e1620; --pcc-border: #ffffff1c; --pcc-dim: #8b98a7; }
.pcc-top { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--pcc-border); flex-wrap: wrap; }
.pcc-top h1 { margin: 0; font-size: 18px; letter-spacing: 1px; }
.pcc-top small { color: var(--pcc-dim); }
.pcc-clock { margin-left: auto; font: 700 22px/1 ui-monospace, Consolas, monospace; }
.pcc button { font: inherit; color: inherit; background: #1a2633; border: 1px solid var(--pcc-border); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.pcc button:hover { background: #24364a; }
.pcc button.on { background: #1d5a36; border-color: #3fd07a88; }
.pcc button.danger { background: #5a1d1d; border-color: #ff4b4b88; }
.pcc-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; padding: 12px 16px; min-height: 0; overflow: auto; }
.pcc-lines { display: grid; gap: 12px; align-content: start; min-width: 0; }
.pcc-line { background: var(--pcc-panel); border: 1px solid var(--pcc-border); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.pcc-line header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.pcc-badge { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 900; color: #fff; }
.pcc-kpis { display: flex; gap: 14px; flex-wrap: wrap; color: var(--pcc-dim); font-size: 13px; }
.pcc-kpis b { color: var(--pcc-fg); }
.pcc-line canvas { width: 100%; height: 240px; display: block; cursor: pointer; }
.pcc-side { display: grid; gap: 12px; align-content: start; min-width: 0; }
.pcc-card { background: var(--pcc-panel); border: 1px solid var(--pcc-border); border-radius: 12px; padding: 12px; }
.pcc-card h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: 1px; color: var(--pcc-dim); font-weight: 700; }
.pcc-train dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0 0 10px; font-size: 13px; }
.pcc-train dt { color: var(--pcc-dim); }
.pcc-train dd { margin: 0; }
.pcc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pcc-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12px; max-height: 300px; overflow: auto; }
.pcc-log li { padding: 4px 6px; border-radius: 6px; background: #ffffff08; }
.pcc-log time { color: var(--pcc-dim); margin-right: 6px; font-family: ui-monospace, Consolas, monospace; }
.pcc-log .warn { border-left: 3px solid #ffb020; } .pcc-log .alert { border-left: 3px solid #ff4b4b; } .pcc-log .ok { border-left: 3px solid #3fd07a; }
.pcc-legend { display: flex; flex-wrap: wrap; gap: 8px 12px; font-size: 12px; color: var(--pcc-dim); }
.pcc-legend i { display: inline-block; width: 12px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.pcc-scroll { min-width: 0; }
.pcc-train-close { display: none; }
@media (max-width: 900px) { .pcc-body { grid-template-columns: 1fr; } .pcc-line canvas { height: 200px; } }
/* Celular: esquemas desplazables de lado (las estaciones no se amontonan) y ficha del tren como hoja inferior */
@media (max-width: 760px) {
  .pcc { padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); }
  .pcc-top { gap: 6px 10px; padding: 8px 12px; }
  .pcc-top h1 { font-size: 15px; }
  .pcc-top small, .pcc-legend { font-size: 11px; }
  .pcc-clock { font-size: 18px; }
  .pcc-body { padding: 10px 10px 90px; gap: 10px; }
  .pcc-line { padding: 8px 10px; }
  .pcc-line header small { flex-basis: 100%; order: 3; }
  .pcc-kpis { gap: 4px 12px; font-size: 12px; }
  .pcc-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; margin: 0 -10px; padding: 0 10px; }
  .pcc-line canvas { width: 860px; max-width: none; height: 190px; }
  .pcc button { min-height: 38px; }
  .pcc-train.has-train { position: fixed; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); z-index: 2;
    max-height: 45vh; overflow: auto; box-shadow: 0 -10px 40px #000c; border-color: #4aa3ff88; }
  .pcc-train.has-train .pcc-train-close { display: block; position: absolute; top: 8px; right: 8px; min-height: 0; padding: 4px 10px; }
  .pcc-train { position: relative; }
}
`;

export class ControlCenter {
  /**
   * @param {object} opts
   * @param {import("../engine/engine.js").MetroEngine} opts.engine
   * @param {() => void} opts.onExit   volver al menú
   */
  constructor({ engine, onExit }) {
    this.engine = engine;
    this.onExit = onExit;
    this.selected = null;            // id del tren seleccionado
    this.log = [];
    this.unsub = [];
    injectCss();
    this.buildDom();
    this.listen();
    this.addLog("Turno iniciado en el Puesto Central de Control", "ok");
  }

  /* ----- Interfaz ----- */
  buildDom() {
    const root = document.createElement("section");
    root.className = "pcc";
    root.innerHTML = `
      <div class="pcc-top">
        <button data-act="exit">← Menú</button>
        <div><h1>CENTRO DE CONTROL</h1><small>Metro de Santiago · red simulada en tiempo real</small></div>
        <div class="pcc-legend">${legendHtml()}</div>
        <span class="pcc-clock">--:--:--</span>
      </div>
      <div class="pcc-body">
        <div class="pcc-lines"></div>
        <aside class="pcc-side">
          <div class="pcc-card pcc-train"><button class="pcc-train-close" data-act="deselect" aria-label="Cerrar">✕</button><h2>TREN SELECCIONADO</h2><div class="pcc-train-body"><small>Toca un tren del esquema.</small></div></div>
          <div class="pcc-card"><h2>INCIDENCIAS</h2><ul class="pcc-log"></ul></div>
        </aside>
      </div>`;
    document.body.append(root);
    this.root = root;
    this.clockEl = root.querySelector(".pcc-clock");
    this.trainEl = root.querySelector(".pcc-train-body");
    this.logEl = root.querySelector(".pcc-log");

    // Un panel por línea: cabecera con indicadores y esquema
    this.panels = [];
    const wrap = root.querySelector(".pcc-lines");
    for (const ls of this.engine.lines.values()) {
      const el = document.createElement("article");
      el.className = "pcc-line";
      el.innerHTML = `
        <header>
          <span class="pcc-badge" style="background:${ls.line.color}">${ls.line.id}</span>
          <strong>${ls.line.name}</strong>
          <small style="color:var(--pcc-dim)">${ls.line.stations[0].name} ⇄ ${ls.line.stations.at(-1).name}</small>
          <button data-act="reg" data-line="${ls.line.id}" style="margin-left:auto">Regulación</button>
        </header>
        <div class="pcc-kpis"></div>
        <div class="pcc-scroll"><canvas></canvas></div>`;
      wrap.append(el);
      const canvas = el.querySelector("canvas");
      canvas.addEventListener("click", (ev) => this.pick(ls, canvas, ev));
      this.panels.push({ ls, el, canvas, ctx: canvas.getContext("2d"), kpis: el.querySelector(".pcc-kpis"), regBtn: el.querySelector("[data-act=reg]") });
    }

    root.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "exit") this.onExit();
      else if (act === "deselect") { this.selected = null; this.renderTrain(); }
      else if (act === "reg") {
        const ls = this.engine.line(btn.dataset.line);
        this.engine.command("control.regulation", { on: !ls.regulator.enabled, line: ls.line.id, source: "pcc" });
      } else if (act === "hold" || act === "release") {
        this.engine.command(`control.${act}`, { trainId: this.selected, source: "pcc" });
      }
    });
  }

  /** Suscripción al bus del motor: incidencias y respuestas a órdenes. */
  listen() {
    const bus = this.engine.bus;
    this.unsub.push(bus.on("command:result", ({ type, payload, result }) => {
      if (type.startsWith("control.") && result?.text) this.addLog(result.text, result.ok ? (result.level === "warn" ? "warn" : "ok") : "alert");
    }));
    this.unsub.push(bus.on("incident", (inc) => {
      const where = inc.unit ? `${inc.unit.id} · ` : `${inc.line.name} · `;
      this.addLog(where + inc.text, inc.phase === "end" ? "ok" : inc.kind === "doorObstruction" ? "info" : "warn");
    }));
    this.unsub.push(bus.on("train:state", ({ unit, to, from }) => {
      if (to === "signalStop") this.addLog(`${unit.id} detenido ante señal en rojo (${describeTrain(unit).location})`, "warn");
      else if (to === "regulating") this.addLog(`${unit.id} regulando intervalo en ${unit.sim.dockedStation()?.name ?? "—"}`, "info");
      else if (from === "held" && to !== "held") this.addLog(`${unit.id} reanuda la marcha`, "ok");
    }));
    this.unsub.push(bus.on("train:event", ({ unit, type, data }) => {
      if (type === "collision") this.addLog(`ALCANCE: ${unit.id} con ${data.other.id}`, "alert");
      else if (type === "redSignal") this.addLog(`${unit.id} rebasó la señal ${data.signal.id} en rojo`, "alert");
      else if (type === "arrivedStation" && data.delay > 120) this.addLog(`${unit.id} llega a ${data.station.name} con ${formatDelay(data.delay)} de retraso`, "warn");
    }));
  }

  addLog(text, level = "info") {
    this.log.unshift({ time: this.engine.time, text, level });
    this.log.length = Math.min(this.log.length, 60);
    this.logDirty = true;
  }

  /* ----- Selección de trenes ----- */
  pick(ls, canvas, ev) {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = 28;
    for (const u of ls.trains) {
      const p = this.trainPoint(ls, u, r.width, r.height);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = u; }
    }
    this.selected = best ? best.id : null;
    this.renderTrain();
  }

  /* ----- Geometría del esquema ----- */
  layout(ls, w, h) {
    const st = ls.line.stations;
    const m = 34;
    const z0 = st[0].z, z1 = st.at(-1).z;
    return {
      xOf: (z) => m + ((z0 - z) / (z0 - z1)) * (w - 2 * m),
      yA: h * 0.36, yB: h * 0.62,
    };
  }

  /** Punto del esquema de un tren (centro del tren, en su vía). */
  trainPoint(ls, u, w, h) {
    const g = this.layout(ls, w, h);
    const z = u.route.toWorldZ(u.sim.position + L / 2);
    return { x: Math.min(w - 6, Math.max(6, g.xOf(z))), y: u.route.dir === 1 ? g.yA : g.yB };
  }

  /* ----- Dibujo ----- */
  update() {
    this.clockEl.textContent = formatClock(this.engine.time);
    for (const p of this.panels) {
      this.drawLine(p);
      this.renderKpis(p);
    }
    this.renderTrain();
    if (this.logDirty) this.renderLog();
  }

  drawLine(p) {
    const { ls, canvas, ctx } = p;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = this.layout(ls, w, h);
    const [A, B] = ls.routes;

    // Vías
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3a4653";
    for (const y of [g.yA, g.yB]) { ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(w - 12, y); ctx.stroke(); }
    ctx.fillStyle = "#8b98a7"; ctx.font = "11px system-ui, Arial";
    ctx.textAlign = "right"; ctx.fillText(`→ ${A.last.short}`, w - 12, g.yA - 8);
    ctx.textAlign = "left"; ctx.fillText(`${B.last.short} ←`, 12, g.yB + 16);

    // Estaciones: andenes y nombres (alternando arriba y abajo para que quepan)
    ls.line.stations.forEach((st, i) => {
      const x = g.xOf(st.z);
      ctx.fillStyle = ls.line.color;
      ctx.fillRect(x - 5, g.yA - 4, 10, g.yB - g.yA + 8);
      const wa = ls.passengers.waitingAt(st, 1) + ls.passengers.waitingAt(st, -1);
      ctx.fillStyle = wa > 250 ? "#ff7a2a" : wa > 120 ? "#ffd166" : "#c9d4df";
      ctx.font = "10px system-ui, Arial";
      ctx.save();
      const top = i % 2 === 0;
      ctx.translate(x, top ? g.yA - 18 : g.yB + 28);
      ctx.rotate(-Math.PI / 5);
      ctx.textAlign = "left";
      ctx.fillText(st.short, 0, 0);
      ctx.restore();
    });

    // Señales (puntos de color en cada vía)
    for (const route of ls.routes) {
      const y = route.dir === 1 ? g.yA - 9 : g.yB + 9;
      for (const s of ls.signals.get(route.id).signals) {
        ctx.fillStyle = ASPECT_COLORS[s.aspect];
        ctx.beginPath(); ctx.arc(g.xOf(route.toWorldZ(s.z)), y, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Trenes
    const len = Math.max(10, (L / Math.abs(ls.line.stations[0].z - ls.line.stations.at(-1).z)) * (w - 68));
    for (const u of ls.trains) {
      const pt = this.trainPoint(ls, u, w, h);
      const color = STATE_COLORS[u.state] || "#c9d4df";
      ctx.fillStyle = color;
      ctx.fillRect(pt.x - len / 2, pt.y - 6, len, 12);
      if (u.id === this.selected) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.strokeRect(pt.x - len / 2 - 3, pt.y - 9, len + 6, 18); }
      if (u.isPlayer) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill(); }
      // Etiqueta: servicio y retraso (si es notable)
      const late = u.arrivedIdx !== null && u.delay > CONFIG.schedule.punctualWindow;
      ctx.fillStyle = late ? "#ff8a8a" : "#e8eef4";
      ctx.font = "10px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      const label = u.id.replace(/^L\dV?-/, "") + (late ? ` +${Math.round(u.delay / 60)}′` : "");
      ctx.fillText(label, pt.x, u.route.dir === 1 ? pt.y + 22 : pt.y - 14);
    }
  }

  renderKpis(p) {
    const { ls } = p;
    const trains = ls.trains;
    const inService = trains.filter(u => u.arrivedIdx !== null);
    const punctual = inService.filter(u => Math.abs(u.delay) <= CONFIG.schedule.punctualWindow).length;
    const maxDelay = inService.reduce((m, u) => Math.max(m, u.delay), 0);
    const waiting = ls.line.stations.reduce((s, st) => s + ls.passengers.waitingAt(st, 1) + ls.passengers.waitingAt(st, -1), 0);
    const onboard = trains.reduce((s, u) => s + (u.load || 0), 0);
    const held = trains.filter(u => u.state === "held").length;
    const html = `<span>Trenes <b>${trains.length}</b></span>
      <span>Puntuales <b>${inService.length ? Math.round(100 * punctual / inService.length) : 100} %</b></span>
      <span>Retraso máx. <b>${formatDelay(Math.max(0, maxDelay))}</b></span>
      <span>A bordo <b>${Math.round(onboard).toLocaleString("es-CL")}</b></span>
      <span>Esperando <b>${Math.round(waiting).toLocaleString("es-CL")}</b></span>
      ${held ? `<span style="color:#ff8a8a">Retenidos <b>${held}</b></span>` : ""}`;
    if (html !== p.lastKpis) { p.kpis.innerHTML = html; p.lastKpis = html; }
    const on = ls.regulator.enabled;
    p.regBtn.textContent = `Regulación ${on ? "ACTIVA" : "APAGADA"}`;
    p.regBtn.classList.toggle("on", on);
    p.regBtn.classList.toggle("danger", !on);
  }

  renderTrain() {
    const u = this.selected ? this.engine.findTrain(this.selected) : null;
    this.trainEl.parentElement.classList.toggle("has-train", !!u);     // en el celular: hoja inferior
    if (!u) {
      const html = this.selected ? `<small>El tren ${this.selected} ya no está en servicio.</small>` : `<small>Toca un tren del esquema.</small>`;
      if (html !== this.lastTrainHtml) { this.trainEl.innerHTML = html; this.lastTrainHtml = html; }
      return;
    }
    const t = describeTrain(u);
    const next = u.sim.nextStation();
    const eta = next ? this.engine.eta(u, next.world) : null;
    const held = !!u.ato?.held;
    const html = `
      <dl>
        <dt>Servicio</dt><dd><b>${t.id}</b> · L${t.line}${u.isPlayer ? " · conducido por el jugador" : ""}</dd>
        <dt>Sentido</dt><dd>${t.direction}</dd>
        <dt>Posición</dt><dd>${t.location}</dd>
        <dt>Estado</dt><dd><span style="color:${STATE_COLORS[u.state] || "#fff"}">●</span> ${TRAIN_STATES[u.state] ?? "—"}</dd>
        <dt>Velocidad</dt><dd>${t.kmh} km/h</dd>
        <dt>Retraso</dt><dd>${t.delay === null ? "—" : formatDelay(t.delay)}</dd>
        <dt>Pasajeros</dt><dd>${t.load} / 1000</dd>
        <dt>Próxima</dt><dd>${next ? `${next.name}${eta ? ` · ${formatClock(eta).slice(0, 5)}` : ""}` : "—"}</dd>
      </dl>
      <div class="pcc-actions">
        ${u.ato ? (held
          ? `<button data-act="release" class="on">Liberar</button>`
          : `<button data-act="hold" class="danger">Retener en próxima estación</button>`)
          : `<small>Tren conducido por una persona: no se puede retener.</small>`}
      </div>`;
    if (html !== this.lastTrainHtml) { this.trainEl.innerHTML = html; this.lastTrainHtml = html; }
  }

  renderLog() {
    this.logDirty = false;
    this.logEl.innerHTML = this.log.map(e => `<li class="${e.level}"><time>${formatClock(e.time).slice(0, 5)}</time>${escapeHtml(e.text)}</li>`).join("");
  }

  destroy() {
    this.unsub.forEach(f => f());
    this.root.remove();
  }
}

function legendHtml() {
  const items = [["Circulando", "running"], ["En andén", "dwell"], ["Regulando", "regulating"], ["Ante señal", "signalStop"], ["Retenido", "held"], ["Cocheras / maniobra", "depot"]];
  return items.map(([t, k]) => `<span><i style="background:${STATE_COLORS[k]}"></i>${t}</span>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
}
