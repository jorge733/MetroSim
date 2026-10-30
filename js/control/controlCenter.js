/* ==========================================================================
   MetroSim — Centro de Control · controlCenter.js
   Tercer rol del jugador: el Puesto Central de Control (PCC).

   No dibuja nada en 3D: muestra la red en un esquema (como los paneles de
   un PCC real) y deja actuar sobre ella con ÓRDENES al motor.

     · Al empezar se elige qué supervisar: la Línea 3 (aprendiz), las líneas
       1, 2 y 3 (operador) o toda la red (jefe de turno). Solo en esas líneas
       hay incidentes, y esperan tu decisión (engine.pcc, incidents.js).
     · Esquema por línea: vías, estaciones (color según la gente esperando),
       señales (las averiadas con una X), limitaciones de velocidad y trenes
       (color según su estado; los que tienen una alarma, con un anillo).
       Botones arriba para ver toda la red o una línea en grande.
     · Ficha del tren seleccionado con sus órdenes: retener 30 s / 60 s / sin
       límite, liberar, saltar la próxima parada y retirar del servicio.
     · Alarmas (alarms.js) con sus botones: autorizar el paso por una señal
       averiada, autorizar que siga un tren detenido en la vía, retirar un
       tren con falla de puertas, saltar parada de un tren muy atrasado.
     · Pestañas Trenes (lista ordenable) y Registro (lo que pasó).
     · Tiempo: pausa y ×1, ×2, ×5, ×10.
     · Nota del turno y, al terminar, informe con el sueldo (se cobra en la
       cuenta del jugador, la misma del Conductor).
     · Tutorial interactivo (controlTutorial.js) la primera vez.
     · Multijugador (net/netHost.js): «Sala» abre una sala con código para
       que otros jugadores conduzcan trenes de las líneas supervisadas. Sus
       trenes se ven con su nombre; las órdenes les llegan por radio. Con la
       sala abierta el tiempo corre a ×1 y no se pausa.

   Igual que el Conductor, el Centro de Control nunca toca la simulación: usa
   engine.command(...) y escucha el bus del motor.
   ========================================================================== */

import { CONFIG, formatCLP } from "../config.js";
import { icon, textOn } from "../icons.js";
import { describeTrain } from "../engine/engine.js";
import { TRAIN_STATES } from "../engine/state.js";
import { formatClock } from "../engine/format.js";
import { formatDelay } from "../engine/schedule.js";
import { TRAIN_CAPACITY } from "../engine/passengers.js";
import { nextStopIndex } from "../engine/express.js";
import { shiftBonus } from "../economy.js";
import { Tutorial, tutorialDone } from "../tutorial.js";
import { AlarmDesk } from "./alarms.js";
import { controlSteps } from "./controlTutorial.js";
import { NetHost, MAX_DRIVERS } from "../net/netHost.js";

/** Color de cada estado de tren en el esquema. */
const STATE_COLORS = {
  running: "#3fd07a", starting: "#3fd07a", approaching: "#9be37a",
  dwell: "#4aa3ff", closing: "#4aa3ff", ready: "#7cc0ff",
  held: "#ff4b4b", regulating: "#ffb020", signalStop: "#ff7a2a", stopped: "#ff7a2a",
  depot: "#6b7785", retiring: "#6b7785", cabChange: "#6b7785",
};
const ASPECT_COLORS = { red: "#ff3030", yellow: "#ffb000", green: "#27c96a" };
const LEVEL_COLORS = { alert: "#ff4b4b", warn: "#ffb020" };
const L = CONFIG.train.length;

/** Qué se puede supervisar. */
const SCOPES = [
  { id: "apprentice", name: "Aprendiz", lines: ["3"], title: "Línea 3", text: "Una sola línea y pocas alarmas. Ideal para empezar." },
  { id: "operator", name: "Operador", lines: ["1", "2", "3"], title: "Líneas 1, 2 y 3", text: "Tres líneas con combinaciones entre ellas." },
  { id: "chief", name: "Jefe de turno", lines: null, title: "Toda la red", text: "Las 7 líneas a la vez: muchas alarmas." },
];
const SPEEDS = [1, 2, 5, 10];
/** Sueldo por alarma atendida y duración mínima (s simulados) del turno para el bono. */
const PAY_PER_ALARM = 700, BONUS_MIN_TIME = 20 * 60;

const PREF = (k) => `metrosim.pcc.${k}`;
function readPref(k, def) { try { return localStorage.getItem(PREF(k)) ?? def; } catch { return def; } }
function writePref(k, v) { try { localStorage.setItem(PREF(k), v); } catch { /* sin almacenamiento */ } }

