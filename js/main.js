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
     net/         multijugador: el Centro de Control abre una sala (netHost.js) y
                  otros jugadores conducen en ella (netClient.js); replica.js
                  pasa el estado de los trenes de un motor a otro, transport.js
                  conecta los navegadores (Trystero / WebRTC)
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
import { CONFIG, STATIONS, LINE, NOTCH_INDEX, FARES, lineTag, lineLabel, lineArticle, isRail, lineSign, spokenName, fareBandAt, formatCLP, demandAt, dayTypeOf, inService, SERVICE_HOURS, DAY_TYPE_LABEL } from "./config.js";
import { ROUTES, ROUTE_A, ROUTE_B, routeForSide, oppositeRoute, setActiveLine } from "./engine/route.js";
import { LINES, SANTIAGO_LINES, lineById } from "./engine/network.js";
import { BipCard } from "./card.js";
import { PHRASES } from "./announcements.js";
import { setupPWA } from "./pwa.js";
import { setupCreator } from "./creator.js";
import { icon, textOn } from "./icons.js";
import { $, clamp, formatClock, formatStopError, gradeStop } from "./utils.js";
import { stopAssist } from "./engine/stopAssist.js";
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
import { key as keyText } from "./keys.js";
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
import { PerformerSystem } from "./performers.js";
import { Civics } from "./civics.js";
import { celebrate } from "./celebration.js";
import { Inventory, souvenirId, SOUVENIR_PRICE, ALBUM_REWARD, LICENSES, FREE_LINE } from "./shop.js";
import { openShopUI } from "./shopUI.js";
import { trainLiveryMaterials } from "./train.js";
import { City } from "./city/city.js";
import { loadRealStreet, prefetchStreets } from "./city/streetData.js";   // 2.7 · calles reales de OpenStreetMap
import { STREET, streetPlan } from "./city/plan.js";
import { Tutorial, tutorialDone } from "./tutorial.js";
import { installTrackLift, setTrackLiftLine, updateTrackLift, pitchCamera } from "./render/trackLift.js";
import { OutdoorView } from "./render/outdoor.js";
import { WEATHER, WEATHER_KINDS, setWeather, typicalWeather, kindFromWmo, weatherLabel } from "./engine/weather.js";
import { LINE_FLEETS, STOCKS, stockLabel } from "./engine/fleet.js";
import { tripStopsAt, nextStopIndex, EXPRESS_LABEL } from "./engine/express.js";
import { SECTION_LABEL } from "./engine/sections.js";
import { joinDriverRoom } from "./net/netClient.js";
import { cleanRoomCode, localNetwork, NET_LEVEL } from "./net/transport.js";
import { startPoint } from "./net/replica.js";
import { setupFareInfo, openFareInfo, closeFareInfo, fareInfoOpen, tickFareInfo } from "./fareInfo.js";
import { riderFare, riderSpecial, riderAsked, riderCategory, riderBusFare } from "./rider.js";
import { quoteStage, commitStage, loadTrip, saveTrip, fareModeOfLine, minutesLeft, payWith } from "./trip.js";
import { setupRiderPanel, openRiderPanel, closeRiderPanel, riderPanelOpen } from "./riderPanel.js";
import { startBusGame } from "./bus/busGame.js";
import { BusAudio } from "./bus/busAudio.js";
import { busTripsFrom, BUS_ROUTES, busRouteById } from "./bus/busRoute.js";
import { setupAccountButton, openAccount, closeAccount, accountOpen, state as accountState } from "./cuenta.js";
import { setupFeedbackButtons, openFeedback, closeFeedback, feedbackOpen } from "./sugerencias.js";

// La vía en 3D sigue las pendientes reales: se engancha antes de compilar ningún material
installTrackLift();

const startScreen = $("startScreen");
const loadingScreen = $("loadingScreen");
const gameScreen = $("gameScreen");
const gameContainer = $("gameContainer");
const hud = new Hud();

let game = null;
let muted = loadMuted();
/** Asistente de parada (punto previsto, aviso de frenado y pitidos): se activa/desactiva con N. */
let stopAssistOn = loadSetting("metrosim.stopAssist") !== "0";
hud.setSound(!muted);
const card = new BipCard();               // la tarjeta bip! del jugador (saldo persistente)
hud.setCard(card);
const bank = new BankAccount();           // cuenta bancaria con tarjeta de débito (compartida por los dos modos)
const civics = new Civics();              // civismo del pasajero (ayudar a otros viajeros, encounters.js)
hud.setBank(bank);
const directionSelect = $("startDirection");

// La introducción de bienvenida la arranca boot.js apenas abre la página (1.8.3)
// App instalable: service worker (sin conexión) y botón "Instalar MetroSim"
setupPWA($("installButton"));
setupAccountButton($("accountButton"));
setupFeedbackButtons($("feedbackButton"), $("feedbackFoot"));
// Modo Creador (?creador): todo desbloqueado y gratis para el creador del juego
setupCreator($("creatorBadge"));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
/** Lo comprado en la Tienda RedMovi (licencias, libreas, contratos, depto, recuerdos). */
const inventory = new Inventory();

/* --- Pantalla principal: primero la línea (botones de color), después el modo --- */
const stationSelect = $("startStation");
const driverLineSelect = $("driverLine"), paxLineSelect = $("paxLine");
const savedLine = loadSetting("metrosim.line") || "3";
for (const sel of [driverLineSelect, paxLineSelect]) {
  LINES.forEach(l => sel.append(new Option(`${l.name} · ${l.stations[0].short} ⇄ ${l.stations.at(-1).short}`, l.id)));
  sel.value = lineById(savedLine) ? savedLine : "3";
}
/* 1.15 · Modo Conductor: primero se elige QUÉ conducir (tren del Metro, Tren Nos, Tren Rancagua de EFE o bus de la Red).
   Los trenes de EFE son líneas más de la red (botones NOS y RCG); el bus tiene su propio modo (js/bus/). */
const VEHICLE_LINE = { nos: "NOS", efe: "RAN", valpo: "MER" };       // 2.18 · valpo: el Metro Valparaíso (bonus)                       // vehículo → línea que conduce
const vehicleOfLine = (id) => Object.keys(VEHICLE_LINE).find(v => VEHICLE_LINE[v] === id) || "metro";
const driverCard = document.querySelector('.mode-card[data-card="driver"]');
const vehicleButtons = [...document.querySelectorAll("#vehicleSeg [data-vehicle]")];
let driverVehicle = loadSetting("metrosim.mode") === "bus" ? "bus" : (loadSetting("metrosim.vehicle") || vehicleOfLine(savedLine));
function selectVehicle(v, { fromLine = false } = {}) {
  driverVehicle = ["metro", "nos", "efe", "valpo", "bus", "taxi"].includes(v) ? v : "metro";
  const road = driverVehicle === "bus" || driverVehicle === "taxi";      // 2.2 · bus y taxi van por la calle
  startScreen.dataset.homeRoad = road ? "1" : "0";
  saveSetting("metrosim.vehicle", driverVehicle);
  vehicleButtons.forEach(b => b.setAttribute("aria-checked", String(b.dataset.vehicle === driverVehicle)));
  driverCard.classList.toggle("bus-vehicle", road);
  startScreen.dataset.homeVehicle = driverVehicle;
  $("busDriverNote").hidden = !road;
  $("driverGo").firstChild.textContent = road ? "Manejar " : "Conducir ";
  $("busRouteLabel").textContent = driverVehicle === "taxi" ? "Calle" : "Recorrido";
  renderBusRouteInfo?.();
  if (fromLine) return;
  const wanted = VEHICLE_LINE[driverVehicle];
  if (wanted && driverLineSelect.value !== wanted) selectLine(wanted);
  if (driverVehicle === "metro" && isRail(driverLineSelect.value)) selectLine(lineById(loadSetting("metrosim.metroLine")) ? loadSetting("metrosim.metroLine") : "3");
}
vehicleButtons.forEach(b => b.addEventListener("click", () => { selectVehicle(b.dataset.vehicle); selectMode("driver"); }));

/* 1.18 · Bus: qué recorrido manejar (el A01 de práctica o un tramo real de Red, de js/bus/redRoutes.js)
   2.9 · Se elige con botones y una ficha del recorrido, igual que las líneas al conducir el Metro.
   2.9.1 · El taxi no elige recorridos de bus sino calles: una por nombre (el tramo más largo de esa calle). */
const busRouteSelect = $("busRouteSelect");
busRouteSelect.innerHTML = BUS_ROUTES.map(r => `<option value="${r.id}">${r.id}</option>`).join("");
const TAXI_YELLOW = "#f2c200";
/* 2.9.2 · Calles con dos tramos lejos uno del otro: se separan con el sector (los de la Alameda se cruzan y van juntos) */
const TAXI_SECTOR = { "211": "La Granja", "712": "Macul", "507": "Estación Central", "506": "Ñuñoa", "430": "El Golf", "C02": "Los Dominicos" };
const streetName = (r) => {
  const name = r.name.replace(/^Gran Av\.$/, "Gran Avenida"), sector = TAXI_SECTOR[r.id];
  return sector ? `${name.replace(/^Av\. (?=Américo)/, "")} · ${sector}` : name;
};
const TAXI_STREETS = [...BUS_ROUTES.filter(r => r.real).reduce((m, r) => {
  const k = streetName(r), cur = m.get(k);
  if (!cur || r.length > cur.length) m.set(k, r);
  return m;
}, new Map()).values()].sort((x, y) => streetName(x).replace(/^Av\. /, "").localeCompare(streetName(y).replace(/^Av\. /, ""), "es"));
const taxiStreetOf = (id) => { const r = busRouteById(id); return TAXI_STREETS.find(t => streetName(t) === streetName(r)) ?? TAXI_STREETS[0]; };
let busRouteChips = [], chipsFor = null;
/** Los botones: números de recorrido para el bus, nombres de calle para el taxi. */
function renderBusChips() {
  const taxi = driverVehicle === "taxi";
  if (chipsFor === taxi) return;
  chipsFor = taxi;
  busRouteSelect.value = taxi ? taxiStreetOf(loadSetting("metrosim.taxiStreet") || "210").id : busRouteById(loadSetting("metrosim.busRoute") || "A01").id;
  const box = $("busRouteChips");
  box.classList.toggle("taxi-chips", taxi);
  box.replaceChildren();
  busRouteChips = (taxi ? TAXI_STREETS : BUS_ROUTES).map(r => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "line-chip bus-chip";
    chip.setAttribute("role", "radio");
    const c = taxi ? TAXI_YELLOW : r.color;
    chip.style.setProperty("--c", c);
    chip.style.setProperty("--on-c", textOn(c));
    chip.dataset.route = r.id;
    if (taxi) {
      const [street, sector] = streetName(r).split(" · ");
      chip.innerHTML = sector ? `${street}<small>${sector}</small>` : street;
    } else chip.textContent = r.id;
    chip.title = taxi ? `${streetName(r)}: ${r.from} ⇄ ${r.to}` : `${r.id} · ${r.practice ? "Práctica · " : ""}${r.name}: ${r.from} → ${r.to}`;
    chip.setAttribute("aria-label", chip.title);
    chip.addEventListener("click", () => selectBusRoute(r.id));
    box.append(chip);
    return chip;
  });
}
function selectBusRoute(id) {
  busRouteSelect.value = busRouteById(id).id;
  saveSetting(driverVehicle === "taxi" ? "metrosim.taxiStreet" : "metrosim.busRoute", busRouteSelect.value);
  renderBusRouteInfo();
}
const kmText = (m) => `${(m / 1000).toFixed(1).replace(".", ",")} km`;
function renderBusRouteInfo() {
  renderBusChips();
  const r = busRouteById(busRouteSelect.value), st = r.stops, first = st[0], last = st.at(-1);
  busRouteChips.forEach(c => c.setAttribute("aria-checked", String(c.dataset.route === r.id)));
  const card = $("busCard");
  const taxi = driverVehicle === "taxi";
  card.style.setProperty("--line", taxi ? TAXI_YELLOW : r.color);
  card.style.setProperty("--on-line", textOn(taxi ? TAXI_YELLOW : r.color));
  $("busCardBadge").textContent = taxi ? "Taxi" : `${r.real ? "Red" : "Práctica"} · ${r.id}`;
  $("busCardRoute").textContent = taxi ? streetName(r) : `${first.name} ⇄ ${last.name}`;
  $("busCardStopsLabel").textContent = taxi ? "Semáforos" : "Paraderos";
  $("busCardFirst").textContent = first.name;
  $("busCardLast").textContent = last.name;
  $("busCardStops").textContent = taxi ? r.lights.length : st.length;
  $("busCardLength").textContent = kmText(r.length);
  $("busCardMetro").textContent = st.filter(s => s.metro).length;
  const map = $("busCardMap"), span = last.s - first.s || 1;
  map.querySelectorAll("i").forEach(d => d.remove());
  for (const s of st) {
    const dot = document.createElement("i");
    if (taxi && !s.metro) continue;                     // el taxi no tiene paraderos: solo las estaciones de Metro
    if (s.metro) dot.className = "combo";
    dot.style.left = `${((s.s - first.s) / span) * 100}%`;
    dot.title = s.name + (s.hint ? ` · ${s.hint}` : "");
    map.append(dot);
  }
  if (taxi) {
    $("busRouteInfo").textContent = `Taxi por ${streetName(r)} (${kmText(r.length)} de calle, de ${first.name} a ${last.name}): recoge a quien haga señas en la vereda y llévalo a su destino. Cobras lo que marca el taxímetro y, si el viaje es suave, propina.`;
    return;
  }
  $("busRouteInfo").textContent = r.practice
    ? "Recorrido de práctica A01 (ficticio) por la Alameda, de Estación Central a Plaza Baquedano."
    : `Tramo real del ${r.id} de Red por ${r.name}, hacia ${r.destino}${r.operador ? ` (${r.operador})` : ""}.`;
}
renderBusRouteInfo();

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
selectVehicle(driverVehicle);
directionSelect.addEventListener("change", renderDirections);

