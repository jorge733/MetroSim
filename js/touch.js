/* ==========================================================================
   MetroSim — touch.js
   Controles táctiles para jugar en el celular o la tablet.

   Solo aparecen en pantallas táctiles (o con ?touch=1 en la dirección, para
   probarlos en el computador). No inventan acciones nuevas: cada botón hace
   lo mismo que su tecla, así que el Conductor sigue mandando ÓRDENES al
   motor exactamente igual que con el teclado.

   En el CELULAR (1.12) el conductor tiene un pupitre realista: palanca de
   mando que se desliza por sus muescas, llave del inversor, hongo de
   emergencia y pulsadores iluminados (buildDesk). En la tablet siguen los
   botones de siempre.

   Minimalista: a la vista solo lo que se usa siempre; lo que sirve en un
   momento puntual aparece solo entonces (context()), y lo poco usado va en
   el menú ☰.

     Conductor  ▲ / ▼ mando · EMERGENCIA · Puertas · tocar F/N/R del
                indicador cambia el inversor · Vigilancia (solo con la alarma
                de hombre muerto) · Cambiar cabina (solo en FIN DE MANIOBRA) ·
                ☰ Bocina, Vista, Tienda, Finalizar turno.
                Arrastrar la pantalla: mirar.
     Pasajero   joystick a la izquierda para caminar (al borde: correr),
                arrastrar a la derecha para mirar · Misiones (J) · Usar (E, si
                hay algo cerca) · Sentarse (F, en andén o tren) · Agarrarse (G,
                de pie en el tren) · ☰ Tienda, Menú principal.
   ========================================================================== */

import { NOTCHES, NOTCH_INDEX } from "./config.js";

/** ¿Hay que mostrar los controles táctiles? */
export function wantsTouch() {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1") return true;
  if (forced === "0") return false;
  return matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
}

