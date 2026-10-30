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
     render/carInfoPanel.js pantallas sobre las puertas (próxima estación, cierre de puertas, avisos)
     roles/driverRole.js    rol de Conductor: teclado → órdenes al motor
     roles/driverSafety.js  vigilancia (hombre muerto), ATP y PCC por radio, personal en la vía
     control/controlCenter.js  rol de Centro de Control: esquema de la red, alarmas, órdenes y tutorial
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
   tutorial.js  tutorial interactivo del jugador nuevo (conductor y pasajero)
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
import { CONFIG, STATIONS, LINE, NOTCH_INDEX, FARES, spokenName, fareBandAt, formatCLP, demandAt, dayTypeOf, inService, SERVICE_HOURS } from "./config.js";
import { ROUTES, ROUTE_A, ROUTE_B, routeForSide, oppositeRoute, setActiveLine } from "./engine/route.js";
import { LINES, lineById } from "./engine/network.js";
import { BipCard } from "./card.js";
import { PHRASES } from "./announcements.js";
import { playIntro } from "./intro.js";
import { setupPWA } from "./pwa.js";
import { setupCreator } from "./creator.js";
import { icon, textOn } from "./icons.js";
import { $, clamp, formatClock, formatStopError, gradeStop } from "./utils.js";
import { formatDelay, makeTrip } from "./engine/schedule.js";
import { MetroEngine } from "./engine/engine.js";
import { TrainViews } from "./render/trainViews.js";
import { SignalViews } from "./render/signalViews.js";
import { LineMapPanel } from "./render/lineMapPanel.js";
import { CarInfoPanel } from "./render/carInfoPanel.js";
import { carAt, carLoads, CAR_CAPACITY } from "./engine/passengers.js";
import { DriverRole } from "./roles/driverRole.js";
import { DriverSafety } from "./roles/driverSafety.js";
import { TRAIN_STATES } from "./engine/state.js";
import { ControlCenter } from "./control/controlCenter.js";
import { TouchControls, wantsTouch } from "./touch.js";
import { World } from "./world.js";
import { createTrainLights, resetTrainAssets, trainLineMapMaterial, trainInfoMaterials, trainGlassMaterial } from "./train.js";
import { PeopleSystem } from "./people.js";
import { Walker } from "./walker.js";
import { AudioSystem } from "./audio.js";
import { CameraRig } from "./camera.js";
import { Hud } from "./hud.js";
import { DriverScore } from "./scoring.js";
import { BankAccount, BANK_NAME, stationWage, shiftBonus } from "./economy.js";
import { MissionSystem, MASTERY_REWARD, GRAND_REWARD, lineMastered } from "./missions.js";
import { EncounterSystem } from "./encounters.js";
import { Civics } from "./civics.js";
import { celebrate } from "./celebration.js";
import { Inventory, souvenirId, SOUVENIR_PRICE, ALBUM_REWARD, LICENSES, FREE_LINE } from "./shop.js";
import { openShopUI } from "./shopUI.js";
import { trainLiveryMaterials } from "./train.js";
import { City } from "./city/city.js";
import { STREET, streetPlan } from "./city/plan.js";
import { Tutorial, tutorialDone } from "./tutorial.js";
import { installTrackLift, setTrackLiftLine, updateTrackLift, pitchCamera } from "./render/trackLift.js";
import { OutdoorView } from "./render/outdoor.js";
import { WEATHER, WEATHER_KINDS, setWeather, typicalWeather, kindFromWmo, weatherLabel } from "./engine/weather.js";
import { LINE_FLEETS, STOCKS, stockLabel } from "./engine/fleet.js";
import { tripStopsAt, nextStopIndex, EXPRESS_LABEL } from "./engine/express.js";
import { SECTION_LABEL } from "./engine/sections.js";

// La vía en 3D sigue las pendientes reales: se engancha antes de compilar ningún material
installTrackLift();

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
const civics = new Civics();              // civismo del pasajero (ayudar a otros viajeros, encounters.js)
hud.setBank(bank);
const directionSelect = $("startDirection");

// Introducción de bienvenida (solo al abrir la página)
playIntro({ isMuted: () => muted });
// App instalable: service worker (sin conexión) y botón "Instalar MetroSim"
setupPWA($("installButton"));
// Modo Creador (?creador): todo desbloqueado y gratis para el creador del juego
setupCreator($("creatorBadge"));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
/** Lo comprado en la Tienda Metro (licencias, libreas, contratos, depto, recuerdos). */
const inventory = new Inventory();

/* --- Pantalla principal: primero la línea (botones de color), después el modo --- */
const stationSelect = $("startStation");
const driverLineSelect = $("driverLine"), paxLineSelect = $("paxLine");
const savedLine = loadSetting("metrosim.line") || "3";
for (const sel of [driverLineSelect, paxLineSelect]) {
  LINES.forEach(l => sel.append(new Option(`${l.name} · ${l.stations[0].short} ⇄ ${l.stations.at(-1).short}`, l.id)));
  sel.value = lineById(savedLine) ? savedLine : "3";
}
const lineChips = LINES.map(l => {
  const chip = document.createElement("button");
  chip.className = "line-chip";
  chip.setAttribute("role", "radio");
  chip.style.setProperty("--c", l.color);
  chip.style.setProperty("--on-c", textOn(l.color));
  chip.dataset.line = l.id;
  chip.addEventListener("click", () => selectLine(l.id));
  $("lineChips").append(chip);
  return chip;
});
selectLine(driverLineSelect.value);
directionSelect.addEventListener("change", renderDirections);

/** Elige la línea para los dos modos: botones, ficha de la línea, servicios, estaciones y color de acento. */
function selectLine(id) {
  const line = lineById(id);
  driverLineSelect.value = paxLineSelect.value = line.id;
  saveSetting("metrosim.line", line.id);
  startScreen.style.setProperty("--line", line.color);
  startScreen.style.setProperty("--on-line", textOn(line.color));
  lineChips.forEach(c => c.setAttribute("aria-checked", String(c.dataset.line === line.id)));
  fillDirections(line);
  fillStations(line);
  renderLineCard(line);
  refreshDriverLines();
}

/** Ficha de la línea elegida: recorrido, esquema con sus estaciones y datos. */
function renderLineCard(line) {
  const st = line.stations, first = st[0], last = st.at(-1);
  $("lineCardRoute").textContent = `${first.name} ⇄ ${last.name}`;
  $("lineCardFirst").textContent = first.short;
  $("lineCardLast").textContent = last.short;
  $("lineCardStations").textContent = st.length;
  $("lineCardLength").textContent = `${last.km.toFixed(1).replace(".", ",")} km`;
  $("lineCardCombos").textContent = st.filter(s => s.combos.length).length;
  $("lineCardText").textContent = [line.description, lineRealismText(line)].filter(Boolean).join(" ");
  const map = $("lineCardMap");
  map.querySelectorAll("i").forEach(d => d.remove());
  for (const s of st) {
    const dot = document.createElement("i");
    if (s.combos.length) dot.className = "combo";
    dot.style.left = `${(s.km / last.km) * 100}%`;
    dot.title = s.name + (s.combos.length ? ` · combinación L${s.combos.join(", L")}` : "");
    map.append(dot);
  }
}

/** Licencias: las líneas sin licencia muestran un candado y el conductor ve el precio. */
function refreshDriverLines() {
  for (const opt of driverLineSelect.options) {
    const l = lineById(opt.value), lic = LICENSES.find(x => x.lineId === l.id);
    const base = `${l.name} · ${l.stations[0].short} ⇄ ${l.stations.at(-1).short}`;
    opt.textContent = inventory.canDrive(l.id) ? base : `🔒 ${base} · licencia ${formatCLP(lic.price)}`;
  }
  for (const chip of lineChips) {
    const l = lineById(chip.dataset.line), locked = !inventory.canDrive(l.id);
    chip.innerHTML = l.id + (locked ? icon("lock", "chip-lock") : "");
    chip.title = `${l.name} · ${l.stations[0].name} ⇄ ${l.stations.at(-1).name}` + (locked ? " · conducir requiere licencia" : "");
    chip.setAttribute("aria-label", chip.title);
  }
  const id = driverLineSelect.value, lic = LICENSES.find(x => x.lineId === id), lock = $("driverLock");
  lock.hidden = inventory.canDrive(id);
  if (lic) lock.innerHTML = `${icon("lock")} Para conducir esta línea necesitas su licencia (${formatCLP(lic.price)}). La Línea 3 es gratis.`;
  $("startBank").textContent = formatCLP(bank.balance);
}

/* Tarjetas de modo: la elegida muestra sus opciones; su botón empieza la partida */
const modeCards = [...document.querySelectorAll(".mode-card")];
function selectMode(mode) {
  modeCards.forEach(c => c.classList.toggle("selected", c.dataset.card === mode));
  saveSetting("metrosim.mode", mode);
}
modeCards.forEach(card => card.addEventListener("click", (ev) => {
  if (!ev.target.closest("button, select")) selectMode(card.dataset.card);
}));
selectMode(modeCards.some(c => c.dataset.card === loadSetting("metrosim.mode")) ? loadSetting("metrosim.mode") : "driver");

/** Tienda Metro: desde la pantalla de inicio o con K durante el juego. */
function openStore(opts = {}) {
  const walker = game?.walker;
  if (walker) { walker.frozen = true; walker.keys.clear(); }
  openShopUI({
    inventory, bank, ...opts,
    onBought: (item) => {
      refreshDriverLines();      // candados de las líneas y saldo de la portada
      if (game) { game.audio.cash(); hud.setBank(bank); hud.moneyFloat(-item.price); }
    },
    onClose: () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } },
  });
}

/** Pinta tu tren con la librea elegida en la tienda (solo el tuyo; los demás siguen igual). */
function applyLivery(unit) {
  const lv = inventory.currentLivery, shared = trainLiveryMaterials();
  if (!shared || (lv.body == null && lv.stripe == null)) return;
  const body = shared.body.clone(), stripe = shared.stripe.clone();
  if (lv.body != null) body.color.setHex(lv.body);
  if (lv.metal != null) body.metalness = lv.metal;
  if (lv.stripe != null) stripe.color.setHex(lv.stripe);
  unit.group.traverse(o => {
    if (o.material === shared.body) o.material = body;
    else if (o.material === shared.stripe) o.material = stripe;
  });
}

/** Servicios del conductor: ida y vuelta de la línea elegida. */
function fillDirections(line) {
  const [A, B] = line.routes;
  directionSelect.replaceChildren(
    new Option(`Ida · ${A.first.short} → ${A.last.short}`, "A"),
    new Option(`Vuelta · ${B.first.short} → ${B.last.short}`, "B"),
  );
  renderDirections();
}