/** Elige la línea para los dos modos: botones, ficha de la línea, servicios, estaciones y color de acento. */
function selectLine(id) {
  const line = lineById(id);
  driverLineSelect.value = paxLineSelect.value = line.id;
  saveSetting("metrosim.line", line.id);
  if (!isRail(line.id)) saveSetting("metrosim.metroLine", line.id);
  // Los botones NOS y RCG eligen ese tren de EFE; una línea del Metro vuelve al tren del Metro (el bus no cambia)
  if (driverVehicle !== "bus" && driverVehicle !== "taxi" && vehicleOfLine(line.id) !== driverVehicle) selectVehicle(vehicleOfLine(line.id), { fromLine: true });
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
  $("lineCardBadge").textContent = lineLabel(line.id);
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
    dot.title = s.name + (s.combos.length ? ` · combinación ${s.combos.map(lineTag).join(", ")}` : "");
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
    chip.innerHTML = lineSign(l.id) + (locked ? icon("lock", "chip-lock") : "");
    chip.title = `${l.name} · ${l.stations[0].name} ⇄ ${l.stations.at(-1).name}` + (locked ? " · conducir requiere licencia" : "");
    chip.setAttribute("aria-label", chip.title);
  }
  const id = driverLineSelect.value, lic = LICENSES.find(x => x.lineId === id), lock = $("driverLock");
  lock.hidden = inventory.canDrive(id);
  if (lic) lock.innerHTML = `${icon("lock")} Para conducir esta línea necesitas su licencia (${formatCLP(lic.price)}). La Línea 3 es gratis.`;
  $("startBank").textContent = formatCLP(bank.balance);
}

/* Tarjetas de modo: la elegida muestra sus opciones; su botón empieza la partida */
/* 2.0 · Portada en dos pasos: 1) qué quieres hacer · 2) prepararlo y Jugar */
const modeCards = [...document.querySelectorAll(".mode-card")];
const MODE_TITLES = { driver: "Conducir", passenger: "Viajar", control: "Centro de Control" };
function selectMode(mode) {
  modeCards.forEach(c => c.classList.toggle("selected", c.dataset.card === mode));
  startScreen.dataset.homeMode = mode;
  // 2.18 · El Metro Valparaíso (bonus) solo se conduce o se supervisa: como pasajero se vuelve a una línea de Santiago
  if (mode !== "driver" && lineById(driverLineSelect.value)?.bonus) selectLine(lineById(loadSetting("metrosim.metroLine")) ? loadSetting("metrosim.metroLine") : "3");
  $("setupTitle").textContent = MODE_TITLES[mode] || "";
  saveSetting("metrosim.mode", mode);
}
/** Paso de la portada (1: elegir qué hacer · 2: prepararlo). */
function homeStep(n) {
  startScreen.dataset.step = String(n);
  startScreen.scrollTop = 0;
  const focus = n === 2 ? [...startScreen.querySelectorAll(".home-setup .go-big")].find(b => b.offsetParent) : startScreen.querySelector(`.mode-card[data-card="${startScreen.dataset.homeMode}"]`);
  focus?.focus({ preventScroll: true });
}
modeCards.forEach(card => {
  const pick = () => { selectMode(card.dataset.card); homeStep(2); };
  card.addEventListener("click", pick);
  card.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
});
$("homeBack").addEventListener("click", () => homeStep(1));
window.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || game || startScreen.classList.contains("hidden") || startScreen.dataset.step !== "2") return;
  if (fareInfoOpen() || riderPanelOpen() || document.querySelector(".shop-overlay:not(.hidden), .ticket-panel:not(.hidden)")) return;
  homeStep(1);
});
selectMode(modeCards.some(c => c.dataset.card === loadSetting("metrosim.mode")) ? loadSetting("metrosim.mode") : "driver");

/** «Seguir donde quedaste»: repite lo último que se jugó con lo elegido entonces (se guarda al empezar). */
function renderResume() {
  const last = loadSetting("redmovisim.lastPlay"), btn = $("homeResume");
  btn.hidden = !MODE_TITLES[last];
  if (btn.hidden) return;
  let text = MODE_TITLES[last];
  if (last === "driver") {
    if (driverVehicle === "bus") text += ` · Bus ${busRouteById(busRouteSelect.value).id}`;
    else if (driverVehicle === "taxi") text += ` · Taxi por ${streetName(busRouteById(busRouteSelect.value))}`;
    else text += ` · ${lineLabel(driverLineSelect.value)} · ${directionSelect.selectedOptions[0]?.textContent.split(" · ")[1] || ""}`;
  } else if (last === "passenger") text += ` · desde ${stationSelect.selectedOptions[0]?.textContent.trim().replace(/\s+\(.*$/, "") || ""}`;
  $("homeResumeText").textContent = text;
  btn.onclick = () => { selectMode(last); firstAskThen(() => startGame(last)); };
}
renderResume();
// Al volver a la portada (fin de partida, menú): se actualiza «Seguir donde quedaste» y se parte del paso 1
// (salvo que haya un aviso de la sala multijugador, que se lee en el paso 2)
new MutationObserver(() => {
  if (startScreen.classList.contains("hidden")) return;
  renderResume();
  if (!$("netJoinMsg").textContent) homeStep(1);
}).observe(startScreen, { attributes: true, attributeFilter: ["class"] });

/** Tienda RedMovi: desde la pantalla de inicio o con K durante el juego. */
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
    new Option(st.name + (st.combos.length ? `  (${st.combos.map(lineTag).join(", ")})` : ""), st.index)));
  const preferred = line.stations.find(s => s.name === "UNIVERSIDAD DE CHILE")
    || [...line.stations].sort((a, b) => b.combos.length - a.combos.length)[0];
  stationSelect.value = String(preferred.index);
}

