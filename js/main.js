/* ==========================================================================
   MetroSim — Alpha 0.9 · main.js
   Punto de entrada: crea la partida y une todos los sistemas.

   Arquitectura:  ENTRADA DEL JUGADOR → MOTOR → ESTADO → RENDER / UI / AUDIO

   Motor (js/engine/, sin Three.js; se puede ejecutar en Node):
     engine.js    MetroEngine: reloj de paso fijo, horarios, señales y trenes
     state.js     estado explícito de cada tren (arrancando, en andén, ante señal...)
     eta.js       llegadas estimadas desde la posición real de los trenes
     incidents.js puertas obstruidas, limitaciones temporales y fallas de señal
     commands.js  buzón de órdenes: los roles mandan órdenes al motor
     clock.js     reloj de la simulación
     route.js     los dos sentidos de circulación (vía 1 y vía 2)
     schedule.js  horarios por sentido y retrasos
     signals.js   lógica de señalización de bloqueo automático
     sim.js       física de un tren y conducción automática
     traffic.js   todos los trenes de la línea, maniobras y retrasos
     consist.js   composición lógica del tren de 5 coches
     events.js    bus de eventos del motor
     format.js    utilidades puras

   Render (js/render/ y resto de js/, con Three.js):
     render/trainViews.js   dibujo de los trenes del motor
     render/signalViews.js  dibujo de las señales del motor
     render/lineMapPanel.js plano de línea dinámico de los coches (luz parpadeante)
     roles/driverRole.js    rol de Conductor: teclado → órdenes al motor
     control/controlCenter.js  rol de Centro de Control: esquema de la red y órdenes
     touch.js               controles táctiles (celular y tablet)
     stationLayout.js       columnas, bancos y pantallas de los andenes (compartido)
     config.js    Línea 3 de Santiago, geometría, mando, horarios y demanda
     utils.js     utilidades, materiales y texturas procedurales
     world.js     túnel, vías, catenaria, estaciones con mezanina y torniquetes
     train.js     tren de 5 coches, cabina y luces
     dmi.js       pantalla de cabina
     people.js    viajeros (NPC) instanciados
     walker.js    pasajero a pie (primera persona)
     audio.js     sonido procedural y megafonía
     camera.js    vistas del conductor
     hud.js       interfaz HTML (incluye boletería y tótem)
     card.js      tarjeta bip! del jugador
     economy.js   cuenta bancaria (débito), sueldo del conductor por estación
     missions.js  misiones del pasajero (compras, turismo, encargos, contrarreloj...)
     city/        la calle de cada estación: plan.js (locales), catalog.js (hitos),
                  landmarks.js (modelos de los hitos), kit.js (piezas), city.js (calle 3D)
     scoring.js   puntaje del conductor: parada, horario, confort, rachas y récord
     announcements.js  frases reales de megafonía del Metro de Santiago

   Principio: Conductor y Pasajero comparten el MISMO mundo, el MISMO tráfico
   y los MISMOS viajeros. Solo cambia qué controla el jugador.

   Ciclo de juego (Alpha 0.9): como Conductor ganas sueldo en tiempo real en
   cada estación (cuenta bancaria compartida); como Pasajero empiezas en la
   calle de la estación elegida, cumples misiones y gastas ese dinero en la
   bip!, sus cargas y los locales de la calle.

   Hora: la partida empieza a la HORA LOCAL real del computador y el reloj
   del motor se mantiene sincronizado con ella (si el juego se pausa o la
   pestaña queda en segundo plano, el motor recupera el tiempo perdido).
   ========================================================================== */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CONFIG, STATIONS, NOTCH_INDEX, FARES, spokenName, fareBandAt, formatCLP } from "./config.js";
import { ROUTES, ROUTE_A, ROUTE_B, routeForSide, oppositeRoute, setActiveLine } from "./engine/route.js";
import { LINES, lineById } from "./engine/network.js";
import { BipCard } from "./card.js";
import { PHRASES } from "./announcements.js";
import { playIntro } from "./intro.js";
import { $, clamp, formatClock, formatStopError, gradeStop } from "./utils.js";
import { formatDelay, makeTrip } from "./engine/schedule.js";
import { MetroEngine } from "./engine/engine.js";
import { TrainViews } from "./render/trainViews.js";
import { SignalViews } from "./render/signalViews.js";
import { LineMapPanel } from "./render/lineMapPanel.js";
import { DriverRole } from "./roles/driverRole.js";
import { ControlCenter } from "./control/controlCenter.js";
import { TouchControls, wantsTouch } from "./touch.js";
import { World } from "./world.js";
import { createTrainLights, resetTrainAssets, trainLineMapMaterial } from "./train.js";
import { PeopleSystem } from "./people.js";
import { Walker } from "./walker.js";
import { AudioSystem } from "./audio.js";
import { CameraRig } from "./camera.js";
import { Hud } from "./hud.js";
import { DriverScore } from "./scoring.js";
import { BankAccount, BANK_NAME, stationWage, shiftBonus } from "./economy.js";
import { MissionSystem } from "./missions.js";
import { City } from "./city/city.js";

const startScreen = $("startScreen");
const loadingScreen = $("loadingScreen");
const gameScreen = $("gameScreen");
const gameContainer = $("gameContainer");
const hud = new Hud();

let game = null;
let muted = loadMuted();
hud.setSound(!muted);
const card = new BipCard();               // la tarjeta bip! del jugador (saldo persistente)
hud.setCard(card);
const bank = new BankAccount();           // cuenta bancaria con tarjeta de débito (compartida por los dos modos)
hud.setBank(bank);
const directionSelect = $("startDirection");

// Introducción de bienvenida (solo al abrir la página)
playIntro({ isMuted: () => muted });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* --- Selección de línea en la pantalla principal (conductor y pasajero) --- */
const stationSelect = $("startStation");
const driverLineSelect = $("driverLine"), paxLineSelect = $("paxLine");
const savedLine = loadSetting("metrosim.line") || "3";
for (const sel of [driverLineSelect, paxLineSelect]) {
  LINES.forEach(l => sel.append(new Option(`${l.name} · ${l.stations[0].short} ⇄ ${l.stations.at(-1).short}`, l.id)));
  sel.value = lineById(savedLine) ? savedLine : "3";
}
fillDirections(lineById(driverLineSelect.value));
fillStations(lineById(paxLineSelect.value));
driverLineSelect.addEventListener("change", () => { fillDirections(lineById(driverLineSelect.value)); saveSetting("metrosim.line", driverLineSelect.value); });
paxLineSelect.addEventListener("change", () => { fillStations(lineById(paxLineSelect.value)); saveSetting("metrosim.line", paxLineSelect.value); });

/** Servicios del conductor: ida y vuelta de la línea elegida. */
function fillDirections(line) {
  const [A, B] = line.routes;
  directionSelect.replaceChildren(
    new Option(`Ida · ${A.first.short} → ${A.last.short}`, "A"),
    new Option(`Vuelta · ${B.first.short} → ${B.last.short}`, "B"),
  );
}

/** Estaciones del modo pasajero de la línea elegida (por defecto, la de más combinaciones). */
function fillStations(line) {
  stationSelect.replaceChildren(...line.stations.map(st =>
    new Option(st.name + (st.combos.length ? `  (L${st.combos.join(", L")})` : ""), st.index)));
  const preferred = line.stations.find(s => s.name === "UNIVERSIDAD DE CHILE")
    || [...line.stations].sort((a, b) => b.combos.length - a.combos.length)[0];
  stationSelect.value = String(preferred.index);
}