/** Estilos propios del Centro de Control (se inyectan una vez). */
const CSS = `
.pcc { position: fixed; inset: 0; z-index: 30; display: grid; grid-template-rows: auto 1fr; background: var(--bg); color: var(--text); font-family: var(--f-body);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); }
.pcc button { font: inherit; font-size: 14px; font-weight: 500; color: inherit; background: var(--raise); border: 1px solid #ffffff26; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.pcc button:hover:not(:disabled) { background: #1d2a38; }
.pcc button:disabled { opacity: .45; cursor: not-allowed; }
.pcc button.primary { background: #123a5c; border-color: #4aa3ffaa; color: #d8ecff; font-weight: 600; }
.pcc button.primary:hover:not(:disabled) { background: #17497a; }
.pcc button.danger { background: #4a1a1a; border-color: #ff4b4b88; color: #ffd6d6; }
.pcc button.danger:hover:not(:disabled) { background: #5e2121; }
.pcc button.ghost { background: transparent; }
.pcc button.on { background: #123826; border-color: #34d17c88; color: #bff0d3; }
.pcc .ico { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: -3px; }

/* Barra superior */
.pcc-top { display: flex; align-items: center; gap: 10px 14px; padding: 8px 14px; border-bottom: 1px solid var(--panel-border); flex-wrap: wrap; background: var(--surface); }
.pcc-title h1 { margin: 0; font: 700 21px/1 var(--f-display); letter-spacing: .5px; text-transform: uppercase; }
.pcc-title small { color: var(--muted); font-size: 12px; }
.pcc-views { display: flex; gap: 6px; flex-wrap: wrap; }
.pcc-views button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; position: relative; }
.pcc-views button.active { border-color: #fff9; background: #ffffff1a; }
.pcc-views .count { position: absolute; top: -7px; right: -7px; min-width: 18px; height: 18px; border-radius: 9px; background: #ff4b4b; color: #fff; font: 700 11px/18px var(--f-data); text-align: center; padding: 0 4px; }
.pcc-time { display: inline-flex; border: 1px solid #ffffff26; border-radius: 9px; overflow: hidden; margin-left: auto; }
.pcc-time button { border: 0; border-radius: 0; padding: 6px 10px; font-family: var(--f-data); font-size: 13px; background: transparent; }
.pcc-time button + button { border-left: 1px solid #ffffff1a; }
.pcc-time button.active { background: #4aa3ff33; color: #d8ecff; }
.pcc-time .pcc-pause.active { background: #ffb02033; color: #ffe2a6; }
.pcc-clock { font: 700 22px/1 var(--f-data); font-variant-numeric: tabular-nums; min-width: 6.2ch; }
.pcc-clock.paused { color: #ffb020; animation: pccBlink 1s steps(2) infinite; }
.pcc-score { font-family: var(--f-data) !important; }
.pcc-score b { font-size: 15px; }
.pcc-icon-btn { display: inline-flex; align-items: center; gap: 6px; }
.pcc-end { background: #2a2312 !important; border-color: #ffc24788 !important; color: #ffe2a6; }
.pcc-room.live { background: #123826; border-color: #34d17c88; color: #bff0d3; }
.pcc-code { font: 700 46px/1 var(--f-data); letter-spacing: 10px; text-align: center; padding: 14px 0 10px; color: #ffd166; user-select: all; }
.pcc-dialog .pcc-drivers { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.pcc-dialog .pcc-drivers li { display: flex; gap: 8px; align-items: center; background: var(--raise); border-radius: 8px; padding: 7px 10px; font-size: 14px; }
.pcc-dialog .pcc-drivers li small { margin-left: auto; color: #9fb0c0; font-family: var(--f-data); }
.pcc-error { color: #ff8a8a !important; }

/* Cuerpo */
.pcc-body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; padding: 12px 14px; min-height: 0; overflow: auto; }
.pcc-main { display: grid; gap: 10px; align-content: start; min-width: 0; position: relative; }
.pcc-summary { display: flex; flex-wrap: wrap; gap: 8px; }
.pcc-kpi { background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 8px 12px; min-width: 110px; flex: 1; }
.pcc-kpi span { display: block; font: 600 10px/1.2 var(--f-data); letter-spacing: 1.2px; text-transform: uppercase; color: var(--muted); }
.pcc-kpi b { font: 700 20px/1.2 var(--f-data); font-variant-numeric: tabular-nums; }
.pcc-kpi.bad b { color: #ff8a8a; } .pcc-kpi.good b { color: #8fe3b0; }
.pcc-lines { display: grid; gap: 10px; min-width: 0; }
.pcc-line { background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 8px 12px 6px; min-width: 0; }
.pcc-line header { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
.pcc-badge { min-width: 28px; height: 28px; padding: 0 4px; border-radius: 7px; display: inline-grid; place-items: center; font: 700 16px/1 var(--f-display); flex: none; }
.pcc-badge.sm { min-width: 20px; height: 20px; font-size: 12px; border-radius: 5px; }
.pcc-line header strong { font: 700 18px/1 var(--f-display); letter-spacing: .4px; }
.pcc-line header small { color: var(--muted); font-size: 12px; }
.pcc-kpis { display: flex; gap: 4px 14px; flex-wrap: wrap; color: var(--muted); font-size: 12.5px; margin-left: auto; }
.pcc-kpis b { color: var(--text); font-family: var(--f-data); font-variant-numeric: tabular-nums; }
.pcc-kpis .bad b { color: #ff8a8a; }
.pcc-switch { display: inline-flex !important; align-items: center; gap: 8px; font-size: 12.5px !important; padding: 4px 10px !important; }
.pcc-switch i { width: 30px; height: 16px; border-radius: 8px; background: #ffffff26; position: relative; transition: background .2s; }
.pcc-switch i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #c9d4df; transition: left .2s; }
.pcc-switch.on i { background: #34d17c; } .pcc-switch.on i::after { left: 16px; background: #fff; }
.pcc-scroll { min-width: 0; }
.pcc-line canvas { width: 100%; height: 128px; display: block; cursor: pointer; touch-action: pan-x pan-y; }
.pcc-lines.single .pcc-line canvas { height: clamp(300px, 46vh, 440px); }
.pcc-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); padding: 0 2px; }
.pcc-legend i { display: inline-block; width: 14px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.pcc-legend .ring { width: 10px; height: 10px; border-radius: 50%; background: none; border: 2px solid #ff4b4b; }
.pcc-legend .x { background: none; width: auto; height: auto; color: #ff3030; font-weight: 700; font-style: normal; margin-right: 4px; }
.pcc-toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 6; background: #0b1118f2; border: 1px solid #ffffff2e; border-left: 4px solid #4aa3ff;
  border-radius: 10px; padding: 9px 14px; font-size: 14px; max-width: min(560px, calc(100% - 32px)); box-shadow: 0 10px 30px #000a; pointer-events: none; }
.pcc-toast.ok { border-left-color: #34d17c; } .pcc-toast.warn { border-left-color: #ffb020; } .pcc-toast.alert { border-left-color: #ff4b4b; }
.pcc-tip { position: fixed; z-index: 7; pointer-events: none; background: #0b1118f5; border: 1px solid #ffffff2e; border-radius: 8px; padding: 6px 9px; font-size: 12.5px; line-height: 1.35; max-width: 260px; box-shadow: 0 6px 20px #0009; }
.pcc-tip b { font-family: var(--f-data); }

/* Columna lateral */
.pcc-side { display: grid; gap: 12px; align-content: start; min-width: 0; }
.pcc-card { background: var(--surface); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 12px 14px; position: relative; min-width: 0; }
.pcc-card h2 { margin: 0 0 8px; font: 600 10.5px/1.2 var(--f-data); letter-spacing: 1.3px; text-transform: uppercase; color: var(--muted); }
.pcc-empty { color: var(--muted); font-size: 13px; margin: 0; }
.pcc-train-close { position: absolute; top: 8px; right: 8px; padding: 2px 9px !important; }
.pcc-train-close[hidden] { display: none; }
.pcc-train-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding-right: 34px; }
.pcc-train-head b { font: 700 20px/1 var(--f-data); display: block; }
.pcc-train-head small { color: var(--muted); font-size: 12.5px; }
.pcc-state { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); margin-bottom: 8px; }
.pcc-train dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 8px; font-size: 13px; }
.pcc-train dt { color: var(--muted); }
.pcc-train dd { margin: 0; }
.pcc-load { display: inline-block; width: 70px; height: 7px; border-radius: 4px; background: #ffffff1a; vertical-align: middle; margin-left: 6px; overflow: hidden; }
.pcc-load i { display: block; height: 100%; }
.pcc-note { font-size: 12.5px; padding: 6px 9px; border-radius: 8px; background: #ffffff0d; margin: 0 0 8px; }
.pcc-note.warn { background: #ffb0201a; color: #ffe2a6; }
.pcc-train-alarm:empty { display: none; }
.pcc-train-alarm { border: 1px solid #ff4b4b66; background: #ff4b4b12; border-radius: 9px; padding: 8px 10px; margin-bottom: 10px; }
.pcc-train-alarm b { display: block; font-size: 13.5px; margin-bottom: 6px; }
.pcc-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.pcc-actions .wide { grid-column: span 3; }
.pcc-actions button { padding: 8px 6px; font-size: 13px; line-height: 1.2; }
.pcc-actions small { grid-column: span 3; color: var(--muted); font-size: 11.5px; line-height: 1.4; }
.pcc-acts-row { display: flex; gap: 6px; flex-wrap: wrap; }
.pcc-acts-row button { padding: 7px 10px; font-size: 13px; }

/* Pestañas */
.pcc-tabs { display: flex; gap: 4px; margin: -4px -4px 10px; }
.pcc-tabs button { flex: 1; border-color: transparent; background: transparent; font-size: 13.5px; padding: 7px 6px; }
.pcc-tabs button.active { background: #ffffff14; border-color: #ffffff2e; font-weight: 700; }
.pcc-tabs .count { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 9px; background: #ff4b4b; color: #fff; font: 700 11px/18px var(--f-data); margin-left: 4px; }
.pcc-tabs .count:empty { display: none; }
.pcc-tab:not(.active) { display: none; }
.pcc-alarms { display: grid; gap: 8px; max-height: min(56vh, 560px); overflow: auto; }
.pcc-alarm { border: 1px solid #ffffff1f; border-left: 4px solid var(--c); border-radius: 9px; padding: 8px 10px; background: #ffffff06; }
.pcc-alarm.fresh { animation: pccFlash 1.2s ease-out 2; }
.pcc-alarm header { display: flex; align-items: center; gap: 8px; }
.pcc-alarm header b { font-size: 14px; flex: 1; }
.pcc-alarm time { font: 600 12px/1 var(--f-data); color: var(--muted); }
.pcc-alarm p { margin: 5px 0 7px; font-size: 12.5px; color: #c9d4df; line-height: 1.4; }
.pcc-alarm.resolved { opacity: .6; border-left-color: #34d17c; }
.pcc-alarm.resolved p { display: none; }
.pcc-ok { color: #8fe3b0; font-size: 13px; padding: 8px 2px; }
.pcc-sort { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; font-size: 12.5px; color: var(--muted); flex-wrap: wrap; }
.pcc-sort button { padding: 4px 9px; font-size: 12.5px; }
.pcc-sort button.active { background: #ffffff1f; border-color: #fff8; color: var(--text); }
.pcc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pcc-table-wrap { max-height: min(56vh, 560px); overflow: auto; }
.pcc-table th { text-align: left; color: var(--muted); font-weight: 600; padding: 4px 6px; position: sticky; top: 0; background: var(--surface); }
.pcc-table td { padding: 5px 6px; border-top: 1px solid #ffffff10; white-space: nowrap; }
.pcc-table tr[data-train] { cursor: pointer; }
.pcc-table tr[data-train]:hover td { background: #ffffff0a; }
.pcc-table tr.sel td { background: #4aa3ff1f; }
.pcc-table .late { color: #ff8a8a; }
.pcc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.pcc-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12.5px; max-height: min(56vh, 560px); overflow: auto; }
.pcc-log li { padding: 5px 7px; border-radius: 6px; background: #ffffff08; display: flex; gap: 6px; align-items: baseline; }
.pcc-log li[data-train] { cursor: pointer; }
.pcc-log li[data-train]:hover { background: #ffffff12; }
.pcc-log time { color: var(--muted); font-family: var(--f-data); flex: none; }
.pcc-log .warn { box-shadow: inset 3px 0 #ffb020; } .pcc-log .alert { box-shadow: inset 3px 0 #ff4b4b; } .pcc-log .ok { box-shadow: inset 3px 0 #3fd07a; }

/* Ventanas (inicio de turno, informe, ayuda) */
.pcc-modal { position: fixed; inset: 0; z-index: 8; display: grid; place-items: center; background: #000a; padding: 16px; overflow: auto; }
.pcc-modal[hidden] { display: none; }
.pcc-dialog { width: min(560px, 100%); background: var(--surface); border: 1px solid #ffffff2e; border-radius: 14px; padding: 20px 22px; box-shadow: 0 30px 80px #000c; display: grid; gap: 12px; }
.pcc-dialog h2 { margin: 0; font: 700 26px/1.05 var(--f-display); letter-spacing: .4px; }
.pcc-dialog h3 { margin: 4px 0 0; font: 600 15px/1.2 var(--f-body); color: #c9d4df; }
.pcc-dialog p { margin: 0; color: #c9d4df; font-size: 14px; line-height: 1.45; }
.pcc-dialog ul { margin: 0; padding-left: 18px; color: #c9d4df; font-size: 13.5px; line-height: 1.5; display: grid; gap: 3px; }
.pcc-scopes { display: grid; gap: 8px; }
.pcc-scopes button { text-align: left; display: grid; gap: 2px; padding: 10px 14px; border-radius: 10px; }
.pcc-scopes button b { font-size: 15px; } .pcc-scopes button span { color: var(--muted); font-size: 13px; }
.pcc-scopes button.active { border-color: #4aa3ff; background: #4aa3ff1f; box-shadow: inset 0 0 0 1px #4aa3ff; }
.pcc-check { display: flex; gap: 8px; align-items: center; font-size: 14px; cursor: pointer; }
.pcc-check input { width: 18px; height: 18px; accent-color: #4aa3ff; }
.pcc-dialog footer { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }
.pcc-dialog footer button { padding: 9px 16px; }
.pcc-grade { display: flex; align-items: center; gap: 16px; }
.pcc-grade strong { font: 800 64px/1 var(--f-display); width: 80px; height: 80px; border-radius: 16px; display: grid; place-items: center; background: #ffffff10; border: 2px solid var(--c); color: var(--c); }
.pcc-grade div b { font: 700 28px/1 var(--f-data); display: block; }
.pcc-grade div span { color: var(--muted); font-size: 13px; }
.pcc-rows { display: grid; grid-template-columns: 1fr auto; gap: 5px 14px; font-size: 14px; }
.pcc-rows span { color: #c9d4df; } .pcc-rows b { font-family: var(--f-data); text-align: right; }
.pcc-rows .total { border-top: 1px solid #ffffff26; padding-top: 6px; font-size: 16px; color: var(--text); }
.pcc-keys { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 13px; color: #c9d4df; }

/* Tutorial del Centro de Control: abajo a la izquierda, sobre el esquema */
.pcc .tutorial-control { top: auto; bottom: 16px; left: 16px; z-index: 5; }
.pcc .tutorial .go-button { background: var(--warn); color: #1a1405; border-color: transparent; font-weight: 700; }
.pcc .tutorial .ghost-button { background: transparent; }

@keyframes pccBlink { 50% { opacity: .35; } }
@keyframes pccFlash { 0% { background: #ff4b4b33; } 100% { background: #ffffff06; } }
@media (prefers-reduced-motion: reduce) { .pcc-alarm.fresh, .pcc-clock.paused { animation: none; } }

@media (max-width: 1000px) {
  .pcc-body { grid-template-columns: 1fr; }
  .pcc-alarms, .pcc-log, .pcc-table-wrap { max-height: 50vh; }
}
/* Celular: barra compacta, esquema grande desplazable de lado y ficha del tren como hoja inferior */
@media (max-width: 760px) {
  .pcc-top { gap: 6px 8px; padding: 6px 10px; }
  .pcc-title h1 { font-size: 15px; }
  .pcc-title small, .pcc-icon-btn span { display: none; }
  .pcc-time { margin-left: 0; }
  .pcc-clock { font-size: 17px; margin-left: auto; }
  .pcc-end { padding: 6px 9px !important; font-size: 13px !important; }
  .pcc-body { padding: 8px 8px 24px; gap: 8px; }
  .pcc-kpi { min-width: 80px; padding: 6px 9px; } .pcc-kpi b { font-size: 16px; }
  .pcc-line { padding: 6px 8px; }
  .pcc-kpis { margin-left: 0; flex-basis: 100%; font-size: 12px; }
  .pcc-lines.single .pcc-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; margin: 0 -8px; padding: 0 8px; }
  .pcc-lines.single .pcc-line canvas { width: 900px; max-width: none; height: 230px; }
  .pcc-line canvas { height: 110px; }
  .pcc button { min-height: 36px; }
  .pcc-train.has-train { position: fixed; left: 6px; right: 6px; bottom: calc(6px + env(safe-area-inset-bottom)); z-index: 4;
    max-height: 58vh; overflow: auto; box-shadow: 0 -10px 40px #000c; border-color: #4aa3ff88; }
  .pcc-train:not(.has-train) { display: none; }
  .pcc .tutorial.tutorial-control { top: calc(var(--pcc-top, 100px) + 6px); bottom: auto; left: 50%; transform: translateX(-50%); }
  .pcc-toast { bottom: 12px; }
}
`;