/** Selector segmentado de servicio (ida / vuelta) que maneja el <select> oculto. */
function renderDirections() {
  $("directionSeg").replaceChildren(...[...directionSelect.options].map(opt => {
    const btn = document.createElement("button");
    const [kind, route] = opt.textContent.split(" · ");
    btn.innerHTML = `<b></b><span></span>`;
    btn.firstChild.textContent = kind;
    btn.lastChild.textContent = route;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(opt.value === directionSelect.value));
    btn.addEventListener("click", () => { directionSelect.value = opt.value; renderDirections(); });
    return btn;
  }));
}

/** Estaciones del modo pasajero de la línea elegida (por defecto, la de más combinaciones). */
function fillStations(line) {
  stationSelect.replaceChildren(...line.stations.map(st =>
    new Option(st.name + (st.combos.length ? `  (L${st.combos.join(", L")})` : ""), st.index)));
  const preferred = line.stations.find(s => s.name === "UNIVERSIDAD DE CHILE")
    || [...line.stations].sort((a, b) => b.combos.length - a.combos.length)[0];
  stationSelect.value = String(preferred.index);
}

/** Flota, tramos al aire libre y Ruta Expresa de una línea (ficha de la portada, 1.5). */
function lineRealismText(line) {
  const fleet = LINE_FLEETS[line.id] || [];
  const rubber = STOCKS[fleet[0]?.[0]]?.tyre === "rubber";
  const parts = [`Trenes ${fleet.map(([m]) => m).join(", ")} (${rubber ? "neumáticos" : "rueda de acero"}).`];
  const open = {};
  for (const sp of line.sectionsInfo?.spans || []) {
    if (sp.type === "tunel") continue;
    const a = Math.min(sp.zA, line.stations[0].z), b = Math.max(sp.zB, line.stations.at(-1).z);
    if (a > b) open[sp.type] = (open[sp.type] || 0) + (a - b);
  }
  const km = Object.entries(open).filter(([, m]) => m > 300).map(([t, m]) => `${SECTION_LABEL[t]} ${(m / 1000).toFixed(1).replace(".", ",")} km`);
  if (km.length) parts.push(`Al aire libre: ${km.join(" · ")}.`);
  if (line.express) parts.push("Ruta Expresa en punta (roja y verde).");
  return parts.join(" ");
}

/* --- Clima (1.5): el tiempo real de Santiago, o el que elijas --- */
const WEATHER_CHOICES = ["real", "despejado", "nublado", "lluvia", "temporal"];
let weatherChoice = loadSetting("metrosim.weather") || "real";
if (!WEATHER_CHOICES.includes(weatherChoice)) weatherChoice = "real";
let realWeather = null;                     // { kind, temp, source } del servicio meteorológico (o el típico del día)

function applyWeatherChoice() {
  if (weatherChoice === "real") {
    const w = realWeather || { ...typicalWeather(new Date()), source: "simulado" };
    setWeather(w.kind, { temp: w.temp, source: w.source });
  } else setWeather(weatherChoice, { temp: realWeather?.temp ?? typicalWeather(new Date()).temp, source: "elegido" });
  renderWeather();
}

function renderWeather() {
  const seg = $("weatherSeg");
  if (!seg) return;
  seg.replaceChildren(...WEATHER_CHOICES.map(id => {
    const btn = document.createElement("button");
    btn.innerHTML = `<b></b>`;
    btn.firstChild.textContent = id === "real" ? "Real" : WEATHER_KINDS[id].icon;
    btn.title = id === "real" ? "El tiempo de ahora en Santiago" : WEATHER_KINDS[id].label;
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(id === weatherChoice));
    btn.addEventListener("click", () => { weatherChoice = id; saveSetting("metrosim.weather", id); applyWeatherChoice(); });
    return btn;
  }));
  const src = { real: "tiempo real de Santiago", simulado: "sin conexión: tiempo típico de la temporada", elegido: "elegido por ti" }[WEATHER.source];
  $("weatherNow").textContent = `${weatherLabel()} · ${src}${WEATHER.rain > 0 ? " · riel mojado al aire libre y más viajeros" : ""}`;
}

/** Pide el tiempo actual de Santiago a Open-Meteo (servicio público, sin clave). Sin conexión, usa el típico del día. */
async function fetchRealWeather() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=-33.45&longitude=-70.66&current=temperature_2m,precipitation,weather_code&timezone=America%2FSantiago", { signal: ctrl.signal });
    clearTimeout(timer);
    const cur = (await res.json())?.current;
    if (cur && Number.isFinite(cur.weather_code)) realWeather = { kind: kindFromWmo(cur.weather_code, cur.precipitation || 0), temp: cur.temperature_2m ?? 15, source: "real" };
  } catch { /* sin conexión: queda el típico de la temporada */ }
  if (weatherChoice === "real" && !game) applyWeatherChoice();
}
applyWeatherChoice();
fetchRealWeather();

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
// "¿Primera vez? Con tutorial" de cada modo: juega ese modo con el tutorial interactivo desde el principio
document.querySelectorAll("[data-tutorial]").forEach(btn => btn.addEventListener("click", () => startGame(btn.dataset.tutorial, { tutorial: true })));
$("backButton").addEventListener("click", requestMenu);
$("confirmOk").addEventListener("click", () => closeConfirm(true));
$("confirmCancel").addEventListener("click", () => closeConfirm(false));
$("confirmPanel").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeConfirm(false); });
$("driverJobButton").addEventListener("click", goDriveForMoney);
$("endShiftButton").addEventListener("click", requestEndShift);
$("shopButton").addEventListener("click", () => openStore());
$("soundButton").addEventListener("click", toggleSound);
$("helpChip").addEventListener("click", () => hud.toggleHelp());
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", onResize);

// Pantallas táctiles: se ocultan las ayudas de teclado
if (wantsTouch()) document.body.classList.add("touch-mode");

// Acceso de depuración desde la consola: MetroSim.game.traffic, etc.
window.MetroSim = { get game() { return game; }, hud, bank, card, CONFIG, get STATIONS() { return STATIONS; }, get ROUTES() { return ROUTES; }, LINES };


/* ==========================================================================
   Inicio y fin de partida
   ========================================================================== */

function startGame(mode, opts = {}) {
  if (game) stopGame();
  if (mode === "control") return startControl(opts);
  if (mode === "driver" && !inventory.canDrive(driverLineSelect.value)) {
    const lic = LICENSES.find(x => x.lineId === driverLineSelect.value);
    return openStore({ tab: "driver", notice: `Para conducir la ${lic.name.replace("Licencia ", "")} necesitas su licencia (${formatCLP(lic.price)}). La Línea 3 es gratis: gana ahí tu primer sueldo.` });
  }
  useLine(lineById(mode === "driver" ? driverLineSelect.value : paxLineSelect.value));
  const stationIndex = Number(stationSelect.value) || 0;
  const direction = directionSelect.value === "B" ? ROUTE_B : ROUTE_A;
  startScreen.classList.add("hidden");
  loadingScreen.classList.remove("hidden");
  if (wantsTouch()) enterMobileFullscreen();     // dentro del gesto del usuario
  const audio = new AudioSystem();          // dentro del gesto del usuario
  audio.muted = muted;
  audio.start();
  setTimeout(() => buildGame(mode, stationIndex, audio, direction, opts), 40);
}