function loadSetting(key) { try { return localStorage.getItem(key); } catch { return null; } }
function saveSetting(key, value) { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } }

/** Activa la línea elegida: su mundo 3D, sus trenes, su interfaz y su color. */
function useLine(line) {
  setActiveLine(line);
  hud.setLine();
  $("loadingBadge").textContent = line.id;
  $("loadingTitle").textContent = `Preparando la ${line.name.charAt(0) + line.name.slice(1).toLowerCase()}…`;
}

document.querySelectorAll("[data-mode]").forEach(btn => btn.addEventListener("click", () => startGame(btn.dataset.mode)));
$("backButton").addEventListener("click", stopGame);
$("soundButton").addEventListener("click", toggleSound);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", onResize);

// Pantallas táctiles: se ocultan las ayudas de teclado
if (wantsTouch()) document.body.classList.add("touch-mode");

// Acceso de depuración desde la consola: MetroSim.game.traffic, etc.
window.MetroSim = { get game() { return game; }, bank, card, CONFIG, get STATIONS() { return STATIONS; }, get ROUTES() { return ROUTES; }, LINES };


/* ==========================================================================
   Inicio y fin de partida
   ========================================================================== */

function startGame(mode) {
  if (game) stopGame();
  if (mode === "control") return startControl();
  useLine(lineById(mode === "driver" ? driverLineSelect.value : paxLineSelect.value));
  const stationIndex = Number(stationSelect.value) || 0;
  const direction = directionSelect.value === "B" ? ROUTE_B : ROUTE_A;
  startScreen.classList.add("hidden");
  loadingScreen.classList.remove("hidden");
  const audio = new AudioSystem();          // dentro del gesto del usuario
  audio.muted = muted;
  audio.start();
  setTimeout(() => buildGame(mode, stationIndex, audio, direction), 40);
}

function buildGame(mode, stationIndex, audio, direction = ROUTE_A) {
  resetTrainAssets();

  /* --- Render --- */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  gameContainer.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040608);
  scene.fog = new THREE.Fog(0x040608, 30, 240);
  scene.add(new THREE.HemisphereLight(0xc4d6ea, 0x1c1f23, 0.7));
  // Mapa de entorno: los metales (trenes, columnas, torniquetes) reflejan luz en vez de verse negros
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(mode === "driver" ? 62 : 70, innerWidth / innerHeight, 0.03, 340);

  /* --- Hora local: la partida empieza "ahora" --- */
  const startClock = localClock(), startEpoch = performance.now();
  CONFIG.startTime = startClock;
  CONFIG.schedule.playerDeparture = Math.ceil((startClock + 90) / 30) * 30;   // tu servicio sale en ~1,5 min

  /* --- Motor MetroSim (el "cerebro") y su dibujo --- */
  const world = new World(scene);
  const warmStart = CONFIG.startTime - 45 * 60;
  const engine = new MetroEngine({ startTime: warmStart });
  const { traffic, signals, timetables } = engine;
  // El juego escucha al motor por su bus: sucesos y cambios de estado de cada tren
  engine.bus.on("train:event", ({ unit, type, data }) => onUnitEvent(unit, type, data));
  engine.bus.on("train:state", (change) => onTrainState(change));
  engine.bus.on("command:result", (r) => onCommandResult(r));
  engine.bus.on("incident", (inc) => onIncident(inc));
  const trainViews = new TrainViews(scene, engine.bus);       // dibuja los trenes que crea el motor
  const signalViews = new SignalViews(scene, signals.values());
  const playerTrip = timetables.get(direction.id).anchorTrip;

  game = {
    mode, renderer, scene, camera, world, engine, signals, timetables, traffic, trainViews, signalViews, audio, playerTrip,
    clock: warmStart, elapsed: 0, last: performance.now(), dmiTimer: 0, pidTimer: 0, raf: 0,
    warming: true,
    stats: { arrivals: [], stops: [], redSignals: 0, overspeeds: 0, emergencies: 0 },
    ride: { origin: null, boardedClock: null },
  };
  if (mode === "driver") traffic.started.add(playerTrip.id);

  /* --- Calentamiento: el motor simula 45 min de servicio para que la línea ya tenga trenes --- */
  const people = new PeopleSystem(scene, traffic, engine.passengers);    // muestra visible de los pasajeros del motor
  game.people = people;
  engine.runUntil(CONFIG.startTime, { onStep: (step, t) => people.update(step, t, { cameraZ: 1e9, render: false }) });
  game.clock = engine.time;
  game.realClock = { epoch: startEpoch, clock: startClock };           // ancla para seguir la hora local (recupera el tiempo de carga)
  game.warming = false;
  game.lineMap = new LineMapPanel(trainLineMapMaterial());              // plano de línea dinámico de los coches

  /* --- Jugador --- */
  game.trainLights = createTrainLights({ cab: mode === "driver" });
  game.innerLight = game.trainLights.getObjectByName("innerLight");
  if (mode === "driver") {
    const player = traffic.createUnit(playerTrip, { isPlayer: true, start: direction.first });
    player.arrivedIdx = player.dockedIdx = 0;
    game.player = player;
    game.score = newScore(direction);
    game.driverRole = new DriverRole(engine, () => game?.player);
    const rig = new CameraRig(camera, player.group);
    rig.setView("cab");
    rig.attach(renderer.domElement);
    game.rig = rig;
    player.group.add(game.trainLights);
    game.lightsUnit = player;
  } else {
    const city = new City(scene);
    game.city = city;
    game.missions = new MissionSystem(ROUTE_A.line, STATIONS);
    const walker = new Walker({
      scene, camera, traffic, station: STATIONS[stationIndex], city,
      onEvent: (t, d) => onWalkerEvent(t, d),
      onValidate: () => validateFare(),
      benches: (st, side) => game.people.stations[st.index].benches[side],
      isCrowded: (x, y, z, fx, fz, unit) => game.people.blocks(x, y, z, fx, fz, unit),
    });
    walker.attach(renderer.domElement);
    game.walker = walker;
    scene.add(game.trainLights);
    goToStreet(STATIONS[stationIndex], { initial: true });     // la partida empieza en la calle
    game.missions.ensure(missionCtx());
  }

  // Precompila los shaders para evitar tirones la primera vez que se ve cada cosa
  renderer.compile(scene, camera);

  hud.setMode(mode);

  // Controles táctiles (celular / tablet): cada botón equivale a su tecla
  if (wantsTouch()) {
    game.touch = new TouchControls({ mode, parent: gameScreen, canvas: renderer.domElement, press: pressKey, walker: game.walker });
  }
  loadingScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  onResize();

  hud.setCard(card);
  hud.setBank(bank);
  hud.showMessage(mode === "driver"
    ? `Servicio ${playerTrip.id} · ${direction.label} · salida ${formatClock(playerTrip.departure)} · cada estación bien servida te paga en tu cuenta`
    : `Calle de ${STATIONS[stationIndex].name} · cuenta ${bank.label} · J misiones · clic para mirar con el ratón`, "info", 7000);

  game.raf = requestAnimationFrame(loop);
}

function stopGame() {
  if (!game) return;
  game.touch?.destroy();
  cancelAnimationFrame(game.raf);
  game.audio.stop();
  game.walker?.detach();
  game.scene.traverse(obj => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach(m => { m.map?.dispose(); m.dispose(); });
  });
  game.renderer.dispose();
  gameContainer.replaceChildren();
  game = null;
  hud.hideSummary();
  gameScreen.classList.add("hidden");
  loadingScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

/* ==========================================================================
   Centro de Control: solo el motor y un esquema 2D (sin mundo 3D ni sonido)
   ========================================================================== */