/** Flota, tramos al aire libre y Ruta Expresa de una línea (ficha de la portada, 1.5). */
function lineRealismText(line) {
  const fleet = LINE_FLEETS[line.id] || [];
  const rubber = STOCKS[fleet[0]?.[0]]?.tyre === "rubber";
  const parts = [`Trenes ${fleet.map(([m]) => STOCKS[m]?.model || m).join(", ")} (${rubber ? "neumáticos" : "rueda de acero"}).`];
  const open = {};
  for (const sp of line.sectionsInfo?.spans || []) {
    if (sp.type === "tunel") continue;
    const a = Math.min(sp.zA, line.stations[0].z), b = Math.max(sp.zB, line.stations.at(-1).z);
    if (a > b) open[sp.type] = (open[sp.type] || 0) + (a - b);
  }
  const km = Object.entries(open).filter(([, m]) => m > 300).map(([t, m]) => `${t === "trinchera" && line.atGrade ? "a nivel del suelo" : SECTION_LABEL[t]} ${(m / 1000).toFixed(1).replace(".", ",")} km`);   // 2.19 · el Merval va a nivel
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
    btn.innerHTML = `<b></b><span></span>`;
    // Ícono arriba y nombre abajo («Real» muestra el ícono del tiempo de ahora)
    const now = realWeather?.kind || typicalWeather(new Date()).kind;
    btn.firstChild.textContent = WEATHER_KINDS[id === "real" ? now : id]?.icon || "📍";
    btn.lastChild.textContent = id === "real" ? "Ahora" : id === "despejado" ? "Sol" : WEATHER_KINDS[id].label;
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
let clockBandShown = null;              // tramo mostrado en la portada (para animar el cambio)
renderClock();
setInterval(() => { if (!game) renderClock(); }, 10000);

/* ---------- Hora y tramo tarifario en la portada (1.8) ---------- */

let hudBandShown = null;
/** Punto de color del tramo vigente junto a la HORA del HUD (y la hora del panel de tarifas, si está abierto). */
function updateHudClockBand() {
  tickFareInfo(game.clock);
  const state = inService(game.clock) ? fareBandAt(game.clock).id : "closed";
  if (state === hudBandShown) return;
  hudBandShown = state;
  $("hudClockBand").className = `hud-clock-band ${state}`;
}

/** "HH:MM" de una hora en horas decimales o de un Date. */
function hhmm(x) {
  const m = x instanceof Date ? x.getHours() * 60 + x.getMinutes() : Math.round(x * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Reloj de la portada: la hora del dispositivo (la misma con la que arranca el juego) y el tramo que se cobra. */
function renderClock() {
  const el = $("clockNow");
  if (!el) return;
  const now = new Date(), day = dayTypeOf(now);
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const open = inService(t, day), band = fareBandAt(t, day);
  $("clockTime").textContent = hhmm(now);

  const chip = $("clockBand"), state = open ? band.id : "closed";
  chip.className = `clock-band ${state}`;
  if (clockBandShown && clockBandShown !== state) { void chip.offsetWidth; chip.classList.add("changed"); }
  clockBandShown = state;
  $("clockBandLabel").textContent = open ? band.label : "Metro cerrado";
  const special = riderSpecial();
  $("clockBandPrice").textContent = open ? (special ? `${formatCLP(special.price)} ${special.card}` : formatCLP(band.price)) : "";

  let note;
  if (open) {
    // Próximo cambio: de tramo o el cierre, buscando minuto a minuto
    let next = null;
    for (let m = 1; m <= 24 * 60 && !next; m++) {
      const u = t - now.getSeconds() + m * 60;
      if (!inService(u, day)) next = `cierra a las ${hhmm(u / 3600)}`;
      else if (fareBandAt(u, day) !== band) next = `pasa a ${fareBandAt(u, day).label.toLowerCase()} a las ${hhmm(u / 3600)}`;
    }
    note = `${DAY_TYPE_LABEL[day]}${day !== "laboral" ? " · tarifa valle todo el día" : ""}${next ? ` · ${next}` : ""}`;
  } else {
    const h = t / 3600, today = SERVICE_HOURS[day];
    const opensAt = h < today[0] ? today[0] : SERVICE_HOURS[dayTypeOf(new Date(+now + 86400000))][0];
    const pay = special || band;
    note = `Abre a las ${hhmm(opensAt)} · puedes jugar igual: se cobra ${pay.label.toLowerCase()} (${formatCLP(pay.price)})`;
  }
  $("clockNote").textContent = note;
}

function loadSetting(key) { try { return localStorage.getItem(key); } catch { return null; } }
function saveSetting(key, value) { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } }

/** Activa la línea elegida: su mundo 3D, sus trenes, su interfaz y su color. */
function useLine(line) {
  setActiveLine(line);
  hud.setLine();
  setLoadingHead(lineSign(line.id), `Preparando ${lineArticle(line.id)} ${lineLabel(line.id)}…`);
}
/** 2.19.1 · Rótulo de la pantalla de carga: el letrero (línea, recorrido o TAXI) y el título. */
function setLoadingHead(badge, title, kind = "") {
  const b = $("loadingBadge");
  b.textContent = badge;
  b.dataset.kind = kind;              // "bus" / "taxi": colores propios (styles.css)
  $("loadingTitle").textContent = title;
}

// 1.10 · La primera vez que se juega, antes de empezar se pregunta la fecha de nacimiento (tarifas TNE y adulto mayor)
setupRiderPanel();
function firstAskThen(go) {
  if (riderAsked()) return go();
  openRiderPanel({ first: true, done: () => { renderClock(); go(); } });
}
document.querySelectorAll("[data-mode]").forEach(btn => btn.addEventListener("click", () => firstAskThen(() => startGame(btn.dataset.mode))));
// "¿Primera vez? Con tutorial" de cada modo: juega ese modo con el tutorial interactivo desde el principio
document.querySelectorAll("[data-tutorial]").forEach(btn => btn.addEventListener("click", () => firstAskThen(() => startGame(btn.dataset.tutorial, { tutorial: true }))));
$("backButton").addEventListener("click", requestMenu);
// 1.9 · Tocar la hora (portada o HUD) abre las tarifas según el horario
setupFareInfo();
function showFares() {
  if (game) {
    const w = game.walker, wasFrozen = w?.frozen;
    if (w) { w.frozen = true; w.keys.clear(); }
    if (document.pointerLockElement) document.exitPointerLock?.();
    openFareInfo({ clock: game.clock, dayType: CONFIG.dayType, onChange: () => hud.setCard(card), onClose: () => { if (w && game?.walker === w && !wasFrozen && !confirmOpen) { w.frozen = false; w.keys.clear(); } } });
  } else {
    const now = new Date();
    openFareInfo({ clock: now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(), dayType: dayTypeOf(now), onChange: renderClock });
  }
}
$("clockNow").addEventListener("click", showFares);
$("clockNow").addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); showFares(); } });
$("hudClock").addEventListener("click", (ev) => { ev.currentTarget.blur(); showFares(); });
window.addEventListener("keydown", (ev) => { if (!game && !riderPanelOpen() && fareInfoOpen() && ev.key === "Escape") closeFareInfo(); });
$("confirmOk").addEventListener("click", () => closeConfirm(true));
$("confirmCancel").addEventListener("click", () => closeConfirm(false));
$("confirmPanel").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeConfirm(false); });
$("driverJobButton").addEventListener("click", goDriveForMoney);
$("netJoinToggle").addEventListener("click", () => {
  const panel = $("netJoin");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) { $("netName").value ||= loadSetting("metrosim.net.name") || ""; ($("netName").value ? $("netCode") : $("netName")).focus(); }
});
$("netJoinGo").addEventListener("click", joinRoomAsDriver);
$("netLevel").textContent = `Versión de red ${NET_LEVEL}.`;
$("netCode").addEventListener("keydown", (ev) => { if (ev.key === "Enter") joinRoomAsDriver(); });
$("endShiftButton").addEventListener("click", requestEndShift);
$("shopButton").addEventListener("click", () => openStore());
$("soundButton").addEventListener("click", toggleSound);
$("helpChip").addEventListener("click", () => hud.toggleHelp());
$("menuButton").addEventListener("click", (ev) => { ev.currentTarget.blur(); openGameMenu(); });
$("gameMenu").addEventListener("click", (ev) => {
  if (ev.target === ev.currentTarget) return closeGameMenu();
  const act = ev.target.closest("[data-act]")?.dataset.act;
  if (act) gameMenuAction(act);
});
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", onResize);

// Pantallas táctiles: se ocultan las ayudas de teclado
if (wantsTouch()) document.body.classList.add("touch-mode");

// Acceso de depuración desde la consola: MetroSim.game.traffic, etc.
window.MetroSim = window.RedMoviSim = { get game() { return game; }, get bus() { return bus; }, hud, bank, card, CONFIG, get STATIONS() { return STATIONS; }, get ROUTES() { return ROUTES; }, LINES };


/* ==========================================================================
   Inicio y fin de partida
   ========================================================================== */

/* Multijugador: conducir en la sala de un Centro de Control (net/netClient.js) */
let joining = false;
async function joinRoomAsDriver() {
  if (joining) return;
  const msg = $("netJoinMsg"), btn = $("netJoinGo");
  const code = cleanRoomCode($("netCode").value);
  const name = $("netName").value.trim().slice(0, 16) || "Conductor";
  if (!code) { msg.textContent = "Escribe el código de 4 letras que te dio el Centro de Control"; return; }
  if (!inventory.canDrive(driverLineSelect.value)) return startGame("driver");     // muestra la licencia que falta
  saveSetting("metrosim.net.name", name);
  // Sonido y pantalla completa se piden ahora, dentro del clic (después de esperar a la red ya no se puede)
  const audio = new AudioSystem();
  audio.muted = muted;
  audio.start();
  if (wantsTouch()) enterMobileFullscreen();
  joining = true;
  btn.disabled = true;
  msg.textContent = localNetwork() ? `Modo local (?red=local): buscando la sala ${code} en otra pestaña de este navegador…` : `Conectando con la sala ${code}…`;
  // 2.19.1 · Mientras responde el Centro de Control se ve la pantalla de carga (antes quedaba la portada quieta)
  const line = lineById(driverLineSelect.value);
  setLoadingHead(lineSign(line.id), `Sala ${code}`);
  startScreen.classList.add("hidden");
  showLoading();
  setLoading(0.03, msg.textContent);
  try {
    const net = await joinDriverRoom(code, { name, line: driverLineSelect.value, dir: directionSelect.value });
    msg.textContent = "";
    startGame("driver", { net, audio });
  } catch (err) {
    audio.stop();
    exitMobileFullscreen();
    loadingScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    useLine(lineById(paxLineSelect.value));           // devuelve el rótulo de la pantalla de carga
    msg.textContent = err.message;
  } finally {
    joining = false;
    btn.disabled = false;
  }
}

function startGame(mode, opts = {}) {
  if (game) stopGame();
  if (!opts.tutorial && MODE_TITLES[mode]) saveSetting("redmovisim.lastPlay", mode);
  if (mode === "bus" || (mode === "driver" && driverVehicle === "bus" && !opts.net && !opts.tutorial)) return startBus();
  if (mode === "driver" && driverVehicle === "taxi" && !opts.net) return startBus({ taxi: true });
  if (mode === "control") return startControl(opts);
  if (mode === "driver" && !inventory.canDrive(driverLineSelect.value)) {
    const lic = LICENSES.find(x => x.lineId === driverLineSelect.value);
    return openStore({ tab: "driver", notice: `Para conducir la ${lic.name.replace("Licencia ", "")} necesitas su licencia (${formatCLP(lic.price)}). La Línea 3 es gratis: gana ahí tu primer sueldo.` });
  }
  useLine(lineById(mode === "driver" ? driverLineSelect.value : paxLineSelect.value));
  const stationIndex = Number(stationSelect.value) || 0;
  // En una sala, el sentido es el del servicio que asignó el Centro de Control
  const direction = opts.net ? [ROUTE_A, ROUTE_B].find(r => r.id === opts.net.welcome.trip.r) : directionSelect.value === "B" ? ROUTE_B : ROUTE_A;
  startScreen.classList.add("hidden");
  showLoading();
  let audio = opts.audio;
  if (!audio) {
    if (wantsTouch()) enterMobileFullscreen();     // dentro del gesto del usuario
    audio = new AudioSystem();                     // dentro del gesto del usuario
    audio.muted = muted;
    audio.start();
  }
  setTimeout(() => buildGame(mode, stationIndex, audio, direction, opts), 40);
}

/* 1.10.2 · Barra de la pantalla de carga: avanza con lo que de verdad lleva armado la partida */
const loadingFill = $("loadingFill"), loadingPct = $("loadingPct"), loadingText = $("loadingText");
function setLoading(frac, text) {
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  loadingFill.style.width = `${pct}%`;
  loadingPct.textContent = `${pct} %`;
  loadingFill.parentElement.setAttribute("aria-valuenow", pct);
  if (text) loadingText.textContent = text;
}
/** Suelta el hilo para que el navegador dibuje la barra (con la pestaña oculta no hay fotogramas: sigue igual). */
const paintPause = () => new Promise(resolve => {
  const t = setTimeout(resolve, 60);
  requestAnimationFrame(() => { clearTimeout(t); setTimeout(resolve, 0); });
});
/**
 * Simula el motor hasta `time` en tramos, soltando el hilo cada ~40 ms para mover la barra
 * entre `from` y `to`. Mismos pasos que un solo runUntil. Devuelve false si se canceló.
 */
async function warmUp(engine, time, { from, to, text, onStep, alive = () => true }) {
  const t0 = engine.time, span = Math.max(1, time - t0), CHUNK = 30;
  let k = 0, mark = performance.now();
  while (engine.time < time) {
    engine.runUntil(Math.min(time, t0 + ++k * CHUNK), { onStep });
    if (performance.now() - mark > 40) {
      setLoading(from + (to - from) * (engine.time - t0) / span, text);
      await paintPause();
      if (!alive()) return false;
      mark = performance.now();
    }
  }
  setLoading(to, text);
  return true;
}
const showLoading = () => { setLoading(0, "Empezando…"); loadingScreen.classList.remove("hidden"); };