const CSS = `
.touch-ui { position: absolute; z-index: 12; pointer-events: none; user-select: none; -webkit-user-select: none;
  inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.touch-ui button { pointer-events: auto; touch-action: none; border: 1px solid #ffffff38; color: #fff; background: #0b141ecc;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border-radius: 14px; font: 700 14px/1.1 var(--f-body); letter-spacing: .5px;
  display: grid; place-items: center; padding: 0; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; }
.touch-ui button:active, .touch-ui button.pressed { background: #2a4d6dcc; transform: scale(.96); }
.touch-col { position: absolute; display: grid; gap: 10px; pointer-events: none; }
.touch-big { width: 74px; height: 74px; font-size: 30px !important; }
.touch-mid { min-width: 64px; height: 48px; padding: 0 10px !important; }
.touch-em { width: 74px; height: 56px; background: #7a1010dd !important; border-color: #ff6b6b99 !important; font-size: 12px !important; }
/* Acciones a la derecha, abajo (al alcance del pulgar): las contextuales aparecen encima */
.touch-actions { position: absolute; right: 14px; bottom: 16px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; }
.touch-actions button { min-width: 118px; height: 48px; padding: 0 14px; font-size: 15px; }
.touch-actions .touch-main { min-width: 132px; height: 64px; font-size: 17px; }
.touch-actions .touch-alert { background: #8a5a00e6; border-color: #ffd166; animation: touchPulse .7s ease-in-out infinite alternate; }
@keyframes touchPulse { to { box-shadow: 0 0 0 6px #ffd16655; } }
.touch-actions button[hidden], .touch-menu button[hidden] { display: none; }
.touch-passenger .touch-actions button { grid-auto-flow: column; gap: 6px; }
/* Menú ☰ (arriba a la derecha) */
.touch-menu-btn { position: absolute; top: 8px; right: 10px; width: 48px; height: 42px; font-size: 20px !important; }
.touch-menu { position: absolute; top: 56px; right: 10px; display: grid; gap: 6px; padding: 8px; border-radius: 14px; pointer-events: auto;
  background: #0b141ef0; border: 1px solid #ffffff2a; box-shadow: 0 12px 40px #000a; }
.touch-menu[hidden] { display: none; }
.touch-menu button { min-width: 170px; height: 44px; justify-items: start; padding: 0 14px; font-size: 14px; }
.touch-notch { cursor: pointer; }
/* Mando e inversor actuales, junto a los botones (reemplaza al selector lateral en pantallas chicas) */
.touch-notch { pointer-events: auto; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px; width: 74px; padding: 4px; border-radius: 12px;
  background: #0b141ecc; border: 1px solid #ffffff2a; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.touch-notch b { display: grid; place-items: center; height: 30px; border-radius: 8px; font: 700 16px/1 var(--f-data); color: #0a121b; background: var(--neutral, #e8eef5); }
.touch-notch b.power { background: var(--power, #4fd6ff); }
.touch-notch b.brake { background: var(--brake, #ffb547); }
.touch-notch b.emergency { background: var(--emergency, #ff4b4b); color: #fff; animation: blink .8s steps(2) infinite; }
.touch-notch i { display: grid; place-items: center; width: 22px; height: 30px; border-radius: 8px; font: 700 13px/1 var(--f-data); font-style: normal; color: #0a121b; background: #e8eef5; }
.touch-notch i[data-dir="1"] { background: var(--ok, #6fe39a); }
.touch-notch i[data-dir="-1"] { background: var(--brake, #ffb547); }
/* Joystick del pasajero */
.touch-stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
  border: 2px solid #ffffff40; background: #0b141e55; pointer-events: none; display: none; }
.touch-stick i { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
  background: #ffffffcc; box-shadow: 0 2px 10px #0008; }
.touch-stick-ghost { position: absolute; left: 70px; bottom: 70px; width: 96px; height: 96px; margin: 0 0 -48px -48px; border-radius: 50%;
  border: 2px dashed #ffffff30; pointer-events: none; transition: opacity .3s; }
.touch-stick-ghost::after { content: ""; position: absolute; inset: 30px; border-radius: 50%; background: #ffffff30; }
.touch-hint, .touch-rotate { position: absolute; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 10px;
  font: 600 12px var(--f-body); text-align: center; max-width: calc(100% - 24px); transition: opacity 1s; }
.touch-hint { top: 64px; background: #0b141ecc; color: #cfe0f1; }
.touch-rotate { display: none; bottom: 46%; background: #5a3d00e8; color: #ffe7a8; font-weight: 700; }
@media (orientation: portrait) { .touch-rotate { display: block; } }
/* Con controles táctiles se ocultan las ayudas de teclado */
body.touch-mode .controls-help, body.touch-mode .start-keys, body.touch-mode .end-shift-button, body.touch-mode #backButton { display: none !important; }
body.touch-mode #gameContainer, body.touch-mode #gameContainer canvas { touch-action: none; }
body.touch-mode .selector-hud { transform: scale(.78); transform-origin: right center; }
/* El HUD respeta la muesca y las esquinas redondeadas del teléfono */
body.touch-mode #hud { inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
/* Las ventanas (boletería, locales, misiones, resumen) quedan sobre los botones táctiles */
body.touch-mode .ticket-panel, body.touch-mode .summary { z-index: 14; }
body.touch-mode .fade { z-index: 15; }
.touch-left { left: 14px; bottom: 16px; }

/* ---- Pantallas chicas (celular): HUD compacto, botones al alcance del pulgar ---- */
@media (max-height: 520px), (max-width: 720px) {
  body.touch-mode .selector-hud, body.touch-mode .line-strip, body.touch-mode .mode-pill, body.touch-mode .hud-route { display: none !important; }
  body.touch-mode .hud-top { top: 8px; left: 10px; right: 96px; gap: 6px; }
  body.touch-mode .hud-brand { padding: 4px; gap: 6px; }
  body.touch-mode .line-badge { width: 30px; height: 30px; font-size: 17px; }
  body.touch-mode .hud-right { gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  body.touch-mode .hud-right .hud-label { font-size: 8px; letter-spacing: 1px; }
  body.touch-mode .bank-pill, body.touch-mode .score-pill, body.touch-mode .hud-clock { padding: 4px 8px; border-radius: 10px; min-width: 0; }
  body.touch-mode .bank-pill strong, body.touch-mode #scoreTotal, body.touch-mode #clock { font-size: 14px; }
  body.touch-mode .score-best, body.touch-mode .score-streak { display: none; }
  body.touch-mode .card-pill { padding: 6px 9px; font-size: 12px; }
  body.touch-mode .sound-button { padding: 8px 10px; font-size: 15px; }
  body.touch-mode .sound-label { display: none; }
  body.touch-mode .back-button { top: calc(8px + env(safe-area-inset-top)); left: auto; right: calc(10px + env(safe-area-inset-right)); z-index: 13; padding: 8px 10px; }
  .touch-left { left: 10px; bottom: 10px; }
  body.touch-mode .message { top: 58px; font-size: 12px; white-space: normal; width: max-content; max-width: calc(100% - 230px); text-align: center; }
  body.touch-mode .mission-tracker { top: 58px; left: 10px; width: min(250px, 42%); padding: 6px 10px; gap: 2px; }
  body.touch-mode .mission-tracker strong { font-size: 13px; }
  body.touch-mode .mission-tracker .hud-label { font-size: 8px; }
  body.touch-mode .mission-tracker ol { display: grid; font-size: 11px; }
  body.touch-mode .mission-tracker li:not(.current) { display: none; }
  .touch-hint { top: 58px; }
}
/* Celular en horizontal (pantalla baja) */
@media (max-height: 520px) {
  body.touch-mode .driver-hud { transform: translateX(-50%) scale(.62); transform-origin: bottom center; left: 50% !important; right: auto !important; bottom: 4px !important; }
  body.touch-mode .passenger-hud { left: 50%; right: auto; bottom: 6px; width: 360px; transform: translateX(-50%) scale(.72); transform-origin: bottom center; padding: 10px 14px; }
  body.touch-mode .passenger-hud strong { font-size: 18px; }
  .touch-big { width: 64px; height: 64px; }
  .touch-em { width: 64px; height: 48px; }
  .touch-notch { width: 64px; }
  .touch-col { gap: 8px; }
  .touch-actions { gap: 6px; }
  .touch-actions button { min-width: 104px; height: 42px; font-size: 13px; }
  .touch-actions .touch-main { min-width: 120px; height: 54px; font-size: 15px; }
}
@media (max-height: 360px) {
  .touch-big { width: 56px; height: 56px; font-size: 24px !important; }
  .touch-em { width: 56px; height: 42px; }
  .touch-notch { width: 56px; }
  .touch-col { gap: 6px; }
}
/* Celular en vertical: el panel de conducción ocupa el ancho de abajo; los botones quedan sobre él */
@media (orientation: portrait) and (max-width: 720px) {
  body.touch-mode .hud-top { flex-direction: column; align-items: flex-start; right: 70px; }
  body.touch-mode .hud-right { justify-content: flex-start; max-width: calc(100vw - 150px); }
  body.touch-mode .mission-tracker { top: 156px; width: calc(100% - 140px); }
  body.touch-mode .message { top: 156px; max-width: calc(100% - 140px); left: 10px; transform: none; }
  body.touch-mode .mission-tracker:not(.hidden) ~ .message { top: 250px; }
  .touch-hint { top: auto; bottom: 52%; }
  .touch-driver .touch-left, .touch-driver .touch-actions { bottom: 150px; }
  /* Tutorial: a la izquierda de la columna de botones (sin taparlos) */
  body.touch-mode .tutorial { top: 156px; left: 10px; right: auto; transform: none; width: calc(100% - 132px); }
  .touch-stick-ghost { bottom: 240px; }
  .touch-rotate { bottom: 40%; }
}

/* ==========================================================================
   1.12 · Consola realista para CELULAR (solo pantallas chicas)
   Conductor: palanca de mando con muescas, llave del inversor, hongo de
   emergencia y pulsadores iluminados sobre placas metálicas del pupitre.
   Pasajero: botones redondos con pictograma y rótulo, palanca analógica.
   ========================================================================== */
.touch-desk { display: none; }
@media (max-height: 520px), (max-width: 720px) {
  .touch-driver .touch-left, .touch-driver .touch-actions, .touch-driver .touch-notch { display: none !important; }
  .touch-desk { display: block; }
}
/* Placa del pupitre: aluminio oscuro cepillado con tornillos en las esquinas */
.desk-plate { position: absolute; pointer-events: auto; touch-action: none; border-radius: 12px; padding: 10px;
  background:
    radial-gradient(circle at 7px 7px, #8d96a0 0 2px, #2a3038 2.5px 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 7px) 7px, #8d96a0 0 2px, #2a3038 2.5px 3px, transparent 3.5px),
    radial-gradient(circle at 7px calc(100% - 7px), #8d96a0 0 2px, #2a3038 2.5px 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 7px) calc(100% - 7px), #8d96a0 0 2px, #2a3038 2.5px 3px, transparent 3.5px),
    repeating-linear-gradient(90deg, #ffffff05 0 1px, transparent 1px 3px),
    linear-gradient(160deg, #3a4149 0%, #23282e 55%, #1a1e23 100%);
  border: 1px solid #0008; box-shadow: inset 0 1px 0 #ffffff26, inset 0 -2px 6px #0007, 0 10px 28px #000b; }
.desk-label { display: block; font: 700 8px/1 var(--f-data); letter-spacing: 1.4px; color: #c9d1d9b3; text-align: center; text-transform: uppercase; white-space: nowrap; }
.desk-label.engraved { color: #d7dee6; text-shadow: 0 1px 0 #000; }

/* --- Manipulador (palanca combinada de tracción y freno) --- */
.desk-lever { left: 10px; bottom: 10px; width: 104px; height: min(300px, calc(100% - 74px)); display: grid; grid-template-rows: auto 1fr; gap: 6px; padding: 10px 8px 12px; }
.lever-body { position: relative; }
.lever-slot { position: absolute; left: 50%; top: 8px; bottom: 8px; width: 12px; margin-left: -6px; border-radius: 6px;
  background: linear-gradient(90deg, #050607, #15181c 45%, #050607); box-shadow: inset 0 2px 4px #000, 0 1px 0 #ffffff1c; }
.lever-scale { position: absolute; inset: 8px 0; }
.lever-scale span { position: absolute; left: 22px; right: 2px; height: 0; display: flex; align-items: center; justify-content: space-between; pointer-events: none; }
.lever-scale span::before, .lever-scale span::after { content: ""; width: 9px; height: 2px; background: currentColor; opacity: .8; }
.lever-scale span b { position: absolute; left: -22px; width: 18px; text-align: right; font: 700 9px/1 var(--f-data); transform: translateY(-50%); top: 0; }
.lever-scale span.power { color: #5fd3ff; }
.lever-scale span.neutral { color: #f1f4f7; }
.lever-scale span.brake { color: #ffb547; }
.lever-scale span.emergency { color: #ff5252; }
.lever-scale span.emergency::before, .lever-scale span.emergency::after { height: 3px; }
.lever-scale span.on b { text-shadow: 0 0 6px currentColor; }
/* Empuñadura en T: se arrastra a lo largo de la ranura */
.lever-handle { position: absolute; left: 50%; width: 70px; height: 34px; margin-left: -35px; transform: translateY(-50%); pointer-events: none;
  transition: top .12s cubic-bezier(.3,1.4,.5,1); }
.lever-handle::before { content: ""; position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #b7c0c9, #4b535c 60%, #22272d); box-shadow: 0 2px 4px #000c; }
.lever-handle i { position: absolute; inset: 4px 0; border-radius: 9px;
  background: linear-gradient(180deg, #4a4f56 0%, #24272b 40%, #0f1113 100%);
  box-shadow: inset 0 1px 0 #ffffff40, inset 0 -2px 3px #000a, 0 6px 10px #000c; }
.lever-handle i::after { content: ""; position: absolute; left: 10px; right: 10px; top: 50%; height: 8px; margin-top: -4px; border-radius: 3px;
  background: repeating-linear-gradient(90deg, #ffffff1c 0 2px, #0000 2px 5px); }
.lever-handle em { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 28px; padding: 2px 4px; border-radius: 4px;
  font: 700 11px/1 var(--f-data); font-style: normal; text-align: center; color: #0a121b; background: #e8eef5; box-shadow: inset 0 0 0 1px #0006; }
.lever-handle em.power { background: #5fd3ff; }
.lever-handle em.brake { background: #ffb547; }
.lever-handle em.emergency { background: #ff4b4b; color: #fff; animation: blink .8s steps(2) infinite; }
.desk-lever.dragging .lever-handle { transition: none; }
.desk-lever.dragging .lever-handle i { background: linear-gradient(180deg, #5b616a 0%, #2c3035 40%, #121416 100%); }

/* --- Placa derecha: llave del inversor, emergencia, bocina y puertas --- */
.desk-right { right: 10px; bottom: 10px; display: grid; grid-template-columns: 64px 72px; gap: 8px 10px; align-items: end; justify-items: center; padding: 10px 12px 12px; }
.desk-cell { display: grid; gap: 4px; justify-items: center; }
/* Llave del inversor: conmutador rotativo R · N · F */
.desk-key { position: relative; width: 60px; height: 50px; pointer-events: auto; touch-action: none; }
.desk-key .key-marks { position: absolute; inset: 0; }
.desk-key .key-marks b { position: absolute; top: 0; font: 700 9px/1 var(--f-data); color: #aeb7c1; }
.desk-key .key-marks b.on { color: #6fe39a; text-shadow: 0 0 6px #6fe39a; }
.desk-key .key-marks b[data-dir="-1"] { left: 2px; top: 6px; }
.desk-key .key-marks b[data-dir="0"] { left: 50%; transform: translateX(-50%); }
.desk-key .key-marks b[data-dir="1"] { right: 2px; top: 6px; }
.desk-key .key-marks b[data-dir="-1"].on { color: #ffb547; text-shadow: 0 0 6px #ffb547; }
.desk-key .key-dial { position: absolute; left: 50%; bottom: 0; width: 38px; height: 38px; margin-left: -19px; border-radius: 50%;
  background: radial-gradient(circle at 40% 30%, #e9edf1, #9aa3ad 45%, #4f5760 80%); box-shadow: 0 0 0 3px #15181c, 0 0 0 4px #ffffff1f, 0 4px 8px #000b;
  transition: transform .18s cubic-bezier(.3,1.5,.5,1); }
.desk-key .key-dial::before { content: ""; position: absolute; left: 50%; top: 4px; bottom: 4px; width: 8px; margin-left: -4px; border-radius: 3px;
  background: linear-gradient(90deg, #1a1d21, #3d434a 50%, #1a1d21); box-shadow: inset 0 0 0 1px #000; }
.desk-key .key-dial::after { content: ""; position: absolute; left: 50%; top: 2px; width: 3px; height: 7px; margin-left: -1.5px; border-radius: 2px; background: #ff5252; }
/* Hongo de emergencia (rojo sobre aro amarillo) */
.desk-mushroom { position: relative; width: 66px; height: 66px; border-radius: 50%; pointer-events: auto; touch-action: none; border: 0 !important; padding: 0;
  background: radial-gradient(circle, #f6c400 0 56%, #c99d00 57% 63%, #1b1e22 64%) !important; box-shadow: 0 4px 10px #000c; -webkit-tap-highlight-color: transparent; }
.desk-mushroom::before { content: ""; position: absolute; inset: 11px; border-radius: 50%;
  background: radial-gradient(circle at 38% 30%, #ff8a80 0, #e0201b 38%, #8f0b08 80%, #5a0504);
  box-shadow: 0 5px 0 #5c0705, 0 7px 8px #000b, inset 0 -3px 5px #0006; transition: transform .08s, box-shadow .08s; }
.desk-mushroom.pressed::before, .desk-mushroom.latched::before { transform: translateY(3px) scale(.97); box-shadow: 0 2px 0 #5c0705, 0 3px 5px #000b, inset 0 -3px 5px #0006; }
.desk-mushroom.latched { box-shadow: 0 0 0 2px #ff3b30, 0 0 18px 5px #ff3b3099, 0 4px 10px #000c; }
.desk-mushroom.latched::before { background: radial-gradient(circle at 38% 30%, #ffb3ad 0, #ff2b24 38%, #b30f0b 80%, #6a0605); }
/* Pulsadores iluminados (puertas, vigilancia, cambio de cabina) y bocina */
.desk-btn { position: relative; pointer-events: auto; touch-action: none; display: grid; place-items: center; border-radius: 10px; padding: 0 8px;
  border: 0 !important; color: #10161c !important; font: 800 10px/1.05 var(--f-data) !important; letter-spacing: .6px; text-align: center; text-transform: uppercase;
  background: #15181c !important; box-shadow: 0 0 0 3px #0c0e10, 0 0 0 4px #ffffff1a, 0 4px 8px #000b; -webkit-tap-highlight-color: transparent; }
.desk-btn::before { content: ""; position: absolute; inset: 4px; border-radius: 7px; z-index: -1;
  background: var(--cap, linear-gradient(180deg, #59616b, #2c3137)); box-shadow: inset 0 1px 0 #ffffff59, inset 0 -3px 4px #0006, 0 3px 0 #08090a; transition: transform .08s, box-shadow .08s; }
.desk-btn { isolation: isolate; }
.desk-btn.pressed::before { transform: translateY(2px); box-shadow: inset 0 1px 0 #ffffff40, inset 0 -2px 3px #0006, 0 1px 0 #08090a; }
.desk-btn.pressed { transform: none !important; }
.desk-doors { width: 72px; height: 58px; --cap: linear-gradient(180deg, #9ef0b9, #33b864 55%, #1d7a40); }
.desk-doors.lit-open { --cap: radial-gradient(circle at 50% 35%, #fff3c4, #ffc23a 50%, #b97a00); box-shadow: 0 0 0 3px #0c0e10, 0 0 14px 2px #ffc23a99, 0 4px 8px #000b; }
.desk-horn { width: 52px; height: 52px; border-radius: 50% !important; color: #e8eef5 !important; font-size: 18px !important; }
.desk-horn::before { border-radius: 50% !important; --cap: radial-gradient(circle at 40% 30%, #4c535b, #1d2125 75%); }
.desk-ctx { position: absolute; right: 10px; display: grid; gap: 12px; justify-items: end; pointer-events: none; }
.desk-ctx .desk-btn { width: 116px; height: 46px; font-size: 10.5px !important; }
.desk-ctx .desk-btn[hidden] { display: none; }
.desk-vigilance { --cap: radial-gradient(circle at 50% 35%, #fff6c8, #ffd23f 50%, #b58b00); animation: deskPulse .7s ease-in-out infinite alternate; }
@keyframes deskPulse { to { box-shadow: 0 0 0 3px #0c0e10, 0 0 18px 4px #ffd23fcc, 0 4px 8px #000b; } }
.desk-cab { --cap: radial-gradient(circle at 50% 35%, #d9f1ff, #5fb9ff 50%, #1f6aa8); }

/* Pantalla de conducción (DMI) con marco de pupitre */
@media (max-height: 520px), (max-width: 720px) {
  body.touch-mode .driver-hud { border-radius: 10px; background: #070a0e !important;
    box-shadow: 0 0 0 4px #23282e, 0 0 0 5px #0009, 0 0 0 6px #ffffff14, 0 12px 30px #000c; }
  body.touch-mode .driver-hud .panel { border-left-color: #ffffff12; }
  body.touch-mode .driver-hud .speed-number { color: #f4f7fa; text-shadow: 0 0 10px #5fd3ff55; }
}
@media (max-height: 520px) {
  .desk-lever { width: 96px; height: calc(100% - 70px); max-height: 300px; }
  .desk-right { grid-template-columns: 58px 66px; gap: 6px 8px; padding: 9px 10px 10px; }
  .desk-mushroom { width: 60px; height: 60px; }
  .desk-mushroom::before { inset: 10px; }
  .desk-doors { width: 66px; height: 52px; }
  .desk-horn { width: 46px; height: 46px; }
}
@media (max-height: 360px) {
  .desk-lever { height: calc(100% - 56px); }
  .desk-right { grid-template-columns: 52px 58px; }
  .desk-mushroom { width: 54px; height: 54px; }
  .desk-doors { width: 58px; height: 46px; font-size: 9px !important; }
  .desk-horn { width: 42px; height: 42px; }
  .desk-key { transform: scale(.9); }
}
@media (orientation: portrait) and (max-width: 720px) {
  .desk-lever, .desk-right { bottom: 180px; }
  .desk-lever { height: min(300px, calc(100% - 360px)); }
}

/* --- Pasajero en el celular: botones redondos con pictograma y rótulo --- */
@media (max-height: 520px), (max-width: 720px) {
  .touch-passenger .touch-actions { gap: 10px; }
  .touch-passenger .touch-actions button { grid-auto-flow: row; min-width: 0; width: 62px; height: 62px; border-radius: 50%; padding: 0 !important; gap: 1px;
    align-content: center; background: radial-gradient(circle at 50% 30%, #2a3644e6, #0b141ee6 75%); border: 2px solid #ffffff40;
    box-shadow: 0 4px 12px #0009, inset 0 1px 0 #ffffff26; }
  .touch-passenger .touch-actions button .tb-ic { font-size: 22px; line-height: 1; }
  .touch-passenger .touch-actions button .tb-tx { font: 700 8.5px/1 var(--f-data); letter-spacing: .6px; text-transform: uppercase; color: #dbe5ef; }
  .touch-passenger .touch-actions .touch-main { width: 76px; height: 76px; border-color: #ffd166cc;
    background: radial-gradient(circle at 50% 30%, #6b5216f0, #2a1f06f0 75%); }
  .touch-passenger .touch-actions .touch-main .tb-ic { font-size: 28px; }
  .touch-passenger .touch-actions button:active, .touch-passenger .touch-actions button.pressed { transform: scale(.92); }
  /* Palanca analógica con base hundida y capuchón de goma */
  .touch-stick { border: 0; background: radial-gradient(circle, #0b141e99 0 55%, #ffffff26 56% 58%, #0b141e66 59%);
    box-shadow: inset 0 4px 14px #000a, 0 0 0 2px #ffffff2a; }
  .touch-stick i { background: radial-gradient(circle at 40% 30%, #6b7681, #2b333b 55%, #13181d);
    box-shadow: 0 6px 12px #000b, inset 0 1px 0 #ffffff40, inset 0 0 0 6px #ffffff0d; }
  .touch-stick-ghost { border: 2px solid #ffffff2a; background: radial-gradient(circle, #0b141e55 0 60%, transparent 61%); }
  .touch-stick-ghost::after { background: radial-gradient(circle at 40% 30%, #ffffff4d, #ffffff1a); }
  .touch-menu-btn { border-radius: 50% !important; width: 44px !important; }
}
@media (max-height: 360px) {
  .touch-passenger .touch-actions button { width: 54px; height: 54px; }
  .touch-passenger .touch-actions .touch-main { width: 64px; height: 64px; }
}
`;

