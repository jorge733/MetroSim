/* ==========================================================================
   MetroSim — Alpha 0.6 · main.js
   Punto de entrada: crea la partida y une todos los sistemas.

   Módulos:
     config.js    Línea 3 de Santiago, geometría, mando, horarios y demanda
     route.js     los dos sentidos de circulación (vía 1 y vía 2)
     utils.js     utilidades, materiales y texturas procedurales
     schedule.js  horarios por sentido y retrasos
     signals.js   señalización de bloqueo automático (una por vía)
     sim.js       simulación de un tren y conducción automática
     traffic.js   todos los trenes de la línea
     world.js     túnel, vías, catenaria, estaciones con mezanina y torniquetes
     train.js     tren de 5 coches, cabina y luces
     dmi.js       pantalla de cabina
     people.js    viajeros (NPC) instanciados
     walker.js    pasajero a pie (primera persona)
     audio.js     sonido procedural y megafonía
     camera.js    vistas del conductor
     hud.js       interfaz HTML (incluye boletería y tótem)
     card.js      tarjeta bip! del jugador

   Principio: Conductor y Pasajero comparten el MISMO mundo, el MISMO tráfico
   y los MISMOS viajeros. Solo cambia qué controla el jugador.
   ========================================================================== */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CONFIG, STATIONS, NOTCH_INDEX, FARES, spokenName, fareBandAt, formatCLP } from "./config.js";
import { ROUTES, ROUTE_A, ROUTE_B, routeForSide, oppositeRoute } from "./route.js";
import { BipCard } from "./card.js";
import { $, clamp, formatClock, formatStopError, gradeStop } from "./utils.js";
import { Timetable, formatDelay, makeTrip } from "./schedule.js";
import { SignalSystem } from "./signals.js";
import { TrafficManager } from "./traffic.js";
import { World } from "./world.js";
import { createTrainLights, resetTrainAssets } from "./train.js";
import { PeopleSystem } from "./people.js";
import { Walker } from "./walker.js";
import { AudioSystem } from "./audio.js";
import { CameraRig } from "./camera.js";
import { Hud } from "./hud.js";

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
const directionSelect = $("startDirection");
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Selector de estación del modo pasajero (Universidad de Chile por defecto)
const stationSelect = $("startStation");
STATIONS.forEach(st => {
  const opt = document.createElement("option");
  opt.value = st.index;
  opt.textContent = st.name + (st.combos.length ? `  (L${st.combos.join(", L")})` : "");
  stationSelect.append(opt);
});
stationSelect.value = String(STATIONS.findIndex(s => s.id === "universidad-de-chile"));

document.querySelectorAll("[data-mode]").forEach(btn => btn.addEventListener("click", () => startGame(btn.dataset.mode)));
$("backButton").addEventListener("click", stopGame);
$("soundButton").addEventListener("click", toggleSound);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", onResize);

// Acceso de depuración desde la consola: MetroSim.game.traffic, etc.
window.MetroSim = { get game() { return game; }, CONFIG, STATIONS, ROUTES };


/* ==========================================================================
   Inicio y fin de partida
   ========================================================================== */