async function buildGame(mode, stationIndex, audio, direction = ROUTE_A, opts = {}) {
  setLoading(0.02, "Preparando el dibujo 3D");
  await paintPause();
  if (game) return;                                  // otra partida ganó la carrera
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

  /* --- Hora local: la partida empieza "ahora" (en una sala, a la hora del Centro de Control) --- */
  const net = opts.net || null;
  let startClock = localClock();
  const startEpoch = performance.now();
  if (net) {
    // Mismo tipo de día, mismas mallas de horario, misma hora y mismo tiempo que el anfitrión
    startClock = net.hostTime();
    CONFIG.dayType = net.welcome.dayType;
    CONFIG.startTime = net.welcome.start;
    CONFIG.schedule.playerDeparture = net.welcome.dep;
    setWeather(net.welcome.weather.kind, { temp: net.welcome.weather.temp, source: "elegido" });
  } else {
    CONFIG.startTime = startClock;
    CONFIG.schedule.playerDeparture = Math.ceil((startClock + 15) / 5) * 5;     // tu servicio sale en ~15–20 s
  }

  /* --- Motor MetroSim (el "cerebro") y su dibujo --- */
  setLoading(0.08, "Construyendo túneles y estaciones");
  await paintPause();
  setTrackLiftLine();                                         // cotas de la línea activa (pendientes en 3D)
  const world = new World(scene);
  setLoading(0.3, "Levantando viaductos y el cielo");
  await paintPause();
  const outdoor = new OutdoorView(scene);                     // viaductos, trincheras, cielo y lluvia (1.5)
  setLoading(0.38, "Poniendo en marcha la red");
  await paintPause();
  const warmStart = startClock - 45 * 60;
  const engine = new MetroEngine({ startTime: warmStart });
  if (net) engine.replica = true;                             // los demás trenes y los incidentes los manda el anfitrión
  const { traffic, signals, timetables } = engine;
  // El juego escucha al motor por su bus: sucesos y cambios de estado de cada tren
  engine.bus.on("train:event", ({ unit, type, data }) => onUnitEvent(unit, type, data));
  engine.bus.on("train:state", (change) => onTrainState(change));
  engine.bus.on("command:result", (r) => onCommandResult(r));
  engine.bus.on("incident", (inc) => onIncident(inc));
  const trainViews = new TrainViews(scene, engine.bus);       // dibuja los trenes que crea el motor
  trainViews.onCreate = onTrainModel;          // modelo rehecho (cambio de cabina, cambio de vía): cámara, luces y librea
  const signalViews = new SignalViews(scene, signals.values());
  const playerTrip = net ? net.trip(engine) : timetables.get(direction.id).anchorTrip;

  const g = game = {
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
  // Músicos en los andenes y comerciantes ambulantes en la mezanina (todos los modos)
  game.performers = new PerformerSystem({ scene, people, audio, say: (text, level, ms) => mode !== "driver" && game && hud.showMessage(text, level, ms) });
  const warmed = await warmUp(engine, startClock, {
    from: 0.42, to: 0.8, text: "Poniendo trenes y pasajeros en servicio", alive: () => game === g,
    onStep: (step, t) => people.update(step, t, { cameraZ: 1e9, render: false }),
  });
  if (!warmed) return;
  setLoading(0.82, mode === "driver" ? "Preparando tu cabina" : "Armando la calle y la estación");
  await paintPause();
  if (game !== g) return;
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
    // En una sala, el andén de origen puede estar ocupado por el tren anterior: entonces se sale de la cochera
    const start = net ? startPoint(engine, direction) : direction.first;
    const player = traffic.createUnit(playerTrip, { isPlayer: true, start });
    if (start === direction.first) player.arrivedIdx = player.dockedIdx = 0;
    game.player = player;
    applyLivery(player);
    game.score = newScore(direction);
    game.driverRole = new DriverRole(engine, () => game?.player);
    game.safety = new DriverSafety({
      scene, audio, signals,
      radioPcc: () => !!game?.net?.connected,           // en una sala, las señales averiadas las autoriza el jugador del PCC
      notify: (text, level, ms) => hud.showMessage(text, level, ms),
      penalty: (kind) => game?.score.penalty(kind),
    });
    const rig = new CameraRig(camera, trainHead(player));
    rig.setView("cab");
    rig.attach(renderer.domElement);
    game.rig = rig;
    attachScreenTap(renderer.domElement, camera);
    trainHead(player).add(game.trainLights);
    game.lightsUnit = player;
    setTimeout(() => game?.player === player && hud.showMessage(driverBriefing(player), "info", 9000), 1500);
    if (net) {
      const badge = document.createElement("div");
      badge.className = "net-badge";
      gameScreen.append(badge);
      game.net = net;
      net.attach(game, {
        badge,
        notify: (text, level, ms) => game && hud.showMessage(text, level, ms),
        radio: (speech, text, level) => game?.safety.pcc(speech, text, level),
      });
      if (start !== direction.first) {
        setTimeout(() => game?.player === player && hud.showMessage(`El andén de ${direction.first.name} está ocupado: sales de la cochera · entra cuando la señal lo permita`, "info", 8000), 11000);
      }
    }
  } else {
    const city = new City(scene, renderer);
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
      people: game.people, performers: game.performers, walker, engine, line: ROUTE_A.line, civics, audio,
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
    // 2.7 · La calle real de la estación (si tiene) se descarga antes de aparecer en ella; las de la línea, después
    if (!opts.transferFrom) {
      setLoading(0.97, "Armando la calle");
      await loadRealStreet(STATIONS[stationIndex].name);
      if (!game) return;
    }
    const lineStreets = STATIONS.map(st => st.name);
    setTimeout(() => prefetchStreets([...lineStreets.slice(stationIndex), ...lineStreets.slice(0, stationIndex).reverse()]), 4000);
    if (opts.transferFrom) arriveByTransfer(STATIONS[stationIndex], opts.transferFrom);   // llega por el pasillo de combinación
    else goToStreet(STATIONS[stationIndex]);     // la partida empieza en la calle
    game.missions.ensure(missionCtx());
  }

  // Precompila los shaders para evitar tirones la primera vez que se ve cada cosa
  setLoading(0.92, "Preparando luces y materiales");
  await paintPause();
  if (game !== g) return;
  renderer.compile(scene, camera);
  setLoading(1, "¡Listo!");

  hud.setMode(mode);
  $("endShiftButton").classList.toggle("hidden", mode !== "driver");
  // El conductor no tiene botón de Menú: sale con Finalizar turno (informe → Menú) o con "atrás"
  $("backButton").classList.toggle("hidden", mode === "driver");
  // La ayuda de controles se muestra al empezar y se oculta sola (H la vuelve a mostrar)
  $("controlsHelp").classList.remove("hidden");
  setTimeout(() => game && $("controlsHelp").classList.add("hidden"), 12000);

  // Controles táctiles (celular / tablet): cada botón equivale a su tecla
  if (wantsTouch()) {
    game.touch = new TouchControls({ mode, parent: gameScreen, canvas: renderer.domElement, press: pressKey, walker: game.walker, context: touchContext, onMenu: openGameMenu });
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
      onFinish: () => { if (game) { game.tutorial = null; hud.showMessage(`Tutorial completado${keyText(" · H muestra los controles")} · se repite desde la portada`, "ok", 5000); } },
    });
  }

  if (opts.fromBus) {
    $("controlsHelp").classList.add("hidden");
    hud.fadeIn();
    hud.showMessage(`Bajaste del bus en ${opts.fromBus} · calle de ${STATIONS[stationIndex].name} · el acceso al Metro está en esta vereda`, "ok", 6500);
  } else if (opts.transferFrom) {
    $("controlsHelp").classList.add("hidden");
    hud.fadeIn();
    hud.showMessage(`Combinación desde ${lineArticle(opts.transferFrom)} ${lineLabel(opts.transferFrom)} · ${STATIONS[stationIndex].name} · ${lineLabel(LINE.id)} · sigues en zona pagada`, "ok", 6000);
  } else hud.showMessage(mode === "driver"
    ? `${net ? `Sala ${net.code} · ` : ""}Servicio ${playerTrip.id} · ${direction.label} · salida ${formatClock(playerTrip.departure)} · cada estación bien servida te paga en tu cuenta`
    : `Calle de ${STATIONS[stationIndex].name} · cuenta ${bank.label} · ${game.touch ? "joystick para caminar · arrastra para mirar · 🎯 misiones" : "W/S caminar · A/D girar · Shift correr · J misiones"}`, "info", 7000);

  game.raf = requestAnimationFrame(loop);
  armBackTrap();
  keepScreenOn();
}

function stopGame({ keepFullscreen = false } = {}) {
  if (!game) return;
  busStopPanel?.remove();
  busStopPanel = null;
  closeFareInfo();
  if (game.net) { game.net.leave(); applyWeatherChoice(); }     // sale de la sala y vuelve al tiempo elegido
  game.touch?.destroy();
  hud.setTurnPanel(null);
  game.tutorial?.destroy();
  cancelAnimationFrame(game.raf);
  game.audio.stop();
  game.walker?.detach();
  game.scene.traverse(obj => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach(m => { m.map?.dispose(); m.dispose(); });
  });
  game.renderer.forceContextLoss();       // 2.15.4 · libera el contexto WebGL (si no, se acumulan al cambiar de modo)
  game.renderer.dispose();
  gameContainer.replaceChildren();
  setCabScreens(false);
  game = null;
  confirmOpen = false;
  $("confirmPanel").classList.add("hidden");
  gameMenuOpen = false;
  $("gameMenu").classList.add("hidden");
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