export class ControlCenter {
  /**
   * @param {object} opts
   * @param {import("../engine/engine.js").MetroEngine} opts.engine
   * @param {() => void} opts.onExit                     volver al menú
   * @param {(amount:number, concept:string) => void} [opts.onPay]   cobrar el sueldo del turno
   * @param {boolean} [opts.tutorial]                    empezar con el tutorial
   * @param {boolean} [opts.touch]                       pantalla táctil (textos sin teclas)
   */
  constructor({ engine, onExit, onPay = () => {}, tutorial = false, touch = false }) {
    this.engine = engine;
    this.onExit = onExit;
    this.onPay = onPay;
    this.touch = touch;
    this.wantTutorial = tutorial || !tutorialDone("control");
    this.lines = new Set();          // líneas supervisadas (se eligen al empezar)
    this.view = "all";               // "all" o id de una línea
    this.speed = 1;
    this.paused = true;              // hasta empezar el turno
    this.started = false;
    this.selected = null;            // id del tren seleccionado
    this.tab = "alarms";
    this.trainSort = "delay";
    this.logFilter = "important";
    this.did = new Set();            // órdenes cumplidas (para el tutorial)
    this.log = [];
    this.unsub = [];
    this.panels = [];
    this.sound = readPref("sound", "on") === "on";
    this.scope = SCOPES.find(s => s.id === readPref("scope", "apprentice")) || SCOPES[0];
    this.slowT = 0;
    injectCss();
    this.buildDom();
    this.listen();
    this.bindInput();
    this.showSetup();
  }

  /* ======================================================================
     Interfaz
     ====================================================================== */
  buildDom() {
    const root = document.createElement("section");
    root.className = "pcc";
    root.innerHTML = `
      <div class="pcc-top">
        <button class="pcc-icon-btn" data-act="exit" title="Volver al menú">${icon("back")}<span>Menú</span></button>
        <div class="pcc-title"><h1>Centro de Control</h1><small class="pcc-scope">Metro de Santiago · red en tiempo real</small></div>
        <nav class="pcc-views" aria-label="Qué ver"></nav>
        <div class="pcc-time" role="group" aria-label="Velocidad del tiempo">
          <button class="pcc-pause" data-act="pause" title="Pausa (Espacio)" aria-label="Pausa">${icon("pause")}</button>
          ${SPEEDS.map(s => `<button data-speed="${s}" title="Tiempo ×${s}">×${s}</button>`).join("")}
        </div>
        <span class="pcc-clock" title="Hora de la simulación">--:--:--</span>
        <button class="pcc-score" data-act="report" title="Nota del turno (toca para ver el detalle)">Nota <b>—</b></button>
        <button class="pcc-icon-btn" data-act="sound" title="Sonido de las alarmas"></button>
        <button class="pcc-icon-btn pcc-room" data-act="room" title="Multijugador: que otros jugadores conduzcan en tu red" hidden>👥<span>Sala</span></button>
        <button class="pcc-icon-btn" data-act="help" title="Ayuda y atajos">${icon("help")}<span>Ayuda</span></button>
        <button class="pcc-end" data-act="end">${icon("flag")} Terminar turno</button>
      </div>
      <div class="pcc-body">
        <main class="pcc-main">
          <div class="pcc-summary"></div>
          <div class="pcc-lines"></div>
          <div class="pcc-legend">${legendHtml()}</div>
        </main>
        <aside class="pcc-side">
          <section class="pcc-card pcc-train">
            <button class="pcc-train-close" data-act="deselect" aria-label="Cerrar ficha" hidden>✕</button>
            <h2>Tren seleccionado</h2>
            <div class="pcc-train-info"></div>
            <div class="pcc-train-alarm"></div>
            <div class="pcc-train-actions"></div>
          </section>
          <section class="pcc-card">
            <div class="pcc-tabs" role="tablist">
              <button data-tab="alarms" role="tab">Alarmas<span class="count"></span></button>
              <button data-tab="trains" role="tab">Trenes</button>
              <button data-tab="log" role="tab">Registro</button>
            </div>
            <div class="pcc-tab pcc-alarms" data-pane="alarms"></div>
            <div class="pcc-tab" data-pane="trains">
              <div class="pcc-sort">Ordenar por
                <button data-sort="delay">Retraso</button><button data-sort="load">Carga</button><button data-sort="id">Nombre</button>
              </div>
              <div class="pcc-table-wrap"><table class="pcc-table"></table></div>
            </div>
            <div class="pcc-tab" data-pane="log">
              <div class="pcc-sort">Mostrar
                <button data-logf="important">Lo importante</button><button data-logf="all">Todo</button>
              </div>
              <ul class="pcc-log"></ul>
            </div>
          </section>
        </aside>
      </div>
      <div class="pcc-tip" hidden></div>
      <div class="pcc-toast" hidden></div>
      <div class="pcc-modal" hidden><div class="pcc-dialog" role="dialog" aria-modal="true"></div></div>`;
    document.body.append(root);
    this.root = root;
    const q = (s) => root.querySelector(s);
    this.clockEl = q(".pcc-clock");
    this.scoreEl = q(".pcc-score b");
    this.viewsEl = q(".pcc-views");
    this.summaryEl = q(".pcc-summary");
    this.linesEl = q(".pcc-lines");
    this.trainCard = q(".pcc-train");
    this.trainInfo = q(".pcc-train-info");
    this.trainAlarm = q(".pcc-train-alarm");
    this.trainActions = q(".pcc-train-actions");
    this.alarmsEl = q(".pcc-alarms");
    this.alarmCount = q(".pcc-tabs .count");
    this.tableEl = q(".pcc-table");
    this.logEl = q(".pcc-log");
    this.tipEl = q(".pcc-tip");
    this.toastEl = q(".pcc-toast");
    this.modalEl = q(".pcc-modal");
    this.dialogEl = q(".pcc-dialog");
    this.soundBtn = q("[data-act=sound]");
    // Alto de la barra superior (en el celular ocupa varias filas): el tutorial se pone justo debajo
    this.topObserver = new ResizeObserver(() => root.style.setProperty("--pcc-top", `${q(".pcc-top").getBoundingClientRect().bottom}px`));
    this.topObserver.observe(q(".pcc-top"));
    this.renderSoundBtn();
    this.setTab(this.tab);
    this.renderTimeButtons();
  }

  /** Paneles de las líneas supervisadas (al empezar el turno). */
  buildPanels() {
    this.linesEl.innerHTML = "";
    this.panels = [];
    for (const ls of this.engine.lines.values()) {
      if (!this.lines.has(ls.line.id)) continue;
      const el = document.createElement("article");
      el.className = "pcc-line";
      el.innerHTML = `
        <header>
          <span class="pcc-badge" style="background:${ls.line.color};color:${textOn(ls.line.color)}">${ls.line.id}</span>
          <div><strong>${ls.line.name}</strong><br><small>${ls.line.stations[0].name} ⇄ ${ls.line.stations.at(-1).name}</small></div>
          <div class="pcc-kpis"></div>
          <button class="pcc-switch" data-act="reg" data-line="${ls.line.id}" title="La regulación automática retiene unos segundos a los trenes que van muy juntos"></button>
          <button class="pcc-zoom ghost" data-act="view" data-view="${ls.line.id}" title="Ver en grande">Ver ›</button>
        </header>
        <div class="pcc-scroll"><canvas aria-label="Esquema de la ${ls.line.name}"></canvas></div>`;
      this.linesEl.append(el);
      const canvas = el.querySelector("canvas");
      const p = { ls, el, canvas, ctx: canvas.getContext("2d"), kpis: el.querySelector(".pcc-kpis"), regBtn: el.querySelector("[data-act=reg]"), zoom: el.querySelector(".pcc-zoom") };
      canvas.addEventListener("click", (ev) => this.pick(p, ev));
      canvas.addEventListener("mousemove", (ev) => this.hover(p, ev));
      canvas.addEventListener("mouseleave", () => { this.tipEl.hidden = true; });
      this.panels.push(p);
    }
    // Botones de vista: toda la red (si hay más de una línea) y cada línea
    const multi = this.lines.size > 1;
    this.viewsEl.innerHTML = (multi ? `<button data-act="view" data-view="all" title="Toda la red (0)">Red</button>` : "")
      + this.panels.map((p, i) => `<button data-act="view" data-view="${p.ls.line.id}" title="${p.ls.line.name}${multi ? ` (${i + 1})` : ""}">
          <span class="pcc-badge sm" style="background:${p.ls.line.color};color:${textOn(p.ls.line.color)}">${p.ls.line.id}</span><span class="count" hidden></span></button>`).join("");
    this.setView(multi ? "all" : this.panels[0].ls.line.id);
  }