let control = null;

function startControl() {
  startScreen.classList.add("hidden");
  loadingScreen.classList.remove("hidden");
  setTimeout(() => {
    // Hora local, igual que en los otros modos
    const startClock = localClock(), startEpoch = performance.now();
    CONFIG.startTime = startClock;
    CONFIG.schedule.playerDeparture = Math.ceil((startClock + 90) / 30) * 30;
    const engine = new MetroEngine({ startTime: startClock - 45 * 60 });
    engine.runUntil(startClock);                     // la red ya tiene trenes al empezar el turno
    const ui = new ControlCenter({ engine, onExit: stopControl });
    control = { engine, ui, startClock, startEpoch, last: performance.now(), uiT: 0, raf: 0 };
    window.MetroSim.control = control;
    loadingScreen.classList.add("hidden");
    control.raf = requestAnimationFrame(controlLoop);
  }, 40);
}

function controlLoop(now) {
  if (!control) return;
  const c = control;
  const realDt = Math.max(0, (now - c.last) / 1000);
  c.last = now;
  c.engine.update(realDt);
  // Seguir la hora local (recupera pausas y pestañas en segundo plano)
  const target = c.startClock + (performance.now() - c.startEpoch) / 1000;
  if (target - c.engine.time > 1) c.engine.runUntil(c.engine.time + Math.min(target - c.engine.time, 120));
  c.uiT -= realDt;
  if (c.uiT <= 0) { c.uiT = 0.1; c.ui.update(); }       // el esquema se redibuja 10 veces por segundo
  c.raf = requestAnimationFrame(controlLoop);
}

function stopControl() {
  if (!control) return;
  cancelAnimationFrame(control.raf);
  control.ui.destroy();
  control = null;
  startScreen.classList.remove("hidden");
}

function restartGame() {
  const mode = game.mode;
  stopGame();
  startGame(mode);
}

function onResize() {
  if (!game) return;
  game.camera.aspect = innerWidth / innerHeight;
  game.camera.updateProjectionMatrix();
  game.renderer.setSize(innerWidth, innerHeight);
}

function loadMuted() {
  try { return localStorage.getItem("metrosim.muted") === "1"; } catch { return false; }
}

function toggleSound() {
  muted = !muted;
  try { localStorage.setItem("metrosim.muted", muted ? "1" : "0"); } catch { /* sin almacenamiento */ }
  hud.setSound(!muted);
  game?.audio.setMuted(muted);
  if (game) hud.showMessage(muted ? "Sonido desactivado" : "Sonido activado", "info", 1200);
}


/* ==========================================================================
   Entrada de teclado
   ========================================================================== */

function onKeyDown(event) {
  if (!game || game.warming) return;
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
  if (hud.summaryOpen) return;
  if (hud.ticketOpen) { if (key === "escape" || key === "e") hud.closeTicket(); return; }
  if (hud.storeOpen) { if (key === "escape" || key === "e") hud.closeStore(); return; }
  if (hud.missionsOpen) { if (key === "escape" || key === "j") hud.closeMissions(); return; }

  if (key === "m") return toggleSound();
  if (key === "h") return hud.toggleHelp();

  if (game.walker) {
    if (game.transition) return;
    if (key === "j") return openMissionBoard();
    const result = game.walker.keyDown(key);
    if (result) hud.showMessage(result.text, result.level);
    return;
  }

  if (key === "c") return game.rig.recenter();
  if (key === "v") {
    // Ciclo de vistas del conductor: cabina → interior del tren (salón) → exterior
    const next = { cab: "saloon", saloon: "exterior", exterior: "cab" }[game.rig.view] || "cab";
    game.rig.setView(next);
    const label = { cab: "Vista de cabina", saloon: "Vista interior del tren", exterior: "Vista exterior" }[next];
    return hud.showMessage(label, "info", 1200);
  }
  // Mando del tren: el rol de Conductor envía órdenes al motor (la respuesta llega en onCommandResult)
  if (game.driverRole.handleKey(key, event.repeat)) return;
  if (event.repeat) return;
  if (key === "r") return restartGame();
  if (key === "t") return changeCab();
}

/** Respuesta del motor a una orden (del conductor o desde la consola / Centro de Control). */
function onCommandResult(r) {
  if (!game || game.warming || !r.result?.text) return;
  if (game.driverRole?.owns(r) || r.type.startsWith("control.")) hud.showMessage(r.result.text, r.result.level);
}

/** Hora local del computador en segundos desde medianoche. */
function localClock() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}

/** Pulsación de una tecla desde los controles táctiles (mismo efecto que el teclado). */
function pressKey(key) {
  const ev = { key, repeat: false, preventDefault() {} };
  onKeyDown(ev);
  onKeyUp(ev);
}

function onKeyUp(event) {
  game?.walker?.keyUp(event.key.toLowerCase());
}


/* ==========================================================================
   Eventos de los trenes
   ========================================================================== */

function onUnitEvent(unit, type, data = {}) {
  if (!game || game.warming || !unit.sim) return;
  if (unit.route.line !== ROUTE_A.line) return;          // otras líneas: simuladas sin dibujo ni sonido
  if (type === "removed") { game.people?.clearUnit(unit); return; }
  if (type === "turnbackStart") { game.people?.clearUnit(unit); return; }
  if (type === "turnback") {
    if (game.lightsUnit === unit) unit.group.add(game.trainLights);    // las luces siguen al tren
    return;
  }
  if (unit === game.player) return onPlayerEvent(type, data);

  const walker = game.walker;
  if (!walker) return;
  const riding = walker.unit === unit;
  switch (type) {
    case "ato:arrived":
      if (riding) hud.showMessage(`Estación ${data.station.name}`, "ok", 3500);
      break;
    case "ato:doorsClosing":
      if (riding && data.station === unit.route.last) {
        walker.exitTrain();
        hud.showMessage(`Fin de trayecto en ${data.station.name} · todos los viajeros han bajado`, "info", 5000);
      } else if (riding || (walker.platformSide() === unit.route.side && walker.stationAt(walker.pos.z) === data.station.world)) {
        hud.showMessage("Atención: cierre de puertas", "warn");
      }
      break;
    case "ato:departing":
      if (riding && data.next) hud.showMessage(`Próxima estación: ${data.next.name}`, "info", 3500);
      break;
  }
}

/** Incidentes aleatorios (engine/incidents.js): avisos al conductor o al viajero afectado. */
function onIncident(inc) {
  if (!game || game.warming || inc.line !== ROUTE_A.line) return;
  const level = inc.phase === "end" ? "ok" : "warn";
  if (game.player) {
    if (inc.kind === "doorObstruction") {
      if (inc.unit === game.player) { game.audio.airHiss(0.4); hud.showMessage(inc.text, "warn", 5000); }
      return;
    }
    if (inc.route !== game.player.route) return;
    if (inc.phase === "start") game.audio.notchClick();
    hud.showMessage(`PCC: ${inc.text}`, level, 7000);
    return;
  }
  const riding = game.walker?.unit;
  if (!riding) return;
  if (inc.kind === "doorObstruction" ? inc.unit === riding : inc.route === riding.route && inc.phase === "start") {
    hud.showMessage(inc.kind === "doorObstruction"
      ? "Por favor, no obstruya el cierre de puertas"
      : inc.kind === "signalFault" ? "Estimados pasajeros, por una falla de señal podríamos detenernos unos momentos"
      : "Estimados pasajeros, circularemos a velocidad reducida por trabajos en la vía", "info", 5000);
  }
}

