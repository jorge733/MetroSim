/* ==========================================================================
   MetroSim — Alpha 0.4 · main.js
   Punto de entrada: crea la partida y une todos los sistemas.

   Módulos:
     config.js    Línea 3 de Santiago, mando, señales, horarios y demanda
     utils.js     utilidades, materiales y texturas procedurales
     schedule.js  horario (malla de servicios) y retrasos
     signals.js   señalización de bloqueo automático
     sim.js       simulación de un tren (TrainSim) y conducción automática (AutoDriver)
     traffic.js   todos los trenes de la línea
     world.js     túnel, vía, catenaria, estaciones y pantallas de andén
     train.js     modelo 3D del tren, cabina y luces
     dmi.js       pantalla de cabina
     people.js    viajeros (NPC)
     walker.js    pasajero a pie (primera persona)
     audio.js     sonido procedural y megafonía
     camera.js    vistas del conductor
     hud.js       interfaz HTML

   Principio: Conductor y Pasajero comparten el MISMO mundo, el MISMO tráfico
   y los MISMOS viajeros. Solo cambia qué controla el jugador.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS, NOTCH_INDEX, spokenName } from "./config.js";
import { $, clamp, formatClock, formatStopError, gradeStop } from "./utils.js";
import { Timetable, formatDelay } from "./schedule.js";
import { SignalSystem } from "./signals.js";
import { TrafficManager } from "./traffic.js";
import { World } from "./world.js";
import { createTrainLights } from "./train.js";
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

let game = null;                 // estado de la partida activa
let muted = loadMuted();
hud.setSound(!muted);

// Selector de estación inicial del modo pasajero (Universidad de Chile por defecto)
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

// Acceso de depuración desde la consola del navegador: MetroSim.game.traffic, etc.
window.MetroSim = { get game() { return game; }, CONFIG, STATIONS };


/* ==========================================================================
   Inicio y fin de partida
   ========================================================================== */

function startGame(mode) {
  if (game) stopGame();
  const stationIndex = Number(stationSelect.value) || 0;
  startScreen.classList.add("hidden");
  loadingScreen.classList.remove("hidden");

  // El audio debe crearse dentro del gesto del usuario (este clic)
  const audio = new AudioSystem();
  audio.muted = muted;
  audio.start();

  // Se deja pintar la pantalla de carga antes del trabajo pesado
  setTimeout(() => buildGame(mode, stationIndex, audio), 40);
}

function buildGame(mode, stationIndex, audio) {
  /* --- Render --- */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));   // resolución 1:1 (rendimiento en GPU integradas)
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  gameContainer.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040608);
  scene.fog = new THREE.Fog(0x040608, 30, 240);
  scene.add(new THREE.HemisphereLight(0xb9cde4, 0x15171a, 0.55));
  const camera = new THREE.PerspectiveCamera(mode === "driver" ? 62 : 70, innerWidth / innerHeight, 0.03, 340);

  /* --- Mundo, señales, horario y tráfico --- */
  const world = new World(scene);
  const signals = new SignalSystem();
  signals.build3D(scene);
  const timetable = new Timetable();
  const traffic = new TrafficManager({ scene, timetable, signals, onUnitEvent: (u, t, d) => onUnitEvent(u, t, d) });

  game = {
    mode, renderer, scene, camera, world, signals, timetable, traffic, audio,
    clock: CONFIG.startTime, elapsed: 0, last: performance.now(), dmiTimer: 0, pidTimer: 0, raf: 0,
    warming: true,
    stats: { arrivals: [], stops: [], redSignals: 0, overspeeds: 0, emergencies: 0 },
    ride: { origin: null, boardedClock: null, stations: 0 },
  };

  if (mode === "driver") traffic.started.add(timetable.playerTrip.id);   // ese servicio lo conduces tú

  /* --- Calentamiento: 45 min de servicio simulado para que la línea ya tenga trenes --- */
  const warmStart = CONFIG.startTime - 45 * 60;
  const people = new PeopleSystem(scene, traffic, warmStart);
  game.people = people;
  const step = 0.25;
  for (let t = warmStart; t < CONFIG.startTime; t += step) {
    traffic.update(step, t);
    people.update(step, t, { cameraZ: 1e9 });
  }
  game.warming = false;

  /* --- Jugador --- */
  game.trainLights = createTrainLights({ cab: mode === "driver" });
  if (mode === "driver") {
    const player = traffic.createUnit(timetable.playerTrip, { isPlayer: true, start: STATIONS[0] });
    player.arrivedIdx = player.dockedIdx = 0;        // ya está en el andén de Plaza Quilicura
    game.player = player;
    const rig = new CameraRig(camera, player.group);
    rig.setView("cab");
    rig.attach(renderer.domElement);
    game.rig = rig;
    player.group.add(game.trainLights);
    game.lightsUnit = player;
  } else {
    const walker = new Walker({ scene, camera, traffic, station: STATIONS[stationIndex], onEvent: (t, d) => onWalkerEvent(t, d) });
    walker.attach(renderer.domElement);
    game.walker = walker;
    scene.add(game.trainLights);
  }

  hud.setMode(mode);
  loadingScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  onResize();

  hud.showMessage(mode === "driver"
    ? `Servicio ${timetable.playerTrip.id} · salida 08:01:30 · abre puertas (D) para el embarque`
    : `Andén de ${STATIONS[stationIndex].name} · clic en la pantalla para mirar con el ratón`, "info", 6000);

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