/* 1.13 · Conductor de bus (beta, antes «MicroSim»): el modo bus tiene su propia pantalla y su propio ciclo (js/bus/) */
let bus = null;
/** 2.9.3 · Al taxi se le pasa la calle con su sector (p. ej. «Av. Matta · Ñuñoa») para el letrero de arriba y los avisos. */
const taxiRoute = (r, taxi) => taxi ? { ...r, name: streetName(r) } : r;
let busStarting = false;
/** 2.19.1 · Pantalla de carga del bus y el taxi: armar la calle traba unos segundos, así se ve qué pasa. */
const busLoading = {
  show(text) {
    showLoading();
    setLoading(0.15, text);
    return paintPause();
  },
  /** Se esconde tras el segundo cuadro: el primero compila los materiales (es el que más traba). */
  hide() {
    setLoading(0.95, "Preparando luces y materiales");
    requestAnimationFrame(() => requestAnimationFrame(() => { setLoading(1, "¡Listo!"); loadingScreen.classList.add("hidden"); }));
  },
};
function startBus({ ride = null, taxi = false } = {}) {
  if (bus || busStarting) return;
  startScreen.classList.add("hidden");
  if (wantsTouch()) enterMobileFullscreen();       // dentro del gesto del usuario
  const route = ride ? ride.route : taxiRoute(busRouteById(busRouteSelect.value), taxi);
  const isTaxi = taxi && !ride;
  setLoadingHead(isTaxi ? "TAXI" : route.id, isTaxi ? "Preparando tu taxi…" : ride ? `Subiendo al ${route.id}…` : `Preparando el ${route.id}…`, isTaxi ? "taxi" : "bus");
  // El sonido se enciende ahora, dentro del gesto del usuario (después de la espera el navegador puede negarlo)
  const audio = new BusAudio();
  audio.muted = muted;
  audio.start({ rain: WEATHER.rain });
  busStarting = true;
  busLoading.show(ride ? `Esperando el bus en el paradero de ${route.stops?.[ride.from]?.name ?? route.from}` : isTaxi ? `Armando ${streetName(route)} y su tráfico` : `Armando el recorrido ${route.from} → ${route.to}`).then(() => {
    busStarting = false;
    if (bus || game) return audio.stop();
    startBusNow({ ride, taxi, route, audio });
    busLoading.hide();
  });
}
function startBusNow({ ride, taxi, route, audio }) {
  bus = startBusGame({
    bank, muted, touch: wantsTouch(), ride, taxi, route: ride ? null : route, audio, loading: busLoading,
    onMuteChange: (m) => { muted = m; saveSetting("metrosim.muted", m ? "1" : "0"); hud.setSound(!m); },
    onExit: () => {
      bus = null;
      startScreen.classList.remove("hidden");
      refreshDriverLines();                        // saldo al volver a la portada
      exitMobileFullscreen();
      disarmBackTrap();
      releaseScreen();
    },
  });
  armBackTrap();
  keepScreenOn();
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
  else if (accountOpen()) closeAccount();
  else if (feedbackOpen()) closeFeedback();
  else if (confirmOpen) closeConfirm(false);
  else if (riderPanelOpen()) closeRiderPanel();
  else if (fareInfoOpen()) closeFareInfo();
  else if (busStopPanel) { closeBusStop(); armBackTrap(); }
  else if (bus) { bus.requestExit(); if (bus) armBackTrap(); }   // MicroSim: pausa (y desde la pausa, portada)
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
  showLoading();
  setTimeout(async () => {
    setLoading(0.05, "Encendiendo el Centro de Control");
    await paintPause();
    // Hora local, igual que en los otros modos
    const startClock = localClock();
    CONFIG.startTime = startClock;
    CONFIG.schedule.playerDeparture = Math.ceil((startClock + 90) / 30) * 30;
    const engine = new MetroEngine({ startTime: startClock - 45 * 60 });
    // La red ya tiene trenes al empezar el turno
    await warmUp(engine, startClock, { from: 0.1, to: 0.95, text: "Poniendo trenes en servicio en toda la red" });
    if (control || game) return;
    const ui = new ControlCenter({
      engine, onExit: stopControl, tutorial: !!opts.tutorial, touch: wantsTouch(),
      onPay: (amount, concept) => bank.deposit(amount, concept, { wage: true }),
    });
    control = { engine, ui, last: performance.now(), acc: 0, uiT: 0, raf: 0 };
    // Con la sala abierta, el turno sigue aunque la pestaña quede en segundo plano (ahí no hay fotogramas):
    // los conductores no pueden quedarse con la red congelada
    control.background = setInterval(() => {
      if (!control || !document.hidden || !control.ui.net) return;
      const now = performance.now();
      controlStep(Math.min(2, (now - control.last) / 1000));
      control.last = now;
    }, 1000);
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
  c.raf = requestAnimationFrame(controlLoop);           // antes del paso: un error en un fotograma no detiene el turno (ni la sala)
  const realDt = Math.min(0.25, Math.max(0, (now - c.last) / 1000));   // tras una pausa larga (pestaña oculta) no da saltos
  c.last = now;
  controlStep(realDt);
}

/** Un paso del Centro de Control: motor, alarmas y esquema. */
function controlStep(realDt) {
  const c = control;
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
}

function stopControl() {
  if (!control) return;
  cancelAnimationFrame(control.raf);
  clearInterval(control.background);
  control.ui.destroy();
  control = null;
  startScreen.classList.remove("hidden");
  refreshDriverLines();                 // saldo y licencias al volver a la portada
  disarmBackTrap();
  releaseScreen();
}

function restartGame() {
  if (game.net) return stopGame();            // en una sala: "Nuevo servicio" vuelve al menú (se entra de nuevo con el código)
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
  if (busStopPanel) { if (event.key === "Escape") closeBusStop(); return; }
  if (!game || game.warming || accountOpen() || feedbackOpen()) return;
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "pageup", "pagedown"].includes(key)) event.preventDefault();
  if (hud.summaryOpen) return;
  if (gameMenuOpen) { if (key === "escape") closeGameMenu(); return; }
  if (confirmOpen) { if (key === "escape") closeConfirm(false); else if (key === "enter") closeConfirm(true); return; }
  if (riderPanelOpen()) return;
  if (fareInfoOpen()) { if (key === "escape" || key === "enter") closeFareInfo(); return; }
  if (hud.ticketOpen) { if (key === "escape" || key === "e") hud.closeTicket(); return; }
  if (hud.storeOpen) { if (key === "escape" || key === "e") hud.closeStore(); return; }
  if (hud.missionsOpen) { if (key === "escape" || key === "j") hud.closeMissions(); return; }
  if (game.tutorial?.onKey(key)) return;                 // Enter: siguiente paso del tutorial

  if (key === "m") return toggleSound();
  if (key === "k" && !game.transition) return openStore({ tab: game.walker ? "album" : "driver" });
  if (key === "h") return hud.toggleHelp();
  if (cabScreens.open && (key === "escape" || key === "p")) return setCabScreens(false);
  if (key === "escape") return openGameMenu();
  if (key === "p" && game.player && !game.walker) return setCabScreens(true);

  if (game.walker) {
    if (game.transition) return;
    if (key === "j") return openMissionBoard();
    if (key === "e" && game.encounters?.interact()) return;   // un encuentro cerca (turista, objeto, vendedor…)
    const result = game.walker.keyDown(key);
    if (result) hud.showMessage(result.text, result.level);
    return;
  }

  if (turnWalkKey(key, true)) return;               // recorrido a la otra cabina (maniobra de retorno)
  if (key === "c") return game.rig.recenter();
  if (key === "v") {
    // Ciclo de vistas del conductor: cabina → interior del tren (salón) → exterior
    const next = { cab: "saloon", saloon: "exterior", exterior: "cab" }[game.rig.view] || "cab";
    game.rig.setView(next);
    const label = { cab: "Vista de cabina", saloon: "Vista interior del tren", exterior: keyText("Vista exterior · arrastra para girar · Shift+arrastrar desplaza · rueda zoom · C encuadre inicial", "Vista exterior · arrastra para girar") }[next];
    return hud.showMessage(label, "info", next === "exterior" ? 4500 : 1200);
  }
  // Mando del tren: el rol de Conductor envía órdenes al motor (la respuesta llega en onCommandResult).
  // Cualquier mando confirma la vigilancia (hombre muerto)
  if (game.driverRole.handleKey(key, event.repeat)) { game.safety.input(); return; }
  if (event.repeat) return;
  if (key === "x") return game.safety.input();
  if (key === "b") return game.safety.horn(game.player);
  if (key === "n") {
    stopAssistOn = !stopAssistOn;
    saveSetting("metrosim.stopAssist", stopAssistOn ? "1" : "0");
    return hud.showMessage(stopAssistOn ? "Asistente de parada ACTIVADO · parada prevista, aviso de frenado y pitidos" : `Asistente de parada desactivado${keyText(" (N para volver a activarlo)")}`, "info", 2500);
  }
  if (key === "r") return game.net ? hud.showMessage(`En una sala no se reinicia el servicio: Finalizar turno${keyText(" (F)")} te lleva al menú`, "info") : restartGame();
  if (key === "t") return changeCab();
  if (key === "f") return requestEndShift();
}