function buildGame(mode, stationIndex, audio, direction = ROUTE_A, opts = {}) {
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
  CONFIG.schedule.playerDeparture = Math.ceil((startClock + 15) / 5) * 5;     // tu servicio sale en ~15–20 s

  /* --- Motor MetroSim (el "cerebro") y su dibujo --- */
  setTrackLiftLine();                                         // cotas de la línea activa (pendientes en 3D)
  const world = new World(scene);
  const outdoor = new OutdoorView(scene);                     // viaductos, trincheras, cielo y lluvia (1.5)
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
    mode, renderer, scene, camera, world, outdoor, engine, signals, timetables, traffic, trainViews, signalViews, audio, playerTrip,
    clock: warmStart, elapsed: 0, last: performance.now(), dmiTimer: 0, pidTimer: 0, raf: 0,
    warming: true,
    stats: { arrivals: [], stops: [], log: [], redSignals: 0, overspeeds: 0, emergencies: 0 },
    ride: { origin: null, boardedClock: null },
  };
  if (mode === "driver") traffic.started.add(playerTrip.id);

  /* --- Calentamiento: el motor simula 45 min de servicio para que la línea ya tenga trenes --- */
  const people = new PeopleSystem(scene, traffic, engine.passengers);    // muestra visible de los pasajeros del motor
  people.elevators = world.elevators;                                  // algunos viajeros usan el ascensor
  game.people = people;
  engine.runUntil(CONFIG.startTime, { onStep: (step, t) => people.update(step, t, { cameraZ: 1e9, render: false }) });
  game.clock = engine.time;
  game.realClock = { epoch: startEpoch, clock: startClock };           // ancla para seguir la hora local (recupera el tiempo de carga)
  game.warming = false;
  game.lineMap = new LineMapPanel(trainLineMapMaterial());              // plano de línea dinámico de los coches
  game.carInfo = new CarInfoPanel(trainInfoMaterials());                // pantallas sobre las puertas
  const glass = trainGlassMaterial();
  game.glass = glass && { mat: glass, color: glass.color.clone(), opacity: glass.opacity, metal: glass.metalness, k: 0 };

  /* --- Jugador --- */
  game.trainLights = createTrainLights({ cab: mode === "driver" });
  game.innerLight = game.trainLights.getObjectByName("innerLight");
  if (mode === "driver") {
    const player = traffic.createUnit(playerTrip, { isPlayer: true, start: direction.first });
    player.arrivedIdx = player.dockedIdx = 0;
    game.player = player;
    applyLivery(player);
    game.score = newScore(direction);
    game.driverRole = new DriverRole(engine, () => game?.player);
    game.safety = new DriverSafety({
      scene, audio, signals,
      notify: (text, level, ms) => hud.showMessage(text, level, ms),
      penalty: (kind) => game?.score.penalty(kind),
    });
    const rig = new CameraRig(camera, player.group);
    rig.setView("cab");
    rig.attach(renderer.domElement);
    game.rig = rig;
    player.group.add(game.trainLights);
    game.lightsUnit = player;
    setTimeout(() => game?.player === player && hud.showMessage(driverBriefing(player), "info", 9000), 1500);
  } else {
    const city = new City(scene);
    city.sound = (type, data) => game?.audio.cityEvent(type, data);     // autos, bocinas, pájaros...
    game.city = city;
    game.missions = new MissionSystem(ROUTE_A.line, STATIONS);
    const walker = new Walker({
      scene, camera, traffic, station: STATIONS[stationIndex], city, elevators: world.elevators,
      onEvent: (t, d) => onWalkerEvent(t, d),
      onValidate: () => validateFare(),
      benches: (st, side) => game.people.stations[st.index].benches[side],
      isCrowded: (x, y, z, fx, fz, unit) => game.people.blocks(x, y, z, fx, fz, unit),
    });
    walker.attach(renderer.domElement);
    game.walker = walker;
    // Encuentros con otros viajeros: ceder el asiento, turistas, objetos olvidados, vendedores, músicos…
    game.encounters = new EncounterSystem({
      people: game.people, walker, engine, line: ROUTE_A.line, civics, audio,
      say: (text, level, ms) => game && hud.showMessage(text, level, ms),
      reward: (amount, concept) => { if (!amount) return; bank.deposit(amount, concept); hud.setBank(bank); hud.moneyFloat(amount); },
      charge: (amount, concept, bagItem) => {
        const r = bank.charge(amount, concept);
        if (!r.ok) return `Fondos insuficientes en tu cuenta (${bank.label})`;
        if (bagItem) bank.addToBag(bagItem);
        hud.setBank(bank);
        hud.moneyFloat(-amount);
        return null;
      },
      dialog: (o) => {
        walker.frozen = true;
        walker.keys.clear();
        hud.openStore({ ...o, bank, onClose: () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } o.onClose?.(); } });
      },
    });
    scene.add(game.trainLights);
    // Luz de la luminaria del túnel más cercana: barre el coche al pasar (el pasajero la ve por las ventanas)
    game.passLight = new THREE.PointLight(0xffd7a3, 0, 9, 1.4);
    scene.add(game.passLight);
    if (opts.transferFrom) arriveByTransfer(STATIONS[stationIndex], opts.transferFrom);   // llega por el pasillo de combinación
    else goToStreet(STATIONS[stationIndex]);     // la partida empieza en la calle
    game.missions.ensure(missionCtx());
  }

  // Precompila los shaders para evitar tirones la primera vez que se ve cada cosa
  renderer.compile(scene, camera);

  hud.setMode(mode);
  $("endShiftButton").classList.toggle("hidden", mode !== "driver");
  // El conductor no tiene botón de Menú: sale con Finalizar turno (informe → Menú) o con "atrás"
  $("backButton").classList.toggle("hidden", mode === "driver");
  // La ayuda de controles se muestra al empezar y se oculta sola (H la vuelve a mostrar)
  $("controlsHelp").classList.remove("hidden");
  setTimeout(() => game && $("controlsHelp").classList.add("hidden"), 12000);

  // Controles táctiles (celular / tablet): cada botón equivale a su tecla
  if (wantsTouch()) {
    game.touch = new TouchControls({ mode, parent: gameScreen, canvas: renderer.domElement, press: pressKey, walker: game.walker, context: touchContext, onMenu: requestMenu });
  }
  loadingScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  onResize();

  hud.setCard(card);
  hud.setBank(bank);

  // Tutorial interactivo: la primera vez en cada modo, al pedirlo desde la portada o si sigue en curso tras una combinación
  if (opts.tutorial || opts.tutorialStep != null || !tutorialDone(mode)) {
    $("controlsHelp").classList.add("hidden");
    game.tutorial = new Tutorial({
      mode, parent: gameScreen, touch: wantsTouch(), step: opts.tutorialStep ?? 0,
      onStep: () => game?.audio.loadOk(),
      onFinish: () => { if (game) { game.tutorial = null; hud.showMessage("Tutorial completado · H muestra los controles · se repite desde la portada", "ok", 5000); } },
    });
  }

  if (opts.transferFrom) {
    $("controlsHelp").classList.add("hidden");
    hud.fadeIn();
    hud.showMessage(`Combinación desde la Línea ${opts.transferFrom} · ${STATIONS[stationIndex].name} · ${LINE.name.charAt(0) + LINE.name.slice(1).toLowerCase()} · sigues en zona pagada`, "ok", 6000);
  } else hud.showMessage(mode === "driver"
    ? `Servicio ${playerTrip.id} · ${direction.label} · salida ${formatClock(playerTrip.departure)} · cada estación bien servida te paga en tu cuenta`
    : `Calle de ${STATIONS[stationIndex].name} · cuenta ${bank.label} · ${game.touch ? "joystick para caminar · arrastra para mirar · 🎯 misiones" : "W/S caminar · A/D girar · Shift correr · J misiones"}`, "info", 7000);

  game.raf = requestAnimationFrame(loop);
  armBackTrap();
  keepScreenOn();
}

function stopGame({ keepFullscreen = false } = {}) {
  if (!game) return;
  game.touch?.destroy();
  game.tutorial?.destroy();
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
  confirmOpen = false;
  $("confirmPanel").classList.add("hidden");
  $("driverJobButton").classList.add("hidden");
  hud.hideSummary();
  gameScreen.classList.add("hidden");
  loadingScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
  refreshDriverLines();                 // saldo y licencias al volver a la portada
  if (!keepFullscreen) {                       // en una combinación se sigue jugando: no se suelta nada
    exitMobileFullscreen();
    disarmBackTrap();
    releaseScreen();
  }
}

/* Celular: pantalla completa y horizontal mientras se juega (si el navegador lo permite;
   en iPhone no existe y el juego sigue igual, con el aviso de girar el teléfono). */
let ownFullscreen = false;
function enterMobileFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  if (matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches) return;   // ya es app instalada
  el.requestFullscreen({ navigationUI: "hide" })
    .then(() => { ownFullscreen = true; return screen.orientation?.lock?.("landscape"); })
    .catch(() => { /* no permitido: se juega igual */ });
}
function exitMobileFullscreen() {
  try { screen.orientation?.unlock?.(); } catch { /* sin bloqueo */ }
  if (ownFullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  ownFullscreen = false;
}

/* "Atrás" no saca del juego: mientras se juega hay una entrada extra en el historial.
   El gesto o botón atrás la consume y vuelve al menú de MetroSim (o cierra la ventana abierta). */
let backTrap = false, ignorePops = 0;
function armBackTrap() {
  if (backTrap) return;
  history.pushState({ metrosim: "play" }, "");
  backTrap = true;
}
function disarmBackTrap() {
  if (!backTrap) return;
  backTrap = false;
  ignorePops++;
  history.back();                       // quita la entrada extra (su popstate se ignora)
}
window.addEventListener("popstate", () => {
  if (ignorePops > 0) { ignorePops--; return; }
  if (!backTrap) return;
  backTrap = false;                     // el navegador ya la quitó
  // Primero cierra la ventana que esté abierta (tienda, boletería, local, misiones) y se sigue jugando
  const shopClose = document.querySelector(".shop-overlay .shop-close");
  if (shopClose) shopClose.click();
  else if (confirmOpen) closeConfirm(false);
  else if (game && hud.ticketOpen) hud.closeTicket();
  else if (game && hud.storeOpen) hud.closeStore();
  else if (game && hud.missionsOpen) hud.closeMissions();
  else if (game?.walker) requestMenu();          // pasajero: pide confirmación, igual que el botón Menú
  else if (game) return stopGame();
  else if (control) {                            // cierra su ventana o muestra el informe del turno antes de salir
    control.ui.requestExit();
    if (!control) return;                         // salió directo al menú (turno corto)
  } else return;
  armBackTrap();
});

/* Aviso antes de cerrar o recargar la página en medio de una partida */
window.addEventListener("beforeunload", (ev) => {
  if (!(game && !game.warming) && !control) return;
  ev.preventDefault();
  ev.returnValue = "";                  // los navegadores muestran su propio "¿Salir del sitio?"
});

/* Pantalla siempre encendida mientras se juega (Wake Lock; si el navegador no lo tiene, nada cambia) */
let wakeLock = null, wantAwake = false;
async function keepScreenOn() {
  wantAwake = true;
  if (wakeLock || !navigator.wakeLock || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch { /* sin permiso (batería baja, etc.): se juega igual */ }
}
function releaseScreen() {
  wantAwake = false;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
// El navegador suelta el bloqueo al cambiar de app; se pide de nuevo al volver
document.addEventListener("visibilitychange", () => {
  if (wantAwake && document.visibilityState === "visible") keepScreenOn();
});

/* ==========================================================================
   Centro de Control: solo el motor y un esquema 2D (sin mundo 3D)
   ========================================================================== */

let control = null;
/** Paso de simulación del Centro de Control (s): sin dibujo 3D basta uno más largo, y deja acelerar el tiempo. */
const CONTROL_STEP = 0.1;

function startControl(opts = {}) {
  startScreen.classList.add("hidden");
  loadingScreen.classList.remove("hidden");
  setTimeout(() => {
    // Hora local, igual que en los otros modos
    const startClock = localClock();
    CONFIG.startTime = startClock;
    CONFIG.schedule.playerDeparture = Math.ceil((startClock + 90) / 30) * 30;
    const engine = new MetroEngine({ startTime: startClock - 45 * 60 });
    engine.runUntil(startClock);                     // la red ya tiene trenes al empezar el turno
    const ui = new ControlCenter({
      engine, onExit: stopControl, tutorial: !!opts.tutorial, touch: wantsTouch(),
      onPay: (amount, concept) => bank.deposit(amount, concept, { wage: true }),
    });
    control = { engine, ui, last: performance.now(), acc: 0, uiT: 0, raf: 0 };
    window.MetroSim.control = control;
    loadingScreen.classList.add("hidden");
    control.raf = requestAnimationFrame(controlLoop);
    armBackTrap();
    keepScreenOn();
  }, 40);
}

function controlLoop(now) {
  if (!control) return;
  const c = control;
  const realDt = Math.min(0.25, Math.max(0, (now - c.last) / 1000));   // tras una pausa larga (pestaña oculta) no da saltos
  c.last = now;
  // Pausa y velocidad del tiempo (×1, ×2, ×5, ×10) las decide el jugador
  let simDt = 0;
  if (!c.ui.paused) {
    c.acc += realDt * c.ui.speed;
    const n = Math.floor(c.acc / CONTROL_STEP);
    if (n > 0) {
      c.acc -= n * CONTROL_STEP;
      simDt = n * CONTROL_STEP;
      c.engine.runUntil(c.engine.time + simDt, { step: CONTROL_STEP });
    }
  }
  c.ui.tick(realDt, simDt);
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
  refreshDriverLines();                 // saldo y licencias al volver a la portada
  disarmBackTrap();
  releaseScreen();
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
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "pageup", "pagedown"].includes(key)) event.preventDefault();
  if (hud.summaryOpen) return;
  if (confirmOpen) { if (key === "escape") closeConfirm(false); else if (key === "enter") closeConfirm(true); return; }
  if (hud.ticketOpen) { if (key === "escape" || key === "e") hud.closeTicket(); return; }
  if (hud.storeOpen) { if (key === "escape" || key === "e") hud.closeStore(); return; }
  if (hud.missionsOpen) { if (key === "escape" || key === "j") hud.closeMissions(); return; }
  if (game.tutorial?.onKey(key)) return;                 // Enter: siguiente paso del tutorial

  if (key === "m") return toggleSound();
  if (key === "k" && !game.transition) return openStore({ tab: game.walker ? "album" : "driver" });
  if (key === "h") return hud.toggleHelp();

  if (game.walker) {
    if (game.transition) return;
    if (key === "j") return openMissionBoard();
    if (key === "e" && game.encounters?.interact()) return;   // un encuentro cerca (turista, objeto, vendedor…)
    const result = game.walker.keyDown(key);
    if (result) hud.showMessage(result.text, result.level);
    return;
  }

  if (key === "c") return game.rig.recenter();
  if (key === "v") {
    // Ciclo de vistas del conductor: cabina → interior del tren (salón) → exterior
    const next = { cab: "saloon", saloon: "exterior", exterior: "cab" }[game.rig.view] || "cab";
    game.rig.setView(next);
    const label = { cab: "Vista de cabina", saloon: "Vista interior del tren", exterior: "Vista exterior · arrastra para girar · Shift+arrastrar desplaza · rueda zoom · C encuadre inicial" }[next];
    return hud.showMessage(label, "info", next === "exterior" ? 4500 : 1200);
  }
  // Mando del tren: el rol de Conductor envía órdenes al motor (la respuesta llega en onCommandResult).
  // Cualquier mando confirma la vigilancia (hombre muerto)
  if (game.driverRole.handleKey(key, event.repeat)) { game.safety.input(); return; }
  if (event.repeat) return;
  if (key === "x") return game.safety.input();
  if (key === "b") return game.safety.horn(game.player);
  if (key === "r") return restartGame();
  if (key === "t") return changeCab();
  if (key === "f") return requestEndShift();
}

/** Respuesta del motor a una orden (del conductor o desde la consola / Centro de Control). */
function onCommandResult(r) {
  if (!game || game.warming || !r.result?.text) return;
  if (r.payload?.source === "pasajero") return;          // el citófono del pasajero ya avisa con su propio texto
  if (game.driverRole?.owns(r) || r.type.startsWith("control.")) hud.showMessage(r.result.text, r.result.level);
}

/**
 * Hora local del computador en segundos desde medianoche. Fija también el
 * tipo de día de hoy (laboral, sábado o domingo/festivo): de él dependen el
 * horario comercial, la demanda y los intervalos.
 */
function localClock() {
  const d = new Date();
  CONFIG.dayType = dayTypeOf(d);
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
      // Ruta Expresa: el andén avisa de qué ruta es el tren que llega
      else if (unit.trip.express && !data.closed && walkerOnPlatformOf(unit, data.station)) {
        const ex = unit.trip.express;
        hud.showMessage(`Tren ${EXPRESS_LABEL[ex].name}: se detiene solo en estaciones ${ex === "roja" ? "rojas" : "verdes"} y comunes`, "info", 5000);
      }
      break;
    case "ato:doorsClosing":
      if (riding && data.station === unit.route.last) {
        walker.exitTrain(true);
        hud.showMessage(`Fin de trayecto en ${data.station.name} · todos los viajeros han bajado`, "info", 5000);
      } else if (riding && unit.ato?.evacuating) {
        walker.exitTrain(true);
        hud.showMessage(`El tren se retira del servicio: bajaste en ${data.station.name} · espera el próximo tren en este andén`, "warn", 6000);
      } else if (riding || (walker.platformSide() === unit.route.side && walker.stationAt(walker.pos.z) === data.station.world)) {
        hud.showMessage("Atención: cierre de puertas", "warn");
      }
      break;
    case "ato:departing":
      if (riding && data.next) hud.showMessage(`Próxima estación: ${data.next.name}${unit.trip.express ? ` · ${EXPRESS_LABEL[unit.trip.express].name}` : ""}`, "info", 3500);
      break;
    case "ato:evacuate":
      // El tren se retira del servicio: se avisa a bordo y en el andén
      if (riding || walkerOnPlatformOf(unit, data.station)) {
        game.audio.announce(PHRASES.outOfService());
        hud.showMessage(riding ? `Este tren se retira del servicio en ${data.station.name}: todos deben descender · espera el próximo tren`
          : "El tren que llega se retira del servicio: no subas, espera el próximo", "warn", 7000);
      }
      break;
    case "ato:lineResume":
      if (riding) { game.audio.announce(PHRASES.resume(), { chime: false }); hud.showMessage("Reanudamos la marcha", "ok", 2500); }
      break;
  }
}