/** Pantalla de celular: la misma condición que activa la consola realista en el CSS. */
const PHONE = "(max-height: 520px), (max-width: 720px)";

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
}

export class TouchControls {
  /**
   * @param {object} opts
   * @param {"driver"|"passenger"} opts.mode
   * @param {HTMLElement} opts.parent      contenedor de la pantalla de juego
   * @param {HTMLCanvasElement} opts.canvas  lienzo 3D (para el joystick y la mirada)
   * @param {(key:string) => void} opts.press  pulsa una tecla del juego (mismo efecto que el teclado)
   * @param {object} [opts.walker]         pasajero a pie (modo pasajero)
   */
  /**
   * @param {() => object} [opts.context]  qué acciones tienen sentido ahora:
   *   conductor { vigilance, cab } · pasajero { use, sit, seated, hold, holding }
   * @param {() => void} [opts.onMenu]      volver al menú principal (pasajero, con confirmación)
   */
  constructor({ mode, parent, canvas, press, walker = null, context = () => ({}), onMenu = null }) {
    injectCss();
    document.body.classList.add("touch-mode");
    this.mode = mode;
    this.press = press;
    this.context = context;
    this.onMenu = onMenu;
    this.walker = walker;
    this.canvas = canvas;
    this.root = document.createElement("div");
    this.root.className = `touch-ui touch-${mode}`;
    parent.append(this.root);
    this.listeners = [];
    if (mode === "driver") this.buildDriver();
    else this.buildPassenger();
    this.syncTimer = setInterval(() => this.sync(), 150);
    const rotate = document.createElement("div");
    rotate.className = "touch-rotate";
    rotate.textContent = "Gira el teléfono para jugar mejor ↻";
    const hint = document.createElement("div");
    hint.className = "touch-hint";
    hint.textContent = mode === "driver"
      ? (matchMedia(PHONE).matches ? "Desliza la palanca: arriba tracción, abajo freno · arrastra la pantalla para mirar" : "Arrastra la pantalla para mirar") : "Joystick abajo a la izquierda para caminar · arrastra a la derecha para mirar";
    this.root.append(rotate, hint);
    setTimeout(() => { hint.style.opacity = "0"; rotate.style.opacity = "0"; }, 6000);
  }