function startGame(mode) {
  if (game) stopGame();
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

  /* --- Mundo, señales, horarios y tráfico (ambos sentidos) --- */
  const world = new World(scene);
  const signals = new Map(ROUTES.map(r => [r.id, new SignalSystem(r)]));
  signals.forEach(s => s.build3D(scene));
  const timetables = new Map([
    [ROUTE_A.id, new Timetable(ROUTE_A, CONFIG.schedule.playerDeparture)],
    [ROUTE_B.id, new Timetable(ROUTE_B, CONFIG.schedule.playerDeparture + CONFIG.schedule.reverseOffset)],
  ]);
  const traffic = new TrafficManager({ scene, timetables, signals, onUnitEvent: (u, t, d) => onUnitEvent(u, t, d) });
  const playerTrip = timetables.get(direction.id).anchorTrip;

  game = {
    mode, renderer, scene, camera, world, signals, timetables, traffic, audio, playerTrip,
    clock: CONFIG.startTime, elapsed: 0, last: performance.now(), dmiTimer: 0, pidTimer: 0, raf: 0,
    warming: true,
    stats: { arrivals: [], stops: [], redSignals: 0, overspeeds: 0, emergencies: 0 },
    ride: { origin: null, boardedClock: null },
  };
  if (mode === "driver") traffic.started.add(playerTrip.id);

  /* --- Calentamiento: 45 min de servicio para que la línea ya tenga trenes --- */
  const warmStart = CONFIG.startTime - 45 * 60;
  const people = new PeopleSystem(scene, traffic, warmStart);
  game.people = people;
  for (let t = warmStart, step = 0.25; t < CONFIG.startTime; t += step) {
    traffic.update(step, t);
    people.update(step, t, { cameraZ: 1e9, render: false });
  }
  game.warming = false;

  /* --- Jugador --- */
  game.trainLights = createTrainLights({ cab: mode === "driver" });
  game.innerLight = game.trainLights.getObjectByName("innerLight");
  if (mode === "driver") {
    const player = traffic.createUnit(playerTrip, { isPlayer: true, start: direction.first });
    player.arrivedIdx = player.dockedIdx = 0;
    game.player = player;
    const rig = new CameraRig(camera, player.group);
    rig.setView("cab");
    rig.attach(renderer.domElement);
    game.rig = rig;
    player.group.add(game.trainLights);
    game.lightsUnit = player;
  } else {
    const walker = new Walker({
      scene, camera, traffic, station: STATIONS[stationIndex],
      onEvent: (t, d) => onWalkerEvent(t, d),
      onValidate: () => validateFare(),
    });
    walker.attach(renderer.domElement);
    game.walker = walker;
    scene.add(game.trainLights);
  }

  // Precompila los shaders para evitar tirones la primera vez que se ve cada cosa
  renderer.compile(scene, camera);

  hud.setMode(mode);
  loadingScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  onResize();

  hud.setCard(card);
  hud.showMessage(mode === "driver"
    ? `Servicio ${playerTrip.id} · ${direction.label} · salida ${formatClock(playerTrip.departure)} · abre puertas (D) para el embarque`
    : `${STATIONS[stationIndex].name} · saldo bip! ${card.label} · clic para mirar con el ratón`, "info", 6000);

  game.raf = requestAnimationFrame(loop);
}

function stopGame() {
  if (!game) return;
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

  if (key === "m") return toggleSound();
  if (key === "h") return hud.toggleHelp();

  if (game.walker) {
    const result = game.walker.keyDown(key);
    if (result) hud.showMessage(result.text, result.level);
    return;
  }

  if (key === "c") return game.rig.recenter();
  if (key === "v") {
    game.rig.setView(game.rig.view === "exterior" ? "cab" : "exterior");
    return hud.showMessage(game.rig.view === "exterior" ? "Vista exterior" : "Vista de cabina", "info", 1200);
  }
  const sim = game.player.sim;
  let result = null;
  if (event.repeat && key !== " ") return;
  if (key === "w" || key === "arrowup") result = sim.notchUp();
  else if (key === "s" || key === "arrowdown") result = sim.notchDown();
  else if (key === " ") result = sim.emergencyBrake();
  else if (key === "q") result = sim.shiftReverser(+1);
  else if (key === "e") result = sim.shiftReverser(-1);
  else if (key === "d") result = sim.toggleDoors();
  else if (key === "r") return restartGame();
  else if (key === "t") return changeCab();
  if (result) hud.showMessage(result.text, result.level);
}

function onKeyUp(event) {
  game?.walker?.keyUp(event.key.toLowerCase());
}


/* ==========================================================================
   Eventos de los trenes
   ========================================================================== */