/* ---------- Sonido on/off (recordado entre sesiones) ---------- */
function loadMuted() {
  try { return localStorage.getItem("metrosim.muted") === "1"; } catch { return false; }
}

function toggleSound() {
  muted = !muted;
  try { localStorage.setItem("metrosim.muted", muted ? "1" : "0"); } catch { /* almacenamiento no disponible */ }
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

  if (key === "m") return toggleSound();
  if (key === "h") return hud.toggleHelp();

  // Pasajero a pie
  if (game.walker) {
    const result = game.walker.keyDown(key);
    if (result) hud.showMessage(result.text, result.level);
    return;
  }

  // Conductor
  if (key === "c") return game.rig.recenter();
  if (key === "v") {
    game.rig.setView(game.rig.view === "exterior" ? "cab" : "exterior");
    return hud.showMessage(game.rig.view === "exterior" ? "Vista exterior" : "Vista de cabina", "info", 1200);
  }
  const sim = game.player.sim;
  let result = null;
  if (event.repeat && key !== " ") return;     // el mando avanza una posición por pulsación
  if (key === "w" || key === "arrowup") result = sim.notchUp();
  else if (key === "s" || key === "arrowdown") result = sim.notchDown();
  else if (key === " ") result = sim.emergencyBrake();
  else if (key === "q") result = sim.shiftReverser(+1);
  else if (key === "e") result = sim.shiftReverser(-1);
  else if (key === "d") result = sim.toggleDoors();
  else if (key === "r") return restartGame();
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
  if (unit === game.player) return onPlayerEvent(type, data);

  // Trenes automáticos: solo interesan si el pasajero va en ellos
  const walker = game.walker;
  if (!walker) return;
  const riding = walker.unit === unit;
  switch (type) {
    case "ato:arrived":
      if (riding) hud.showMessage(`Estación ${data.station.name}`, "ok", 3500);
      break;
    case "ato:doorsClosing":
      if (riding && data.station === STATIONS.at(-1)) {
        // Fin de trayecto: el tren se retira y todos deben bajar
        walker.exitTrain();
        walker.placeOnPlatform(data.station);
        hud.showMessage("Fin de trayecto · todos los viajeros han bajado en F. Castillo Velasco", "info", 5000);
      } else if (riding || (walker.space === "world" && walker.stationAt(walker.pos.z) === data.station)) {
        hud.showMessage("Atención: cierre de puertas", "warn");
      }
      break;
    case "ato:departing":
      if (riding && data.next) hud.showMessage(`Próxima estación: ${data.next.name}`, "info", 3500);
      break;
  }
}

