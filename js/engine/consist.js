/* ==========================================================================
   MetroSim — Motor · consist.js
   Composición lógica del tren AS-2014 de 5 coches: tipos de coche, puertas,
   asientos e intercirculación, en coordenadas locales del tren (z = 0 en el
   testero delantero, creciendo hacia la cola).

   Son datos puros: los usan tanto la simulación (puertas, viajeros) como el
   dibujo 3D (train.js), que construye la geometría a partir de ellos.
   ========================================================================== */

import { CONFIG } from "../config.js";

const T = CONFIG.train;
export const CAR = T.carLength, GAP = T.carGap;

export const CAR_TYPES = {
  cab: {
    doors: [6.2, 13.2],
    seatRuns: [[3.0, 5.35], [7.05, 12.35], [14.05, 17.7]],
    windows: [[0.6, 2.2], [3.3, 5.1], [7.5, 9.6], [9.8, 11.9], [14.3, 17.4]],
    saloonStart: 2.75,
    standZ: [4.2, 8.3, 10.6, 15.2, 16.6],
    maps: [8.7, 15.85],
  },
  middle: {
    doors: [4.6, 13.4],
    seatRuns: [[0.5, 3.75], [5.45, 12.55], [14.25, 17.5]],
    windows: [[0.8, 3.5], [5.6, 8.9], [9.1, 12.4], [14.5, 17.2]],
    saloonStart: 0.05,
    standZ: [2.1, 7.2, 9.0, 10.8, 15.9],
    maps: [9.0],
  },
};

/** Composición del tren: tipo, si está girado (cabina trasera) y si lleva pantógrafo. */
export const CONSIST = [
  { type: "cab", flipped: false, panto: false },
  { type: "middle", flipped: false, panto: true },
  { type: "middle", flipped: false, panto: false },
  { type: "middle", flipped: false, panto: true },
  { type: "cab", flipped: true, panto: false },
].map((c, i) => ({ ...c, offset: i * (CAR + GAP) }));

/** Convierte una coordenada z de un coche a coordenadas del tren. */
export const carToTrainZ = (car, z) => car.offset + (car.flipped ? CAR - z : z);

/** Disposición interior del tren completo (en coordenadas locales del tren). */
export const TRAIN_LAYOUT = (() => {
  const doors = [];
  CONSIST.forEach(car => CAR_TYPES[car.type].doors.forEach(zc => doors.push(carToTrainZ(car, zc))));
  doors.sort((a, b) => a - b);
  const gangways = CONSIST.slice(0, -1).map(car => [car.offset + CAR - 0.15, car.offset + CAR + GAP + 0.15]);
  return { length: T.length, doors, gangways, aisle: [2.95, T.length - 2.95] };
})();
