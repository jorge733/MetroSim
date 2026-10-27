/* ==========================================================================
   MetroSim — Motor · fleet.js
   1.5 · La FLOTA REAL de cada línea: qué trenes corren por ella y cómo
   se comportan.

   Metro de Santiago tiene dos familias de material rodante:
     · NEUMÁTICOS (líneas 1, 2 y 5): trenes de Alstom de la familia NS
       (NS-74, NS-93, NS-2007, NS-2016). Ruedan sobre neumáticos en pistas
       de rodadura, se guían con ruedas horizontales contra BARRAS GUÍA a
       ambos lados de la vía, que además llevan la corriente (750 V CC). No
       tienen pantógrafo. Agarran mucho más que una rueda de acero (frenan
       y arrancan más fuerte) a cambio de más resistencia a la rodadura.
       Con lluvia, en los tramos al aire libre el neumático pierde agarre.
     · ACERO (líneas 3, 4, 4A y 6): AS-2002 (Alstom, L4 y L4A) y AS-2014
       (CAF, L3 y L6), con pantógrafo y catenaria de 1.500 V CC.

   Cada línea tiene su mezcla de modelos (mix): a cada servicio le toca uno,
   siempre el mismo para el mismo servicio. Los modelos antiguos no tienen
   freno regenerativo (el NS-74 frena con resistencias) ni aire
   acondicionado, y aceleran algo menos.

   Simplificación: todos los trenes se dibujan y se simulan con la misma
   composición de 5 coches y ~120 m (la del AS-2014), para que andenes,
   puertas y viajeros sigan funcionando igual. Lo que cambia por modelo es la
   física, la alimentación, el sonido y el aspecto (pantógrafo, rodado).
   Las cifras son APROXIMADAS: coherentes con cada familia, no oficiales.
   ========================================================================== */

import { STOCK } from "./consist.js";

/** Datos comunes de los trenes de neumáticos (sobre los del AS-2014). */
const RUBBER = {
  tyre: "rubber",
  supply: "barras",                   // barras guía laterales (tercer riel)
  /** Adherencia neumático-pista (seca, en túnel): mucho mayor que acero-acero. */
  adhesion: 0.5,
  /** El neumático deforma: más resistencia a la rodadura. */
  rollingPerKg: 0.026,
  davisB: 40,
  lineVoltage: 750,
  lineDropPerAmp: 0.012,
  /** Con lluvia la pista mojada agarra bastante menos (solo al aire libre). */
  wetAdhesion: 0.3,
};

/** Modelos de tren (datos físicos completos: los de STOCK más los de cada modelo). */
export const STOCKS = {
  "AS-2014": {
    ...STOCK, tyre: "steel", supply: "catenaria", year: 2017, ac: true,
    wetAdhesion: 0.11,
  },
  "AS-2002": {
    ...STOCK, model: "AS-2002", builder: "Alstom", tyre: "steel", supply: "catenaria", year: 2005, ac: false,
    tare: 172000, maxTractive: 270000, maxPower: 3.0e6,
    maxElectricBrake: 280000, maxElectricBrakePower: 3.6e6,
    regenEfficiency: 0.75,
    auxPower: 120000,
    wetAdhesion: 0.11,
  },
  "NS-74": {
    ...STOCK, ...RUBBER, model: "NS-74", builder: "Alstom", year: 1975, ac: false,
    tare: 165000, maxTractive: 290000, maxPower: 2.3e6,
    // Freno eléctrico reostático: frena con los motores, pero la energía se quema en resistencias
    maxElectricBrake: 240000, maxElectricBrakePower: 2.6e6,
    regenEfficiency: 0, regenReceptivity: 0,
    tractionEfficiency: 0.8,
    auxPower: 90000,
  },
  "NS-93": {
    ...STOCK, ...RUBBER, model: "NS-93", builder: "GEC-Alsthom", year: 1997, ac: false,
    tare: 168000, maxTractive: 300000, maxPower: 2.7e6,
    maxElectricBrake: 270000, maxElectricBrakePower: 3.2e6,
    regenEfficiency: 0.6,
    tractionEfficiency: 0.84,
    auxPower: 100000,
  },
  "NS-2007": {
    ...STOCK, ...RUBBER, model: "NS-2007", builder: "Alstom", year: 2009, ac: false,
    tare: 170000, maxTractive: 310000, maxPower: 3.1e6,
    maxElectricBrake: 300000, maxElectricBrakePower: 3.8e6,
    auxPower: 120000,
  },
  "NS-2016": {
    ...STOCK, ...RUBBER, model: "NS-2016", builder: "Alstom", year: 2018, ac: true,
    tare: 172000, maxTractive: 315000, maxPower: 3.3e6,
    maxElectricBrake: 310000, maxElectricBrakePower: 4.0e6,
    auxPower: 170000,
  },
};

/**
 * Flota de cada línea: [modelo, parte de los trenes]. La L5 conserva casi
 * la mitad de su flota de NS-74 (los trenes más antiguos de la red).
 */
export const LINE_FLEETS = {
  "1":  [["NS-2007", 0.55], ["NS-93", 0.45]],
  "2":  [["NS-2016", 0.8], ["NS-74", 0.2]],
  "3":  [["AS-2014", 1]],
  "4":  [["AS-2002", 1]],
  "4A": [["AS-2002", 1]],
  "5":  [["NS-74", 0.49], ["NS-2016", 0.31], ["NS-93", 0.2]],
  "6":  [["AS-2014", 1]],
};

/** Número 0..1 estable a partir de un texto (mismo servicio → mismo tren). */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** Modelo principal de una línea (el más numeroso): el que usa la marcha tipo del horario. */
export function lineStock(line) {
  const fleet = LINE_FLEETS[line?.id] || LINE_FLEETS["3"];
  return STOCKS[fleet[0][0]];
}

/** ¿La línea es de neumáticos? */
export const isRubberLine = (line) => lineStock(line).tyre === "rubber";

/**
 * Modelo de tren que le toca a un servicio de una línea, según la mezcla de
 * su flota (determinista: el mismo servicio siempre lleva el mismo modelo).
 * @param {object} line  línea de network.js
 * @param {string} key   id del servicio (u otro texto estable)
 */
export function stockFor(line, key = "") {
  const fleet = LINE_FLEETS[line?.id] || LINE_FLEETS["3"];
  let x = hash01(`${line?.id}|${key}`);
  for (const [model, share] of fleet) {
    if (x < share) return STOCKS[model];
    x -= share;
  }
  return STOCKS[fleet[0][0]];
}

/** Descripción corta de un modelo para la interfaz ("NS-74 · Alstom · 1975 · neumáticos"). */
export function stockLabel(stock) {
  return `${stock.model} · ${stock.builder} · ${stock.year} · ${stock.tyre === "rubber" ? "neumáticos" : "rueda de acero"}`;
}