/** Eventos del tren del jugador (Modo Conductor). */
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
      if (data.station === STATIONS.at(-1)) setTimeout(() => game && showDriverSummary(), 2500);
      break;
    case "overspeed":
      stats.overspeeds++;
      hud.showMessage(`EXCESO DE VELOCIDAD · límite ${data.limit} km/h`, "alert");
      break;
    case "redSignal": {
      stats.redSignals++;
      game.player.sim.emergencyBrake();
      hud.showMessage(`REBASE DE SEÑAL S${data.signal.id} EN ROJO · frenado de emergencia automático`, "alert", 5000);
      break;
    }
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
    title: "Fernando Castillo Velasco",
    rows: [
      ["Estaciones servidas", `${s.arrivals.length} / ${STATIONS.length - 1}`],
      ["Llegadas puntuales (±30 s)", `${punctual} / ${s.arrivals.length}`],
      ["Retraso final", formatDelay(s.arrivals.at(-1) ?? 0)],
      ["Precisión media de parada", `${avgStop.toFixed(2)} m`],
      ["Señales rebasadas en rojo", String(s.redSignals)],
      ["Excesos de velocidad", String(s.overspeeds)],
      ["Frenos de emergencia", String(s.emergencies)],
    ],
    continueLabel: "Nuevo servicio",
    onContinue: restartGame,
    onMenu: stopGame,
  });
}

/** Eventos del pasajero a pie. */
function onWalkerEvent(type, data) {
  const ride = game.ride;
  switch (type) {
    case "boarded":
      if (!ride.origin) { ride.origin = data.unit.sim.dockedStation(); ride.boardedClock = game.clock; }
      hud.showMessage(`Has subido al tren ${data.unit.id} · dirección F. Castillo Velasco`, "ok", 3500);
      break;
    case "alighted":
      if (data.station) hud.showMessage(`Has bajado en ${data.station.name}`, "ok", 3500);
      break;
    case "exit": {
      const st = data.station;
      const rows = [["Estación de salida", st.name]];
      if (ride.origin && ride.origin !== st) {
        rows.unshift(["Estación de origen", ride.origin.name]);
        rows.push(["Tiempo de viaje", `${Math.round((game.clock - ride.boardedClock) / 60)} min`]);
        rows.push(["Estaciones recorridas", String(Math.abs(st.index - ride.origin.index))]);
      }
      rows.push(["Combinaciones aquí", st.combos.length ? st.combos.map(c => `Línea ${c}`).join(", ") : "ninguna"]);
      rows.push(["Hora", formatClock(game.clock).slice(0, 5)]);
      hud.showSummary({
        kicker: "HAS SALIDO DE LA ESTACIÓN",
        title: st.name,
        rows,
        continueLabel: "Volver al andén",
        onContinue: () => { game.walker.placeOnPlatform(st); game.ride = { origin: null, boardedClock: null }; },
        onMenu: stopGame,
      });
      break;
    }
  }
}


/* ==========================================================================
   Megafonía y sonidos de estado
   ========================================================================== */

function arrivalText(st) {
  const name = spokenName(st.name);
  if (st === STATIONS.at(-1)) return `${name}. Fin de trayecto. Por favor, abandonen el tren.`;
  if (st.combos.length) return `${name}. Combinación con Línea ${st.combos.join(" y Línea ")}.`;
  return `${name}.`;
}

/** Anuncios dentro del tren en el que va el jugador. */
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

/** Aviso en el andén cuando se acerca un tren a la estación del pasajero. */
function updatePlatformAnnouncements() {
  const w = game.walker;
  if (!w || w.space !== "world") return;
  const st = w.stationAt(w.pos.z);
  if (!st || st === STATIONS.at(-1)) return;
  for (const u of game.traffic.units) {
    const d = u.sim.position - st.stopZ;
    if (d > 60 && d < 420 && u.sim.speed > 2 && u.platformAnnounced !== st.id) {
      u.platformAnnounced = st.id;
      game.audio.announce("Tren con destino Fernando Castillo Velasco, próximo a llegar. Por favor, manténganse detrás de la línea amarilla.");
    }
  }
}