function onUnitEvent(unit, type, data = {}) {
  if (!game || game.warming || !unit.sim) return;
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

function onPlayerEvent(type, data) {
  const audio = game.audio, stats = game.stats;
  switch (type) {
    case "notch": audio.notchClick(); break;
    case "reverser": audio.reverserClunk(); break;
    case "halt": audio.airHiss(0.6); break;
    case "emergency": audio.emergency(); stats.emergencies++; break;
    case "stopped":
      game.lastStop = data;
      if (Math.abs(data.error) > CONFIG.station.stopTolerance) {
        hud.showMessage(`${data.station.name} · FUERA DE POSICIÓN (${formatStopError(data.error)}) · usa marcha atrás (E) si te pasaste`, "warn", 4500);
      }
      break;
    case "arrivedStation": {
      const stop = game.lastStop?.station === data.station ? game.lastStop.error : 0;
      stats.stops.push(Math.abs(stop));
      stats.arrivals.push(data.delay);
      const p = punctuality(data.delay);
      hud.showMessage(`${data.station.name} · parada ${gradeStop(stop)} · llegada ${formatDelay(data.delay)} (${p.text})`, p.cls === "ontime" ? "ok" : "warn", 4500);
      break;
    }
    case "departedStation":
      if (data.delay < -10) hud.showMessage(`Salida anticipada de ${data.station.name} (${formatDelay(data.delay)}) · respeta el horario`, "warn", 4000);
      break;
    case "doorsOpen":
      if (data.station === game.player.route.last) setTimeout(() => game && showDriverSummary(), 2500);
      break;
    case "overspeed":
      stats.overspeeds++;
      hud.showMessage(`EXCESO DE VELOCIDAD · límite ${data.limit} km/h`, "alert");
      break;
    case "redSignal":
      stats.redSignals++;
      game.player.sim.emergencyBrake();
      hud.showMessage(`REBASE DE SEÑAL S${data.signal.id} EN ROJO · frenado de emergencia automático`, "alert", 5000);
      break;
    case "collision":
      audio.impact();
      game.player.sim.emergencyBrake();
      hud.showMessage(`ALCANCE CON EL TREN ${data.other.id} a ${Math.round(data.kmh)} km/h`, "alert", 5000);
      break;
    case "bumper":
      audio.impact();
      hud.showMessage(`IMPACTO CONTRA LA TOPERA a ${Math.round(data.kmh)} km/h`, "alert", 4000);
      break;
  }
}

function punctuality(delay) {
  const w = CONFIG.schedule.punctualWindow;
  if (Math.abs(delay) <= w) return { text: "puntual", cls: "ontime" };
  return delay > 0 ? { text: "con retraso", cls: "late" } : { text: "adelantado", cls: "early" };
}

function showDriverSummary() {
  const s = game.stats;
  const w = CONFIG.schedule.punctualWindow;
  const punctual = s.arrivals.filter(d => Math.abs(d) <= w).length;
  const avgStop = s.stops.length ? s.stops.reduce((a, b) => a + b, 0) / s.stops.length : 0;
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
    case "exit": {
      if (hud.summaryOpen) return;
      const st = data.station;
      const rows = [["Estación de salida", st.name]];
      if (ride.origin && ride.origin !== st) {
        rows.unshift(["Estación de origen", ride.origin.name]);
        rows.push(["Tiempo de viaje", `${Math.round((game.clock - ride.boardedClock) / 60)} min`]);
        rows.push(["Estaciones recorridas", String(Math.abs(st.index - ride.origin.index))]);
      }
      if (ride.fare) rows.push(["Pasaje pagado", `${formatCLP(ride.fare.price)} (${ride.fare.label.toLowerCase()})`]);
      rows.push(["Saldo bip!", card.label]);
      rows.push(["Combinaciones aquí", st.combos.length ? st.combos.map(c => `Línea ${c}`).join(", ") : "ninguna"]);
      rows.push(["Hora", formatClock(game.clock).slice(0, 5)]);
      hud.showSummary({
        kicker: "HAS SALIDO A LA CALLE",
        title: st.name,
        rows,
        continueLabel: "Volver a entrar",
        onContinue: () => { game.walker.enterStation(st); game.ride = { origin: null, boardedClock: null }; },
        onMenu: stopGame,
      });
      break;
    }
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
    ? "No tienes tarjeta bip!: cómprala en la boletería"
    : `Saldo insuficiente (${formatCLP(card.balance)}) · pasaje ${formatCLP(band.price)} · carga en la boletería o en un tótem`, "alert", 4000);
  return { ok: false };
}