/** Cambios de estado de los trenes (state.js): avisos para el viajero a bordo. */
function onTrainState({ unit, from, to }) {
  if (!game || game.warming || game.walker?.unit !== unit) return;
  if (to === "signalStop") hud.showMessage("Tren detenido por señal · reanudaremos la marcha en breve", "info", 4500);
  else if (to === "regulating") hud.showMessage("Este tren se encuentra regulando su intervalo · saldremos en unos momentos", "info", 5000);
  else if (to === "held") hud.showMessage("Tren retenido en la estación por el Centro de Control", "warn", 5000);
  else if (from === "signalStop" && to === "starting") hud.showMessage("Reanudamos la marcha", "ok", 2500);
}

function onPlayerEvent(type, data) {
  const audio = game.audio, stats = game.stats;
  switch (type) {
    case "notch": audio.notchClick(); break;
    case "reverser": audio.reverserClunk(); break;
    case "halt": audio.airHiss(0.6); break;
    case "emergency": audio.emergency(); stats.emergencies++; game.score.penalty("emergency"); break;
    case "stopped":
      game.lastStop = data;
      game.score.stopped(game.lastDecel);
      if (Math.abs(data.error) > CONFIG.station.stopTolerance) {
        game.score.penalty("offPosition");
        hud.showMessage(`${data.station.name} · FUERA DE POSICIÓN (${formatStopError(data.error)}) · usa marcha atrás (E) si te pasaste`, "warn", 4500);
      }
      break;
    case "arrivedStation": {
      const stop = game.lastStop?.station === data.station ? game.lastStop.error : 0;
      stats.stops.push(Math.abs(stop));
      stats.arrivals.push(data.delay);
      const p = punctuality(data.delay);
      const sc = game.score.arrival(stop, data.delay);
      const streak = sc.streak >= 2 ? ` · ¡RACHA ${sc.streak}!` : "";
      // Sueldo de la estación: se deposita al instante (las faltas del tramo se descuentan)
      const wage = stationWage({ gained: sc.gained, perfect: sc.perfect, deductions: game.wageDeductions });
      game.wageDeductions = 0;
      game.shiftPay += wage.pay;
      if (wage.pay > 0) { bank.deposit(wage.pay, `Sueldo · ${data.station.name}`, { wage: true }); hud.setBank(bank); hud.moneyFloat(wage.pay); }
      const discount = wage.discount ? ` (−${formatCLP(wage.discount)} por faltas)` : "";
      hud.showMessage(`${data.station.name} · parada ${gradeStop(stop)} · llegada ${formatDelay(data.delay)} (${p.text}) · +${sc.gained} pts${streak} · sueldo +${formatCLP(wage.pay)}${discount}`, p.cls === "ontime" ? "ok" : "warn", 5000);
      break;
    }
    case "departedStation":
      if (data.delay < -10) game.score.penalty("earlyDeparture");
      if (data.delay < -10) hud.showMessage(`Salida anticipada de ${data.station.name} (${formatDelay(data.delay)}) · respeta el horario`, "warn", 4000);
      break;
    case "doorsOpen":
      if (data.station === game.player.route.last) setTimeout(() => game && showDriverSummary(), 2500);
      break;
    case "overspeed":
      stats.overspeeds++;
      game.score.penalty("overspeed");
      hud.showMessage(`EXCESO DE VELOCIDAD · límite ${data.limit} km/h`, "alert");
      break;
    case "redSignal":
      stats.redSignals++;
      game.score.penalty("redSignal");
      game.player.sim.emergencyBrake();
      hud.showMessage(`REBASE DE SEÑAL S${data.signal.id} EN ROJO · frenado de emergencia automático`, "alert", 5000);
      break;
    case "collision":
      audio.impact();
      game.score.penalty("collision");
      game.player.sim.emergencyBrake();
      hud.showMessage(`ALCANCE CON EL TREN ${data.other.id} a ${Math.round(data.kmh)} km/h`, "alert", 5000);
      break;
    case "bumper":
      audio.impact();
      game.score.penalty("bumper");
      hud.showMessage(`IMPACTO CONTRA LA TOPERA a ${Math.round(data.kmh)} km/h`, "alert", 4000);
      break;
  }
}

function punctuality(delay) {
  const w = CONFIG.schedule.punctualWindow;
  if (Math.abs(delay) <= w) return { text: "puntual", cls: "ontime" };
  return delay > 0 ? { text: "con retraso", cls: "late" } : { text: "adelantado", cls: "early" };
}

/** Puntaje nuevo para un servicio (récord por línea y sentido). */
function newScore(route) {
  game.wageDeductions = 0;                 // puntos de falta desde la última estación (se descuentan del sueldo)
  game.shiftPay = 0;                       // sueldo ganado en este servicio
  const score = new DriverScore(`${route.line}.${route.id}`, (ev) => {
    if (ev.points < 0 && game) game.wageDeductions += -ev.points;
    hud.updateScore(ev);
  });
  hud.updateScore({ total: 0, streak: 0, multiplier: 1, points: 0, best: score.best?.total });
  return score;
}

function showDriverSummary() {
  const s = game.stats, sc = game.score;
  const prevBest = sc.best?.total ?? 0;
  const record = sc.finish();
  const w = CONFIG.schedule.punctualWindow;
  const punctual = s.arrivals.filter(d => Math.abs(d) <= w).length;
  const avgStop = s.stops.length ? s.stops.reduce((a, b) => a + b, 0) / s.stops.length : 0;
  // Bono solo si se sirvió al menos la mitad de la línea (no vale empezar a mitad de camino)
  const bonus = s.arrivals.length >= (STATIONS.length - 1) / 2 ? shiftBonus(sc.grade()) : 0;
  if (bonus) { bank.deposit(bonus, `Bono de servicio ${game.player.trip.id} (nota ${sc.grade()})`, { wage: true }); hud.setBank(bank); hud.moneyFloat(bonus); }
  hud.showSummary({
    kicker: `SERVICIO ${game.player.trip.id} COMPLETADO`,
    title: spokenName(game.player.route.last.name),
    rows: [
      ["Estaciones servidas", `${s.arrivals.length} / ${STATIONS.length - 1}`],
      ["Llegadas puntuales (±30 s)", `${punctual} / ${s.arrivals.length}`],
      ["Retraso final", formatDelay(s.arrivals.at(-1) ?? 0)],
      ["Precisión media de parada", `${avgStop.toFixed(2)} m`],
      ["Señales rebasadas en rojo", String(s.redSignals)],
      ["Excesos de velocidad", String(s.overspeeds)],
      ["Frenos de emergencia", String(s.emergencies)],
      ["Tirones / paradas bruscas", `${sc.totalJerks} / ${sc.harshStops}`],
      ["Estaciones perfectas · mejor racha", `${sc.perfects} · ${sc.bestStreak}`],
      ["PUNTAJE", `${sc.total} pts · nota ${sc.grade()}`],
      [record ? "★ ¡NUEVO RÉCORD!" : "Récord de este servicio", record ? `antes ${prevBest} pts` : `${prevBest} pts`],
      ["Sueldo por estaciones", formatCLP(game.shiftPay)],
      [`Bono de fin de servicio (nota ${sc.grade()})`, formatCLP(bonus)],
      [`Saldo en tu cuenta ${BANK_NAME}`, bank.label],
    ],
    continueLabel: "Maniobra de retorno",
    onContinue: () => hud.showMessage("Cierra puertas (D), avanza a la cola de maniobras y detente en el cartel FIN DE MANIOBRA. Luego pulsa T", "info", 9000),
    altLabel: "Reiniciar",
    onAlt: restartGame,
    onMenu: stopGame,
  });
}