  /** Botón que manda una tecla al tocarlo (con repetición si se mantiene, para el mando). */
  button(label, key, cls = "touch-mid", { repeat = false, onClick = false } = {}) {
    const b = document.createElement("button");
    b.className = cls;
    this.paint(b, label);
    if (onClick) {
      // Abre una ventana: se espera al "click" para que el mismo toque no la cierre al soltar
      b.addEventListener("click", (ev) => { ev.preventDefault(); this.press(key); });
      return b;
    }
    let timer = null;
    const down = (ev) => {
      ev.preventDefault();
      b.classList.add("pressed");
      this.press(key);
      if (repeat) timer = setInterval(() => this.press(key), 260);
    };
    const up = () => { b.classList.remove("pressed"); clearInterval(timer); timer = null; };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("contextmenu", (ev) => ev.preventDefault());
    return b;
  }

  /** Menú ☰ con las acciones poco usadas; se cierra al elegir una o al tocar fuera. */
  buildMenu(items) {
    const btn = document.createElement("button");
    btn.className = "touch-menu-btn";
    btn.textContent = "☰";
    btn.setAttribute("aria-label", "Más opciones");
    const menu = document.createElement("div");
    menu.className = "touch-menu";
    menu.hidden = true;
    const close = () => { menu.hidden = true; };
    btn.addEventListener("click", (ev) => { ev.preventDefault(); menu.hidden = !menu.hidden; });
    for (const [label, action] of items) {
      const b = document.createElement("button");
      b.innerHTML = label;
      b.addEventListener("click", (ev) => { ev.preventDefault(); close(); action(); });
      menu.append(b);
    }
    const outside = (ev) => { if (!menu.hidden && !menu.contains(ev.target) && ev.target !== btn) close(); };
    document.addEventListener("pointerdown", outside, true);
    this.docListeners = [["pointerdown", outside]];
    this.menu = menu;
    this.root.append(btn, menu);
  }