/** Sonidos ligados a cambios de estado del tren que se oye (puertas, aire del freno). */
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

  // Próxima señal
  const s = game.signals.nextAhead(sim.position);
  const signal = s ? { id: s.id, aspect: s.aspect, distance: sim.position - s.z } : null;

  // Horario
  let schedule = null;
  const trip = unit.trip, clock = game.clock;
  if (trip) {
    if (docked && docked !== STATIONS.at(-1)) {
      const dep = trip.dep[docked.index];
      const wait = dep - clock;
      schedule = wait > 0
        ? { label: `Salida ${formatClock(dep)}`, delayText: `espera ${formatDelay(wait).replace("+", "")}`, cls: "early", color: "#ffd166" }
        : { label: `Salida ${formatClock(dep)}`, delayText: formatDelay(-wait), ...delayStyle(-wait) };
    } else if (next) {
      const arr = trip.arr[next.index];
      // Retraso estimado: el último medido, o el actual si ya vamos tarde respecto a la llegada
      const est = Math.max(unit.delay, clock - arr);
      schedule = { label: `Llegada ${next.short} ${formatClock(arr)}`, delayText: formatDelay(est), ...delayStyle(est) };
    }
  }

  const first = STATIONS[0].stopZ, last = STATIONS.at(-1).stopZ;
  return {
    docked, next,
    distance: next ? sim.position - next.stopZ : 0,
    approach,
    limit: sim.currentLimit(),
    progress: (first - sim.position) / (first - last),
    signal, schedule,
  };
}

function delayStyle(d) {
  const w = CONFIG.schedule.punctualWindow;
  if (Math.abs(d) <= w) return { cls: "ontime", color: "#6fe39a" };
  return d > 0 ? { cls: "late", color: "#ff6b6b" } : { cls: "early", color: "#ffd166" };
}

/** Palanca, inversor, pilotos y DMI de la cabina del jugador. */
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
  setLamp(model.lamps.doorLeft, doorsActive && (sim.doorState === "open" || blink));
  setLamp(model.lamps.doorRight, doorsActive && (sim.doorState === "open" || blink));
  setLamp(model.lamps.traction, sim.accel > 0.05 && sim.reverser !== 0);
  setLamp(model.lamps.brake, sim.accel < -0.05);
  setLamp(model.lamps.emergency, sim.emergency && blink);

  game.dmiTimer -= dt;
  if (game.dmiTimer <= 0) { model.dmi.draw(sim, info); game.dmiTimer = 1 / 12; }
}

/** Tren "en foco": el del jugador, aquel en el que va el pasajero o el que se acerca a su andén. */
function focusUnit() {
  if (game.player) return game.player;
  const w = game.walker;
  if (w.unit) return w.unit;
  const z = w.worldZ;
  let best = null, bestD = Infinity;
  for (const u of game.traffic.units) {
    const center = u.sim.position + CONFIG.train.length / 2;
    const d = center - z;
    const score = d > -20 ? Math.abs(d) : Math.abs(d) * 3;    // se prefiere el que viene hacia el andén
    if (score < bestD) { bestD = score; best = u; }
  }
  return best;
}


/* ==========================================================================
   Bucle principal
   ========================================================================== */

const cameraWorld = new THREE.Vector3();