/**
 * Cambio de cabina al final de la cola de maniobras: el conductor pasa al
 * otro extremo, el tren cruza el cambio de vía y empieza el servicio de vuelta.
 */
function changeCab() {
  const player = game.player, sim = player.sim;
  const endZ = player.route.track.retireZ;
  if (sim.dockedStation() === player.route.first && sim.isStopped) {
    return hud.showMessage("Ya estás en la terminal de origen de tu servicio", "info");
  }
  if (!sim.isStopped || Math.abs(sim.position - endZ) > 15 || sim.nextStation()) {
    const d = Math.round(sim.position - endZ);
    return hud.showMessage(sim.nextStation()
      ? "El cambio de cabina se hace en la cola de maniobras, tras la terminal"
      : `Detén el tren en el cartel FIN DE MANIOBRA (${d > 0 ? d + " m por delante" : -d + " m pasado"})`, "warn");
  }
  if (!sim.doorsClosed) return hud.showMessage("Cierra las puertas antes de cambiar de cabina", "warn");

  const other = oppositeRoute(player.route);
  hud.fadeOut("Cambiando de cabina · cruzando a la vía contraria…");
  setTimeout(() => {
    if (!game) return;
    const trip = game.traffic.nextTripFor(other, game.clock, 120, 1200) || makeTrip(other, Math.ceil((game.clock + 300) / 60) * 60);
    game.traffic.turnback(player, trip);
    game.rig.setTrain(player.group);
    player.group.add(game.trainLights);
    game.lightsUnit = player;
    game.stats = { arrivals: [], stops: [], redSignals: 0, overspeeds: 0, emergencies: 0 };
    game.score = newScore(other);
    game.lastStop = null;
    game.dmiTimer = 0;
    hud.fadeIn();
    hud.showMessage(`Servicio ${trip.id} · ${other.label} · entra al andén de ${other.first.name} y sale a las ${formatClock(trip.departure)}`, "ok", 8000);
  }, 2600);
}

function onWalkerEvent(type, data) {
  const ride = game.ride;
  switch (type) {
    case "service":
      openService(data);
      break;
    case "boarded":
      if (!ride.origin) { ride.origin = data.unit.sim.dockedStation()?.world || null; ride.boardedClock = game.clock; }
      hud.showMessage(`Has subido al tren ${data.unit.id} · ${data.unit.route.label}`, "ok", 3500);
      break;
    case "alighted":
      if (data.station) hud.showMessage(`Has bajado en ${data.station.name}`, "ok", 3500);
      break;
    case "exit":
      goToStreet(data.station);
      break;
    case "street":
      onStreetTarget(data);
      break;
  }
}


/** Cobro del pasaje al entrar por un torniquete. */
function validateFare() {
  const band = fareBandAt(game.clock);
  const gate = game.world.nearestGate(game.walker.pos);
  const r = card.pay(band.price);
  hud.setCard(card);
  if (r.ok) {
    game.audio.bip();
    if (gate) game.world.flashValidator(gate, true);
    game.ride.fare = band;
    hud.showMessage(`bip! · ${band.label} ${formatCLP(band.price)} · saldo ${formatCLP(card.balance)}`, "ok", 2500);
    return { ok: true };
  }
  game.audio.deny();
  if (gate) game.world.flashValidator(gate, false);
  hud.showMessage(r.reason === "nocard"
    ? "No tienes tarjeta bip!: cómprala en la boletería (a la izquierda) con tu tarjeta de débito"
    : `Saldo bip! insuficiente (${formatCLP(card.balance)}) · pasaje ${formatCLP(band.price)} · carga en la boletería o en un tótem${bank.balance < 1000 ? " · tu cuenta está baja: haz un turno de Conductor" : ""}`, "alert", 5000);
  return { ok: false };
}

/** Abre la boletería o el tótem de autoservicio. */
function openService({ kind, station }) {
  const walker = game.walker;
  walker.frozen = true;
  walker.keys.clear();
  const booth = kind === "boleteria";
  const delay = (a, b) => wait(a + Math.random() * (b - a));
  const noFunds = (price) => new Error(`Fondos insuficientes en tu cuenta (${bank.label}) para pagar ${formatCLP(price)}. Gana dinero en el modo Conductor: cada estación bien servida te paga.`);
  hud.openTicketPanel({
    kind, station, card, bank, clock: game.clock,
    onLoad: async (amount, method, progress) => {
      if (!card.hasCard) throw new Error(booth ? "No tienes tarjeta: compra una primero" : "Este tótem no vende tarjetas: ve a la boletería");
      if (card.balance + amount > FARES.maxBalance) throw new Error(`El saldo máximo de la tarjeta es ${formatCLP(FARES.maxBalance)}`);
      if (!bank.canPay(amount)) throw noFunds(amount);
      if (booth) {
        progress("El cajero te acerca el lector de tarjetas…");
        await delay(1200, 2000);
        progress("Procesando pago… aprobado");
        await delay(900, 1400);
      } else {
        progress("Acerca tu tarjeta de débito o crédito al lector…");
        await delay(1200, 1600);
        progress("Procesando pago, no retires la tarjeta…");
        await delay(1300, 2000);
        if (Math.random() < 0.06) throw new Error("Transacción rechazada por el banco. Intenta de nuevo.");
      }
      progress("Acerca tu tarjeta bip! al lector…");
      await delay(700, 1000);
      const loaded = card.load(amount);
      bank.charge(loaded, `Carga bip! · ${station.name}`);
      game?.audio.loadOk();
      hud.setCard(card);
      hud.moneyFloat(-loaded);
      return `Carga realizada: ${formatCLP(loaded)} · nuevo saldo bip! ${formatCLP(card.balance)} · cuenta ${bank.label}`;
    },
    onBuyCard: async (progress) => {
      if (!bank.canPay(FARES.cardPrice)) throw noFunds(FARES.cardPrice);
      progress("El cajero prepara una tarjeta bip! nueva…");
      await delay(1500, 2200);
      card.buyNew();
      bank.charge(FARES.cardPrice, `Tarjeta bip! nueva · ${station.name}`);
      game?.audio.loadOk();
      hud.setCard(card);
      hud.moneyFloat(-FARES.cardPrice);
      return `Tarjeta bip! nueva ${card.maskedNumber} · pagaste ${formatCLP(FARES.cardPrice)} con débito · saldo bip! $0: recuerda cargarla`;
    },
    onClose: () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } },
  });
}

/* ==========================================================================
   Calle, locales, fotos y misiones (modo Pasajero)
   ========================================================================== */

/** Contexto para las misiones: dónde está el jugador, la hora y su bip!. */
function missionCtx() {
  const w = game.walker;
  const station = w.space === "world" ? (w.stationAt(w.pos.z) || w.station) : w.station;
  return { station, clock: game.clock, card };
}

/** Muestra los avisos de las misiones uno tras otro y paga las recompensas. */
function report(list) {
  if (!list?.length) return;
  list.forEach((m, i) => setTimeout(() => game && hud.showMessage(m.text, m.level, 5000), i * 4300));
  for (const m of list) {
    if (m.completed) {
      bank.deposit(m.completed.reward, `Misión cumplida: ${m.completed.title}`);
      hud.setBank(bank);
      hud.moneyFloat(m.completed.reward);
      game.audio.loadOk();
    }
    if (m.failed) game.audio.deny();
  }
  hud.updateTracker(game.missions);
}

/**
 * Sale a la calle de una estación (desde la mezanina, o al empezar la partida).
 * Al llegar avisa a las misiones ("llegaste a X").
 */
