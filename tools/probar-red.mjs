/* ==========================================================================
   MetroSim — tools/probar-red.mjs
   Prueba del multijugador SIN navegador (Node 22 o superior).

   Corre dos motores separados, como en una sala real:
     · el ANFITRIÓN (Centro de Control) en el hilo principal;
     · un CONDUCTOR en un hilo aparte (worker), con su motor réplica.
   Se pasan los mismos mensajes que por la red (net/replica.js), con un
   retardo simulado, y al final se mide cuánto se separan los trenes de
   uno y otro motor. El tren del conductor lo maneja un ATO de prueba.

   Uso:
     node tools/probar-red.mjs            20 min de juego en la Línea 3
     node tools/probar-red.mjs 30 1       30 min en la Línea 1
   ========================================================================== */

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { CONFIG } from "../js/config.js";
import { MetroEngine } from "../js/engine/engine.js";
import { setActiveLine } from "../js/engine/route.js";
import { lineById } from "../js/engine/network.js";
import { lineSnapshot, applySnapshot, ownState, applyOwnState, reserveTrip, tripFrom, tripData, handOverToAto, SNAP_HZ, OWN_HZ } from "../js/net/replica.js";

const STEP = 0.1;                 // paso de simulación de esta prueba (s)
const LATENCY = 0.15;             // retardo de la red simulado (s)

if (isMainThread) await host();
else await driver();

/* ----- Anfitrión ----- */
async function host() {
  const minutes = Number(process.argv[2] || 20), lineId = process.argv[3] || "3";
  const line = lineById(lineId);
  setActiveLine(line);
  CONFIG.startTime = 8 * 3600;
  CONFIG.schedule.playerDeparture = CONFIG.startTime + 90;
  const engine = new MetroEngine({ startTime: CONFIG.startTime - 45 * 60 });
  engine.pcc = { lines: new Set([lineId]) };
  engine.runUntil(CONFIG.startTime, { step: STEP });
  const remoteOrders = [];
  engine.remoteOrder = (type, payload, u) => { remoteOrders.push(type); return { ok: true, text: `${u.id}: aviso por radio`, level: "info" }; };

  const trip = reserveTrip(engine, line.routes[0]);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { lineId, start: CONFIG.startTime, dep: CONFIG.schedule.playerDeparture, time: engine.time, trip: tripData(trip) },
  });
  const inbox = [];
  let replied = null;
  worker.on("message", (m) => {
    if (m.type !== "ready" && m.type !== "noop") inbox.push({ at: engine.time + LATENCY, m });
    if (m.type !== "compare") replied?.();
  });
  await new Promise(r => { replied = r; });

  let remote = null, sent = 0, errors = [], worst = { d: 0 }, checks = 0;
  const end = engine.time + minutes * 60;
  while (engine.time < end) {
    engine.runUntil(engine.time + STEP, { step: STEP });
    // Mensajes del conductor que ya llegaron
    for (const x of inbox.filter(x => x.at <= engine.time)) {
      inbox.splice(inbox.indexOf(x), 1);
      if (x.m.type === "st") {
        if (!remote) {
          remote = engine.line(lineId).traffic.createUnit(trip, { isPlayer: true, start: x.m.p });
          remote.remote = { name: "prueba" };
        }
        applyOwnState(remote, x.m, Math.max(0, engine.time - x.m.t));
      } else if (x.m.type === "compare") compare(x.m.units);
    }
    if (engine.time >= sent + 1 / SNAP_HZ) {
      sent = engine.time;
      const snap = lineSnapshot(engine, lineId);
      worker.postMessage({ type: "snap", snap, at: engine.time + LATENCY });
      // Cada 30 s se comparan las posiciones de los dos motores (en el mismo instante)
      if (engine.time > CONFIG.startTime + 5 && Math.floor(engine.time / 30) !== Math.floor((engine.time - 1 / SNAP_HZ) / 30)) worker.postMessage({ type: "compare", time: engine.time });
    }
    worker.postMessage({ type: "tick", time: engine.time });
    await new Promise(r => { replied = r; });
  }

  function compare(units) {
    checks++;
    const mine = new Map(engine.line(lineId).trains.map(u => [u.id, u]));
    for (const c of units) {
      const u = mine.get(c.i);
      if (!u) continue;
      const d = Math.abs(u.sim.position - c.p);
      errors.push(d);
      if (d > worst.d) worst = { d, id: c.i, own: c.own };
      if (d > 30) console.log(`  ${clock(engine.time)} · ${c.i} separado ${Math.round(d)} m · anfitrión ${u.state} z=${Math.round(u.sim.position)} · conductor ${c.st} z=${Math.round(c.p)}`);
    }
    const missing = [...mine.keys()].filter(id => !units.some(c => c.i === id));
    const extra = units.filter(c => !mine.has(c.i)).map(c => c.i);
    if (missing.length || extra.length) console.log(`  ${clock(engine.time)} · faltan en el conductor: ${missing.join(", ") || "—"} · sobran: ${extra.join(", ") || "—"}`);
  }

  // Órdenes del PCC al tren del conductor: van por radio
  engine.command("control.hold", { trainId: remote?.id });
  engine.runUntil(engine.time + STEP, { step: STEP });

  // El conductor se va: su tren sigue como automático
  const before = remote ? remote.sim.position : null;
  if (remote) handOverToAto(engine, remote);
  engine.runUntil(engine.time + 300, { step: STEP });
  const alive = remote && engine.line(lineId).trains.includes(remote);
  worker.terminate();

  errors.sort((a, b) => a - b);
  const pct = (q) => (errors[Math.floor(q * (errors.length - 1))] ?? 0).toFixed(2);
  console.log(`\nLínea ${lineId} · ${minutes} min · ${checks} comparaciones · ${errors.length} posiciones`);
  console.log(`  separación entre motores: mediana ${pct(0.5)} m · p95 ${pct(0.95)} m · máx ${worst.d.toFixed(2)} m (${worst.id ?? "—"}${worst.own ? ", tren del conductor" : ""})`);
  console.log(`  tren del conductor en el anfitrión: ${remote ? `${remote.id}, ${remote.state}` : "NO SE CREÓ"}`);
  console.log(`  órdenes por radio: ${remoteOrders.join(", ") || "ninguna"}`);
  console.log(`  tras irse el conductor: ${alive ? `sigue como automático (${remote.state}, ${Math.round(before - remote.sim.position)} m recorridos en 5 min)` : "retirado"}`);
  const ok = remote && errors.length && Number(pct(0.95)) < 5 && worst.d < 30 && remoteOrders.length === 1;
  console.log(ok ? "\nOK" : "\nFALLÓ");
  process.exit(ok ? 0 : 1);
}