/** Respuesta del motor a una orden (del conductor o desde la consola / Centro de Control). */
function onCommandResult(r) {
  if (!game || game.warming || !r.result?.text) return;
  if (r.payload?.source === "pasajero") return;          // el citófono del pasajero ya avisa con su propio texto
  if (r.payload?.source === "red") return;               // órdenes del PCC de la sala a otros trenes (solo se replican)
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
  const key = event.key.toLowerCase();
  game?.walker?.keyUp(key);
  if (game?.turn) turnWalkKey(key, false);
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
    if (game.lightsUnit === unit) trainHead(unit).add(game.trainLights);    // las luces siguen al tren
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
    case "notch": audio.notchClick(); noteBrakeTest(game.player.sim); break;
    case "reverser": audio.reverserClunk(); break;
    case "halt": audio.airHiss(0.6); break;
    case "emergency": audio.emergency(); stats.emergencies++; game.score.penalty("emergency"); break;
    case "stopped":
      game.lastStop = data;
      game.score.stopped(game.lastDecel);
      if (Math.abs(data.error) <= CONFIG.station.stopTolerance) { if (stopAssistOn && tripStopsAt(game.player.trip, data.station.index)) audio.stopAssistCue("inPosition"); }
      else {
        game.score.penalty("offPosition");
        const e = Math.abs(data.error).toFixed(1).replace(".", ",");
        hud.showMessage(data.error < 0
          ? `${data.station.name} · TE PASASTE ${e} m · inversor atrás${keyText(" (E)", " (R)")} y retrocede despacio hasta la marca (máx. ${Math.round(CONFIG.train.reverseMaxSpeed * 3.6)} km/h)`
          : `${data.station.name} · TE QUEDASTE ${e} m ANTES · avanza despacio en TRACCIÓN 1 hasta la marca`, "warn", 6000);
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
  game.net?.shift(trip, i, shift);                     // el Centro de Control de la sala también lo ve adelantado
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
  if (game.shiftEnded) return hud.showMessage(`Este servicio ya terminó · haz la maniobra de retorno${keyText(" (T)")} o vuelve al menú`, "info", 4000);
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
        onContinue: () => hud.showMessage(`Cierra puertas${keyText(" (D)")}, avanza a la cola de maniobras (máx. 30 km/h) y detente en el cartel FIN DE MANIOBRA. Ahí asegura el tren (freno e inversor en N) y ${keyText("pulsa T", "toca ⇄ Cambiar cabina")}`, "info", 9000),
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

/* ==========================================================================
   Maniobra de retorno (1.7): como en un tren real, por pasos
     1. ASEGURAR el tren en FIN DE MANIOBRA: detenido, puertas cerradas,
        freno aplicado e inversor en N. T retira la llave.
     2. RECORRIDO hasta la cabina del otro extremo por dentro del tren vacío:
        caminando (W caminar · S detenerse · Shift correr) o en recorrido
        automático (T).
     3. ACTIVAR la cabina: inversor ADELANTE y prueba de frenos (soltar a
        FRENO 1 y volver a FRENO 3). Hasta entonces no hay tracción.
     4. MANIOBRAR: esperar la señal de maniobra (S…00) abierta, cruzar el
        cambio de vía (máx. 30 km/h) y detenerse en la marca del andén de
        salida. El tren cruza las agujas de verdad (traffic.js, trainViews.js).
   ========================================================================== */

/** Bloqueo de tracción mientras la cabina nueva no esté activada. */
const CAB_LOCK = "cabina sin activar · completa la prueba de frenos";
/** Velocidades del recorrido por el tren (m/s): caminando, corriendo y automático. */
const WALK_SPEED = 1.4, RUN_SPEED = 2.8, AUTO_SPEED = 8;
/** El recorrido termina al llegar a esta distancia (m) del testero: entras a la cabina. */
const WALK_END = 4.5;

/** ¿El tren del jugador está detenido en el cartel FIN DE MANIOBRA? */
function atTurnbackBoard(player) {
  const sim = player.sim;
  return sim.isStopped && !sim.nextStation() && Math.abs(sim.position - player.route.track.retireZ) <= 15;
}

/** Condiciones para dejar la cabina (paso 1). */
function securedChecks(sim) {
  const t = sim.notchData.type;
  return [
    { ok: sim.doorsClosed, text: `Puertas cerradas${keyText(" (D)")}` },
    { ok: t === "brake" || t === "emergency", text: "Freno aplicado (S/▼)" },
    { ok: sim.reverser === 0, text: "Inversor en N (Q/E)" },
  ];
}

/** T: retirar la llave (paso 1 → 2), o saltar al recorrido automático durante el paso 2. */
async function changeCab() {
  const player = game.player, sim = player.sim;
  const turn = game.turn;
  if (turn?.phase === "walk") { turn.auto = true; return; }
  if (turn) return hud.showMessage(turn.phase === "activate" ? "Ya estás en la cabina nueva: completa la prueba de frenos" : "Ya cambiaste de cabina: cruza a la vía de salida", "info");
  if (sim.dockedStation() === player.route.first && sim.isStopped) {
    return hud.showMessage("Ya estás en la terminal de origen de tu servicio", "info");
  }
  if (!atTurnbackBoard(player)) {
    const d = Math.round(sim.position - player.route.track.retireZ);
    return hud.showMessage(sim.nextStation()
      ? "El cambio de cabina se hace en la cola de maniobras, tras la terminal"
      : `Detén el tren en el cartel FIN DE MANIOBRA (${d > 0 ? d + " m por delante" : -d + " m pasado"})`, "warn");
  }
  const missing = securedChecks(sim).filter(c => !c.ok);
  if (missing.length) return hud.showMessage(`Antes de dejar la cabina asegura el tren: ${missing.map(c => c.text).join(" · ")}`, "warn", 5000);
  const other = oppositeRoute(player.route);
  if (!game.traffic.depotFree(other)) {
    return hud.showMessage(`La vía de salida está ocupada por un tren que sale de cocheras · espera unos segundos y ${keyText("vuelve a pulsar T", "vuelve a intentarlo")}`, "warn", 5000);
  }
  if (game.turnPending) return;
  game.turnPending = true;
  audio_(a => a.reverserClunk());
  // En una sala, el servicio de vuelta lo asigna el Centro de Control
  let trip = null;
  if (game.net?.connected) {
    hud.showMessage("Llave retirada · pidiendo el servicio de vuelta al Centro de Control…", "info", 3000);
    trip = await game.net.requestTurn().catch(() => { game?.net?.lost("El Centro de Control no asignó el servicio de vuelta"); return null; });
  }
  if (!game || game.player !== player) return;
  game.turnPending = false;
  trip ??= game.traffic.nextTripFor(other, game.clock, 240, 1500) || makeTrip(other, Math.ceil((game.clock + 420) / 60) * 60);
  game.traffic.turnback(player, trip);          // el tren pasa a ser el servicio de vuelta (aún en la cola de llegada)
  game.net?.turned();
  sim.reverser = 0;                             // cabina nueva sin activar: llave fuera, inversor en N
  sim.tractionLock = CAB_LOCK;
  game.stats = { arrivals: [], stops: [], log: [], redSignals: 0, overspeeds: 0, emergencies: 0 };
  game.score = newScore(other);
  game.shiftEnded = false;                      // empieza un servicio nuevo
  game.lastStop = null;
  game.dmiTimer = 0;
  game.turn = { phase: "walk", trip, walkZ: CONFIG.train.length - 5, walking: false, auto: false, run: false, stepDist: 0, test: { b1: false, b3: false } };
  game.rig.walkZ = game.turn.walkZ;
  game.rig.setView("walk");
  hud.showMessage(`Servicio ${trip.id} · ${other.label} · sale de ${other.first.name} a las ${formatClock(trip.departure)}. Camina hasta la otra cabina${keyText(" (W) o pulsa T para el recorrido automático", " (▲) o toca ⇄ Cambiar cabina para el recorrido automático")}`, "ok", 8000);
}

/** Objeto del tren al que se enganchan cámara y luces: su coche delantero (el grupo entero si es rígido). */
function trainHead(unit) { return unit.model?.head || unit.group; }

/** Un tren de la línea activa estrenó modelo 3D (trainViews.js): reengancha lo que colgaba del anterior. */
function onTrainModel(unit) {
  if (!game) return;
  if (game.lightsUnit === unit) trainHead(unit).add(game.trainLights);
  if (unit !== game.player) return;
  game.rig?.setTrain(trainHead(unit));
  applyLivery(unit);
  game.dmiTimer = 0;
}

/** Pequeño atajo: el audio de la partida si existe. */
function audio_(fn) { if (game?.audio) fn(game.audio); }

/** Teclas durante el recorrido por el tren (paso 2). Devuelve true si la tecla se usó. */
function turnWalkKey(key, down) {
  const turn = game.turn;
  if (turn?.phase !== "walk") return false;
  if (key === "shift") { turn.run = down; return true; }
  if (!down) return true;
  if (key === "w" || key === "arrowup") { turn.walking = true; return true; }
  if (key === "s" || key === "arrowdown") { turn.walking = false; turn.auto = false; return true; }
  if (key === "t") { turn.auto = true; return true; }
  if (key === "c") { game.rig.recenter(); return true; }
  return !["h", "m", "k", "f", "escape", "r"].includes(key);    // el resto del mando no hace nada mientras caminas
}

/** Avance de la maniobra en cada fotograma. */
function updateTurn(dt, player) {
  const turn = game.turn, sim = player.sim;
  if (!turn) return;
  if (turn.phase === "walk") {
    const v = turn.auto ? AUTO_SPEED : turn.walking ? (turn.run ? RUN_SPEED : WALK_SPEED) : 0;
    turn.walkZ = Math.max(WALK_END, turn.walkZ - v * dt);
    game.rig.walkZ = turn.walkZ;
    game.rig.walkSpeed = v;
    if (v && !turn.auto) {
      turn.stepDist += v * dt;
      if (turn.stepDist > (turn.run ? 1.1 : 0.75)) { turn.stepDist = 0; game.audio.footstep("train", turn.run); }
    }
    if (turn.walkZ <= WALK_END) {
      turn.phase = "activate";
      game.rig.setView("cab");
      audio_(a => a.reverserClunk());
      hud.showMessage(`En la cabina nueva · llave puesta · inversor ADELANTE${keyText(" (Q)", " (F)")} y prueba de frenos: suelta a FRENO 1 y vuelve a FRENO 3`, "info", 7000);
    }
  }
  if (turn.phase === "activate") {
    if (!sim.tractionLock) sim.tractionLock = CAB_LOCK;
    noteBrakeTest(sim);
    if (sim.reverser === 1 && turn.test.b1 && turn.test.b3) {
      if (sim.tractionLock === CAB_LOCK) sim.tractionLock = null;
      turn.phase = "shunt";
      audio_(a => a.chime?.());
      const man = game.signals.get(player.route.id).signals.find(s => s.type === "maniobra");
      hud.showMessage(`Cabina activa · espera la señal de maniobra S${man?.id ?? ""} (verde o amarillo) y cruza el cambio de vía (máx. 30 km/h) hasta la marca del andén de ${player.route.first.name}`, "ok", 8000);
    }
  }
  if (turn.phase === "shunt" && sim.isStopped && sim.dockedStation() === player.route.first) {
    game.turn = null;
    hud.showMessage(`Maniobra completa · en el andén de ${player.route.first.name} · abre puertas${keyText(" (D)")} y sal a las ${formatClock(turn.trip.departure)}`, "ok", 7000);
  }
}

/** Prueba de frenos (paso 3): se anota en cada cambio del mando, aunque pase rápido por FRENO 1. */
function noteBrakeTest(sim) {
  const turn = game?.turn;
  if (turn?.phase !== "activate") return;
  if (sim.notch === NOTCH_INDEX.B1) turn.test.b1 = true;
  if (turn.test.b1 && sim.notch <= NOTCH_INDEX.B3) turn.test.b3 = true;
}

/** Lista de pasos de la maniobra para el HUD (null si no hay maniobra en curso ni el tren está en FIN DE MANIOBRA). */
function turnSteps(player) {
  const turn = game.turn, sim = player.sim;
  const step = (ok, text, now = false) => ({ ok, text, now });
  if (!turn) {
    if (!atTurnbackBoard(player)) return null;
    const checks = securedChecks(sim);
    const ready = checks.every(c => c.ok);
    return { title: "MANIOBRA DE RETORNO · 1/4 · ASEGURAR EL TREN", steps: [
      ...checks.map(c => step(c.ok, c.text, !c.ok)),
      step(false, `T: retirar la llave e ir a la otra cabina`, ready),
    ] };
  }
  if (turn.phase === "walk") {
    const left = Math.max(0, Math.round(turn.walkZ - WALK_END));
    return { title: "MANIOBRA DE RETORNO · 2/4 · A LA OTRA CABINA", steps: [
      step(false, `Faltan ${left} m por el interior del tren`, true),
      step(false, turn.auto ? "Recorrido automático…" : keyText("W caminar · S detenerte · Shift correr", "▲ caminar · ▼ detenerte")),
      step(false, "T: recorrido automático"),
    ] };
  }
  if (turn.phase === "activate") {
    return { title: "MANIOBRA DE RETORNO · 3/4 · ACTIVAR LA CABINA", steps: [
      step(true, "Llave puesta"),
      step(sim.reverser === 1, `Inversor ADELANTE${keyText(" (Q)", " (F)")}`, sim.reverser !== 1),
      step(turn.test.b1, "Prueba de frenos: suelta a FRENO 1 (W/▲)", sim.reverser === 1 && !turn.test.b1),
      step(turn.test.b3, "…y vuelve a FRENO 3 (S/▼)", turn.test.b1 && !turn.test.b3),
    ] };
  }
  const sys = game.signals.get(player.route.id);
  const man = sys.signals.find(s => s.type === "maniobra");
  const passed = !man || sim.position < man.z;
  const aspect = man ? { red: "ROJO · espera", yellow: "AMARILLO · avanza, el andén aún está ocupado: para ante la señal de entrada", green: "VERDE · paso libre al andén" }[man.aspect] : "";
  const crossed = !player.crossing;
  return { title: "MANIOBRA DE RETORNO · 4/4 · AL ANDÉN DE SALIDA", steps: [
    step(passed, passed ? `Señal de maniobra S${man?.id ?? ""} rebasada` : `Señal de maniobra S${man.id}: ${aspect}`, !passed),
    step(crossed, `Cruza el cambio de vía (máx. 30 km/h)`, passed && !crossed),
    step(false, `Detente en la marca del andén de ${player.route.first.name}`, crossed),
  ] };
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
    case "enterShop":
      enterShopDoor(data);
      break;
    case "leaveShop":
      leaveShopDoor();
      break;
  }
}


/** Cobro del pasaje al entrar por un torniquete. */
function validateFare() {
  const gate = game.world.nearestGate(game.walker.pos);
  const mode = fareModeOfLine(LINE.id);
  // 2.5 · Pago Ágil: tarjeta bancaria sin contacto (siempre tarifa adulto, sin integración).
  // 2.5.1 · De momento solo en el Metro: en Tren Nos y Tren Rancagua se paga con la bip!
  if (payWith() === "banco" && mode === "metro") {
    const band = fareBandAt(game.clock);
    const r = bank.charge(band.price, `Metro · pago sin contacto · ${band.label.toLowerCase()}`);
    if (r.ok) {
      game.audio.bip();
      if (gate) game.world.flashValidator(gate, true);
      game.ride.fare = band;
      hud.showMessage(`Pago sin contacto · ${band.label} ${formatCLP(band.price)} · ${BANK_NAME} ${bank.maskedNumber} · saldo ${bank.label}`, "ok", 3000);
      return { ok: true };
    }
    game.audio.deny();
    if (gate) game.world.flashValidator(gate, false);
    hud.showMessage(`Tarjeta rechazada: tu cuenta tiene ${bank.label} y el pasaje es ${formatCLP(band.price)} · haz un turno de Conductor o paga con la bip! (Tarifas)`, "alert", 5000);
    return { ok: false };
  }
  const band = riderFare(game.clock);              // 1.10: la tarifa TNE o de adulto mayor, si le corresponde
  const r = payTrip(band.price, mode);             // 2.5: tarifa integrada (paga la diferencia en el transbordo)
  hud.setCard(card);
  if (r.ok) {
    game.audio.bip();
    if (gate) game.world.flashValidator(gate, true);
    game.ride.fare = r.transfer ? { ...band, price: r.charge } : band;
    hud.showMessage(r.transfer
      ? `bip! · Transbordo desde ${r.from} · ${r.charge ? `pagas la diferencia ${formatCLP(r.charge)}` : "$0"} · saldo ${formatCLP(card.balance)}`
      : `bip! · ${band.label}${band.card ? ` ${band.card}` : ""} ${formatCLP(band.price)} · saldo ${formatCLP(card.balance)}${r.why ? ` · no es transbordo: ${r.why}` : ""}`, "ok", r.why ? 4500 : 2500);
    return { ok: true };
  }
  game.audio.deny();
  if (gate) game.world.flashValidator(gate, false);
  const need = r.charge ?? band.price;
  hud.showMessage(r.reason === "nocard"
    ? `No tienes tarjeta bip!: cómprala en la boletería (a la izquierda) con tu tarjeta de débito${mode === "metro" ? ", o paga con tu tarjeta bancaria sin contacto (Tarifas › Pagar con)" : " (en el tren se paga con bip!; la tarjeta bancaria sirve solo en el Metro)"}`
    : `Saldo bip! insuficiente (${formatCLP(card.balance)}) · pasaje ${formatCLP(need)} · carga en la boletería o en un tótem${bank.balance < 1000 ? " · tu cuenta está baja: haz un turno de Conductor" : ""}`, "alert", 5000);
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
  const grand = SANTIAGO_LINES.every(l => l.id === line.id || lineMastered(l.id));   // 2.18 · sin la bonus de Valparaíso
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
    : `Estimados pasajeros: Metro de Santiago felicita a nuestro nuevo Pasajero Ilustre de${isRail(line.id) ? "l" : " la"} ${lineLabel(line.id)}. ¡Muchas gracias por viajar con nosotros!`), 4200);
  celebrate({
    line, completed: game.missions.completed, reward: MASTERY_REWARD, grand, grandReward: GRAND_REWARD,
    lines: SANTIAGO_LINES, isMastered: (id) => id === line.id || lineMastered(id),
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
    if (st) loadRealStreet(st.name);                 // 2.7 · ya en la estación: que su calle real esté lista al salir
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
  hud.fadeOut(`Combinación · ${lineLabel(lineId)} · ${st.name}`);
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
    showLoading();
    const audio = new AudioSystem();
    audio.muted = muted;
    audio.start();
    setTimeout(() => buildGame("passenger", target.index, audio, ROUTE_A, { transferFrom: fromId, tutorialStep }), 40);
  }, 700);
}