function goToStreet(st, { initial = false } = {}) {
  if (game.transition) return;
  const walker = game.walker;
  const finish = () => {
    if (!game) return;
    game.city.load(st, game.clock);
    walker.enterStreet(st);
    game.city.enter();
    walker.frozen = false;
    walker.keys.clear();
    if (!initial) {
      const ride = game.ride;
      if (ride.origin && ride.origin !== st) {
        const mins = Math.max(1, Math.round((game.clock - ride.boardedClock) / 60));
        hud.showMessage(`Llegaste a ${st.name} desde ${ride.origin.name} · ${Math.abs(st.index - ride.origin.index)} estaciones · ${mins} min${ride.fare ? ` · pasaje ${formatCLP(ride.fare.price)}` : ""}`, "ok", 4200);
      } else {
        const lm = game.city.landmark;
        hud.showMessage(`Sales a la calle en ${st.name}${lm ? ` · enfrente: ${lm.name}` : ""}`, "info", 4200);
      }
      const msgs = game.missions.notify("street", { station: st, ride }, missionCtx());
      setTimeout(() => game && report(msgs), msgs.length ? 2500 : 0);
    }
    game.ride = { origin: null, boardedClock: null };
    hud.fadeIn();
    game.transition = false;
  };
  if (initial) return finish();
  game.transition = true;
  walker.frozen = true;
  hud.fadeOut(`Subiendo a la calle · ${st.name}`);
  setTimeout(finish, 700);
}

/** Baja de la calle a la mezanina de la estación. */
function goUnderground(st) {
  if (game.transition) return;
  const walker = game.walker;
  game.transition = true;
  walker.frozen = true;
  walker.keys.clear();
  hud.fadeOut(`Bajando a la estación ${st.name}`);
  setTimeout(() => {
    if (!game) return;
    game.city.leave();
    walker.enterStation(st);
    walker.frozen = false;
    hud.fadeIn();
    game.transition = false;
    hud.showMessage(card.hasCard
      ? `${st.name} · saldo bip! ${card.label} · boletería a la izquierda, tótems a la derecha`
      : `${st.name} · aún no tienes tarjeta bip!: cómprala en la boletería (izquierda)`, "info", 5000);
  }, 700);
}

/** Interacción en la calle (E): acceso al Metro, un local o el hito. */
function onStreetTarget(target) {
  const st = game.walker.station;
  if (target.kind === "access") return goUnderground(st);
  if (target.kind === "shop") return openShop(target.shop, st);
  if (target.kind === "landmark") return takePhoto(target.landmark, st);
}

/** Foto del hito de la estación. */
function takePhoto(lm, st) {
  game.audio.shutter();
  hud.photoFlash();
  hud.showMessage(`📷 ${lm.photo || lm.name}`, "ok", 4500);
  const msgs = game.missions.notify("photo", { station: st }, missionCtx());
  setTimeout(() => game && report(msgs), msgs.length ? 2200 : 0);
}

/** Local de la calle (o el cajero automático del banco). */
function openShop(shop, st) {
  const walker = game.walker;
  walker.frozen = true;
  walker.keys.clear();
  const onClose = () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } };

  if (shop.kind === "banco") {
    hud.openStore({
      icon: "🏧", kicker: `CAJERO AUTOMÁTICO · ${st.name}`, title: BANK_NAME, bank,
      rows: () => [
        ["Saldo disponible", bank.label],
        ["Ganado como conductor (total)", formatCLP(bank.earned)],
        ...bank.history.slice(0, 8).map(h => [`${h.date.slice(5)} · ${h.concept}`, `${h.amount > 0 ? "+" : "−"}${formatCLP(Math.abs(h.amount))}`]),
      ],
      status: bank.history.length ? "Últimos movimientos de tu cuenta." : "Aún no tienes movimientos. Gana dinero en el modo Conductor.",
      onBuy: async () => "",
      onClose,
    });
    return;
  }

  hud.openStore({
    icon: shop.icon, kicker: `${shop.label.toUpperCase()} · ${st.name}`, title: shop.name, bank,
    items: () => [...game.missions.actionsAt(st, shop.kind).map(a => ({ name: a.label, action: a.id })), ...shop.items],
    status: "Elige lo que quieras comprar: pagas con tu tarjeta de débito.",
    onBuy: async (item) => {
      if (item.action) {
        const msgs = game.missions.notify("action", { station: st, shop: shop.kind, action: item.action }, missionCtx());
        report(msgs);
        return item.action === "pickup" ? "Te entregan el paquete. ¡Llévalo con cuidado!" : "Entregaste el paquete. ¡Muchas gracias!";
      }
      if (!bank.canPay(item.price)) throw new Error(`Fondos insuficientes (${bank.label}) para ${formatCLP(item.price)}. Gana dinero en el modo Conductor: cada estación bien servida te paga.`);
      await wait(450);
      bank.charge(item.price, `${shop.name}: ${item.name}`);
      bank.addToBag(item.name);
      game?.audio.cash();
      hud.moneyFloat(-item.price);
      report(game.missions.notify("buy", { station: st, shop: shop.kind, item }, missionCtx()));
      return `Compraste ${item.name} por ${formatCLP(item.price)} · saldo ${bank.label}`;
    },
    onClose,
  });
}

/** Tablero de misiones (J). */
function openMissionBoard() {
  const walker = game.walker, ms = game.missions;
  walker.frozen = true;
  walker.keys.clear();
  ms.ensure(missionCtx());
  hud.openMissions({
    missions: ms,
    onAccept: (i) => {
      const m = ms.accept(i, missionCtx());
      if (m) hud.showMessage(`Misión aceptada: ${m.icon} ${m.title}`, "ok", 3500);
      // Si ya estás en la calle de la estación del primer paso, ese paso cuenta como cumplido
      if (walker.space === "street" && ms.step?.kind === "arrive" && !ms.step.fare && !ms.step.deadline) report(ms.notify("street", { station: walker.station, ride: {} }, missionCtx()));
      else report(ms.tick(missionCtx()));
      hud.updateTracker(ms);
    },
    onAbandon: () => { ms.abandon(missionCtx()); hud.updateTracker(ms); },
    onShuffle: () => ms.shuffle(missionCtx()),
    onClose: () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } },
  });
}


/* ==========================================================================
   Megafonía y sonidos de estado
   ========================================================================== */

/** ¿El jugador está en el andén donde se detiene este tren? */
function walkerOnPlatformOf(unit) {
  const w = game.walker;
  if (!w || w.unit) return false;
  const rs = unit.sim.dockedStation();
  return !!rs && w.platformSide() === unit.route.side && w.stationAt(w.pos.z) === rs.world;
}

/**
 * Megafonía del tren en el que va el jugador (conductor o pasajero), con las
 * frases reales del Metro de Santiago (announcements.js).
 */
function updateOnboardAnnouncements(unit) {
  if (!unit) return;
  const sim = unit.sim, next = sim.nextStation();
  unit.announced ??= { next: null, safety: 0 };
  if (!next || sim.movingBackwards) return;
  // Al salir de una estación: "Próxima estación, <nombre>[, combinación a línea N]"
  if (sim.speedKmh > 8 && sim.doorsClosed && unit.announced.next !== next.id) {
    unit.announced.next = next.id;
    unit.announced.safetyDone = false;
    game.audio.announce(PHRASES.nextStation(next));
  }
  const remaining = sim.position - next.stopZ;
  // Justo antes de llegar: "<nombre>[, combinación a línea N]"
  if (unit.announced.next === next.id && unit.announced.arriving !== next.id
      && remaining < 250 && remaining > 15 && sim.speedKmh > 10) {
    unit.announced.arriving = next.id;
    game.audio.announce(PHRASES.arriving(next));
  }
  // De vez en cuando, en plena marcha, el mensaje de seguridad
  if (!unit.announced.safetyDone && sim.speedKmh > 45 && remaining > 500 && next.index % 4 === 2) {
    unit.announced.safetyDone = true;
    game.audio.announce(PHRASES.safety());
  }
}