  /* ----- Conductor ----- */
  buildDriver() {
    // Columna izquierda: mando actual (tocar el inversor lo cambia), ▲ / ▼ y emergencia
    const col = document.createElement("div");
    col.className = "touch-col touch-left";
    this.notch = document.createElement("div");
    this.notch.className = "touch-notch";
    this.notch.innerHTML = "<b>N</b><i>N</i>";
    this.notch.title = "Toca F / N / R para cambiar el inversor";
    // Inversor de tres posiciones: cada toque avanza una (F → N → R → N → F)
    this.revStep = -1;
    this.notch.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const dir = Number(this.notch.lastChild.dataset.dir || 0);
      if (dir === 1) this.revStep = -1;
      if (dir === -1) this.revStep = 1;
      this.press(this.revStep > 0 ? "q" : "e");
    });
    col.append(
      this.notch,
      this.button("▲", "w", "touch-big", { repeat: true }),
      this.button("▼", "s", "touch-big", { repeat: true }),
      this.button("EMER-<br>GENCIA", " ", "touch-em"),
    );
    // Derecha, abajo: puertas siempre; vigilancia y cambio de cabina solo cuando hacen falta
    const actions = document.createElement("div");
    actions.className = "touch-actions";
    this.ctxButtons = {
      vigilance: this.button("✋ Vigilancia", "x", "touch-alert"),
      cab: this.button("⇄ Cambiar cabina", "t"),
    };
    actions.append(this.ctxButtons.vigilance, this.ctxButtons.cab, this.button("🚪 Puertas", "d", "touch-main"));
    this.root.append(col, actions);
    this.buildDesk();
    this.buildMenu([
      ["📯 Bocina", () => this.press("b")],
      ["👁 Vista", () => this.press("v")],
      ["🛒 Tienda", () => this.press("k")],
      ["🏁 Finalizar turno", () => this.press("f")],
    ]);
  }

  /* ----- Consola realista del celular ----- */

  /**
   * Pupitre de conducción (solo se ve en pantallas chicas, ver CSS):
   *   izquierda  manipulador: se arrastra la empuñadura por la ranura (P4 arriba,
   *              EMERGENCIA abajo, tras un tope) o se toca una muesca de la escala
   *   derecha    llave del inversor (tocar el lado R o F la gira un paso),
   *              hongo de emergencia, bocina y pulsador iluminado de puertas;
   *              encima, vigilancia y cambio de cabina cuando hacen falta.
   * La palanca no inventa nada: manda W / S (o Espacio) tantas veces como
   * muescas haya que recorrer, igual que el teclado.
   */
  buildDesk() {
    const desk = document.createElement("div");
    desk.className = "touch-desk";
    this.desk = desk;

    // --- Manipulador ---
    const lever = document.createElement("div");
    lever.className = "desk-plate desk-lever";
    lever.innerHTML = `<span class="desk-label engraved">Manipulador</span>
      <div class="lever-body"><div class="lever-slot"></div><div class="lever-scale"></div>
      <div class="lever-handle"><i></i><em>N</em></div></div>`;
    const scale = lever.querySelector(".lever-scale");
    this.leverBody = lever.querySelector(".lever-body");
    this.leverHandle = lever.querySelector(".lever-handle");
    this.leverTag = this.leverHandle.querySelector("em");
    // Posición vertical (0–100 %) de cada muesca: P4 arriba … B3, un tope y EMERGENCIA
    const top = NOTCHES.length - 1, units = top + 0.7;
    this.leverPct = NOTCHES.map((n, i) => { const r = top - i; return ((r + (i === 0 ? 0.7 : 0)) / units) * 100; });
    this.leverMarks = NOTCHES.map((n, i) => {
      const s = document.createElement("span");
      s.className = n.type;
      s.style.top = `${this.leverPct[i]}%`;
      s.innerHTML = `<b>${n.id === "EM" ? "EM" : n.id}</b>`;
      scale.append(s);
      return s;
    });
    this.leverNotch = NOTCH_INDEX.N;     // lo que la palanca ya pidió (se corrige con el estado real del tren)
    this.leverSentAt = 0;
    this.leverDrag = null;
    const pick = (ev) => {
      const r = this.leverBody.getBoundingClientRect();
      const pct = ((ev.clientY - r.top - 8) / Math.max(1, r.height - 16)) * 100;
      let best = 0;
      this.leverPct.forEach((p, i) => { if (Math.abs(p - pct) < Math.abs(this.leverPct[best] - pct)) best = i; });
      return best;
    };
    lever.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      try { lever.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
      this.leverDrag = ev.pointerId;
      lever.classList.add("dragging");
      this.moveLever(pick(ev));
    });
    lever.addEventListener("pointermove", (ev) => {
      if (this.leverDrag !== ev.pointerId) return;
      ev.preventDefault();
      this.moveLever(pick(ev));
    });
    const release = (ev) => {
      if (this.leverDrag !== ev.pointerId) return;
      this.leverDrag = null;
      lever.classList.remove("dragging");
    };
    lever.addEventListener("pointerup", release);
    lever.addEventListener("pointercancel", release);
    lever.addEventListener("contextmenu", (ev) => ev.preventDefault());

    // --- Placa derecha ---
    const right = document.createElement("div");
    right.className = "desk-plate desk-right";
    const cell = (label, el) => {
      const c = document.createElement("div");
      c.className = "desk-cell";
      c.append(el);
      const l = document.createElement("span");
      l.className = "desk-label";
      l.textContent = label;
      c.append(l);
      return c;
    };
    // Llave del inversor: el lado tocado indica hacia dónde girarla
    const key = document.createElement("div");
    key.className = "desk-key";
    key.innerHTML = `<div class="key-marks"><b data-dir="-1">R</b><b data-dir="0">N</b><b data-dir="1">F</b></div><div class="key-dial"></div>`;
    key.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const r = key.getBoundingClientRect();
      this.press(ev.clientX < r.left + r.width / 2 ? "e" : "q");
    });
    this.keyDial = key.querySelector(".key-dial");
    this.keyMarks = [...key.querySelectorAll(".key-marks b")];
    // Hongo de emergencia
    this.mushroom = this.button("", " ", "desk-mushroom");
    this.mushroom.setAttribute("aria-label", "Freno de emergencia");
    // Bocina y puertas
    const horn = this.button("📯", "b", "desk-btn desk-horn");
    horn.setAttribute("aria-label", "Bocina");
    this.doorBtn = this.button("Abrir<br>puertas", "d", "desk-btn desk-doors");
    right.append(cell("Inversor", key), cell("Emergencia", this.mushroom), cell("Bocina", horn), cell("Puertas", this.doorBtn));

    // Pulsadores que solo aparecen cuando hacen falta, encima de la placa
    const ctx = document.createElement("div");
    ctx.className = "desk-ctx";
    this.deskCtx = {
      vigilance: this.button("Vigilancia<br>hombre muerto", "x", "desk-btn desk-vigilance"),
      cab: this.button("⇄ Cambiar<br>cabina", "t", "desk-btn desk-cab"),
    };
    ctx.append(this.deskCtx.vigilance, this.deskCtx.cab);
    this.deskRight = right;
    this.deskCtxEl = ctx;

    desk.append(lever, right, ctx);
    this.root.append(desk);
  }

  /** La palanca pide la muesca `target`: manda los pasos de mando que falten (o la emergencia). */
  moveLever(target) {
    this.showLever(target);
    if (target === this.leverNotch) return;
    if (target === NOTCH_INDEX.EM) {
      this.press(" ");
    } else {
      for (let n = this.leverNotch; n < target; n++) this.press("w");
      for (let n = this.leverNotch; n > target; n--) this.press("s");
    }
    this.leverNotch = target;
    this.leverSentAt = performance.now();
  }

  /** Dibuja la empuñadura en una muesca. */
  showLever(i) {
    if (this.leverShown === i) return;
    this.leverShown = i;
    const n = NOTCHES[i];
    this.leverHandle.style.top = `calc(8px + (100% - 16px) * ${this.leverPct[i] / 100})`;
    this.leverTag.textContent = n.id;
    this.leverTag.className = n.type === "neutral" ? "" : n.type;
    this.leverMarks.forEach((m, k) => m.classList.toggle("on", k === i));
  }

  /** Copia el estado real del tren a la consola (palanca, llave, hongo, puertas). */
  syncDesk(ctx) {
    if (ctx.notch == null) return;
    // La palanca sigue al tren salvo mientras se arrastra (o justo después: las órdenes van al próximo paso)
    if (performance.now() - this.leverSentAt > 450) {
      this.leverNotch = ctx.notch;
      if (this.leverDrag == null) this.showLever(ctx.notch);
    }
    const dir = String(ctx.reverser ?? 0);
    if (this.keyDir !== dir) {
      this.keyDir = dir;
      this.keyDial.style.transform = `rotate(${Number(dir) * 50}deg)`;
      this.keyMarks.forEach(b => b.classList.toggle("on", b.dataset.dir === dir));
    }
    this.mushroom.classList.toggle("latched", !!ctx.emergency);
    const open = !!ctx.doorsOpen;
    if (this.doorOpen !== open) {
      this.doorOpen = open;
      this.doorBtn.classList.toggle("lit-open", open);
      this.doorBtn.innerHTML = open ? "Cerrar<br>puertas" : "Abrir<br>puertas";
    }
    // Los pulsadores contextuales quedan justo encima de la placa derecha
    const h = this.deskRight.offsetHeight;
    const bottom = h ? `${parseFloat(getComputedStyle(this.deskRight).bottom) + h + 12}px` : "";
    if (bottom && this.deskCtxEl.style.bottom !== bottom) this.deskCtxEl.style.bottom = bottom;
  }

  /** Muestra solo las acciones que sirven ahora y copia el mando al indicador. */
  sync() {
    if (this.notch) this.syncNotch();
    if (!this.ctxButtons) return;
    let ctx = {};
    try { ctx = this.context() || {}; } catch { /* partida terminando */ }
    for (const [key, b] of Object.entries(this.ctxButtons)) b.hidden = !ctx[key];
    for (const [key, b] of Object.entries(this.deskCtx || {})) b.hidden = !ctx[key];
    if (this.desk) this.syncDesk(ctx);
    if (this.seatBtn) this.setLabel(this.seatBtn, ctx.seated ? "🧍 Levantarse" : "🪑 Sentarse");
    if (this.holdBtn) this.setLabel(this.holdBtn, ctx.holding ? "🤚 Soltarse" : "🤚 Agarrarse");
  }

  setLabel(b, text) { if (b.dataset.label !== text) this.paint(b, text); }

  /** Rótulo del botón; en el pasajero separa pictograma y texto (en el celular van uno sobre otro). */
  paint(b, label) {
    b.dataset.label = label;
    const m = this.mode === "passenger" && label.match(/^(\S+)\s(.+)$/);
    b.innerHTML = m && /[^\x00-\x7f]/.test(m[1]) ? `<span class="tb-ic">${m[1]}</span><span class="tb-tx">${m[2]}</span>` : label;
  }

  /** Copia el punto de mando y el inversor activos al indicador táctil. */
  syncNotch() {
    const li = document.querySelector("#notchList li.active");
    const rev = document.querySelector("#reverserPills span.active");
    const b = this.notch.firstChild, i = this.notch.lastChild;
    const label = li?.querySelector("b")?.textContent ?? "N";
    const cls = li ? ["power", "brake", "emergency"].find(c => li.classList.contains(c)) ?? "" : "";
    if (b.textContent !== label) b.textContent = label;
    if (b.className !== cls) b.className = cls;
    const dir = rev?.dataset.dir ?? "0";
    if (i.dataset.dir !== dir) { i.dataset.dir = dir; i.textContent = rev?.textContent ?? "N"; }
  }

  /* ----- Pasajero a pie ----- */
  buildPassenger() {
    const w = this.walker;
    this.stick = document.createElement("div");
    this.stick.className = "touch-stick";
    this.stick.innerHTML = "<i></i>";
    this.knob = this.stick.firstChild;

    // Derecha, abajo: misiones siempre; usar, sentarse y agarrarse solo donde se puede (correr: joystick al borde)
    const actions = document.createElement("div");
    actions.className = "touch-actions";
    this.seatBtn = this.button("🪑 Sentarse", "f");
    this.holdBtn = this.button("🤚 Agarrarse", "g");
    this.ctxButtons = { use: this.button("✋ Usar", "e", "touch-main"), sit: this.seatBtn, hold: this.holdBtn };
    actions.append(this.holdBtn, this.seatBtn, this.ctxButtons.use, this.button("🎯 Misiones", "j", "", { onClick: true }));
    // Marca dónde va el joystick hasta que se usa por primera vez
    this.ghost = document.createElement("div");
    this.ghost.className = "touch-stick-ghost";
    this.root.append(this.ghost, this.stick, actions);
    this.buildMenu([
      ["🛒 Tienda", () => this.press("k")],
      ["← Menú principal", () => this.onMenu?.()],
    ]);

    // Joystick (mitad izquierda) y mirada (mitad derecha) sobre el lienzo 3D
    const touches = new Map();          // pointerId → { kind, x0, y0, x, y }
    const on = (type, fn) => { this.canvas.addEventListener(type, fn, { passive: false }); this.listeners.push([type, fn]); };
    on("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && !new URLSearchParams(location.search).get("touch")) return;
      ev.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const left = ev.clientX - r.left < r.width * 0.42;
      const kind = left && ![...touches.values()].some(t => t.kind === "stick") ? "stick" : "look";
      touches.set(ev.pointerId, { kind, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY });
      try { this.canvas.setPointerCapture?.(ev.pointerId); } catch { /* puntero no capturable */ }
      if (kind === "stick") {
        this.ghost.style.opacity = "0";
        this.stick.style.display = "block";
        this.stick.style.left = `${ev.clientX - r.left}px`;
        this.stick.style.top = `${ev.clientY - r.top}px`;
        this.setKnob(0, 0);
      }
    });
    on("pointermove", (ev) => {
      const t = touches.get(ev.pointerId);
      if (!t) return;
      ev.preventDefault();
      if (t.kind === "look") {
        w.yaw -= (ev.clientX - t.x) * 0.006;
        w.pitch = Math.max(-1.3, Math.min(1.3, w.pitch - (ev.clientY - t.y) * 0.006));
      } else {
        this.setKnob(ev.clientX - t.x0, ev.clientY - t.y0);
      }
      t.x = ev.clientX; t.y = ev.clientY;
    });
    const end = (ev) => {
      const t = touches.get(ev.pointerId);
      if (!t) return;
      touches.delete(ev.pointerId);
      if (t.kind === "stick") { this.stick.style.display = "none"; this.setKnob(0, 0); }
    };
    on("pointerup", end);
    on("pointercancel", end);
  }

  /** Mueve la palanca y traduce su dirección a las teclas de caminar del pasajero. */
  setKnob(dx, dy) {
    const R = 50, d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const keys = this.walker.keys;
    for (const key of ["w", "a", "s", "d", "shift"]) keys.delete(key);
    if (d < 12) return;                                  // zona muerta
    const ang = Math.atan2(dy, dx);                      // 0 = derecha, −π/2 = arriba
    const sector = (a0, a1) => ang > a0 && ang < a1;
    if (sector(-2.75, -0.39)) keys.add("w");             // arriba (con diagonales)
    if (sector(0.39, 2.75)) keys.add("s");               // abajo
    if (Math.abs(ang) < 1.18) keys.add("d");             // derecha
    if (Math.abs(ang) > 1.96) keys.add("a");             // izquierda
    if (d > R * 1.15) keys.add("shift");                 // al borde: correr
  }

  destroy() {
    clearInterval(this.syncTimer);
    for (const [type, fn] of this.docListeners || []) document.removeEventListener(type, fn, true);
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    this.root.remove();
  }
}