/** Llega a la mezanina por el pasillo de combinación (zona pagada, mirando hacia los andenes). */
function arriveByTransfer(st, fromId) {
  const walker = game.walker;
  walker.enterStation(st);
  const T = CONFIG.mezzanine.transfer;
  // 2.17.2 · Sale por el pasillo de la línea de la que viene (en Estación Central, la segunda está en el muro −X)
  const side = st.combos.indexOf(fromId) === 1 ? -1 : 1;
  walker.pos.set(side * (CONFIG.station.wallX - 1.4), CONFIG.mezzanine.y, st.z + (T.z0 + T.z1) / 2);
  walker.yaw = side * Math.PI / 2;          // de espaldas al pasillo, mirando al centro
  walker.paid = true;
  walker.transferring = true;               // no vuelve a entrar al pasillo hasta alejarse
  game.ride = { origin: null, boardedClock: null };
}

/* ==========================================================================
   1.15 · Todo conectado: el pasajero toma el bus en el paradero de la calle
   ========================================================================== */

/* 2.5 · Tarifa integrada (trip.js): hasta 2 transbordos en 120 min desde el primer bip!, pagando solo la
   diferencia; una etapa en Metro y una en Tren Nos por viaje, sin repetir recorrido de bus. El viaje se guarda. */
let fareTrip = loadTrip();
function payTrip(price, mode, route = null) {
  const stage = { mode, route, price, now: Date.now() };
  const q = quoteStage(fareTrip, stage);
  const r = card.pay(q.charge);
  if (!r.ok) return { ...r, charge: q.charge };
  fareTrip = commitStage(fareTrip, q, stage);
  saveTrip(fareTrip);
  return { ok: true, ...q };
}

let busStopPanel = null;
function closeBusStop() {
  busStopPanel?.remove();
  busStopPanel = null;
  if (game?.walker && !game.transition) { game.walker.frozen = false; game.walker.keys.clear(); }
}

/** Paradero de la calle: elige el sentido del bus y sube (paga con la bip!). */
function openBusStop(st) {
  const trips = busTripsFrom(st.name);
  if (!trips.length || busStopPanel) return;
  const walker = game.walker;
  walker.frozen = true;
  walker.keys.clear();
  if (document.pointerLockElement) document.exitPointerLock?.();
  const band = riderBusFare();
  const now = Date.now();
  const quotes = trips.map(t => quoteStage(fareTrip, { mode: "bus", route: t.route.id, price: band.price, now }));
  const transfer = quotes.some(q => q.transfer), q0 = quotes.find(q => q.transfer) || quotes[0];
  const fareText = transfer ? `transbordo: ${q0.charge ? `pagas la diferencia ${formatCLP(q0.charge)}` : "$0"}` : `pasaje ${formatCLP(band.price)} (${band.label}, a toda hora) con tu bip!`;
  const el = document.createElement("div");
  el.className = "bus-stop-panel";
  el.innerHTML = `<div class="bus-card" role="dialog" aria-label="Paradero">
    <span class="small-label">PARADERO · ${st.name}</span>
    <h2>¿Hacia dónde vas?</h2>
    <div class="bus-stop-dirs">${trips.map((t, i) => {
      const next = t.route.stops.slice(t.from + 1, t.from + 4).map(s => s.name).join(", ");
      // 2.15.4 · El precio de cada recorrido (un recorrido ya usado en el viaje no es transbordo)
      const q = quotes[i], price = q.transfer ? (q.charge ? `transbordo · pagas ${formatCLP(q.charge)}` : "transbordo · $0") : formatCLP(band.price);
      return `<button class="bus-stop-dir" data-i="${i}"><b><i style="background:${t.route.color}">${t.route.id}</i>hacia ${t.route.to}</b><small>Próximas paradas: ${next}${t.route.stops.length - t.from > 4 ? "…" : ""} · ${price}</small></button>`;
    }).join("")}</div>
    <p>${transfer ? `Tu viaje empezó hace menos de 2 horas (te quedan ${minutesLeft(fareTrip, now)} min): es un <b>transbordo</b> · ${fareText}.` : `Al subir se cobra el ${fareText}${q0.why ? ` · no es transbordo: ${q0.why}` : ""}. Si después tomas el Metro antes de 2 horas, es transbordo y pagas solo la diferencia.`} El bus no acepta tarjetas bancarias. Saldo bip!: ${card.label}.</p>
    <button class="bus-btn" data-close>Seguir a pie</button>
  </div>`;
  el.addEventListener("click", (ev) => {
    if (ev.target === el || ev.target.closest("[data-close]")) return closeBusStop();
    const b = ev.target.closest(".bus-stop-dir");
    if (b) boardBus(trips[Number(b.dataset.i)], st);
  });
  document.body.append(el);
  busStopPanel = el;
}

function boardBus(trip, st) {
  const band = riderBusFare();
  const r = payTrip(band.price, "bus", trip.route.id);
  hud.setCard(card);
  if (!r.ok) {
    game.audio.deny();
    closeBusStop();
    return hud.showMessage(r.reason === "nocard"
      ? "Necesitas una tarjeta bip! para subir al bus: cómprala en la boletería de la estación"
      : `Saldo bip! insuficiente (${card.label}) · pasaje ${formatCLP(r.charge ?? band.price)} · carga en la boletería o en un tótem`, "alert", 5000);
  }
  game.audio.bip();
  const fareText = r.transfer ? `transbordo ${r.charge ? `· diferencia ${formatCLP(r.charge)}` : "$0"} · saldo ${card.label}` : `bip! ${formatCLP(band.price)} · saldo ${card.label}`;
  busStopPanel?.remove();
  busStopPanel = null;
  const fromLine = LINE.id;
  game.transition = true;
  game.walker.frozen = true;
  hud.fadeOut(`Bus ${trip.route.id} hacia ${trip.route.to}`);
  setTimeout(() => {
    if (!game) return;
    stopGame({ keepFullscreen: true });
    startBus({ ride: { route: trip.route, from: trip.from, fareText, onArrive: (stop) => arriveByBus(stop, fromLine) } });
  }, 700);
}

/** Se bajó del bus: aparece en la calle de la estación de Metro de ese paradero. */
function arriveByBus(stop, fromLine) {
  bus = null;
  const line = [lineById(fromLine), lineById("1"), ...LINES].find(l => l?.stations.some(s => s.name === stop.metro));
  if (!line) { startScreen.classList.remove("hidden"); return; }
  const target = line.stations.find(s => s.name === stop.metro);
  paxLineSelect.value = line.id;
  fillStations(line);
  stationSelect.value = String(target.index);
  saveSetting("metrosim.line", line.id);
  useLine(line);
  startScreen.classList.add("hidden");
  showLoading();
  const audio = new AudioSystem();
  audio.muted = muted;
  audio.start();
  setTimeout(() => buildGame("passenger", target.index, audio, ROUTE_A, { fromBus: stop.name }), 40);
}

/** Interacción en la calle (E): acceso al Metro, un local o el hito. */
function onStreetTarget(target) {
  const st = game.walker.station;
  if (target.kind === "access") return hud.showMessage("Camina hacia la escalera para bajar a la estación", "info");
  if (target.kind === "busstop") return target.served ? openBusStop(st)
    : hud.showMessage("Por este paradero no pasa ninguno de los recorridos del juego (A01, 210, 385, 401, 403, 109, 107, 211 y 506)", "info", 5500);
  if (target.kind === "shop") return game.city.canEnter(target.shop) ? enterShopDoor(target.shop) : openShop(target.shop, st);
  if (target.kind === "counter") return openShop(target.shop, st);
  if (target.kind === "exit") return leaveShopDoor();
  if (target.kind === "landmark") return takePhoto(target.landmark, st);
}

/**
 * 2.17 · Entrar a un local caminando: la puerta automática se abre, se cruza
 * (un parpadeo) y se aparece adentro, con la campanilla y el saludo de quien
 * atiende. Se compra en la caja del mesón.
 */
function enterShopDoor(shop) {
  if (!game || game.shopDoor || game.city.inside) return;
  const w = game.walker, city = game.city;
  game.shopDoor = true;
  w.frozen = true;
  w.keys.clear();
  city.holdDoor(shop, true);
  const open = city.doors.find(d => d.shop === shop)?.open ?? 1;
  setTimeout(() => {
    if (!game || game.city !== city) return;
    hud.blink(() => {
      w.placeAt(city.enterShop(shop));
      city.holdDoor(shop, false);
      game.audio.shopChime();
    }, () => {
      if (!game) return;
      game.shopDoor = false;
      w.frozen = false;
      w.keys.clear();
      const h = Math.floor(game.clock / 3600) % 24;
      const hello = h < 12 ? "¡Buenos días!" : h < 20 ? "¡Buenas tardes!" : "¡Buenas noches!";
      hud.showMessage(`${shop.icon} «${hello} ¿Qué le sirvo?» · ${shop.name} · acércate a la caja del fondo para comprar`, "info", 4200);
    });
  }, open > 0.6 ? 60 : 420);
}