/** Cambios de estado del tren que se oye: puertas (con su locución) y aire del freno. */
function updateStateSounds(unit, level, rider) {
  if (!unit) return;
  const sim = unit.sim, audio = game.audio;
  if (unit.prevDoorState !== undefined && sim.doorState !== unit.prevDoorState && level > 0.3) {
    const hearsVoice = unit === rider || walkerOnPlatformOf(unit);
    if (sim.doorState === "opening") {
      audio.doorsOpening(CONFIG.train.doorTime);
      if (hearsVoice) {
        const terminal = sim.dockedStation() === unit.route.last;
        audio.announce(terminal ? PHRASES.terminal() : PHRASES.letOff(), { chime: terminal });
      }
    }
    if (sim.doorState === "closing") {
      if (hearsVoice) audio.announce(PHRASES.doorsClosing(), { chime: false });
      audio.doorsClosing(CONFIG.train.doorTime);
    }
  }
  unit.prevDoorState = sim.doorState;
  if (sim.isStopped && (unit.prevAccel ?? 0) < -0.3 && sim.accel >= -0.3 && level > 0.3) audio.airHiss(0.35);
  unit.prevAccel = sim.accel;
}


/* ==========================================================================
   Información para el conductor
   ========================================================================== */

function getRouteInfo(unit) {
  const sim = unit.sim;
  const docked = sim.isStopped ? sim.dockedStation() : null;
  const next = sim.nextStation();
  const near = sim.nearestStation();
  const nearError = sim.position - near.stopZ;
  let approach = null;
  if (next && sim.position - next.stopZ < 60) approach = { station: next, error: sim.position - next.stopZ };
  else if (Math.abs(nearError) < 15) approach = { station: near, error: nearError };

  const s = game.signals.get(unit.route.id).nextAhead(sim.position);
  const signal = s ? { id: s.id, aspect: s.aspect, distance: sim.position - s.z } : null;

  let schedule = null;
  const trip = unit.trip, clock = game.clock;
  if (docked && docked !== unit.route.last) {
    const dep = trip.dep[docked.index];
    const wait = dep - clock;
    schedule = wait > 0
      ? { label: `Salida ${formatClock(dep)}`, delayText: `espera ${formatDelay(wait).replace("+", "")}`, cls: "early", color: "#ffd166" }
      : { label: `Salida ${formatClock(dep)}`, delayText: formatDelay(-wait), ...delayStyle(-wait) };
  } else if (next) {
    // Llegada prevista desde la posición y velocidad reales del tren (motor · eta.js)
    const arr = trip.arr[next.index];
    const est = (game.engine.eta(unit, next.world) ?? clock) - arr;
    schedule = { label: `Llegada ${next.short} ${formatClock(arr)}`, delayText: formatDelay(est), ...delayStyle(est) };
  }

  return {
    docked, next,
    distance: next ? sim.position - next.stopZ : 0,
    approach,
    limit: sim.currentLimit(),
    signal, schedule,
  };
}

function delayStyle(d) {
  const w = CONFIG.schedule.punctualWindow;
  if (Math.abs(d) <= w) return { cls: "ontime", color: "#6fe39a" };
  return d > 0 ? { cls: "late", color: "#ff6b6b" } : { cls: "early", color: "#ffd166" };
}

function updateCabVisuals(dt, unit, info) {
  const { sim, model } = unit;
  const target = (sim.notch - NOTCH_INDEX.N) * -0.11;
  model.lever.rotation.x += (target - model.lever.rotation.x) * Math.min(1, dt * 12);
  const keyTarget = -sim.reverser * 0.6;
  model.reverserKey.rotation.y += (keyTarget - model.reverserKey.rotation.y) * Math.min(1, dt * 12);

  const blink = Math.floor(game.elapsed * 3) % 2 === 0;
  const setLamp = (lamp, on) => lamp.material.color.copy(on ? lamp.on : lamp.off);
  const doorsActive = sim.doorState !== "closed";
  setLamp(model.lamps.doorsClosed, sim.doorsClosed);
  setLamp(model.lamps.doorLeft, false);                                 // el andén de la vía 1 queda a la derecha
  setLamp(model.lamps.doorRight, doorsActive && (sim.doorState === "open" || blink));
  setLamp(model.lamps.traction, sim.accel > 0.05 && sim.reverser !== 0);
  setLamp(model.lamps.brake, sim.accel < -0.05);
  setLamp(model.lamps.emergency, sim.emergency && blink);

  game.dmiTimer -= dt;
  if (game.dmiTimer <= 0) { model.dmi.draw(sim, info); game.dmiTimer = 1 / 12; }
}

/** Tren "en foco": el del jugador, aquel en el que va el pasajero o el que se acerca a él. */
function focusUnit(cameraZ) {
  if (game.player) return game.player;
  const w = game.walker;
  if (w.unit) return w.unit;
  let best = null, bestScore = Infinity;
  for (const u of game.traffic.units) {
    const d = game.traffic.worldCenterZ(u) - cameraZ;
    const approaching = u.route.dir === 1 ? d > -20 : d < 20;   // la vía 1 avanza hacia −Z, la vía 2 hacia +Z
    const score = Math.abs(d) * (approaching ? 1 : 3);
    if (score < bestScore) { bestScore = score; best = u; }
  }
  return best;
}


/* ==========================================================================
   Bucle principal
   ========================================================================== */

const cameraWorld = new THREE.Vector3();
const deckAgents = [];

