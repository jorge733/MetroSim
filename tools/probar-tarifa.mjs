// 2.5 · Prueba de la tarifa integrada (js/trip.js): node tools/probar-tarifa.mjs
import assert from "node:assert/strict";
import { quoteStage, commitStage, TRIP_WINDOW_MS } from "../js/trip.js";

let trip = null, t0 = 1_000_000;
const pay = (mode, price, min, route) => {
  const st = { mode, price, route, now: t0 + min * 60000 };
  const q = quoteStage(trip, st);
  trip = commitStage(trip, q, st);
  return q;
};

// Bus $795 → Metro punta $895: paga la diferencia ($100) → otro bus: $0
assert.deepEqual(pay("bus", 795, 0, "210"), { transfer: false, charge: 795, why: undefined });
let q = pay("metro", 895, 30);
assert.equal(q.transfer, true); assert.equal(q.charge, 100);
q = pay("bus", 795, 60, "403");
assert.equal(q.transfer, true); assert.equal(q.charge, 0);
// cuarta etapa: viaje nuevo
q = pay("bus", 795, 70, "109");
assert.equal(q.transfer, false); assert.equal(q.charge, 795); assert.match(q.why, /2 transbordos/);

// Metro dos veces: viaje nuevo
trip = null;
pay("metro", 815, 0);
q = pay("metro", 815, 10);
assert.equal(q.transfer, false); assert.match(q.why, /Metro/);

// Mismo recorrido de bus: no es transbordo
trip = null;
pay("bus", 795, 0, "210");
q = pay("bus", 795, 5, "210");
assert.equal(q.transfer, false); assert.match(q.why, /210/);

// Metro → Tren Nos sí (una etapa de cada uno)
trip = null;
pay("metro", 735, 0);
q = pay("nos", 735, 20);
assert.equal(q.transfer, true); assert.equal(q.charge, 0);

// Vence a los 120 min
trip = null;
pay("bus", 795, 0, "210");
q = pay("metro", 895, TRIP_WINDOW_MS / 60000);
assert.equal(q.transfer, false); assert.equal(q.charge, 895);

// Tren Rancagua: siempre aparte y no corta el viaje integrado
trip = null;
pay("bus", 795, 0, "210");
q = pay("ran", 815, 10);
assert.equal(q.transfer, false); assert.equal(q.charge, 815);
q = pay("metro", 895, 20);
assert.equal(q.transfer, true); assert.equal(q.charge, 100);

// TNE: 260 bus → 260 Metro = $0
trip = null;
pay("bus", 260, 0, "210");
assert.equal(pay("metro", 260, 5).charge, 0);

console.log("tarifa integrada: OK");