/** Incidentes aleatorios (engine/incidents.js): avisos al conductor o al viajero afectado. */
function onIncident(inc) {
  if (!game || game.warming || inc.line !== ROUTE_A.line) return;
  const level = inc.phase === "end" ? "ok" : "warn";
  if (game.player) {
    game.safety.onIncident(inc);                       // personal en la vía (se ve desde ambas vías)
    if (inc.kind === "doorObstruction") {
      if (inc.unit === game.player) { game.audio.airHiss(0.4); hud.showMessage(inc.text, "warn", 5000); }
      return;
    }
    if (inc.route !== game.player.route) return;
    // El PCC avisa por radio a los trenes de la vía
    if (inc.phase === "start") game.audio.radio(`Atención trenes de la vía. ${inc.text.replace(/km\/h/g, "kilómetros por hora").replace(/ · /g, ". ")}.`);
    hud.showMessage(`📻 PCC: ${inc.text}`, level, 7000);
    return;
  }
  const riding = game.walker?.unit;
  if (!riding) return;
  if (inc.kind === "lineStop" || inc.kind === "outOfService") {
    if (inc.unit === riding && inc.phase === "start") {
      hud.showMessage(inc.kind === "lineStop"
        ? `Tren detenido entre estaciones (${inc.reason}) · reanudará la marcha en breve`
        : `Aviso: este tren se retirará del servicio en ${inc.station.name}`, "warn", 6000);
    }
    return;
  }
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
  game.safety?.onPlayerEvent(type, data);
  switch (type) {
    case "atpTrip":
      hud.showMessage(`ATP · exceso de velocidad (${Math.round(data.kmh)} km/h, límite ${data.limit}) · frenado de emergencia · detente y espera al PCC`, "alert", 6000);
      break;
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
      if (!tripStopsAt(game.player.trip, data.station.index)) {
        // Ruta Expresa: esta estación no le toca a tu servicio (no paga; abrir puertas es falta)
        hud.showMessage(`Tu servicio es ${EXPRESS_LABEL[game.player.trip.express].name}: no se detiene en ${data.station.name} · sigue a la próxima parada`, "warn", 5000);
        break;
      }
      const stop = game.lastStop?.station === data.station ? game.lastStop.error : 0;
      stats.stops.push(Math.abs(stop));
      stats.arrivals.push(data.delay);
      const p = punctuality(data.delay);
      const sc = game.score.arrival(stop, data.delay);
      const streak = sc.streak >= 2 ? ` · ¡RACHA ${sc.streak}!` : "";
      // Sueldo de la estación: se deposita al instante (las faltas del tramo se descuentan)
      const wage = stationWage({ gained: sc.gained, perfect: sc.perfect, deductions: game.wageDeductions, mult: inventory.wageMultiplier });
      game.wageDeductions = 0;
      game.shiftPay += wage.pay;
      // Detalle por estación para el informe de turno
      stats.log.push({ name: data.station.name, delay: data.delay, stop: Math.abs(stop), perfect: sc.perfect, points: sc.gained, pay: wage.pay });
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
      game.boardingDone = false;
      if (data.station && !tripStopsAt(game.player.trip, data.station.index)) {
        game.score.penalty("wrongStop");
        hud.showMessage(`FALTA · abriste puertas en ${data.station.name}, que tu ${EXPRESS_LABEL[game.player.trip.express].name} no sirve`, "alert", 5000);
      }
      if (data.station === game.player.route.last && !game.shiftEnded) setTimeout(() => game && !game.shiftEnded && showDriverSummary(), 2500);
      break;
    case "doorsClosed":
      // Embarque terminado y puertas cerradas: no hace falta esperar la hora; el horario se adelanta
      if (game.boardingDone && data.station && data.station !== game.player.route.last) advanceSchedule(game.player, data.station);
      game.boardingDone = false;
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
      hud.showMessage(`REBASE DE SEÑAL S${data.signal.id} EN ROJO · frenado de emergencia automático · detente y espera al PCC`, "alert", 6000);
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

/**
 * Salida sin esperas: si el conductor cierra las puertas con el embarque ya terminado,
 * su horario se adelanta desde esta estación (la señal de salida se abre y los
 * tiempos siguientes se corren igual, así la puntualidad se mide contra el horario nuevo).
 */
function advanceSchedule(unit, station) {
  const trip = unit.trip, i = station.index;
  const ready = game.clock + 6;                        // lo que tarda en abrirse la señal y arrancar
  const shift = trip.dep[i] - ready;
  if (shift < 3) return;
  trip.dep[i] -= shift;
  for (let j = i + 1; j < trip.arr.length; j++) { trip.arr[j] -= shift; trip.dep[j] -= shift; }
  hud.showMessage(`Embarque completo · puedes salir ya (horario adelantado ${formatDelay(shift).replace("+", "")})`, "ok", 3500);
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

/**
 * Finalizar turno antes de la terminal: el primer toque pide confirmación (para no
 * terminar por accidente) y el segundo, dentro de 4 s, muestra el resumen del servicio.
 */
function requestEndShift() {
  if (!game?.player || game.transition || hud.summaryOpen) return;
  if (game.shiftEnded) return hud.showMessage("Este servicio ya terminó · haz la maniobra de retorno (T) o vuelve al menú", "info", 4000);
  const now = performance.now();
  if (!game.endShiftAsk || now - game.endShiftAsk > 4000) {
    game.endShiftAsk = now;
    return hud.showMessage(`¿Finalizar el turno aquí? ${game.touch ? "Toca" : "Pulsa"} otra vez «Finalizar turno» para confirmar`, "warn", 4000);
  }
  game.endShiftAsk = 0;
  showDriverSummary({ early: true });
}

function showDriverSummary({ early = false } = {}) {
  game.shiftEnded = true;
  const s = game.stats, sc = game.score;
  const prevBest = sc.best?.total ?? 0;
  const record = sc.finish();
  const w = CONFIG.schedule.punctualWindow;
  // Bono solo si se sirvió al menos la mitad de la línea (no vale empezar a mitad de camino)
  const stops = STATIONS.filter((_, i) => tripStopsAt(game.player.trip, game.player.route.stationOf(STATIONS[i]).index)).length;
  const minStations = Math.ceil((stops - 1) / 2);
  const bonusOk = s.arrivals.length >= minStations;
  const bonus = bonusOk ? shiftBonus(sc.grade(), inventory.wageMultiplier) : 0;
  if (bonus) { bank.deposit(bonus, `Bono de servicio ${game.player.trip.id} (nota ${sc.grade()})`, { wage: true }); hud.setBank(bank); hud.moneyFloat(bonus); }
  const sim = game.player.sim;
  const where = sim.dockedStation()?.name ?? (sim.nextStation() ? `Antes de ${spokenName(sim.nextStation().name)}` : spokenName(game.player.route.last.name));
  const audio = game.audio;
  hud.showShiftReport({
    kicker: early ? `Turno finalizado · servicio ${game.player.trip.id}` : `Servicio ${game.player.trip.id} completado`,
    title: early ? (sim.dockedStation() ? spokenName(where) : where) : spokenName(game.player.route.last.name),
    line: { id: LINE.id, color: LINE.color },
    stations: s.log,
    totalStations: stops - 1,
    punctualWindow: w,
    score: {
      total: sc.total, grade: sc.grade(), record, prevBest,
      perfects: sc.perfects, bestStreak: sc.bestStreak, jerks: sc.totalJerks, harshStops: sc.harshStops,
    },
    faults: { redSignals: s.redSignals, overspeeds: s.overspeeds, emergencies: s.emergencies },
    pay: { stations: game.shiftPay, bonus, bonusOk, minStations, bank: BANK_NAME, balance: bank.label },
    actions: early
      ? { continueLabel: "Nuevo servicio", onContinue: restartGame, onMenu: stopGame }
      : {
        continueLabel: "Maniobra de retorno",
        onContinue: () => hud.showMessage("Cierra puertas (D), avanza a la cola de maniobras y detente en el cartel FIN DE MANIOBRA. Luego pulsa T", "info", 9000),
        altLabel: "Reiniciar",
        onAlt: restartGame,
        onMenu: stopGame,
      },
  }, {
    tick: () => audio.notchClick(),
    stamp: () => audio.reverserClunk(),
    record: () => audio.chime(),
    cash: () => audio.cash(),
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
    game.stats = { arrivals: [], stops: [], log: [], redSignals: 0, overspeeds: 0, emergencies: 0 };
    game.score = newScore(other);
    game.shiftEnded = false;                 // empieza un servicio nuevo
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
    case "step":
      game.audio.footstep(data.space === "street" ? "street" : data.space === "train" ? "train" : "tile", data.running);
      break;
    case "boarded":
      if (!ride.origin) { ride.origin = data.unit.sim.dockedStation()?.world || null; ride.boardedClock = game.clock; }
      hud.showMessage(`Has subido al tren ${data.unit.id} · ${data.unit.route.label}`, "ok", 3500);
      break;
    case "alighted":
      if (data.station) hud.showMessage(`Has bajado en ${data.station.name}`, "ok", 3500);
      break;
    case "transfer":
      transferLine(data.lineId, data.station);
      break;
    case "trainFull": {
      const whole = data.unit.load >= CAR_CAPACITY * CONFIG.train.cars - 5;
      hud.showMessage(whole
        ? `Tren lleno (${Math.round(data.unit.load)} personas, 6 por m²): no alcanzas a subir · espera el siguiente`
        : `El coche ${data.car + 1} va repleto: no cabes · prueba en otra puerta (los coches del extremo van más vacíos)`, "warn", 4500);
      break;
    }
    case "noBoarding":
      hud.showMessage("Este tren no admite pasajeros: se retira del servicio · espera el próximo", "warn", 4500);
      break;
    case "notice":
      hud.showMessage(data.text, data.level, 3500);
      break;
    case "stumble":
      game.audio.stumble(data.bump);
      break;
    case "doorObstructed": {
      // El sensor de la puerta detecta el obstáculo y el cierre se invierte; el ATO vuelve a cerrar
      const u = data.unit, sim = u.sim;
      if (sim.doorState === "closing") sim.toggleDoors({ automatic: true });
      if (!u.isPlayer) game.engine.line(u.route)?.incidents.recloses.push({ unit: u, at: game.clock + 5 });
      hud.showMessage("Obstruiste el cierre de puertas: se vuelven a abrir · no te quedes en el vano de la puerta", "warn", 4000);
      game.audio.doorsOpening?.(CONFIG.train.doorTime);
      break;
    }
    case "surface":
      arriveStreet(data.station);
      break;
    case "descend":
      descendFromStreet(data.station);
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
  // Objeto olvidado que llevas: se entrega en la ventanilla de la boletería
  const delivered = kind === "boleteria" ? game.encounters?.deliverAtBooth() : null;
  if (delivered) return hud.showMessage(delivered, "ok", 6500);
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
    if (m.mastered) setTimeout(() => game && celebrateLine(), 1800);   // tras el aviso de la misión cumplida
  }
  hud.updateTracker(game.missions);
}

/**
 * ¡Libreta de misiones completa! Gran premio, fanfarria, anuncio por
 * megafonía, confeti y medalla de la línea. Si con esta quedan completas
 * todas las líneas, premio doble: Gran Maestro del Metro de Santiago.
 */
function celebrateLine() {
  const line = LINES.find(l => l.id === LINE.id) || LINE;
  const grand = LINES.every(l => l.id === line.id || lineMastered(l.id));
  bank.deposit(MASTERY_REWARD, `Libreta de misiones completa · ${line.name}`);
  if (grand) bank.deposit(GRAND_REWARD, "Gran Maestro del Metro de Santiago");
  hud.setBank(bank);
  hud.moneyFloat(MASTERY_REWARD + (grand ? GRAND_REWARD : 0));
  const walker = game.walker;
  walker.frozen = true;
  walker.keys.clear();
  game.audio.fanfare(grand);
  setTimeout(() => game?.audio.announce(grand
    ? "Estimados pasajeros: Metro de Santiago felicita a nuestro nuevo Gran Maestro, que completó las misiones de todas las líneas de la red. ¡Muchas gracias por viajar con nosotros!"
    : `Estimados pasajeros: Metro de Santiago felicita a nuestro nuevo Pasajero Ilustre de la ${line.name.charAt(0) + line.name.slice(1).toLowerCase()}. ¡Muchas gracias por viajar con nosotros!`), 4200);
  celebrate({
    line, completed: game.missions.completed, reward: MASTERY_REWARD, grand, grandReward: GRAND_REWARD,
    lines: LINES, isMastered: (id) => id === line.id || lineMastered(id),
    onClose: () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } },
  });
}

/**
 * Al empezar la partida el pasajero aparece en la calle de su estación
 * (lo único que se "teletransporta": el inicio). Después todo se camina.
 */
function goToStreet(st) {
  const walker = game.walker;
  game.city.load(st, game.clock);
  walker.enterStreet(st);
  game.city.enter();
  walker.frozen = false;
  walker.keys.clear();
  game.ride = { origin: null, boardedClock: null };
}

/** Subió caminando la escalera de salida y llegó a la vereda: avisos y misiones ("llegaste a X"). */
function arriveStreet(st) {
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
  game.ride = { origin: null, boardedClock: null };
}

/** Entró por la boca del acceso: baja caminando hacia la mezanina. */
function descendFromStreet(st) {
  hud.showMessage(card.hasCard
    ? `${st.name} · saldo bip! ${card.label} · abajo: boletería a la izquierda, tótems a la derecha`
    : `${st.name} · aún no tienes tarjeta bip!: cómprala en la boletería de la mezanina (izquierda)`, "info", 5000);
}

/**
 * Luz del día en la salida: la calle se construye y se ve en cuanto el
 * pasajero se acerca a la salida de la mezanina, y el cielo, la niebla y la
 * luz pasan de a poco del Metro a la calle mientras sube la escalera.
 */
function updateOutdoor(walker) {
  const city = game.city;
  let f = 0;
  if (walker.space === "street") f = 1;
  else if (walker.space === "world") {
    const st = walker.stationAt(walker.pos.z);
    const dz = st ? walker.pos.z - st.z : -1e9;
    if (st && dz > CONFIG.mezzanine.gateZ && walker.pos.y > CONFIG.mezzanine.y - 0.3) {
      if (city.station !== st) city.load(st, game.clock);
      const top = CONFIG.exit.streetY + 0.1;
      f = THREE.MathUtils.clamp(0.08 + 0.92 * (walker.pos.y - CONFIG.mezzanine.y) / (top - CONFIG.mezzanine.y), 0.08, 1);
    }
  }
  if (Math.abs(f - (city.outdoor ?? -1)) > 0.004) city.setOutdoor(f);
}

/**
 * Combinación a pie: el pasajero recorre el pasillo de la mezanina y pasa a
 * la otra línea en la misma estación. Solo se dibuja una línea a la vez
 * (GPU integrada), así que el mundo se reconstruye con la nueva línea; la
 * cuenta, la tarjeta bip! y las misiones (guardadas por línea) se conservan,
 * y se llega a su mezanina en zona pagada (no se vuelve a pagar).
 */
function transferLine(lineId, st) {
  const line = lineById(lineId);
  if (!game || game.transition || !line) return;
  const target = line.stations.find(s => s.name === st.name);
  if (!target) { game.walker.transferring = false; return; }
  const fromId = LINE.id;
  const tutorialStep = game.tutorial ? game.tutorial.index : null;     // el tutorial sigue en la otra línea
  game.transition = true;
  game.walker.frozen = true;
  game.walker.keys.clear();
  hud.fadeOut(`Combinación · Línea ${lineId} · ${st.name}`);
  setTimeout(() => {
    if (!game) return;
    stopGame({ keepFullscreen: true });          // en el celular sigue a pantalla completa
    // Mismo arranque que "Entrar" en la pantalla de inicio, pero en la otra línea
    paxLineSelect.value = line.id;
    fillStations(line);
    stationSelect.value = String(target.index);
    saveSetting("metrosim.line", line.id);
    useLine(line);
    startScreen.classList.add("hidden");
    loadingScreen.classList.remove("hidden");
    const audio = new AudioSystem();
    audio.muted = muted;
    audio.start();
    setTimeout(() => buildGame("passenger", target.index, audio, ROUTE_A, { transferFrom: fromId, tutorialStep }), 40);
  }, 700);
}

/** Llega a la mezanina por el pasillo de combinación (zona pagada, mirando hacia los andenes). */
function arriveByTransfer(st) {
  const walker = game.walker;
  walker.enterStation(st);
  const T = CONFIG.mezzanine.transfer;
  walker.pos.set(CONFIG.station.wallX - 1.4, CONFIG.mezzanine.y, st.z + (T.z0 + T.z1) / 2);
  walker.yaw = Math.PI / 2;                 // de espaldas al pasillo, mirando al centro
  walker.paid = true;
  walker.transferring = true;               // no vuelve a entrar al pasillo hasta alejarse
  game.ride = { origin: null, boardedClock: null };
}

/** Interacción en la calle (E): acceso al Metro, un local o el hito. */
function onStreetTarget(target) {
  const st = game.walker.station;
  if (target.kind === "access") return hud.showMessage("Camina hacia la escalera para bajar a la estación", "info");
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
        ...bank.history.slice(0, 8).map(h => [`${h.date.slice(5)} · ${h.concept}`, h.amount === 0 ? "gratis" : `${h.amount > 0 ? "+" : "−"}${formatCLP(Math.abs(h.amount))}`]),
      ],
      status: bank.history.length ? "Últimos movimientos de tu cuenta." : "Aún no tienes movimientos. Gana dinero en el modo Conductor.",
      onBuy: async () => "",
      onClose,
    });
    return;
  }

  hud.openStore({
    icon: shop.icon, kicker: `${shop.label.toUpperCase()} · ${st.name}`, title: shop.name, bank,
    items: () => [
      ...game.missions.actionsAt(st, shop.kind).map(a => ({ name: a.label, action: a.id })),
      // Kiosko: el recuerdo de la estación para el álbum de la Tienda Metro (uno por estación)
      ...(shop.kind === "kiosko" && !inventory.has(souvenirId(LINE.id, st.name)) ? [{ id: "souvenir", souvenir: true, name: `🎟️ Recuerdo de ${st.name}`, price: SOUVENIR_PRICE }] : []),
      ...shop.items,
    ],
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
      if (item.souvenir) return addSouvenir(st);
      bank.addToBag(item.name);
      game?.audio.cash();
      hud.moneyFloat(-item.price);
      report(game.missions.notify("buy", { station: st, shop: shop.kind, item }, missionCtx()));
      return `Compraste ${item.name} por ${formatCLP(item.price)} · saldo ${bank.label}`;
    },
    onClose,
  });
}