function loop(now) {
  if (!game) return;
  const realDt = Math.max(0, (now - game.last) / 1000);
  const dt = Math.min(realDt, 0.05);                 // paso de animación del fotograma
  game.last = now;
  if (hud.summaryOpen) { game.renderer.render(game.scene, game.camera); game.raf = requestAnimationFrame(loop); return; }
  game.elapsed += dt;
  const { engine, traffic, people, world, audio, walker, player } = game;

  // 1. Motor: trenes y señales avanzan con su propio reloj de paso fijo
  engine.update(realDt);
  if (!game) return;
  syncWithLocalTime();
  game.clock = engine.time;

  // 2. Cámara / jugador
  if (player) {
    game.trainViews.sync(traffic.units, player.group.position.z);
    game.rig.update(player.sim, game.elapsed);
  } else {
    walker.update(dt);
    game.trainViews.sync(traffic.units, walker.worldZ);
    walker.update(0);
  }
  game.camera.updateMatrixWorld(true);
  game.camera.getWorldPosition(cameraWorld);
  const cameraZ = cameraWorld.z;

  // 3. Mundo, señales, viajeros, torniquetes y pantallas
  world.update(cameraWorld, dt);
  game.signalViews.update(cameraZ);
  people.update(dt, game.clock, { cameraZ, hideUnit: player && game.rig.view === "cab" ? player : null });
  deckAgents.length = 0;
  people.deckAgents(deckAgents);
  if (walker && walker.space === "world") deckAgents.push(walker.pos);
  const opened = world.updateGates(dt, deckAgents, cameraZ);
  if (opened.some(g => Math.hypot(g.x - cameraWorld.x, g.z - cameraZ) < 10 && !(walker && Math.abs(g.x - walker.pos.x) < 0.5))) audio.bip();
  game.pidTimer -= dt;
  if (game.pidTimer <= 0) { game.pidTimer = 1; world.updatePids(cameraZ, game.clock, (st, side) => traffic.arrivalsFor(st, routeForSide(side), game.clock)); }

  // Calle de la estación: autos, peatones y cielo (en la calle no se oyen los trenes)
  const inStreet = !!walker && walker.space === "street";
  if (game.city) game.city.update(dt, inStreet ? walker.pos : null, game.clock);
  game.missionT = (game.missionT || 0) - dt;
  if (game.missions && game.missionT <= 0) {
    game.missionT = 1;
    report(game.missions.tick(missionCtx()));
    hud.updateTracker(game.missions);
  }

  // 4. Luces del tren en foco (la interior sigue al pasajero a lo largo del tren)
  const focus = inStreet ? null : focusUnit(cameraZ);
  if (focus && focus !== game.lightsUnit) { focus.group.add(game.trainLights); game.lightsUnit = focus; }
  if (walker && walker.unit) game.innerLight.position.z = walker.pos.z;
  game.lineMap.update(player || walker.unit || focus || null, game.elapsed);

  // 5. Sonido
  let level = 1, view = "cab", rider = null;
  if (player) { view = game.rig.view; rider = player; }
  else if (walker.unit) { view = "saloon"; rider = walker.unit; }
  else if (focus) {
    const d = Math.abs(traffic.worldCenterZ(focus) - cameraZ);
    level = Math.pow(clamp(1 - d / 230, 0, 1), 1.5);
    view = "exterior";
  }
  updateStateSounds(focus, level, rider);
  updateOnboardAnnouncements(rider);
  const fs = focus?.sim;
  audio.update({
    dt,
    velocity: fs ? fs.velocity : 0,
    speedKmh: fs ? fs.speedKmh : 0,
    accel: fs ? fs.accel : 0,
    braking: fs ? fs.isBraking : false,
    level: focus ? level : 0,
    inStation: !inStreet && STATIONS.some(s => Math.abs(cameraZ - s.z) < CONFIG.station.hallHalf),
    street: inStreet,
    view,
    overspeed: !!player && player.sim.speedKmh > player.sim.currentLimit() + 2,
    crowd: inStreet ? 0.25 : people.crowdLevel(cameraWorld) * (view === "cab" ? 0.5 : 1),
  });

  // 6. HUD
  if (player) {
    const info = getRouteInfo(player);
    updateCabVisuals(dt, player, info);
    if (player.sim.speed > 0.2) game.lastDecel = -player.sim.accel;
    game.score.update(dt, player.sim);
    hud.updateDriver(player.sim, info, { clock: game.clock, onboard: people.onboardCount(player), boardingBusy: engine.isBoarding(player) });
  } else {
    hud.updatePassenger(walkerHudData());
  }

  game.renderer.render(game.scene, game.camera);
  game.raf = requestAnimationFrame(loop);
}

/**
 * Mantiene el reloj del motor en la hora local: si se quedó atrás (pausa,
 * pestaña en segundo plano), simula rápido lo que falta (máx. 60 s por fotograma).
 */
function syncWithLocalTime() {
  const target = game.realClock.clock + (performance.now() - game.realClock.epoch) / 1000;
  const behind = target - game.engine.time;
  if (behind < 1) return;
  const cameraZ = game.player ? game.player.group.position.z : game.walker.worldZ;
  game.engine.runUntil(game.engine.time + Math.min(behind, 60), {
    onStep: (step, t) => game.people.update(step, t, { cameraZ, render: false }),
  });
}

/** Texto de próximo tren para un andén. */
function nextTrainText(st, side) {
  const route = routeForSide(side);
  if (route.stationOf(st) === route.last) return "andén de llegada";
  const a = game.traffic.arrivalsFor(st, route, game.clock);
  if (!a.length) return "sin trenes previstos";
  const first = a[0].here ? "en andén" : a[0].minutes < 1 ? "llegando" : `${a[0].minutes} min`;
  return `${first}${a[1] ? ` · siguiente ${a[1].minutes} min` : ""}`;
}

function walkerHudData() {
  const w = game.walker, clock = game.clock;
  const base = { clock, worldZ: w.worldZ, hint: w.hint() };
  if (w.space === "street") {
    const lm = game.city.landmark, band = fareBandAt(clock);
    return {
      ...base,
      title: `CALLE${lm ? " · " + lm.name.toUpperCase() : ""}`,
      station: w.station.name,
      sub: `Cuenta ${bank.label} · bip! ${card.label} · pasaje ahora ${formatCLP(band.price)} (${band.label.toLowerCase()})`,
      highlight: w.station,
    };
  }
  if (w.unit) {
    const sim = w.unit.sim;
    const docked = sim.isStopped ? sim.dockedStation() : null;
    const next = sim.nextStation();
    const people = game.people.onboardCount(w.unit);
    const car = clamp(Math.floor(w.pos.z / (CONFIG.train.carLength + CONFIG.train.carGap)) + 1, 1, CONFIG.train.cars);
    const title = `A BORDO · ${w.unit.id} · COCHE ${car} · ${w.unit.route.label.toUpperCase()}`;
    if (docked) {
      const doors = { open: "Puertas abiertas", opening: "Abriendo puertas", closing: "Cierre de puertas", closed: "Puertas cerradas" }[sim.doorState];
      return { ...base, title, station: docked.name, sub: `${doors} · ${people} viajeros`, highlight: docked };
    }
    return {
      ...base, title,
      station: next ? `→ ${next.name}` : "VÍA DE RETIRADA",
      sub: `${Math.round(sim.speedKmh)} km/h · ${next ? Math.max(0, Math.round(sim.position - next.stopZ)) + " m" : ""} · ${people} viajeros`,
      highlight: next,
    };
  }
  const st = w.stationAt(w.pos.z) || w.station;
  const combos = st.combos.length ? ` · COMBINACIÓN L${st.combos.join(", L")}` : "";
  const side = w.platformSide();
  if (side) {
    const route = routeForSide(side);
    return { ...base, title: `ANDÉN · ${route.label.toUpperCase()}${combos}`, station: st.name, sub: `Próximo tren: ${nextTrainText(st, side)} · ~${Math.round(game.engine.passengers.waitingAt(st, side))} personas esperando${transferText(st)}`, highlight: st };
  }
  return {
    ...base,
    title: `${w.pos.y > CONFIG.mezzanine.y - 0.3 ? "MEZANINA" : "ESCALERA"}${combos}`,
    station: st.name,
    sub: `${ROUTE_A.last.short}: ${nextTrainText(st, 1)} · ${ROUTE_B.last.short}: ${nextTrainText(st, -1)}${transferText(st)}`,
    highlight: st,
  };
}

/**
 * Combinación con otras líneas simuladas por el motor (por ejemplo la L6 en Ñuñoa):
 * próximos trenes de cada sentido, calculados igual que los de la L3.
 */
function transferText(st) {
  const parts = [];
  for (const ls of game.engine.lines.values()) {
    if (ls === game.engine.main) continue;
    const other = ls.line.stations.find(s => s.name === st.name);
    if (!other) continue;
    const dirs = ls.routes
      .filter(r => r.stationOf(other) !== r.last)
      .map(r => {
        const a = game.engine.arrivalsAt(other, r)[0];
        const when = !a ? "sin trenes" : a.here ? "en andén" : a.minutes < 1 ? "llegando" : `${a.minutes} min`;
        return `dir. ${r.last.short} ${when}`;
      });
    parts.push(` · Combinación L${ls.line.id}: ${dirs.join(" · ")}`);
  }
  return parts.join("");
}