/** 2.17 · Salir del local por la misma puerta, de vuelta a la vereda. */
function leaveShopDoor() {
  if (!game || game.shopDoor || !game.city.inside) return;
  const w = game.walker, city = game.city;
  game.shopDoor = true;
  w.frozen = true;
  w.keys.clear();
  hud.blink(() => {
    const out = city.exitShop();
    if (out) w.placeAt(out);
    game.audio.shopChime();
  }, () => {
    if (!game) return;
    game.shopDoor = false;
    w.frozen = false;
    w.keys.clear();
  });
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
      // Kiosko: el recuerdo de la estación para el álbum de la Tienda RedMovi (uno por estación)
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
  return `Recuerdo de ${st.name} al álbum (${have}/${total}) · ${keyText("K", "☰ Tienda")} para ver tu colección${extra}`;
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
    // 2.17 · Dentro de un local: a la caja si la misión es aquí; si no, de vuelta a la puerta
    const inside = game.city.inside?.shop;
    if (inside) {
      const here = target && target.name === w.station.name && (step.kind === "buy" || step.kind === "action") && step.shop === inside.kind;
      g.label = here ? "ESTÁS EN EL DESTINO" : "SAL A LA CALLE";
      g.target = here ? `${inside.icon} ${inside.name}` : (target?.name ?? `Estación ${w.station.name}`);
      const c = game.city.counterSpot(), d = game.city.shopExitSpot();
      if (here) {
        toward(c.x, c.z);
        g.hint = "Pide en la caja del mesón · E";
        if (game.city.nearest(w.pos)?.kind === "counter") { g.here = true; g.hint = `¡Aquí es! ${keyText("Pulsa E", "Toca ✋ Usar")} en la caja`; }
      } else { toward(d.x, d.z); g.hint = "Sal por la puerta del local para seguir con la misión"; }
      return g;
    }
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
      g.hint = shop?.stand ? `Puesto en la vereda del Metro · ${keyText("E", "✋ Usar")} para atender` : "En la vereda del Metro · entra por la puerta y pide en la caja";
      if (g.dist != null && g.dist < 2.6) { g.here = true; g.hint = `¡Aquí es! ${keyText("Pulsa E", "Toca ✋ Usar")}`; }
    } else if (step.kind === "photo" && plan.landmark) {
      g.target = `📷 ${plan.landmark.name}`;
      const spot = game.city.landmarkGoal();
      toward(o.x + spot.x, o.z + spot.z);
      g.hint = game.city.real ? `En la vereda, frente al edificio · ${keyText("E", "✋ Usar")} para sacar la foto` : `Al frente, cruzando la avenida · ${keyText("E", "✋ Usar")} para sacar la foto`;
      if (game.city.atLandmark(w.pos.x - o.x, w.pos.z - o.z)) { g.here = true; g.hint = `¡Aquí es! ${keyText("Pulsa E", "Toca ✋ Usar")} para sacar la foto`; }
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
      g.hint = totem ? `Boletería a la izquierda, tótems a la derecha · ${keyText("E", "✋ Usar")} para atender` : `A la izquierda de los torniquetes · ${keyText("E", "✋ Usar")} para atender`;
      if (g.dist < 1.4) { g.here = true; g.hint = `¡Aquí es! ${keyText("Pulsa E", "Toca ✋ Usar")}`; }
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
  const fare = riderFare(game.clock).price;
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
      cab: game.turn?.phase === "walk" || (!game.turn && atTurnbackBoard(game.player)),
      // Estado real del tren para la consola del celular (palanca, llave del inversor, pulsadores)
      notch: sim.notch,
      reverser: sim.reverser,
      emergency: !!sim.emergency,
      doorsOpen: !sim.doorsClosed,
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

/* ---------- 2.0 · Menú de la partida (Esc o botón Menú) ---------- */
let gameMenuOpen = false, gameMenuWasFrozen = false;
function openGameMenu() {
  if (!game || gameMenuOpen || game.warming) return;
  gameMenuOpen = true;
  const w = game.walker;
  gameMenuWasFrozen = !!w?.frozen;
  if (w) { w.frozen = true; w.keys.clear(); }
  if (document.pointerLockElement) document.exitPointerLock?.();
  const menu = $("gameMenu");
  menu.dataset.who = w ? "walker" : "driver";
  $("gameMenuKicker").textContent = w ? "VIAJANDO" : game.net ? `CONDUCIENDO · SALA ${game.net.code}` : "CONDUCIENDO";
  $("gameMenuSound").textContent = muted ? "desactivado" : "activado";
  menu.querySelector('[data-act="restart"]').hidden = !!game.net;
  const acc = accountState();
  $("gameMenuAccount").textContent = acc.signedIn ? "Mi cuenta · guardado en la nube" : "Guardar en la nube";
  $("gameMenuNote").textContent = w
    ? (acc.signedIn ? "Tu cuenta, tu bip! y tus misiones se guardan en la nube." : "Tu cuenta, tu bip! y tus misiones quedan guardadas en este dispositivo.")
    : "El tren sigue en marcha mientras ves el menú. Al finalizar el turno ves tu informe y cobras el sueldo.";
  menu.classList.remove("hidden");
  menu.querySelector(".game-menu-resume").focus();
}
function closeGameMenu() {
  if (!gameMenuOpen) return;
  gameMenuOpen = false;
  $("gameMenu").classList.add("hidden");
  const w = game?.walker;
  if (w && !gameMenuWasFrozen) { w.frozen = false; w.keys.clear(); }
}
function gameMenuAction(act) {
  if (act === "sound") { toggleSound(); $("gameMenuSound").textContent = muted ? "desactivado" : "activado"; return; }
  closeGameMenu();
  if (!game) return;
  if (act === "help") hud.toggleHelp();
  else if (act === "fares") showFares();
  else if (act === "store") openStore({ tab: game.walker ? "album" : "driver" });
  else if (act === "missions" && game.walker) openMissionBoard();
  else if (act === "restart" && !game.net) restartGame();
  else if (act === "end") { game.endShiftAsk = performance.now(); requestEndShift(); }   // ya se confirmó en el menú
  else if (act === "home") stopGame();
  else if (act === "account") openAccount();
  else if (act === "feedback") {
    const w = !!game.walker, train = isRail(LINE.id);
    openFeedback({
      tema: game.net ? "multijugador" : w ? "viajar" : train ? "tren" : "metro",
      contexto: `${w ? "Viajando" : "Conduciendo"} · ${lineLabel(LINE.id)}${game.net ? " · multijugador" : ""}`,
    });
  }
}

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
  // Estación a la que te acercabas para parar: si te pasas de su marca, sigue
  // siendo el objetivo (y no la siguiente) hasta que te detengas en ella o la
  // dejes 60 m atrás. Al salir de una estación en la que ya paraste no cuenta.
  // (sim.nextStation() ya da la siguiente en cuanto el testero entra en la tolerancia.)
  if (docked || sim.doorState !== "closed") unit.stopTarget = null;
  const keep = !!unit.stopTarget && unit.stopTarget === near && nearError > -60;
  if (!keep) unit.stopTarget = next && !docked && sim.position - next.stopZ < 1500 ? next : null;
  let approach = null;
  if (keep && nearError < 60) approach = { station: near, error: nearError };
  else if (next && sim.position - next.stopZ < 60) approach = { station: next, error: sim.position - next.stopZ };
  else if (Math.abs(nearError) < 15 && tripStopsAt(unit.trip, near.index)) approach = { station: near, error: nearError };

  // Asistente de parada: dónde paras con el freno actual y cuándo frenar (engine/stopAssist.js)
  const assist = stopAssistOn && !docked ? stopAssist(sim, keep ? near : next) : null;
  if (approach) approach.predicted = assist?.predicted ?? null;

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
    approach, assist,
    limit: sim.currentLimit(),
    signal, schedule,
    ahead: trainAhead(unit),
  };
}

/**
 * Sonidos del asistente de parada: un aviso al cambiar a "frena", "te pasas"
 * o "pasaste la marca", y en los últimos metros pitidos cada vez más seguidos
 * (como un sensor de estacionamiento), rápidos y agudos dentro de la tolerancia.
 */
function updateStopAssistSound(dt, sim, info) {
  const audio = game.audio, a = info.assist;
  const cue = a?.cue || null;
  game.assistCueT = (game.assistCueT ?? 0) - dt;
  if (cue !== game.assistCue) {
    // Los avisos urgentes suenan siempre; "frena" y "te pasarías", como mucho uno cada 3 s (sin repiquetear)
    const urgent = cue === "late" || cue === "passed";
    if (urgent || ((cue === "brake" || cue === "more") && game.assistCueT <= 0)) { audio.stopAssistCue(cue); game.assistCueT = 3; }
    game.assistCue = cue;
  }
  game.assistBeepT = (game.assistBeepT ?? 0) - dt;
  if (!a || a.cue === "passed" || a.dist > 15 || sim.speed < 0.05) return;
  const tol = CONFIG.station.stopTolerance, inZone = Math.abs(a.dist) <= tol;
  if (game.assistBeepT <= 0) {
    audio.stopAssistBeep(inZone);
    game.assistBeepT = inZone ? 0.1 : 0.12 + (a.dist - tol) / (15 - tol) * 0.5;
  }
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

/* ----- Pantallas de cabina ampliadas (1.7.2) -----
   Las pantallas del pupitre se ven pequeñas (sobre todo en el teléfono):
   tocarlas (o P) las abre en grande, dibujadas directo en canvas HTML a la
   resolución de la pantalla del dispositivo, así el texto queda nítido. */
const cabScreens = { open: false, dmi: null, status: null, openedAt: 0 };
// En el teléfono el «click» que sigue al toque cae sobre la vista recién abierta: se ignora el primer instante
$("cabScreens").addEventListener("click", () => { if (performance.now() - cabScreens.openedAt > 400) setCabScreens(false); });

function setCabScreens(open) {
  const el = $("cabScreens");
  if (open && !game?.player) open = false;
  cabScreens.open = open;
  el.classList.toggle("hidden", !open);
  if (!open) { cabScreens.dmi = cabScreens.status = null; return; }
  cabScreens.openedAt = performance.now();
  const fit = (id) => {
    const c = $(id), r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.max(320, Math.round(r.width * dpr));
    c.height = Math.round(c.width * 9 / 16);
    return c.getContext("2d");
  };
  cabScreens.dmi = fit("cabScreenDmi");
  cabScreens.status = fit("cabScreenStatus");
  game.dmiTimer = 0;                                   // se dibujan en el próximo cuadro
}

/** Un toque (sin arrastrar) sobre una pantalla del pupitre la abre ampliada. */
function attachScreenTap(dom, camera) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  dom.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  dom.addEventListener("pointerup", (ev) => {
    const d = down; down = null;
    if (!d || !game?.player || game.walker || game.rig?.view !== "cab" || cabScreens.open) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 10 || performance.now() - d.t > 450) return;   // fue un arrastre para mirar
    const m = game.player.model, meshes = [m.dmi?.mesh, m.status?.mesh].filter(Boolean);
    const r = dom.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObjects(meshes, false).length) setCabScreens(true);
  });
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

  model.dmi.mirror = cabScreens.open ? cabScreens.dmi : null;          // vista ampliada (sigue al tren tras el cambio de cabina)
  if (model.status) model.status.mirror = cabScreens.open ? cabScreens.status : null;
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
  engine.update(game.net ? game.net.pace(realDt, engine.time) : realDt);    // en una sala, al ritmo del reloj del anfitrión
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
  people.update(dt, game.clock, { cameraZ, hideUnit: player && game.rig.view === "cab" ? player : null, eye: game.walker ? cameraWorld : null });
  if (!game.transition) game.performers?.update(dt, cameraWorld);
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
  game.outdoor.update(dt, cameraWorld, game.clock, { street: inStreet, indoor: inStreet && !!game.city?.inside, cityOutdoor: game.city?.outdoor || 0, dry: ridden ? trainBounds(ridden) : null });
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
  if (focus && focus !== game.lightsUnit) { trainHead(focus).add(game.trainLights); game.lightsUnit = focus; }
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
    game.net?.update(dt);                              // sala: estado del tren al anfitrión y retención del PCC
    const info = getRouteInfo(player);
    info.alert = game.safety.alert(player);
    updateCabVisuals(dt, player, info);
    if (player.sim.speed > 0.2) game.lastDecel = -player.sim.accel;
    game.score.update(dt, player.sim);
    const boardingBusy = engine.isBoarding(player);
    if (player.sim.doorState === "open") game.boardingDone = !boardingBusy;     // ¿terminó el embarque antes de cerrar?
    hud.updateDriver(player.sim, info, { clock: game.clock, onboard: people.onboardCount(player), boardingBusy });
    updateTurn(dt, player);
    hud.setTurnPanel(turnSteps(player));
    updateStopAssistSound(dt, player.sim, info);
    game.tutorial?.update(dt, { game, sim: player.sim, info });
  } else {
    hud.setTurnPanel(null);
    hud.updatePassenger(walkerHudData());
    hud.updateGuide(missionGuide());
    game.tutorial?.update(dt, { game, walker, card, hud, fare: riderFare(game.clock).price });
  }

  updateHudClockBand();
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
  if (behind < (game.net?.connected ? 0.25 : 1)) return;      // en una sala se sigue de cerca el reloj del anfitrión
  const cameraZ = game.player ? game.player.group.position.z : game.walker.worldZ;
  game.engine.runUntil(game.engine.time + Math.min(behind, 60), {
    step: behind < 2 ? 1 / 30 : 0.5,
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
    const lm = game.city.landmark, band = riderFare(clock), inShop = game.city.inside?.shop;
    return {
      ...base,
      title: inShop ? `${inShop.label.toUpperCase()} · ${inShop.name.toUpperCase()}` : `CALLE${lm ? " · " + lm.name.toUpperCase() : ""}`,
      station: w.station.name,
      sub: `Cuenta ${bank.label} · bip! ${card.label} · pasaje ahora ${formatCLP(band.price)} (${band.label.toLowerCase()}${band.card ? ` ${band.card}` : ""})`,
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
  const combos = st.combos.length ? ` · COMBINACIÓN ${st.combos.map(lineTag).join(", ").toUpperCase()}` : "";
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
    parts.push(` · Combinación ${lineTag(ls.line.id)}: ${dirs.join(" · ")}`);
  }
  return parts.join("");
}