/** Abre la boletería o el tótem de autoservicio. */
function openService({ kind, station }) {
  const walker = game.walker;
  walker.frozen = true;
  walker.keys.clear();
  const booth = kind === "boleteria";
  const delay = (a, b) => wait(a + Math.random() * (b - a));
  hud.openTicketPanel({
    kind, station, card, clock: game.clock,
    onLoad: async (amount, method, progress) => {
      if (!card.hasCard) throw new Error(booth ? "No tienes tarjeta: compra una primero" : "Este tótem no vende tarjetas: ve a la boletería");
      if (card.balance + amount > FARES.maxBalance) throw new Error(`El saldo máximo de la tarjeta es ${formatCLP(FARES.maxBalance)}`);
      if (booth) {
        progress(method === "efectivo" ? "Entregas el dinero al cajero…" : "El cajero te acerca el lector de tarjetas…");
        await delay(1200, 2000);
        progress(method === "efectivo" ? "El cajero cuenta el dinero…" : "Procesando pago… aprobado");
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
      game?.audio.loadOk();
      hud.setCard(card);
      return `Carga realizada: ${formatCLP(loaded)} · nuevo saldo ${formatCLP(card.balance)} · comprobante impreso`;
    },
    onBuyCard: async (progress) => {
      progress("El cajero prepara una tarjeta bip! nueva…");
      await delay(1500, 2200);
      card.buyNew();
      game?.audio.loadOk();
      hud.setCard(card);
      return `Tarjeta bip! nueva ${card.maskedNumber} · pagaste ${formatCLP(FARES.cardPrice)} · saldo $0: recuerda cargarla`;
    },
    onClose: () => { if (game?.walker) { game.walker.frozen = false; game.walker.keys.clear(); } },
  });
}

/* ==========================================================================
   Megafonía y sonidos de estado
   ========================================================================== */

function arrivalText(rs) {
  const name = spokenName(rs.name);
  if (rs === rs.route.last) return `${name}. Fin de trayecto. Por favor, abandonen el tren.`;
  if (rs.combos.length) return `${name}. Combinación con Línea ${rs.combos.join(" y Línea ")}.`;
  return `${name}.`;
}

function updateOnboardAnnouncements(unit) {
  if (!unit) return;
  const sim = unit.sim, next = sim.nextStation();
  unit.announced ??= { next: null, arrival: null };
  if (!next || sim.movingBackwards) return;
  if (sim.speedKmh > 8 && sim.doorsClosed && unit.announced.next !== next.id) {
    unit.announced.next = next.id;
    game.audio.announce(`Próxima estación: ${spokenName(next.name)}.`);
  }
  if (sim.position - next.stopZ < 170 && sim.speedKmh > 3 && unit.announced.arrival !== next.id) {
    unit.announced.arrival = next.id;
    game.audio.announce(arrivalText(next));
  }
}

/** Aviso en el andén cuando se acerca un tren al andén del pasajero. */
function updatePlatformAnnouncements() {
  const w = game.walker;
  const side = w?.platformSide();
  if (!side) return;
  const st = w.stationAt(w.pos.z);
  const route = routeForSide(side);
  const rs = st && route.stationOf(st);
  if (!rs || rs === route.last) return;
  for (const u of game.traffic.units) {
    if (u.route !== route) continue;
    const d = u.sim.position - rs.stopZ;
    if (d > 80 && d < 450 && u.sim.speed > 2 && u.platformAnnounced !== st.id) {
      u.platformAnnounced = st.id;
      game.audio.announce(`Tren con destino ${spokenName(route.last.name)}, próximo a llegar. Por favor, manténganse detrás de la línea amarilla.`);
    }
  }
}

function updateStateSounds(unit, level) {
  if (!unit) return;
  const sim = unit.sim, audio = game.audio;
  if (unit.prevDoorState !== undefined && sim.doorState !== unit.prevDoorState && level > 0.3) {
    if (sim.doorState === "opening") audio.doorsOpening(CONFIG.train.doorTime);
    if (sim.doorState === "closing") audio.doorsClosing(CONFIG.train.doorTime);
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
    const arr = trip.arr[next.index];
    const est = Math.max(unit.delay, clock - arr);
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
  const dt = clamp((now - game.last) / 1000, 0, 0.05);
  game.last = now;
  if (hud.summaryOpen) { game.renderer.render(game.scene, game.camera); game.raf = requestAnimationFrame(loop); return; }
  game.elapsed += dt;
  game.clock += dt;
  const { traffic, people, world, signals, audio, walker, player } = game;

  // 1. Trenes y señales
  traffic.update(dt, game.clock);
  if (!game) return;

  // 2. Cámara / jugador
  if (player) {
    traffic.syncVisuals(player.group.position.z);
    game.rig.update(player.sim, game.elapsed);
  } else {
    walker.update(dt);
    traffic.syncVisuals(walker.worldZ);
    walker.update(0);
  }
  game.camera.updateMatrixWorld(true);
  game.camera.getWorldPosition(cameraWorld);
  const cameraZ = cameraWorld.z;

  // 3. Mundo, señales, viajeros, torniquetes y pantallas
  world.update(cameraWorld, dt);
  signals.forEach(s => s.updateVisibility(cameraZ));
  people.update(dt, game.clock, { cameraZ, hideUnit: player && game.rig.view === "cab" ? player : null });
  deckAgents.length = 0;
  people.deckAgents(deckAgents);
  if (walker && walker.space === "world") deckAgents.push(walker.pos);
  const opened = world.updateGates(dt, deckAgents, cameraZ);
  if (opened.some(g => Math.hypot(g.x - cameraWorld.x, g.z - cameraZ) < 10 && !(walker && Math.abs(g.x - walker.pos.x) < 0.5))) audio.bip();
  game.pidTimer -= dt;
  if (game.pidTimer <= 0) { game.pidTimer = 1; world.updatePids(cameraZ, game.clock, (st, side) => traffic.arrivalsFor(st, routeForSide(side), game.clock)); }

  // 4. Luces del tren en foco (la interior sigue al pasajero a lo largo del tren)
  const focus = focusUnit(cameraZ);
  if (focus && focus !== game.lightsUnit) { focus.group.add(game.trainLights); game.lightsUnit = focus; }
  if (walker && walker.unit) game.innerLight.position.z = walker.pos.z;

  // 5. Sonido
  let level = 1, view = "cab", rider = null;
  if (player) { view = game.rig.view; rider = player; }
  else if (walker.unit) { view = "saloon"; rider = walker.unit; }
  else if (focus) {
    const d = Math.abs(traffic.worldCenterZ(focus) - cameraZ);
    level = Math.pow(clamp(1 - d / 230, 0, 1), 1.5);
    view = "exterior";
  }
  updateStateSounds(focus, level);
  updateOnboardAnnouncements(rider);
  updatePlatformAnnouncements();
  const fs = focus?.sim;
  audio.update({
    dt,
    velocity: fs ? fs.velocity : 0,
    speedKmh: fs ? fs.speedKmh : 0,
    accel: fs ? fs.accel : 0,
    braking: fs ? fs.isBraking : false,
    level: focus ? level : 0,
    inStation: STATIONS.some(s => Math.abs(cameraZ - s.z) < CONFIG.station.hallHalf),
    view,
    overspeed: !!player && player.sim.speedKmh > player.sim.currentLimit() + 2,
    crowd: people.crowdLevel(cameraWorld) * (view === "cab" ? 0.5 : 1),
  });

  // 6. HUD
  if (player) {
    const info = getRouteInfo(player);
    updateCabVisuals(dt, player, info);
    hud.updateDriver(player.sim, info, { clock: game.clock, onboard: people.onboardCount(player), boardingBusy: people.isBusy(player) });
  } else {
    hud.updatePassenger(walkerHudData());
  }

  game.renderer.render(game.scene, game.camera);
  game.raf = requestAnimationFrame(loop);
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
    return { ...base, title: `ANDÉN · ${route.label.toUpperCase()}${combos}`, station: st.name, sub: `Próximo tren: ${nextTrainText(st, side)}`, highlight: st };
  }
  return {
    ...base,
    title: `${w.pos.y > CONFIG.mezzanine.y - 0.3 ? "MEZANINA" : "ESCALERA"}${combos}`,
    station: st.name,
    sub: `F. Castillo V.: ${nextTrainText(st, 1)} · Pza. Quilicura: ${nextTrainText(st, -1)}`,
    highlight: st,
  };
}