/** Recuerdo comprado en el kiosko: va al álbum; completar la línea paga un premio. */
function addSouvenir(st) {
  game?.audio.cash();
  hud.moneyFloat(-SOUVENIR_PRICE);
  inventory.owned.add(souvenirId(LINE.id, st.name));
  const line = lineById(LINE.id), { have, total } = inventory.album(line);
  let extra = "";
  if (have === total && !inventory.albums.has(line.id)) {
    inventory.albums.add(line.id);
    bank.deposit(ALBUM_REWARD, `Álbum de recuerdos completo · ${line.name}`);
    hud.moneyFloat(ALBUM_REWARD);
    game?.audio.fanfare();
    extra = ` · 🏆 ¡ÁLBUM DE LA ${line.name} COMPLETO! +${formatCLP(ALBUM_REWARD)}`;
  }
  inventory.save();
  hud.setBank(bank);
  return `Recuerdo de ${st.name} al álbum (${have}/${total}) · K para ver tu colección${extra}`;
}

/** Tablero de misiones (J). */
function openMissionBoard() {
  const walker = game.walker, ms = game.missions;
  walker.frozen = true;
  walker.keys.clear();
  ms.ensure(missionCtx());
  hud.openMissions({
    missions: ms,
    civics: () => `Civismo: ${civics.label}${civics.carrying ? ` · llevas ${civics.carrying.name}: entrégala en una boletería` : ""}`,
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
   Mapa de la misión (modo Pasajero): hacia dónde ir para cumplir el paso actual
   ========================================================================== */

/**
 * Guía del paso actual de la misión: qué lugar es, cómo llegar y hacia
 * dónde queda (ángulo respecto de donde miras, para la brújula del HUD).
 * Dentro de las estaciones guía por tramos: andén → escalera → mezanina →
 * torniquetes → salida (o al revés para bajar al andén del sentido correcto).
 */
function missionGuide() {
  const w = game.walker, ms = game.missions, step = ms?.step;
  if (!w || !step) return null;
  const MZ = CONFIG.mezzanine, ST = CONFIG.station;
  const target = step.station ? ms.byName(step.station) : null;
  const you = w.space === "street" ? hud.progressOf(w.station.z) : hud.progressOf(w.worldZ);
  const g = { label: "", target: "", hint: "", angle: null, dist: null, here: false, you, pin: null, pinIndex: -1 };
  if (target) { g.pin = hud.progressOf(target.z); g.pinIndex = target.index; }

  // Punto a seguir (coordenadas del mundo) → ángulo relativo a la mirada y distancia
  const toward = (x, z) => {
    const dx = x - w.pos.x, dz = z - w.pos.z;
    let rel = Math.atan2(-dx, -dz) - w.yaw;                 // 0 = al frente, + = a la izquierda
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    g.angle = -rel;                                          // la flecha gira en sentido horario
    g.dist = Math.hypot(dx, dz);
  };
  const dirLabel = (route) => `dirección ${spokenName(route.last.name)}`;
  const plural = (n) => `${n} ${n === 1 ? "estación" : "estaciones"}`;
  const routeTo = (from) => (target.index > from.index ? ROUTE_A : ROUTE_B);

  /* --- A bordo de un tren --- */
  if (w.space === "train") {
    if (!target) { g.label = "BOLETERÍA"; g.target = "En la mezanina de cualquier estación"; g.hint = "Bájate en la próxima estación y sube a la mezanina"; return g; }
    const sim = w.unit.sim, route = w.unit.route;
    const docked = sim.dockedStation(), next = sim.nextStation();
    const tIdx = route.stations.findIndex(s => s.name === target.name);
    g.target = target.name;
    if (docked && tIdx === docked.index) {
      g.here = true;
      g.label = "ESTÁS EN EL DESTINO";
      g.hint = "Bájate aquí y sal a la calle";
    } else if (tIdx >= 0 && (docked ? tIdx > docked.index : next && tIdx >= next.index)) {
      const n = docked ? tIdx - docked.index : tIdx - next.index + 1;
      g.label = `DESTINO · ${plural(n)}`;
      g.hint = n === 1 ? "Bájate en la próxima estación" : `Vas bien: quédate a bordo ${plural(n)} más`;
    } else {
      g.label = "SENTIDO CONTRARIO";
      g.hint = `Bájate y toma el tren ${dirLabel(route === ROUTE_A ? ROUTE_B : ROUTE_A)}`;
    }
    return g;
  }

  /* --- En la calle --- */
  if (w.space === "street") {
    const o = game.city.origin, a = STREET.access;
    const goMetro = (hint) => { toward(o.x + a.x, o.z + a.z + a.mouthZ - 0.8); g.hint = hint; };
    if (!target) {
      g.label = "BOLETERÍA";
      g.target = `Estación ${w.station.name}`;
      goMetro(step.kind === "bipCard" ? "Baja al Metro: la boletería está en la mezanina" : "Baja al Metro: boletería o tótem en la mezanina");
      return g;
    }
    if (target.name !== w.station.name) {
      const n = Math.abs(target.index - w.station.index);
      g.label = `DESTINO · ${plural(n)}`;
      g.target = target.name;
      goMetro(`Entra al Metro y toma el tren ${dirLabel(routeTo(w.station))}`);
      return g;
    }
    // En la calle del destino: el local, el hito o (si ya está todo) nada
    const plan = streetPlan(target);
    g.label = "ESTÁS EN EL DESTINO";
    if (step.kind === "buy" || step.kind === "action") {
      const shop = plan.shops.find(sh => sh.kind === step.shop);
      g.target = shop ? `${shop.icon} ${shop.name}` : target.name;
      if (shop) toward(o.x + shop.door.x, o.z + shop.door.z);
      g.hint = shop?.stand ? "Puesto en la vereda del Metro · E para atender" : "En la vereda del Metro · E en la puerta para entrar";
      if (g.dist != null && g.dist < 2.6) { g.here = true; g.hint = "¡Aquí es! Pulsa E"; }
    } else if (step.kind === "photo" && plan.landmark) {
      g.target = `📷 ${plan.landmark.name}`;
      toward(o.x - STREET.walkHalf - 3, o.z);
      g.hint = "Al frente, cruzando la avenida · E para sacar la foto";
      if (w.pos.x - o.x < -3 && Math.abs(w.pos.z - o.z) < (game.city.landmark?.halfZ ?? 10) + 6) { g.here = true; g.hint = "¡Aquí es! Pulsa E para sacar la foto"; }
    } else {
      g.target = target.name;
      g.here = true;
      g.hint = step.fare ? "Para que cuente tienes que llegar viajando en Metro" : "Ya estás aquí";
    }
    return g;
  }

  /* --- Dentro de una estación (andenes, escaleras, mezanina, salida) --- */
  const st = w.stationAt(w.pos.z) || w.station;
  const dz = w.pos.z - st.z;
  const onPlatform = Math.abs(w.pos.y - ST.platformTop) < 0.3;
  const onMezz = Math.abs(w.pos.y - MZ.y) < 0.3 && dz <= MZ.z1 + 0.5;
  const inExit = !onPlatform && !onMezz && dz > MZ.z1 - 0.5;
  const mySide = Math.sign(w.pos.x) || 1;
  const stairX = (side) => side * (MZ.stairX0 + MZ.stairX1) / 2;
  // Subir a la mezanina por la escalera del andén en que estás (o seguir subiendo si ya vas en ella)
  const goUp = () => (onPlatform ? toward(stairX(mySide), st.z + MZ.stairZ0 - 1) : toward(stairX(mySide), st.z + MZ.stairZ1 + 1));
  const goOut = () => {
    if (inExit) return toward(0, st.z + CONFIG.exit.streetDz + 6);
    if (!onMezz) return goUp();
    if (dz < MZ.gateZ - 0.3) return toward(0, st.z + MZ.gateZ + 1);          // zona pagada: primero los torniquetes
    return toward(0, st.z + MZ.z1 + 1);                                      // la salida, al fondo de la mezanina
  };

  if (!target) {
    g.label = "BOLETERÍA";
    const totem = step.kind === "bipLoad";
    g.target = totem ? "Boletería o tótem de carga" : "Boletería";
    if (onMezz && dz >= MZ.gateZ) {
      const booth = { x: MZ.booth.x1 + 0.6, z: st.z + MZ.booth.windowZ };
      const spots = totem ? [booth, ...MZ.totems.map(x => ({ x, z: st.z + MZ.totemZ - 0.8 }))] : [booth];
      const best = spots.reduce((b, p) => (Math.hypot(p.x - w.pos.x, p.z - w.pos.z) < Math.hypot(b.x - w.pos.x, b.z - w.pos.z) ? p : b));
      toward(best.x, best.z);
      g.hint = totem ? "Boletería a la izquierda, tótems a la derecha · E para atender" : "A la izquierda de los torniquetes · E para atender";
      if (g.dist < 1.4) { g.here = true; g.hint = "¡Aquí es! Pulsa E"; }
    } else if (inExit) {
      toward(0, st.z + MZ.z1 - 2);
      g.hint = "Vuelve a la mezanina: está en la zona no pagada";
    } else {
      goOut();
      g.hint = "Está en la mezanina, antes de los torniquetes";
    }
    return g;
  }

  g.target = target.name;
  if (target.name === st.name) {
    g.label = "ESTÁS EN EL DESTINO";
    goOut();
    g.hint = "Sal a la calle: la salida está al fondo de la mezanina";
    return g;
  }
  const route = routeTo(st), side = route.side;
  g.label = `DESTINO · ${plural(Math.abs(target.index - st.index))}`;
  if (onPlatform) {
    if (mySide === side) { g.here = true; g.hint = `Andén correcto: espera el tren ${dirLabel(route)}`; }
    else { goUp(); g.hint = `Andén equivocado: sube y baja al andén ${dirLabel(route)}`; }
  } else if (onMezz && dz >= MZ.gateZ) {
    toward(0, st.z + MZ.gateZ - 1);
    g.hint = `Pasa los torniquetes y baja al andén ${dirLabel(route)}`;
  } else if (onMezz) {
    toward(stairX(side), st.z + MZ.stairZ1 - 0.5);
    g.hint = `Baja por la escalera al andén ${dirLabel(route)}`;
  } else if (inExit) {
    toward(0, st.z + MZ.z1 - 2);
    g.hint = `Vuelve a la mezanina y baja al andén ${dirLabel(route)}`;
  } else if (mySide === side) {
    toward(stairX(side), st.z + MZ.stairZ0 - 1);
    g.hint = `Sigue bajando: andén ${dirLabel(route)}`;
  } else {
    goUp();
    g.hint = `Esta escalera va al otro andén: vuelve y baja al andén ${dirLabel(route)}`;
  }
  return g;
}

/* ==========================================================================
   Sin dinero (modo Pasajero): atajo al modo Conductor para ganar el sueldo
   ========================================================================== */

/** ¿No alcanza ni para pagar el pasaje ni para cargar la bip!? */
function passengerBroke() {
  const fare = fareBandAt(game.clock).price;
  if (card.hasCard && card.balance >= fare) return false;
  return bank.balance < (card.hasCard ? FARES.loadAmounts[0] : FARES.cardPrice + FARES.loadAmounts[0]);
}

function updateDriverJobButton() {
  const show = !!game?.walker && !game.transition && passengerBroke();
  $("driverJobButton").classList.toggle("hidden", !show);
}

/** Deja el modo Pasajero y entra al de Conductor (en la línea actual si tiene licencia; si no, en la gratuita). */
function goDriveForMoney() {
  if (!game?.walker) return;
  const id = inventory.canDrive(LINE.id) ? LINE.id : FREE_LINE;
  stopGame({ keepFullscreen: true });
  selectLine(id);
  startGame("driver");
}

/**
 * Acciones táctiles que tienen sentido ahora (el resto de los botones contextuales se ocultan).
 * Conductor: vigilancia solo con la alarma de hombre muerto; cambio de cabina solo detenido en FIN DE MANIOBRA.
 * Pasajero: usar si hay algo al alcance; sentarse en el andén o el tren; agarrarse de pie en el tren.
 */
function touchContext() {
  if (!game || game.warming || game.transition) return {};
  if (game.player) {
    const sim = game.player.sim;
    return {
      vigilance: !!game.safety.alarm,
      cab: sim.isStopped && !sim.nextStation() && Math.abs(sim.position - game.player.route.track.retireZ) <= 15,
    };
  }
  const w = game.walker;
  if (!w || w.frozen) return {};
  const inTrain = w.space === "train";
  return {
    use: !!game.encounters?.near() || (w.space === "street" ? !!game.city.nearest(w.pos) : !inTrain && !!(w.elevatorNear() || w.nearService() || w.nearExit())),
    sit: !!w.seat || inTrain || w.platformSide() !== 0,
    seated: !!w.seat,
    hold: inTrain && !w.seat,
    holding: !!w.holding,
  };
}

/* ==========================================================================
   Volver al menú desde el modo Pasajero: con confirmación
   ========================================================================== */

let confirmOpen = false;

function requestMenu() {
  if (!game?.walker) return stopGame();
  if (confirmOpen) return;
  confirmOpen = true;
  game.walker.frozen = true;
  game.walker.keys.clear();
  $("confirmPanel").classList.remove("hidden");
  $("confirmCancel").focus();
}

function closeConfirm(leave) {
  if (!confirmOpen) return;
  confirmOpen = false;
  $("confirmPanel").classList.add("hidden");
  if (leave) return stopGame();
  if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); }
}

/* ==========================================================================
   Megafonía y sonidos de estado
   ========================================================================== */

/** ¿El jugador está en el andén donde se detiene este tren (o en el de la estación indicada de su ruta)? */
function walkerOnPlatformOf(unit, station = null) {
  const w = game.walker;
  if (!w || w.unit) return false;
  const rs = station || unit.sim.dockedStation();
  return !!rs && w.platformSide() === unit.route.side && w.stationAt(w.pos.z) === rs.world;
}

/**
 * Megafonía del tren en el que va el jugador (conductor o pasajero), con las
 * frases reales del Metro de Santiago (announcements.js).
 */
function updateOnboardAnnouncements(unit) {
  if (!unit) return;
  const sim = unit.sim, next = nextStopOf(unit);
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
  // Detenido entre estaciones: a los pocos segundos, el aviso por megafonía
  if (sim.isStopped && remaining > 30 && !sim.dockedStation()) {
    unit.announced.stoppedAt ??= game.clock;
    const waited = game.clock - unit.announced.stoppedAt, ls = unit.ato?.lineStop;
    if (!unit.announced.stopDone && ls && waited > 5) { unit.announced.stopDone = true; game.audio.announce(PHRASES.lineStop(ls.speech)); }
    else if (!unit.announced.stopDone && !ls && waited > 14) { unit.announced.stopDone = true; game.audio.announce(PHRASES.briefStop()); }
  } else if (!sim.isStopped) { unit.announced.stoppedAt = null; unit.announced.stopDone = false; }
}

/** En el andén: aviso de que el tren que llega no admite pasajeros (se retira del servicio). */
function updatePlatformAnnouncements() {
  const w = game.walker;
  const side = w && !w.unit ? w.platformSide() : 0;
  const st = side ? w.stationAt(w.pos.z) : null;
  if (!st) return;
  const route = routeForSide(side), rs = route.stationOf(st);
  for (const u of game.traffic.units) {
    if (u.route !== route || !u.ato?.outOfService || u.ato.evacuating || u.noPaxAnnounced === rs.index) continue;
    const d = u.sim.position - rs.stopZ;
    if (d < 5 || d > 450) continue;                    // (no el que ya está en el andén)
    u.noPaxAnnounced = rs.index;
    game.audio.announce(PHRASES.noPassengers());
    hud.showMessage("El próximo tren no admite pasajeros: no subas", "warn", 6000);
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
        if (!unit.ato?.evacuating) audio.announce(terminal ? PHRASES.terminal() : PHRASES.letOff(), { chime: terminal });
      }
    }
    if (sim.doorState === "closing") {
      if (hearsVoice) audio.announce(PHRASES.doorsClosing(), { chime: false });
      audio.doorsClosing(CONFIG.train.doorTime);
    }
  }
  unit.prevDoorState = sim.doorState;
  if (sim.isStopped && (unit.prevAccel ?? 0) < -0.3 && sim.accel >= -0.3 && level > 0.3) audio.airHiss(0.35);
  // Al arrancar se sueltan los frenos (escape de aire)
  if (sim.speed < 0.3 && (unit.prevAccel ?? 0) <= 0.02 && sim.accel > 0.02 && level > 0.3) audio.brakeRelease(level);
  unit.prevAccel = sim.accel;
}