/* ----- Conductor (motor réplica) ----- */
async function driver() {
  const { lineId, start, dep, time, trip: td } = workerData;
  const line = lineById(lineId);
  setActiveLine(line);
  CONFIG.startTime = start;
  CONFIG.schedule.playerDeparture = dep;
  const engine = new MetroEngine({ startTime: time - 45 * 60 });
  engine.replica = true;
  const trip = tripFrom(engine, td);
  engine.line(lineId).traffic.started.add(trip.id);
  engine.runUntil(time, { step: STEP });
  const traffic = engine.line(lineId).traffic;
  const own = traffic.createUnit(trip, { isPlayer: true, start: trip.route.first });
  own.ato = traffic.makeDriver(own, 0, trip.departure - 150);      // un "conductor" de prueba
  parentPort.postMessage({ type: "ready" });

  const snaps = [];
  let sent = 0;
  parentPort.on("message", (m) => {
    if (m.type === "snap") return snaps.push(m);
    if (m.type === "compare") {
      // Posición de cada tren en el instante del anfitrión (corrigiendo el pequeño desfase de reloj)
      const dt = engine.time - m.time;
      return parentPort.postMessage({ type: "compare", units: traffic.units.map(u => ({ i: u.id, p: u.sim.position + u.sim.velocity * dt, own: u === own, st: u.state })) });
    }
    if (m.type !== "tick") return;
    while (engine.time < m.time) engine.runUntil(engine.time + STEP, { step: STEP });
    for (const s of snaps.filter(s => s.at <= engine.time)) {
      snaps.splice(snaps.indexOf(s), 1);
      applySnapshot(engine, s.snap, { lag: engine.time - s.snap.t, own });
    }
    if (engine.time >= sent + 1 / OWN_HZ) {
      sent = engine.time;
      return parentPort.postMessage({ type: "st", ...ownState(engine, own) });
    }
    parentPort.postMessage({ type: "noop" });
  });
}

function clock(t) {
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