  /* ----- Estado de la interfaz (también lo usa el tutorial) ----- */
  setView(id) {
    this.view = id;
    const single = id !== "all";
    this.linesEl.classList.toggle("single", single);
    for (const p of this.panels) {
      p.el.hidden = single && p.ls.line.id !== id;
      p.zoom.hidden = single;
    }
    this.viewsEl.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === id));
    this.tipEl.hidden = true;
    this.lastSummary = null;
    this.update();
  }

  setSpeed(s) {
    if (this.net && s !== 1) return this.toast("Con la sala abierta el tiempo corre a ×1 para todos", "info");
    this.speed = s;
    this.paused = false;
    this.renderTimeButtons();
  }

  togglePause() {
    if (this.net) return this.toast("Con la sala abierta no se puede pausar: los conductores siguen en la vía", "info");
    this.paused = !this.paused;
    this.renderTimeButtons();
  }

  renderTimeButtons() {
    this.root.querySelectorAll("[data-speed]").forEach(b => b.classList.toggle("active", !this.paused && Number(b.dataset.speed) === this.speed));
    const pause = this.root.querySelector(".pcc-pause");
    pause.classList.toggle("active", this.paused);
    pause.innerHTML = icon(this.paused ? "play" : "pause");
    pause.title = this.paused ? "Seguir (Espacio)" : "Pausa (Espacio)";
    this.clockEl.classList.toggle("paused", this.paused && this.started);
  }

  setTab(tab) {
    this.tab = tab;
    this.root.querySelectorAll("[data-tab]").forEach(b => { b.classList.toggle("active", b.dataset.tab === tab); b.setAttribute("aria-selected", b.dataset.tab === tab); });
    this.root.querySelectorAll("[data-pane]").forEach(p => p.classList.toggle("active", p.dataset.pane === tab));
    this.root.querySelectorAll("[data-sort]").forEach(b => b.classList.toggle("active", b.dataset.sort === this.trainSort));
    this.root.querySelectorAll("[data-logf]").forEach(b => b.classList.toggle("active", b.dataset.logf === this.logFilter));
    this.lastTable = this.lastAlarms = null;
    this.logDirty = true;
  }

  select(id) {
    this.selected = id;
    this.lastTrainInfo = this.lastTrainActions = this.lastTrainAlarm = null;
    this.renderTrain();
  }

  renderSoundBtn() {
    this.soundBtn.innerHTML = `${icon(this.sound ? "soundOn" : "soundOff")}<span>${this.sound ? "Sonido" : "Silencio"}</span>`;
  }

  /* ======================================================================
     Entrada: clics, teclado
     ====================================================================== */
  bindInput() {
    const root = this.root;
    // Mientras se pulsa, no se rehace el HTML (el clic no se pierde)
    root.addEventListener("pointerdown", () => { this.pressing = true; });
    this.onPointerUp = () => { this.pressing = false; };
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);

    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("button, [data-train]");
      if (!t || !root.contains(t)) return;
      if (t.disabled) return;
      const d = t.dataset;
      if (d.speed) return this.setSpeed(Number(d.speed));
      if (d.tab) return this.setTab(d.tab);
      if (d.sort) { this.trainSort = d.sort; return this.setTab(this.tab); }
      if (d.logf) { this.logFilter = d.logf; return this.setTab(this.tab); }
      if (d.scope) {
        this.scope = SCOPES.find(s => s.id === d.scope);
        this.dialogEl.querySelectorAll("[data-scope]").forEach(b => b.classList.toggle("active", b === t));
        return;
      }
      switch (d.act) {
        case "exit": return this.requestExit();
        case "deselect": return this.select(null);
        case "pause": return this.togglePause();
        case "sound": this.sound = !this.sound; writePref("sound", this.sound ? "on" : "off"); return this.renderSoundBtn();
        case "help": return this.showHelp();
        case "room": return this.showRoom();
        case "room-open": return this.openRoom();
        case "room-close": this.closeRoom(); return this.showRoom();
        case "report": return this.showReport({ ending: false });
        case "end": return this.showReport({ ending: true });
        case "view": return this.setView(d.view);
        case "reg": {
          const ls = this.engine.line(d.line);
          return this.order("control.regulation", { on: !ls.regulator.enabled, line: ls.line.id });
        }
        case "cmd": return this.order(d.cmd, { trainId: this.selected, ...(d.seconds ? { seconds: Number(d.seconds) } : {}) });
        case "alarm": return this.alarmAction(Number(d.alarm), Number(d.idx));
        case "focus-line": { const u = this.engine.findTrain(this.selected); if (u) this.setView(u.route.line.id); return; }
        case "start": return this.startShift();
        case "modal-close": return this.closeModal();
        case "pay-exit": this.payShift(); return this.onExit();
        case "pay-new": this.payShift(); this.desk.reset(); this.addLog("Nuevo turno: la nota vuelve a empezar", "ok"); return this.closeModal();
        case "tutorial": this.closeModal(); return this.startTutorial();
      }
      if (d.train) { this.select(d.train); if (this.touch) this.trainCard.scrollIntoView?.({ block: "nearest" }); }
    });

    this.onKey = (ev) => this.key(ev);
    window.addEventListener("keydown", this.onKey);
  }

  key(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target.closest?.("input, select, textarea")) return;
    const key = ev.key.toLowerCase();
    if (this.modal) {
      if (key === "escape" && this.modalClosable) this.closeModal();
      return;
    }
    if (this.tutorial?.onKey(key)) { ev.preventDefault(); return; }
    const u = this.selected ? this.engine.findTrain(this.selected) : null;
    if (key === " ") { ev.preventDefault(); return this.togglePause(); }
    if (key === "escape") return this.select(null);
    if (key === "0" && this.lines.size > 1) return this.setView("all");
    if (/^[1-9]$/.test(key)) { const p = this.panels[Number(key) - 1]; if (p) this.setView(p.ls.line.id); return; }
    if (key === "+" || key === "=") return this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(this.speed) + 1)]);
    if (key === "-") return this.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(this.speed) - 1)]);
    if (!u) return;
    if (key === "r") return this.order("control.hold", { trainId: u.id, seconds: 60 });
    if (key === "l") return this.order("control.release", { trainId: u.id });
    if (key === "s") return this.order("control.skip", { trainId: u.id });
    if (key === "a") {
      const a = this.desk?.forTrain(u);
      const i = a ? a.actions().findIndex(x => x.cmd && !x.disabled) : -1;
      if (a && i >= 0) this.alarmAction(a.id, i);
    }
  }

  /** Orden al motor (la respuesta llega por "command:result"). */
  order(type, payload) {
    if (!this.started) return;
    this.engine.command(type, { ...payload, source: "pcc" });
    if (this.paused) this.engine.commands.process();   // en pausa también se cumplen
  }

  alarmAction(id, idx) {
    const a = this.desk.alarms.find(x => x.id === id);
    const act = a?.actions()[idx];
    if (!act || act.disabled) return;
    if (act.dismiss) {
      this.desk.dismiss(a);
      this.addLog(`${a.title}: ${act.label.toLowerCase()}`, "info", a.line, a.unit?.id);
      this.toast(`${act.label} · ${a.unit?.id ?? ""}`, "info");
    } else this.order(act.cmd, act.payload);
    this.lastAlarms = this.lastTrainAlarm = null;
  }

  /* ======================================================================
     Turno: inicio, tutorial, informe
     ====================================================================== */
  showSetup() {
    this.openModal("setup", false, `
      <h2>Nuevo turno en el PCC</h2>
      <p>Eres jefe de turno del Puesto Central de Control: vigilas los trenes en tiempo real, atiendes las alarmas y das órdenes para que todo funcione a tiempo. ¿Qué vas a supervisar?</p>
      <div class="pcc-scopes">
        ${SCOPES.map(s => `<button data-scope="${s.id}" class="${s === this.scope ? "active" : ""}"><b>${s.title} · ${s.name}</b><span>${s.text}</span></button>`).join("")}
      </div>
      <label class="pcc-check"><input type="checkbox" class="pcc-tut" ${this.wantTutorial ? "checked" : ""}> Con tutorial (recomendado la primera vez)</label>
      <footer>
        <button class="ghost" data-act="exit">Volver</button>
        <button class="primary" data-act="start">Empezar turno ›</button>
      </footer>`);
    this.dialogEl.querySelector("[data-act=start]").focus();
  }

  startShift() {
    if (this.started) return;
    const tutorial = this.dialogEl.querySelector(".pcc-tut")?.checked;
    writePref("scope", this.scope.id);
    const ids = this.scope.lines ?? [...this.engine.lines.keys()];
    this.lines = new Set(ids.filter(id => this.engine.lines.has(id)));
    this.engine.pcc = { lines: this.lines };
    this.desk = new AlarmDesk(this.engine, this.lines, { onNew: (a) => this.onAlarm(a) });
    this.root.querySelector(".pcc-scope").textContent = `${this.scope.title} · ${this.scope.name}`;
    this.buildPanels();
    this.closeModal(true);
    this.started = true;
    this.paused = false;
    this.renderTimeButtons();
    this.root.querySelector(".pcc-room").hidden = false;
    this.addLog(`Turno iniciado en el Puesto Central de Control · ${this.scope.title}`, "ok");
    unlockAudio();
    if (tutorial) this.startTutorial();
  }

  startTutorial() {
    this.tutorial?.destroy();
    this.engine.pcc.quiet = true;                     // sin incidentes al azar mientras se aprende (el tutorial provoca los suyos)
    const k = (keys, touchText) => this.touch ? touchText : keys;
    this.tutorial = new Tutorial({
      mode: "control", parent: this.root, touch: this.touch, steps: controlSteps(k),
      onStep: () => beep("ok", this.sound),
      onFinish: () => { this.tutorial = null; this.engine.pcc && (this.engine.pcc.quiet = false); this.toast("Tutorial completado · lo puedes repetir desde Ayuda", "ok"); },
    });
  }

  /** Volver al menú (botón o gesto atrás): cierra la ventana abierta, o muestra el informe antes de salir. */
  requestExit() {
    if (this.modal && this.modalClosable) return this.closeModal();
    if (!this.started || (this.desk.score().duration < 120 && !this.desk.score().handled)) return this.onExit();
    this.showReport({ ending: true, exiting: true });
  }

  /** Sueldo del turno: por alarma atendida y bono según la nota (turnos de 20 min o más). */
  pay(sc) {
    const alarms = sc.handled * PAY_PER_ALARM;
    const bonus = sc.duration >= BONUS_MIN_TIME ? shiftBonus(sc.grade) : 0;
    return { alarms, bonus, total: alarms + bonus };
  }

  payShift() {
    const sc = this.desk.score(), p = this.pay(sc);
    if (p.total > 0) this.onPay(p.total, `Sueldo PCC · turno nota ${sc.grade} (${this.scope.title})`);
  }

  showReport({ ending, exiting = false }) {
    if (!this.started) return;
    const sc = this.desk.score(), p = this.pay(sc);
    const color = { S: "#ffd166", A: "#34d17c", B: "#4aa3ff", C: "#ffb020", D: "#ff7a7a" }[sc.grade];
    const pct = (x) => `${Math.round(x * 100)} %`;
    const mins = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
    this.openModal("report", true, `
      <h2>${ending ? "Informe del turno" : "Tu turno hasta ahora"}</h2>
      <div class="pcc-grade" style="--c:${color}"><strong>${sc.grade}</strong><div><b>${sc.score} / 100</b><span>${this.scope.title} · ${mins(sc.duration)} de turno</span></div></div>
      <div class="pcc-rows">
        <span>Llegadas puntuales (${sc.arrivals} llegadas)</span><b>${pct(sc.punctuality)}</b>
        <span>Calidad de tu respuesta a las alarmas</span><b>${sc.alarms ? pct(sc.response) : "—"}</b>
        <span>Alarmas atendidas</span><b>${sc.handled} de ${sc.alarms}</b>
        <span>Tiempo de trenes esperándote detenidos</span><b>${mins(sc.waitSeconds)}</b>
        <span>Órdenes dadas</span><b>${sc.orders}</b>
      </div>
      <p>La nota pesa la puntualidad (45 %), la rapidez con que atiendes las alarmas (40 %) y el tiempo que los trenes esperan tu decisión (15 %).</p>
      <div class="pcc-rows">
        <span>Sueldo por alarmas atendidas (${formatCLP(PAY_PER_ALARM)} c/u)</span><b>${formatCLP(p.alarms)}</b>
        <span>Bono por nota ${sc.grade}${sc.duration < BONUS_MIN_TIME ? " (desde 20 min de turno)" : ""}</span><b>${formatCLP(p.bonus)}</b>
        <span class="total">Total</span><b class="total">${formatCLP(p.total)}</b>
      </div>
      <footer>
        <button class="ghost" data-act="modal-close">${exiting ? "Seguir supervisando" : "Volver al turno"}</button>
        ${ending ? `<button data-act="pay-new">${p.total ? "Cobrar y empezar otro turno" : "Empezar otro turno"}</button>
        <button class="primary" data-act="pay-exit">${p.total ? "Cobrar y volver al menú" : "Volver al menú"}</button>` : ""}
      </footer>`);
  }

  /* ======================================================================
     Multijugador: sala para conductores
     ====================================================================== */
  showRoom(error = null) {
    const net = this.net;
    const drivers = net?.drivers ?? [];
    const list = drivers.length ? `<ul class="pcc-drivers">${drivers.map(p => `<li>👤 <b>${escapeHtml(p.name)}</b> L${p.line} · ${escapeHtml(p.unit?.id ?? p.trip?.id ?? "")}<small>${p.unit ? TRAIN_STATES[p.unit.state] ?? "" : "cargando…"}</small></li>`).join("")}</ul>`
      : `<p>Aún no entra nadie. Cuando un conductor se una, su tren aparece en el esquema con su nombre.</p>`;
    this.openModal("room", true, net ? `
      <h2>Sala abierta</h2>
      <p>Comparte este código. Cada conductor abre MetroSim, elige una de tus líneas (${[...this.lines].map(id => `L${id}`).join(", ")}) y su servicio, y pulsa <b>«Unirse a una sala»</b> en la tarjeta Conductor.</p>
      <div class="pcc-code" aria-label="Código de la sala">${net.code}</div>
      <h3>Conductores (${drivers.length} de ${MAX_DRIVERS})</h3>
      ${list}
      <p>Sus trenes reciben tus órdenes por radio: retener y liberar (desde su ficha) y autorizar el paso por una señal averiada (desde la alarma). Con la sala abierta el tiempo corre a ×1 y no se pausa.</p>
      <footer>
        <button class="danger" data-act="room-close">Cerrar sala</button>
        <button class="primary" data-act="modal-close">Volver al turno</button>
      </footer>` : `
      <h2>Multijugador</h2>
      <p>Abre una sala para que hasta ${MAX_DRIVERS} amigos conduzcan trenes de verdad en tu red, desde su propio computador o celular: tú los ves en el esquema, les das órdenes por radio y su puntualidad cuenta en tu nota.</p>
      <p>Necesita internet (la conexión es directa entre los navegadores). Mientras la sala esté abierta, el tiempo corre a ×1 y no se puede pausar.</p>
      ${error ? `<p class="pcc-error">${escapeHtml(error)}</p>` : ""}
      <footer>
        <button class="ghost" data-act="modal-close">Ahora no</button>
        <button class="primary" data-act="room-open">${this.opening ? "Abriendo…" : "Abrir sala"}</button>
      </footer>`);
  }

  async openRoom() {
    if (this.net || this.opening) return;
    this.opening = true;
    this.showRoom();
    const net = new NetHost({
      engine: this.engine, lines: () => this.lines,
      log: (text, level = "info", line = null, trainId = null) => { this.addLog(text, level, line, trainId); this.toast(text, level === "warn" ? "alert" : level); },
      onChange: () => { this.renderRoomBtn(); if (this.modal === "room") this.showRoom(); this.lastTrainActions = null; },
    });
    try {
      await net.open();
      this.net = net;
      this.speed = 1;
      this.paused = false;
      this.pausedBeforeModal = false;
    } catch (err) {
      this.opening = false;
      return this.showRoom(err.message);
    }
    this.opening = false;
    this.renderTimeButtons();
    this.renderRoomBtn();
    this.showRoom();
  }

  closeRoom() {
    if (!this.net) return;
    this.net.close();
    this.net = null;
    this.addLog("Sala cerrada", "info");
    this.renderRoomBtn();
  }

  renderRoomBtn() {
    const btn = this.root.querySelector(".pcc-room");
    btn.classList.toggle("live", !!this.net);
    btn.querySelector("span").textContent = this.net ? `Sala ${this.net.code} · ${this.net.drivers.length}` : "Sala";
  }

  showHelp() {
    this.openModal("help", true, `
      <h2>Cómo se juega</h2>
      <ul>
        <li><b>Mira el esquema:</b> cada tren tiene el color de lo que hace. Un anillo rojo o ámbar marca a los que tienen una alarma; una X roja, una señal averiada; una franja ámbar, una limitación de velocidad.</li>
        <li><b>Atiende las alarmas</b> (pestaña Alarmas) con sus botones. Cuanto antes, mejor nota.</li>
        <li><b>Toca un tren</b> para ver su ficha y darle órdenes: retenerlo en la estación, saltar su próxima parada o retirarlo del servicio.</li>
        <li><b>Regulación automática:</b> separa sola a los trenes que van muy juntos. Si la apagas, te toca hacerlo a ti reteniendo trenes.</li>
        <li><b>El tiempo:</b> pausa o acelera ×2, ×5, ×10 cuando está tranquilo.</li>
        <li><b>Sala (👥):</b> otros jugadores conducen trenes de tus líneas. Se ven con su nombre y borde amarillo; les das órdenes por radio.</li>
      </ul>
      ${this.touch ? "" : `<div class="pcc-keys">
        <kbd>Espacio</kbd><span>pausa / seguir</span>
        <kbd>+ −</kbd><span>más rápido / más lento</span>
        <kbd>0 · 1-9</kbd><span>toda la red · ver una línea</span>
        <kbd>R · L</kbd><span>retener 60 s · liberar el tren seleccionado</span>
        <kbd>S</kbd><span>saltar su próxima parada</span>
        <kbd>A</kbd><span>atender su alarma (autorizar)</span>
        <kbd>Esc</kbd><span>soltar el tren seleccionado</span>
      </div>`}
      <footer>
        <button data-act="tutorial">${icon("cap")} Repetir tutorial</button>
        <button class="primary" data-act="modal-close">Entendido</button>
      </footer>`);
  }

  openModal(kind, closable, html) {
    if (!this.modal) this.pausedBeforeModal = this.paused;
    this.modal = kind;
    this.modalClosable = closable;
    if (!this.net) this.paused = true;            // con la sala abierta el tiempo sigue para los conductores
    this.dialogEl.innerHTML = html;
    this.modalEl.hidden = false;
    this.renderTimeButtons();
  }

  closeModal(keepPaused = false) {
    if (!this.modal) return;
    this.modal = null;
    this.modalEl.hidden = true;
    if (!keepPaused) this.paused = this.pausedBeforeModal ?? false;
    this.renderTimeButtons();
  }

  /* ======================================================================
     Bus del motor: registro y avisos
     ====================================================================== */
  listen() {
    const bus = this.engine.bus;
    const mine = (line) => this.lines.has(line.id);
    this.unsub.push(bus.on("command:result", ({ type, payload, result }) => {
      if (!type.startsWith("control.") || payload.source !== "pcc") return;
      if (result.ok) this.did.add(type);
      const u = payload.trainId ? this.engine.findTrain(payload.trainId) : null;
      const level = result.ok ? (result.level === "warn" ? "warn" : "ok") : "alert";
      if (result.text) {
        this.addLog(result.text, level, u?.route.line ?? (payload.line ? this.engine.line(payload.line).line : null), payload.trainId);
        this.toast(result.text, result.ok ? "ok" : "alert");
      }
      this.lastAlarms = this.lastTrainActions = this.lastTrainAlarm = null;
    }));
    this.unsub.push(bus.on("incident", (inc) => {
      if (!mine(inc.line) || inc.kind === "doorObstruction") return;
      this.addLog(inc.text, inc.phase === "end" ? "ok" : "warn", inc.line, inc.unit?.id);
    }));
    this.unsub.push(bus.on("train:event", ({ unit, type, data }) => {
      if (!mine(unit.route.line)) return;
      if (type === "collision") this.addLog(`ALCANCE: ${unit.id} con ${data.other.id}`, "alert", unit.route.line, unit.id);
      else if (type === "redSignal") this.addLog(`${unit.id} rebasó la señal ${data.signal.id} en rojo`, "alert", unit.route.line, unit.id);
      else if (type === "ato:released") this.addLog(`${unit.id} cumplió su retención y sale`, "info", unit.route.line, unit.id);
      else if (type === "ato:evacuate") this.addLog(`${unit.id}: bajan todos en ${data.station.name}`, "info", unit.route.line, unit.id);
    }));
  }

  onAlarm(a) {
    this.lastAlarms = null;
    this.freshAlarm = a.id;
    if (!this.started) return;
    beep(a.level, this.sound);
    if (this.tab !== "alarms" && a.level === "alert") this.toast(`Nueva alarma: ${a.title}`, "alert");
  }

  addLog(text, level = "info", line = null, trainId = null) {
    this.log.unshift({ time: this.engine.time, text, level, line, trainId });
    this.log.length = Math.min(this.log.length, 120);
    this.logDirty = true;
  }

  toast(text, level = "info") {
    this.toastEl.textContent = text;
    this.toastEl.className = `pcc-toast ${level}`;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, 3200);
  }

  /* ======================================================================
     Esquema: geometría, selección y ayuda al pasar el ratón
     ====================================================================== */
  layout(ls, w, h) {
    const big = this.view !== "all";
    const st = ls.line.stations;
    const m = big ? 40 : 26;
    const z0 = st[0].z, z1 = st.at(-1).z;
    return {
      big,
      xOf: (z) => m + ((z0 - z) / (z0 - z1)) * (w - 2 * m),
      yA: h * (big ? 0.38 : 0.36), yB: h * (big ? 0.62 : 0.66),
      len: Math.max(8, (L / Math.abs(z0 - z1)) * (w - 2 * m)),
    };
  }

  /** Punto del esquema de un tren (centro del tren, en su vía). */
  trainPoint(g, u, w) {
    const z = u.route.toWorldZ(u.sim.position + L / 2);
    return { x: Math.min(w - 6, Math.max(6, g.xOf(z))), y: u.route.dir === 1 ? g.yA : g.yB };
  }

  /** Tren más cercano a un punto del lienzo (o null). */
  trainAt(p, x, y, reach) {
    const w = p.canvas.clientWidth, h = p.canvas.clientHeight;
    const g = this.layout(p.ls, w, h);
    let best = null, bd = reach;
    for (const u of p.ls.trains) {
      const pt = this.trainPoint(g, u, w);
      const d = Math.hypot(pt.x - x, (pt.y - y) * 1.4);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  pick(p, ev) {
    const r = p.canvas.getBoundingClientRect();
    const u = this.trainAt(p, ev.clientX - r.left, ev.clientY - r.top, this.touch ? 34 : 26);
    this.select(u ? u.id : null);
  }

  hover(p, ev) {
    if (this.touch) return;
    const r = p.canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const u = this.trainAt(p, x, y, 18);
    let html = "";
    if (u) {
      const late = u.arrivedIdx !== null && u.delay > CONFIG.schedule.punctualWindow;
      const a = this.desk.forTrain(u);
      html = `<b>${u.id}</b> · ${TRAIN_STATES[u.state] ?? "—"}<br>${describeTrain(u).location}${late ? `<br><span style="color:#ff8a8a">${formatDelay(u.delay)}</span>` : ""}${a ? `<br><span style="color:${LEVEL_COLORS[a.level]}">⚠ ${a.title}</span>` : ""}`;
    } else {
      const g = this.layout(p.ls, r.width, r.height);
      const st = p.ls.line.stations.find(s => Math.abs(g.xOf(s.z) - x) < 9);
      if (st) {
        const wa = Math.round(p.ls.passengers.waitingAt(st, 1) + p.ls.passengers.waitingAt(st, -1));
        html = `<b>${st.name}</b><br>${wa.toLocaleString("es-CL")} personas esperando`;
      }
    }
    p.canvas.style.cursor = u ? "pointer" : "default";
    this.tipEl.hidden = !html;
    if (!html) return;
    if (html !== this.lastTip) { this.tipEl.innerHTML = html; this.lastTip = html; }
    this.tipEl.style.left = `${Math.min(ev.clientX + 14, innerWidth - 270)}px`;
    this.tipEl.style.top = `${ev.clientY + 14}px`;
  }

  /* ======================================================================
     Dibujo (10 veces por segundo, desde main.js)
     ====================================================================== */
  update() {
    this.clockEl.textContent = formatClock(this.engine.time);
    if (!this.started) return;
    const now = performance.now();
    const slow = now - this.slowT > 1000;           // lo que basta con refrescar una vez por segundo
    if (slow) this.slowT = now;
    this.alarmUnits = new Map();
    for (const a of this.desk.open()) {
      for (const u of a.unit ? [a.unit] : (a.waiting ?? [])) if (!this.alarmUnits.has(u)) this.alarmUnits.set(u, a.level);
    }
    for (const p of this.panels) {
      if (p.el.hidden) continue;
      this.drawLine(p);
      if (slow || !p.lastKpis) this.renderKpis(p);
    }
    if (slow || !this.lastSummary) this.renderSummary();
    this.renderTrain();
    this.renderAlarms();
    if (this.tab === "trains" && (slow || !this.lastTable)) this.renderTable();
    if (this.tab === "log" && this.logDirty && !this.pressing) this.renderLog();
    if (slow) {
      const sc = this.desk.score();
      this.scoreEl.textContent = `${sc.grade} · ${sc.score}`;
      this.renderViewCounts();
    }
  }

  /** Paso del bucle (cada fotograma): alarmas y tutorial. */
  tick(realDt, simDt) {
    if (!this.started) return;
    this.net?.update();
    this.desk.update(simDt);
    this.tutorial?.update(realDt, { ui: this, engine: this.engine, desk: this.desk });
  }

  drawLine(p) {
    const { ls, canvas, ctx } = p;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = this.layout(ls, w, h);
    const [A, B] = ls.routes;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    const yOf = (route) => (route.dir === 1 ? g.yA : g.yB);

    // Vías y sentido
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3a4653";
    for (const y of [g.yA, g.yB]) { ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(w - 12, y); ctx.stroke(); }
    ctx.fillStyle = "#8b98a7"; ctx.font = "11px system-ui, Arial";
    ctx.textAlign = "right"; ctx.fillText(`vía 1 → ${A.last.name}`, w - 12, 12);
    ctx.textAlign = "left"; ctx.fillText(`${B.last.name} ← vía 2`, 12, h - 5);

    // Limitaciones temporales de velocidad (franja ámbar sobre la vía)
    for (const route of ls.routes) {
      for (const zone of route.restrictions || []) {
        const x1 = g.xOf(route.toWorldZ(zone.from)), x2 = g.xOf(route.toWorldZ(zone.to));
        const y = yOf(route);
        ctx.fillStyle = "#ffb02066";
        ctx.fillRect(Math.min(x1, x2), y - 5, Math.max(4, Math.abs(x2 - x1)), 10);
        if (g.big) { ctx.fillStyle = "#ffd27a"; ctx.font = "bold 10px system-ui, Arial"; ctx.textAlign = "center"; ctx.fillText(`${zone.kmh}`, (x1 + x2) / 2, route.dir === 1 ? y + 32 : y - 26); }
      }
    }

    // Estaciones: andenes; nombres en la vista grande, color según la gente esperando
    ls.line.stations.forEach((st, i) => {
      const x = g.xOf(st.z);
      const wa = ls.passengers.waitingAt(st, 1) + ls.passengers.waitingAt(st, -1);
      const crowd = wa > 250 ? "#ff7a2a" : wa > 120 ? "#ffd166" : null;
      ctx.fillStyle = ls.line.color;
      ctx.fillRect(x - (g.big ? 5 : 3), g.yA - 4, g.big ? 10 : 6, g.yB - g.yA + 8);
      if (g.big) {
        ctx.fillStyle = crowd || "#c9d4df";
        ctx.font = "10.5px system-ui, Arial";
        ctx.save();
        const top = i % 2 === 0;                      // alternando arriba y abajo para que quepan
        ctx.translate(x, top ? g.yA - 20 : g.yB + 24);
        ctx.rotate(top ? -Math.PI / 5 : Math.PI / 5);
        ctx.textAlign = "left";
        ctx.fillText(st.short, 0, 0);
        ctx.restore();
      } else if (crowd) {
        ctx.fillStyle = crowd;
        ctx.beginPath(); ctx.arc(x, (g.yA + g.yB) / 2, 3, 0, Math.PI * 2); ctx.fill();
      }
    });

    // Señales (puntos de color); las averiadas, con una X roja que late
    for (const route of ls.routes) {
      const y = route.dir === 1 ? g.yA - 9 : g.yB + 9;
      for (const s of ls.signals.get(route.id).signals) {
        const x = g.xOf(route.toWorldZ(s.z));
        if (s.fault) {
          ctx.strokeStyle = `rgba(255,48,48,${0.55 + 0.45 * pulse})`; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
          if (g.big) { ctx.fillStyle = "#ff8a8a"; ctx.font = "bold 10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText(`S${s.id}`, x, route.dir === 1 ? y - 9 : y + 16); }
          continue;
        }
        if (!g.big && s.aspect === "green") continue;          // vista compacta: solo las que no están en verde
        ctx.fillStyle = ASPECT_COLORS[s.aspect];
        ctx.beginPath(); ctx.arc(x, y, g.big ? 2 : 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Trenes
    for (const u of ls.trains) {
      const pt = this.trainPoint(g, u, w);
      const color = STATE_COLORS[u.state] || "#c9d4df";
      const th = g.big ? 12 : 10;
      ctx.fillStyle = u.ato?.outOfService ? "#6b7785" : color;
      ctx.fillRect(pt.x - g.len / 2, pt.y - th / 2, g.len, th);
      const level = this.alarmUnits.get(u);
      if (level) {
        ctx.strokeStyle = LEVEL_COLORS[level]; ctx.globalAlpha = 0.45 + 0.55 * pulse; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, g.len / 2 + 7 + 2 * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const sel = u.id === this.selected;
      if (sel) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.strokeRect(pt.x - g.len / 2 - 3, pt.y - th / 2 - 3, g.len + 6, th + 6); }
      else if (u.remote) { ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2; ctx.strokeRect(pt.x - g.len / 2 - 2, pt.y - th / 2 - 2, g.len + 4, th + 4); }
      // Etiqueta: en la vista grande, todas; en la compacta, solo las que importan (y siempre los trenes de jugadores)
      const late = u.arrivedIdx !== null && u.delay > CONFIG.schedule.punctualWindow;
      if (!g.big && !sel && !level && !u.remote && !(late && u.delay > 180)) continue;
      let label = u.remote ? `👤${u.remote.name}` : u.id.replace(/^L\w+?-/, "");
      if (u.remote?.hold && !u.remote.hold.pending) label += " ⏸";
      if (late) label += ` +${Math.round(u.delay / 60)}′`;
      if (u.ato?.held) label += u.ato.heldUntil ? ` ⏸${Math.max(0, Math.ceil(u.ato.heldUntil - this.engine.time))}` : " ⏸";
      ctx.fillStyle = sel ? "#ffffff" : level ? LEVEL_COLORS[level] : late ? "#ff8a8a" : "#e8eef4";
      ctx.font = `${sel ? "bold " : ""}10px ui-monospace, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(label, pt.x, u.route.dir === 1 ? pt.y + (g.big ? 22 : 18) : pt.y - (g.big ? 14 : 11));
    }
  }

  lineStats(ls) {
    const trains = ls.trains;
    const inService = trains.filter(u => u.arrivedIdx !== null && !u.ato?.outOfService);
    const punctual = inService.filter(u => Math.abs(u.delay) <= CONFIG.schedule.punctualWindow).length;
    return {
      trains: trains.length,
      punctual: inService.length ? punctual / inService.length : 1,
      maxDelay: inService.reduce((m, u) => Math.max(m, u.delay), 0),
      waiting: ls.line.stations.reduce((s, st) => s + ls.passengers.waitingAt(st, 1) + ls.passengers.waitingAt(st, -1), 0),
      onboard: trains.reduce((s, u) => s + (u.load || 0), 0),
      held: trains.filter(u => u.ato?.held).length,
    };
  }

  renderKpis(p) {
    const s = this.lineStats(p.ls);
    const html = `<span class="${s.punctual < 0.8 ? "bad" : ""}">Puntuales <b>${Math.round(100 * s.punctual)} %</b></span>
      <span class="${s.maxDelay > 300 ? "bad" : ""}">Retraso máx. <b>${formatDelay(Math.max(0, s.maxDelay))}</b></span>
      <span>Trenes <b>${s.trains}</b></span>
      <span>Esperando <b>${Math.round(s.waiting).toLocaleString("es-CL")}</b></span>
      ${s.held ? `<span class="bad">Retenidos <b>${s.held}</b></span>` : ""}`;
    if (html !== p.lastKpis) { p.kpis.innerHTML = html; p.lastKpis = html; }
    const on = p.ls.regulator.enabled;
    const reg = `Regulación auto ${on ? "sí" : "no"}`;
    if (p.regBtn.dataset.state !== String(on)) {
      p.regBtn.dataset.state = String(on);
      p.regBtn.innerHTML = `${reg}<i></i>`;
      p.regBtn.classList.toggle("on", on);
    }
  }

  /** Indicadores de lo que se está mirando (toda la red supervisada o una línea). */
  renderSummary() {
    const lines = this.panels.filter(p => this.view === "all" || p.ls.line.id === this.view).map(p => this.lineStats(p.ls));
    const sum = (k) => lines.reduce((s, x) => s + x[k], 0);
    const trains = sum("trains");
    const punctual = trains ? lines.reduce((s, x) => s + x.punctual * x.trains, 0) / trains : 1;
    const open = this.desk.open().filter(a => this.view === "all" || a.line.id === this.view).length;
    const html = `
      <div class="pcc-kpi ${punctual < 0.8 ? "bad" : "good"}"><span>Puntualidad</span><b>${Math.round(punctual * 100)} %</b></div>
      <div class="pcc-kpi ${open ? "bad" : "good"}"><span>Alarmas abiertas</span><b>${open}</b></div>
      <div class="pcc-kpi"><span>Trenes en la vía</span><b>${trains}</b></div>
      <div class="pcc-kpi"><span>Viajando</span><b>${Math.round(sum("onboard")).toLocaleString("es-CL")}</b></div>
      <div class="pcc-kpi"><span>Esperando</span><b>${Math.round(sum("waiting")).toLocaleString("es-CL")}</b></div>`;
    if (html !== this.lastSummary) { this.summaryEl.innerHTML = html; this.lastSummary = html; }
  }

  /** Burbuja con las alarmas abiertas de cada línea (y del total en la pestaña). */
  renderViewCounts() {
    const open = this.desk.open();
    this.viewsEl.querySelectorAll("[data-view]").forEach(b => {
      const c = b.querySelector(".count");
      if (!c) return;
      const n = open.filter(a => a.line.id === b.dataset.view).length;
      c.hidden = !n;
      c.textContent = n;
    });
    this.alarmCount.textContent = open.length || "";
  }

  /* ----- Ficha del tren ----- */
  renderTrain() {
    const u = this.selected ? this.engine.findTrain(this.selected) : null;
    this.trainCard.classList.toggle("has-train", !!u);
    this.trainCard.querySelector(".pcc-train-close").hidden = !this.selected;
    if (!u) {
      const html = this.selected ? `<p class="pcc-empty">El tren ${this.selected} ya no está en servicio.</p>`
        : `<p class="pcc-empty">Toca un tren del esquema (o de la pestaña Trenes) para ver su ficha y darle órdenes.</p>`;
      this.setHtml(this.trainInfo, "lastTrainInfo", html);
      this.setHtml(this.trainAlarm, "lastTrainAlarm", "");
      this.setHtml(this.trainActions, "lastTrainActions", "");
      return;
    }
    const t = describeTrain(u);
    const ato = u.ato;
    const next = u.sim.nextStation();
    const eta = next ? this.engine.eta(u, next.world) : null;
    const color = STATE_COLORS[u.state] || "#c9d4df";
    const load = Math.round(u.load || 0), loadPct = Math.min(1, load / TRAIN_CAPACITY);
    const loadColor = loadPct > 0.9 ? "#ff7a2a" : loadPct > 0.7 ? "#ffd166" : "#3fd07a";
    const delayColor = t.delay === null ? "" : t.delay > CONFIG.schedule.punctualWindow ? "#ff8a8a" : t.delay < -CONFIG.schedule.punctualWindow ? "#9ec9ff" : "#8fe3b0";
    const notes = [];
    if (ato?.held) notes.push(ato.heldUntil ? `Retenido · sale en ${Math.max(0, Math.ceil(ato.heldUntil - this.engine.time))} s`
      : ato.holdFor ? `Se retendrá ${ato.holdFor} s al llegar a ${ato.target.name}` : `Retenido hasta nueva orden (pulsa Liberar)`);
    if (ato?.outOfService || ato?.evacuateAt != null) notes.push(ato.outOfService ? "Fuera de servicio: va vacío a la terminal" : `Se retira del servicio en ${u.route.stations[ato.evacuateAt].name}`);
    if (ato?.doorFault && !ato.outOfService) notes.push("Falla de puertas: cada parada tarda ~25 s más");
    if (ato?.sightUntil != null || ato?.permit) notes.push("Marcha a la vista (20 km/h) por una señal averiada");
    if (ato?.lineStop) notes.push(`Detenido en la vía: ${ato.lineStop.reason}`);
    if (u.remote?.hold) notes.push(u.remote.hold.until ? `Retenido por radio · sale en ${Math.max(0, Math.ceil(u.remote.hold.until - this.engine.time))} s`
      : u.remote.hold.pending ? `Orden por radio: retenerse${u.remote.hold.seconds ? ` ${u.remote.hold.seconds} s` : ""} en su próxima parada`
      : "Retenido por radio hasta nueva orden (pulsa Puede salir)");
    const skipped = u.trip?.skip && !u.trip.express ? [...u.trip.skip].filter(i => i >= (ato?.targetIndex ?? 0)).map(i => u.route.stations[i].name) : [];
    if (skipped.length) notes.push(`Pasa sin parar por ${skipped.join(", ")}`);
    const info = `
      <div class="pcc-train-head">
        <span class="pcc-badge" style="background:${u.route.line.color};color:${textOn(u.route.line.color)}">${u.route.line.id}</span>
        <div><b>${t.id}${u.remote ? ` · 👤 ${escapeHtml(u.remote.name)}` : ""}</b><small>hacia ${u.route.last.name}</small></div>
      </div>
      <span class="pcc-state" style="--c:${color}">● ${TRAIN_STATES[u.state] ?? "—"}</span>
      <dl>
        <dt>Dónde</dt><dd>${t.location}</dd>
        <dt>Velocidad</dt><dd>${t.kmh} km/h</dd>
        <dt>Retraso</dt><dd style="color:${delayColor}">${t.delay === null ? "—" : formatDelay(t.delay)}</dd>
        <dt>Pasajeros</dt><dd>${load} / ${TRAIN_CAPACITY}<span class="pcc-load"><i style="width:${loadPct * 100}%;background:${loadColor}"></i></span></dd>
        <dt>Próxima</dt><dd>${next ? `${next.name}${eta ? ` · ${formatClock(eta).slice(0, 5)}` : ""}` : "—"}</dd>
        <dt>Tren</dt><dd>${u.stock?.model ?? "—"}</dd>
      </dl>
      ${notes.map(n => `<p class="pcc-note warn">${n}</p>`).join("")}`;
    this.setHtml(this.trainInfo, "lastTrainInfo", info);

    // Alarma del tren (con sus botones)
    const a = this.desk.forTrain(u);
    const alarm = a ? `<b style="color:${LEVEL_COLORS[a.level]}">⚠ ${a.title}</b><div class="pcc-acts-row">${alarmButtons(a)}</div>` : "";
    if (!this.pressing) this.setHtml(this.trainAlarm, "lastTrainAlarm", alarm);

    // Órdenes (solo se rehacen cuando cambian, para no perder clics)
    let acts;
    if (u.remote) {
      const hold = u.remote.hold;
      acts = (hold
        ? `<button class="on wide" data-act="cmd" data-cmd="control.release">📻 Puede salir${this.touch ? "" : " (L)"}</button>`
        : `<button class="danger" data-act="cmd" data-cmd="control.hold" data-seconds="30">📻 Retener 30 s</button>
           <button class="danger" data-act="cmd" data-cmd="control.hold" data-seconds="60">📻 Retener 60 s${this.touch ? "" : " (R)"}</button>
           <button class="danger" data-act="cmd" data-cmd="control.hold">📻 Retener sin límite</button>`)
        + `<small>Lo conduce <b>${escapeHtml(u.remote.name)}</b> (jugador): tus órdenes le llegan por radio. Al retenerlo, no puede arrancar del andén hasta que lo liberes o se cumpla el tiempo.</small>`;
    } else if (!ato) acts = `<small>Tren conducido por una persona: no recibe órdenes del PCC.</small>`;
    else {
      const last = u.route.stations.length - 1;
      const busy = ato.state === "depot" || ato.state === "retire" || ato.state === "retired" || ato.outOfService;
      const nextStop = ato.state === "running" ? ato.targetIndex : nextStopIndex(u.trip, ato.targetIndex, last);
      const canSkip = !busy && nextStop < last;
      const canWithdraw = !busy && ato.evacuateAt == null && nextStop < last;
      acts = (ato.held
        ? `<button class="on wide" data-act="cmd" data-cmd="control.release">${icon("play")} Liberar ahora${this.touch ? "" : " (L)"}</button>`
        : `<button class="danger" data-act="cmd" data-cmd="control.hold" data-seconds="30" ${busy ? "disabled" : ""}>Retener 30 s</button>
           <button class="danger" data-act="cmd" data-cmd="control.hold" data-seconds="60" ${busy ? "disabled" : ""}>Retener 60 s${this.touch ? "" : " (R)"}</button>
           <button class="danger" data-act="cmd" data-cmd="control.hold" ${busy ? "disabled" : ""}>Retener sin límite</button>`)
        + `<button class="wide" data-act="cmd" data-cmd="control.skip" ${canSkip ? "" : "disabled"}>Saltar próxima parada${canSkip ? ` (${u.route.stations[nextStop].name})` : ""}</button>`
        + `<button class="wide" data-act="cmd" data-cmd="control.withdraw" ${canWithdraw ? "" : "disabled"}>Retirar del servicio</button>`
        + (this.view !== u.route.line.id ? `<button class="wide ghost" data-act="focus-line">Ver en su línea ›</button>` : "")
        + `<small>Retener: espera con las puertas abiertas en la estación (separa trenes muy juntos). Saltar: pasa sin parar y recupera tiempo, pero la gente de ese andén espera el siguiente. Retirar: bajan todos en la próxima estación y sigue vacío.</small>`;
    }
    acts = `<div class="pcc-actions">${acts}</div>`;
    if (!this.pressing) this.setHtml(this.trainActions, "lastTrainActions", acts);
  }

  setHtml(el, key, html) {
    if (html === this[key]) return;
    el.innerHTML = html;
    this[key] = html;
  }

  /* ----- Pestañas ----- */
  renderAlarms() {
    if (this.pressing) return;
    const list = this.desk.visible(this.view === "all" ? null : this.view);
    const sig = list.map(a => `${a.id}${a.resolvedAt ? "r" : ""}:${a.actions().map(x => x.label + (x.disabled ? "-" : "")).join("|")}:${a.waiting?.length ?? ""}`).join(";");
    if (sig !== this.lastAlarms) {
      this.lastAlarms = sig;
      const others = this.view !== "all" ? this.desk.open().length - list.filter(a => !a.resolvedAt).length : 0;
      this.alarmsEl.innerHTML = (list.length ? list.map(a => {
        const more = a.waiting?.length > 1 ? `<p>También esperan: ${a.waiting.slice(1).map(t => t.id).join(", ")}</p>` : "";
        const unit = a.unit ?? a.waiting?.[0];
        return `<article class="pcc-alarm ${a.resolvedAt ? "resolved" : ""} ${a.id === this.freshAlarm ? "fresh" : ""}" style="--c:${LEVEL_COLORS[a.level]}">
          <header><span class="pcc-badge sm" style="background:${a.line.color};color:${textOn(a.line.color)}">${a.line.id}</span><b>${a.resolvedAt ? "✔ " : ""}${a.title}</b><time data-since="${a.since}"></time></header>
          <p>${a.detail}</p>${more}
          ${a.resolvedAt ? "" : a.kind === "signalFault" && !unit ? `<p class="pcc-empty">Todavía no llega ningún tren a esta señal.</p>`
            : `<div class="pcc-acts-row">${alarmButtons(a)}${unit ? `<button class="ghost" data-train="${unit.id}">Ver tren</button>` : ""}</div>`}
        </article>`;
      }).join("") : `<p class="pcc-ok">${icon("check")} Sin alarmas: todo en orden.</p>`)
        + (others > 0 ? `<p class="pcc-empty">${others} alarma${others > 1 ? "s" : ""} en otras líneas · <button class="ghost" data-act="view" data-view="all">Ver toda la red</button></p>` : "");
      this.freshAlarm = null;
    }
    // Antigüedad de cada alarma (sin rehacer el HTML)
    const now = this.engine.time;
    this.alarmsEl.querySelectorAll("time[data-since]").forEach(t => {
      const s = Math.max(0, Math.round(now - Number(t.dataset.since)));
      t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    });
  }

  renderTable() {
    if (this.pressing) return;
    const lines = this.panels.filter(p => this.view === "all" || p.ls.line.id === this.view).map(p => p.ls);
    let trains = lines.flatMap(ls => ls.trains).filter(u => u.ato?.state !== "depot");
    const delay = (u) => (u.arrivedIdx === null ? -Infinity : u.delay);
    if (this.trainSort === "delay") trains.sort((a, b) => delay(b) - delay(a));
    else if (this.trainSort === "load") trains.sort((a, b) => (b.load || 0) - (a.load || 0));
    else trains.sort((a, b) => a.id.localeCompare(b.id));
    trains = trains.slice(0, 80);
    const html = `<thead><tr><th>Tren</th><th>Estado</th><th>Retraso</th><th>Carga</th></tr></thead><tbody>${trains.map(u => {
      const late = u.arrivedIdx !== null && u.delay > CONFIG.schedule.punctualWindow;
      const a = this.alarmUnits?.get(u);
      return `<tr data-train="${u.id}" class="${u.id === this.selected ? "sel" : ""}">
        <td>${a ? `<span style="color:${LEVEL_COLORS[a]}">⚠</span> ` : ""}<b>${u.id}</b></td>
        <td><span class="pcc-dot" style="background:${STATE_COLORS[u.state] || "#c9d4df"}"></span>${TRAIN_STATES[u.state] ?? "—"}</td>
        <td class="${late ? "late" : ""}">${u.arrivedIdx === null ? "—" : formatDelay(u.delay)}</td>
        <td>${Math.round(100 * (u.load || 0) / TRAIN_CAPACITY)} %</td></tr>`;
    }).join("")}</tbody>`;
    this.setHtml(this.tableEl, "lastTable", html);
  }

  renderLog() {
    this.logDirty = false;
    const items = this.log.filter(e => this.logFilter === "all" || e.level !== "info")
      .filter(e => this.view === "all" || !e.line || e.line.id === this.view).slice(0, 80);
    this.logEl.innerHTML = items.length ? items.map(e => `<li class="${e.level}" ${e.trainId ? `data-train="${escapeHtml(e.trainId)}"` : ""}>
      <time>${formatClock(e.time).slice(0, 5)}</time>${e.line ? `<span class="pcc-badge sm" style="background:${e.line.color};color:${textOn(e.line.color)}">${e.line.id}</span>` : ""}<span>${escapeHtml(e.text)}</span></li>`).join("")
      : `<li>Sin novedades.</li>`;
  }

  destroy() {
    this.net?.close();
    this.unsub.forEach(f => f());
    this.desk?.destroy();
    this.tutorial?.destroy();
    this.engine.pcc = null;
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    clearTimeout(this.toastTimer);
    this.topObserver.disconnect();
    this.root.remove();
  }
}

/** Botones de una alarma (data-alarm + índice de la acción). */
function alarmButtons(a) {
  return a.actions().map((x, i) => `<button class="${x.primary ? "primary" : "ghost"}" data-act="alarm" data-alarm="${a.id}" data-idx="${i}" ${x.disabled ? "disabled" : ""}>${x.label}</button>`).join("");
}

function legendHtml() {
  const items = [["Circulando", "running"], ["En andén", "dwell"], ["Regulando", "regulating"], ["Ante señal / detenido", "signalStop"], ["Retenido", "held"], ["Cocheras / fuera de servicio", "depot"]];
  return items.map(([t, k]) => `<span><i style="background:${STATE_COLORS[k]}"></i>${t}</span>`).join("")
    + `<span><i class="ring"></i>Con alarma</span><span><i class="x">✕</i>Señal averiada</span><span><i style="background:#ffb02088"></i>Limitación de velocidad</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ----- Sonido de las alarmas (un pitido sintetizado; sin archivos) ----- */
let actx = null;
function unlockAudio() {
  try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch { actx = null; }
}
function beep(level, on) {
  if (!on || !actx) return;
  try {
    const tones = level === "alert" ? [880, 660] : level === "ok" ? [660, 990] : [740];
    tones.forEach((f, i) => {
      const t = actx.currentTime + i * 0.16;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.16);
    });
  } catch { /* sin audio */ }
}

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
}