/* ==========================================================================
   Información para el conductor
   ========================================================================== */

/** Caja que ocupa un tren en el mundo (para que no llueva dentro del coche). */
function trainBounds(unit) {
  const a = unit.route.toWorldZ(unit.sim.position), b = unit.route.toWorldZ(unit.sim.position + CONFIG.train.length);
  const x = unit.route.trackX, w = CONFIG.train.halfWidth + 0.15;
  return { x0: x - w, x1: x + w, z0: Math.min(a, b), z1: Math.max(a, b) };
}

/** Aviso al empezar a conducir (1.5): el tren que te tocó, tu ruta y el tiempo. */
function driverBriefing(unit) {
  const k = unit.stock, parts = [`Hoy conduces un ${stockLabel(k)}`];
  if (k.tyre === "rubber") parts.push("frena y arranca fuerte, sin pantógrafo: toma 750 V de las barras guía");
  if (!k.regenEfficiency) parts.push("sin freno regenerativo");
  if (unit.trip.express) parts.push(`servicio ${EXPRESS_LABEL[unit.trip.express].name}: para solo en estaciones ${unit.trip.express === "roja" ? "rojas" : "verdes"} y comunes`);
  if (WEATHER.rain > 0 && unit.route.line.sectionsInfo.hasExposed) parts.push(`${weatherLabel()}: riel mojado en los tramos al aire libre, frena antes`);
  return parts.join(" · ");
}

