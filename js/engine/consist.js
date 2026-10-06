/* ==========================================================================
   MetroSim — Motor · consist.js
   El tren AS-2014 (CAF) de las líneas 3 y 6 de Metro de Santiago:
     · composición lógica de 5 coches de ~23,4 m (≈ 120 m en total), con
       4 puertas dobles por costado en cada coche;
     · tipos de coche, puertas, asientos e intercirculación, en coordenadas
       locales del tren (z = 0 en el testero delantero, creciendo hacia la cola);
     · datos físicos del material rodante (STOCK): masas, capacidad, esfuerzo
       de tracción, potencia, freno, resistencia al avance y consumo.

   Son datos puros: los usan tanto la simulación (física, puertas, viajeros)
   como el dibujo 3D (train.js), que construye la geometría a partir de ellos.

   Cifras reales: 5 coches, 120 m, 1.299 personas a 6 p/m², 80 km/h. Las
   demás (masas, esfuerzo, potencia, resistencias) son valores típicos de un
   metro moderno de este tamaño, elegidos para que el tren acelere a
   ~1,1 m/s² con carga normal, como especifican los metros reales.
   ========================================================================== */

import { CONFIG } from "../config.js";

const T = CONFIG.train;
export const CAR = T.carLength, GAP = T.carGap;

/*
  Coche con cabina (z = 0 en el testero): cabina 0…2,75 m, zona de silla de
  ruedas tras la cabina y 4 puertas. Coche intermedio: 4 puertas simétricas.
  Las puertas miden 1,4 m (CONFIG.train.doorWidth) y se reparten cada ~5,5 m.
*/
export const CAR_TYPES = {
  cab: {
    doors: [4.75, 10.15, 15.55, 20.95],
    seatRuns: [[6.15, 9.25], [11.55, 14.65], [16.95, 20.05], [21.85, 23.05]],
    windows: [[0.6, 2.2], [6.35, 9.05], [11.75, 14.45], [17.15, 19.85], [21.95, 22.95]],
    saloonStart: 2.75,
    standZ: [3.35, 7.7, 13.1, 18.5, 22.4],
    maps: [7.7, 18.5],
  },
  middle: {
    doors: [2.95, 8.65, 14.75, 20.45],
    seatRuns: [[0.4, 2.05], [4.35, 7.75], [9.55, 13.85], [15.65, 19.05], [21.35, 23.0]],
    windows: [[0.55, 1.9], [4.55, 7.55], [9.75, 13.65], [15.85, 18.85], [21.5, 22.85]],
    saloonStart: 0.05,
    standZ: [1.2, 6.05, 11.7, 16.95, 22.2],
    maps: [6.05, 11.7, 16.95],
  },
};

/** Composición: tipo, si está girado (cabina trasera) y si lleva pantógrafo. */
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

/* ==========================================================================
   Material rodante: datos físicos
   ========================================================================== */

export const STOCK = {
  model: "AS-2014",
  builder: "CAF",
  cars: CONSIST.length,
  /** Masa en vacío (kg) de los 5 coches. */
  tare: 178000,
  /** Masa media de una persona (kg). */
  paxMass: 70,
  /** Capacidad total a 6 personas/m² (sentados + de pie): cifra oficial. */
  capacity: 1299,
  /** Capacidad "cómoda" a 4 personas/m²: a partir de aquí subir cuesta más. */
  comfortCapacity: 900,
  /** Factor de masas rotativas (ruedas, motores, reductoras). */
  rotary: 1.08,
  /** Coches motores (de 5): reparten el esfuerzo y fijan la masa adherente. */
  motorCars: 4,
  /** Esfuerzo de tracción máximo en llanta (N) hasta la velocidad base. */
  maxTractive: 285000,
  /** Potencia máxima en llanta (W): por encima de la velocidad base el esfuerzo cae como P/v. */
  maxPower: 3.2e6,
  /** Freno eléctrico (regenerativo): esfuerzo máximo (N) y potencia máxima (W). */
  maxElectricBrake: 300000,
  maxElectricBrakePower: 4.0e6,
  /** Por debajo de esta velocidad (m/s) el freno eléctrico se desvanece y entra el de fricción. */
  electricFadeSpeed: 6 / 3.6,
  /** Coeficiente de adherencia rueda-carril (túnel seco). */
  adhesion: 0.22,
  /** Resistencia al avance (Davis) en túnel: A + B·v + C·v² (N), A proporcional a la masa. */
  rollingPerKg: 0.0118,                // N/kg (≈ 1,2 daN/t)
  davisB: 32,                          // N/(m/s)
  davisC: 7.5,                         // N/(m/s)² (aerodinámica en túnel)
  /** Rendimientos y servicios auxiliares (climatización, compresores, alumbrado). */
  tractionEfficiency: 0.88,
  regenEfficiency: 0.8,
  /** Parte de la energía regenerada que aprovecha otro tren (el resto se quema en reóstatos). */
  regenReceptivity: 0.7,
  auxPower: 180000,                    // W
  /** Tensión nominal de la catenaria (V) y caída aproximada por amperio. */
  lineVoltage: 1500,
  lineDropPerAmp: 0.028,
};

/** Masa real del tren (kg) con una carga de viajeros. */
export const trainMass = (load = 0) => STOCK.tare + Math.max(0, load) * STOCK.paxMass;