function loop(now) {
  if (!game) return;
  const dt = clamp((now - game.last) / 1000, 0, 0.05);
  game.last = now;
  if (hud.summaryOpen) { game.raf = requestAnimationFrame(loop); game.renderer.render(game.scene, game.camera); return; }
  game.elapsed += dt;
  game.clock += dt;
  const { traffic, people, world, signals, audio, walker, player } = game;

  // 1. Simulación de todos los trenes y señales
  traffic.update(dt, game.clock);
  if (!game) return;                                // la partida pudo cerrarse por un evento

  // 2. Cámara / jugador
  let cameraZ;
  if (player) {
    traffic.syncVisuals(player.sim.position);
    game.rig.update(player.sim, game.elapsed);
    game.camera.getWorldPosition(cameraWorld);
    cameraZ = cameraWorld.z;
  } else {
    walker.update(dt);
    cameraZ = walker.worldZ;
    traffic.syncVisuals(cameraZ);
    walker.update(0);                               // recoloca la cámara con el tren ya movido
  }

  // 3. Mundo, señales y viajeros cercanos
  world.update(cameraZ);
  signals.updateVisibility(cameraZ);
  people.update(dt, game.clock, { cameraZ, hideUnit: player && game.rig.view === "cab" ? player : null });
  game.pidTimer -= dt;
  if (game.pidTimer <= 0) { game.pidTimer = 1; world.updatePids(cameraZ, game.clock, st => traffic.arrivalsFor(st, game.clock)); }

  // 4. Luces del tren en foco
  const focus = focusUnit();
  if (focus && focus !== game.lightsUnit) { focus.group.add(game.trainLights); game.lightsUnit = focus; }

  // 5. Sonido
  let level = 1, view = "cab", rider = null;
  if (player) { view = game.rig.view; rider = player; }
  else if (walker.unit) { view = "saloon"; rider = walker.unit; }
  else if (focus) {
    const d = Math.abs(focus.sim.position + CONFIG.train.length / 2 - cameraZ);
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
    crowd: people.crowdLevel(cameraZ) * (view === "cab" ? 0.5 : 1),
  });

  // 6. HUD
  if (player) {
    const info = getRouteInfo(player);
    updateCabVisuals(dt, player, info);
    hud.updateDriver(player.sim, info, {
      clock: game.clock,
      onboard: people.onboardCount(player),
      boardingBusy: people.isBusy(player),
    });
  } else {
    hud.updatePassenger(walkerHudData());
  }

  game.renderer.render(game.scene, game.camera);
  game.raf = requestAnimationFrame(loop);
}

/** Datos del panel del pasajero a pie. */
function walkerHudData() {
  const w = game.walker, clock = game.clock;
  const base = { clock, worldZ: w.worldZ, hint: w.hint() };
  if (w.unit) {
    const sim = w.unit.sim;
    const docked = sim.isStopped ? sim.dockedStation() : null;
    const next = sim.nextStation();
    const people = game.people.onboardCount(w.unit);
    if (docked) {
      const doors = { open: "Puertas abiertas", opening: "Abriendo puertas", closing: "Cierre de puertas", closed: "Puertas cerradas" }[sim.doorState];
      return { ...base, title: `A BORDO · ${w.unit.id}`, station: docked.name, sub: `${doors} · ${people} viajeros`, highlight: docked };
    }
    return {
      ...base,
      title: `A BORDO · ${w.unit.id} · PRÓXIMA ESTACIÓN`,
      station: next ? next.name : "VÍA DE RETIRADA",
      sub: `${Math.round(sim.speedKmh)} km/h · ${next ? Math.max(0, Math.round(sim.position - next.stopZ)) + " m" : ""} · ${people} viajeros`,
      highlight: next,
    };
  }
  const st = w.stationAt(w.pos.z) || w.station;
  const arrivals = game.traffic.arrivalsFor(st, clock);
  const first = arrivals[0];
  let sub;
  if (st === STATIONS.at(-1)) sub = "Fin de trayecto · los trenes no admiten viajeros aquí";
  else if (!first) sub = "Sin trenes previstos";
  else if (first.here) sub = "Tren en el andén";
  else sub = `Próximo tren: ${first.minutes < 1 ? "llegando" : first.minutes + " min"}${arrivals[1] ? ` · siguiente: ${arrivals[1].minutes} min` : ""}`;
  const combos = st.combos.length ? ` · Combinación L${st.combos.join(", L")}` : "";
  return { ...base, title: `ANDÉN · DIRECCIÓN F. CASTILLO VELASCO${combos}`, station: st.name, sub, highlight: st };
}