/** Ruta Expresa: la próxima PARADA del servicio (las saltadas se pasan sin detenerse). */
function nextStopOf(unit) {
  const physical = unit.sim.nextStation();
  if (!physical || !unit.trip?.skip || tripStopsAt(unit.trip, physical.index)) return physical;
  return unit.route.stations[nextStopIndex(unit.trip, physical.index, unit.route.stations.length - 1)];
}

function getRouteInfo(unit) {
  const sim = unit.sim;
  const docked = sim.isStopped ? sim.dockedStation() : null;
  const physical = sim.nextStation(), next = nextStopOf(unit);
  const passing = physical !== next ? physical : null;
  const near = sim.nearestStation();
  const nearError = sim.position - near.stopZ;
  let approach = null;
  if (next && sim.position - next.stopZ < 60) approach = { station: next, error: sim.position - next.stopZ };
  else if (Math.abs(nearError) < 15 && tripStopsAt(unit.trip, near.index)) approach = { station: near, error: nearError };

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
    docked, next, passing,
    express: unit.trip?.express || null,
    distance: next ? sim.position - next.stopZ : 0,
    approach,
    limit: sim.currentLimit(),
    signal, schedule,
    ahead: trainAhead(unit),
  };
}

/** Distancia (m) hasta la que la DMI muestra el tren de adelante. */
const AHEAD_RANGE = 3000;

/**
 * Tren de adelante en la misma vía (para la DMI): distancia desde tu testero
 * hasta su cola, su velocidad y qué está haciendo (estado del motor, state.js).
 */
function trainAhead(unit) {
  const pos = unit.sim.position, L = CONFIG.train.length;
  let best = null, gap = Infinity;
  for (const u of game.traffic.units) {
    if (u === unit || u.route !== unit.route || u.sim.position >= pos) continue;   // la ruta avanza hacia −Z
    const g = pos - (u.sim.position + L);
    if (g < gap) { gap = g; best = u; }
  }
  if (!best || gap > AHEAD_RANGE) return null;
  const docked = best.sim.isStopped ? best.sim.dockedStation() : null;
  let status = TRAIN_STATES[best.state] || "circulando";
  if (docked && (best.state === "dwell" || best.state === "closing" || best.state === "ready" || best.state === "regulating" || best.state === "held")) status = `${status} · ${docked.short}`;
  else if (!best.sim.isStopped) status = `${status} · ${Math.round(best.sim.speedKmh)} km/h`;
  return { id: best.id, gap: Math.max(0, gap), stopped: best.sim.isStopped, status, outOfService: !!best.ato?.outOfService };
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
  if (game.dmiTimer <= 0) {
    model.dmi.draw(sim, info);
    model.status?.draw(sim, info, { clock: game.clock, onboard: game.people.onboardCount(unit), trip: unit.trip, lineColor: LINE.color });
    game.dmiTimer = 1 / 12;
  }
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
  if (hud.summaryOpen) { renderFrame(); game.raf = requestAnimationFrame(loop); return; }
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
    game.rig.update(player.sim, game.elapsed, dt);
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
  // Ascensores: "ding" al llegar y zumbido al arrancar (solo los que están cerca)
  for (const el of world.elevators.list) {
    if (!el.events.length) continue;
    if (Math.hypot(el.side * CONFIG.elevator.x0 - cameraWorld.x, el.st.z + CONFIG.elevator.z0 - cameraZ) < 14) {
      for (const ev of el.events) ev === "chime" ? audio.elevatorDing() : audio.elevatorHum();
    }
    el.events.length = 0;
  }
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
  if (game.city && walker) updateOutdoor(walker);
  if (game.city) game.city.update(dt, inStreet ? walker.pos : null, game.clock);
  const ridden = player && game.rig.view !== "exterior" ? player : walker?.unit;
  game.outdoor.update(dt, cameraWorld, game.clock, { street: inStreet, cityOutdoor: game.city?.outdoor || 0, dry: ridden ? trainBounds(ridden) : null });
  // Encuentros con otros viajeros (no durante el tutorial ni en un cambio de línea)
  if (game.encounters && !game.tutorial && !game.transition) game.encounters.update(dt);
  game.missionT = (game.missionT || 0) - dt;
  if (game.missions && game.missionT <= 0) {
    game.missionT = 1;
    report(game.missions.tick(missionCtx()));
    hud.updateTracker(game.missions);
    updateDriverJobButton();
  }

  // 4. Luces del tren en foco (la interior sigue al pasajero a lo largo del tren)
  const focus = inStreet ? null : focusUnit(cameraZ);
  if (focus && focus !== game.lightsUnit) { focus.group.add(game.trainLights); game.lightsUnit = focus; }
  if (walker && walker.unit) game.innerLight.position.z = walker.pos.z;
  game.lineMap.update(player || walker.unit || focus || null, game.elapsed);
  game.carInfo.update(player || walker.unit || focus || null, game.clock, game.elapsed);
  engine.main.incidents.focus = walker ? (walker.unit || focus) : null;     // los incidentes le tocan a menudo al tren del pasajero
  const inHall = !inStreet && STATIONS.some(s => cameraZ - s.z > CONFIG.station.hallZ0 && cameraZ - s.z < CONFIG.station.hallZ1);
  const outside = game.outdoor.exposure;                                  // 0 túnel … 1 viaducto / trinchera
  if (walker) updateTunnelView(dt, walker, inHall || outside > 0.5);

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
  if (walker) { updatePlatformAnnouncements(); updatePassingTrains(rider); }
  const fs = focus?.sim;
  audio.update({
    dt,
    velocity: fs ? fs.velocity : 0,
    speedKmh: fs ? fs.speedKmh : 0,
    accel: fs ? fs.accel : 0,
    braking: fs ? fs.isBraking : false,
    level: focus ? level : 0,
    inStation: inHall,
    outdoor: inStreet ? 1 : outside,
    rain: game.outdoor.rainAmount || 0,
    stock: (rider || focus)?.stock || null,
    street: inStreet,
    streetBusy: inStreet ? clamp(demandAt(game.clock) * 1.4 + 0.15, 0.15, 1) : 0,
    view,
    overspeed: !!player && player.sim.speedKmh > player.sim.currentLimit() + 2,
    crowd: inStreet ? 0.25 : people.crowdLevel(cameraWorld) * (view === "cab" ? 0.5 : 1),
  });

  // 6. HUD
  if (player) {
    game.safety.update(dt, player);
    const info = getRouteInfo(player);
    info.alert = game.safety.alert(player);
    updateCabVisuals(dt, player, info);
    if (player.sim.speed > 0.2) game.lastDecel = -player.sim.accel;
    game.score.update(dt, player.sim);
    const boardingBusy = engine.isBoarding(player);
    if (player.sim.doorState === "open") game.boardingDone = !boardingBusy;     // ¿terminó el embarque antes de cerrar?
    hud.updateDriver(player.sim, info, { clock: game.clock, onboard: people.onboardCount(player), boardingBusy });
    game.tutorial?.update(dt, { game, sim: player.sim, info });
  } else {
    hud.updatePassenger(walkerHudData());
    hud.updateGuide(missionGuide());
    game.tutorial?.update(dt, { game, walker, card, hud, fare: fareBandAt(game.clock).price });
  }

  renderFrame();
  game.raf = requestAnimationFrame(loop);
}

/**
 * A bordo en el túnel: la luminaria más cercana ilumina el coche al pasar (la luz
 * barre los asientos y el piso) y los vidrios se oscurecen y brillan como un espejo
 * (el reflejo del interior iluminado). En la estación vuelven a ser transparentes.
 */
function updateTunnelView(dt, walker, inHall) {
  const onboard = walker.space === "train";
  const lamp = onboard && !inHall ? game.world.tunnelLampNear(cameraWorld.z) : null;
  if (lamp) game.passLight.position.set(lamp.x, lamp.y, lamp.z);
  game.passLight.intensity = lamp ? 7 : 0;
  const G = game.glass;
  if (!G) return;
  const target = onboard && !inHall ? 1 : 0;
  if (G.k === target) return;
  G.k += clamp(target - G.k, -dt * 1.5, dt * 1.5);
  G.mat.opacity = G.opacity + (0.62 - G.opacity) * G.k;
  G.mat.metalness = G.metal + (0.85 - G.metal) * G.k;
  G.mat.color.copy(G.color).lerp(_tunnelGlass, G.k);
}
const _tunnelGlass = new THREE.Color(0x56646f);

/** Tren que se cruza en la vía de al lado mientras viajas: estruendo y golpe de presión. */
function updatePassingTrains(rider) {
  if (!rider) return;
  const z = game.traffic.worldCenterZ(rider);
  for (const u of game.traffic.units) {
    if (u.route === rider.route) continue;
    const d = game.traffic.worldCenterZ(u) - z;
    if (Math.abs(d) > 200) { if (u.passedBy === rider) u.passedBy = null; continue; }
    if (u.passedBy === rider || Math.abs(d) > 75) continue;
    // Se acercan: la vía 1 avanza hacia −Z y la vía 2 hacia +Z
    const closing = -(u.route.dir * -u.sim.velocity - rider.route.dir * -rider.sim.velocity) * Math.sign(d);
    if (closing < 4) continue;
    u.passedBy = rider;
    game.audio.passingTrain(clamp(closing / 30, 0.35, 1));
  }
}

/**
 * Dibuja el fotograma con la vía doblada según sus pendientes (render/trackLift.js):
 * la cota de la cámara es la referencia, y en la cabina, el interior o a bordo la
 * cámara cabecea con el tren.
 */
const _camWorld = new THREE.Vector3();
function renderFrame() {
  const { camera, walker, rig, city } = game;
  camera.getWorldPosition(_camWorld);
  const inStreet = walker?.space === "street";
  updateTrackLift(_camWorld.z, { cityZ: city?.station ? city.station.z : null, inStreet });
  const onboard = (rig && rig.view !== "exterior") || walker?.space === "train";
  const undo = onboard ? pitchCamera(camera, _camWorld.z) : null;
  game.renderer.render(game.scene, camera);
  undo?.();
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
  return `${first}${a[0].noPax ? " (no admite pasajeros)" : ""}${a[1] ? ` · siguiente ${a[1].minutes} min` : ""}`;
}

function walkerHudData() {
  const w = game.walker, clock = game.clock;
  // Fuera del horario comercial el Metro real está cerrado: el juego mantiene un servicio especial
  const [h0, h1] = SERVICE_HOURS[CONFIG.dayType];
  const closed = inService(clock) ? "" : `Fuera del horario comercial (${String(h0 | 0).padStart(2, "0")}:${h0 % 1 ? "30" : "00"}–${h1 | 0}:${h1 % 1 ? "30" : "00"}): servicio especial del juego cada 15 min · `;
  const base = { clock, worldZ: w.worldZ, hint: closed + (game.encounters?.hint() ?? w.hint()) };
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
    const ci = carAt(w.pos.z), car = ci + 1;
    const title = `A BORDO · ${w.unit.id} · COCHE ${car} · ${w.unit.route.label.toUpperCase()}`;
    // Cuánta gente va en tu coche (los del extremo junto a la escalera van más llenos)
    const inCar = Math.round(carLoads(w.unit)[ci]), fill = inCar / CAR_CAPACITY;
    const feel = fill < 0.2 ? "holgado" : fill < 0.45 ? "cómodo" : fill < 0.7 ? "lleno" : fill < 0.92 ? "apretado" : "repleto";
    const carText = `coche ${car}: ${inCar} personas (${feel}) · ${people} en el tren`;
    if (docked) {
      const doors = { open: "Puertas abiertas", opening: "Abriendo puertas", closing: "Cierre de puertas", closed: "Puertas cerradas" }[sim.doorState];
      return { ...base, title, station: docked.name, sub: `${doors} · ${carText}`, highlight: docked };
    }
    // Retraso respecto del horario (desde la posición real del tren)
    let late = "";
    if (next && !w.unit.ato?.outOfService) {
      const d = (game.engine.eta(w.unit, next.world) ?? clock) - w.unit.trip.arr[next.index];
      if (d > 45) late = ` · retraso ${formatDelay(d)}`;
    }
    const stopped = sim.isStopped && next && sim.position - next.stopZ > 30 ? " · DETENIDO" : "";
    return {
      ...base, title,
      station: next ? `→ ${next.name}` : "VÍA DE RETIRADA",
      sub: `${Math.round(sim.speedKmh)} km/h${stopped} · ${next ? Math.max(0, Math.round(sim.position - next.stopZ)) + " m" : ""}${late} · ${carText}`,
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
