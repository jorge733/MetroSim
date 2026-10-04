/* ==========================================================================
   MetroSim — Alpha 0.9 · city/plan.js
   PLAN de la calle de cada estación (sin Three.js): qué locales hay, dónde
   están y qué venden, y qué hito tiene enfrente.

   El plan es determinista (semilla = nombre de la estación): la misma
   estación tiene siempre los mismos locales. Lo usan el dibujo de la calle
   (city/city.js) y el generador de misiones (missions.js), que solo pide
   comprar cosas que de verdad se venden en esa estación.

   Coordenadas LOCALES de la calle (metros):
     · origen = sobre el eje de la línea, a la altura del centro de la estación
     · la avenida va a lo largo de Z (como la línea, que corre bajo ella)
     · calzada |x| < 7 · veredas 7 < |x| < 12 · fachadas en |x| = 12
     · vereda ESTE (+X): acceso al Metro y locales · lado OESTE (−X): el hito
   En el mundo 3D la calle se dibuja lejos del túnel (x = STREET.originX)
   para que nunca se superponga con la estación subterránea.
   ========================================================================== */

import { landmarkFor } from "./catalog.js";

export const STREET = {
  originX: 1500,              // x del mundo donde se dibuja la calle
  halfLen: 92,                // largo transitable: z ∈ [−92, 92]
  roadHalf: 7,
  walkHalf: 12,               // fachadas
  // Acceso al Metro: boca de escalera en la vereda este
  access: { x: 9.6, z: 0, halfX: 1.25, halfZ: 3.2, mouthZ: 3.2 },
  spawn: { x: 9.6, z: 6.2 },
  doorX: 11.2,                // donde se para el jugador para entrar a un local
};

/** Locales: rubro, nombres posibles, color del toldo y lo que venden. */
export const SHOPS = {
  panaderia: {
    label: "Panadería", icon: "🥖", color: "#b5651d",
    names: ["Panadería La Espiga", "Panadería San Camilo", "Panadería El Trigal", "Amasandería Doña Rosa"],
    items: [
      { id: "marraqueta", name: "Marraqueta (1 kg)", price: 2100, tag: "pan" },
      { id: "hallulla", name: "Hallulla (½ kg)", price: 1200, tag: "pan" },
      { id: "amasado", name: "Pan amasado (4 u.)", price: 1600, tag: "pan" },
      { id: "empanada", name: "Empanada de pino", price: 2600 },
      { id: "kuchen", name: "Kuchen de manzana (trozo)", price: 1900 },
      { id: "berlin", name: "Berlín", price: 900 },
    ],
  },
  almacen: {
    label: "Almacén", icon: "🛒", color: "#2c7a3f",
    names: ["Minimarket Don Lucho", "Almacén La Esquina", "Minimarket El Sol", "Almacén Las Rosas"],
    items: [
      { id: "leche", name: "Leche entera 1 L", price: 1190 },
      { id: "huevos", name: "Huevos (docena)", price: 3290 },
      { id: "bebida", name: "Bebida 1,5 L", price: 1890 },
      { id: "palta", name: "Palta Hass (1 kg)", price: 4990 },
      { id: "te", name: "Té (100 bolsitas)", price: 2890 },
      { id: "mantequilla", name: "Mantequilla 250 g", price: 2490 },
    ],
  },
  farmacia: {
    label: "Farmacia", icon: "💊", color: "#1b6fb3",
    names: ["Farmacia del Barrio", "Farmacia Popular", "Farmacia Santa Ana", "Farmacia Central"],
    items: [
      { id: "paracetamol", name: "Paracetamol 500 mg", price: 1390, tag: "remedio" },
      { id: "gel", name: "Alcohol gel", price: 1990 },
      { id: "vitamina", name: "Vitamina C", price: 3490, tag: "remedio" },
      { id: "bloqueador", name: "Protector solar", price: 8990 },
      { id: "parche", name: "Parches curita", price: 990 },
    ],
  },
  banco: {
    label: "Cajero automático", icon: "🏧", color: "#0d4f8b",
    names: ["Banco Andino · Cajero automático"],
    items: [],                // el cajero muestra la cuenta, no vende
  },
  kiosko: {
    label: "Kiosko", icon: "📰", color: "#c9302c",
    names: ["Kiosko Don Pepe", "Kiosko La Esquina", "Kiosko El Diario"],
    items: [
      { id: "diario", name: "Diario", price: 900 },
      { id: "chicle", name: "Chicle", price: 400 },
      { id: "super8", name: "Chocolate Super 8", price: 350 },
      { id: "revista", name: "Revista", price: 3500 },
      { id: "recarga", name: "Recarga de celular", price: 2000 },
      { id: "agua", name: "Agua mineral", price: 990 },
    ],
  },
  cafeteria: {
    label: "Cafetería", icon: "☕", color: "#6b4226",
    names: ["Café Andino", "Café del Metro", "Cafetería La Taza"],
    items: [
      { id: "cortado", name: "Café cortado", price: 2200, tag: "cafe" },
      { id: "capuchino", name: "Capuchino", price: 2800, tag: "cafe" },
      { id: "sandwich", name: "Sándwich ave palta", price: 4500, tag: "almuerzo" },
      { id: "jugo", name: "Jugo natural", price: 2900 },
      { id: "torta", name: "Torta (trozo)", price: 3200 },
    ],
  },
  fuente: {
    label: "Fuente de soda", icon: "🌭", color: "#d4a017",
    names: ["Fuente de Soda El Rápido", "Fuente Alemana", "Sanguchería Don Tito"],
    items: [
      { id: "completo", name: "Completo italiano", price: 2900, tag: "almuerzo" },
      { id: "churrasco", name: "Churrasco italiano", price: 5900, tag: "almuerzo" },
      { id: "barrosluco", name: "Barros Luco", price: 6200, tag: "almuerzo" },
      { id: "papas", name: "Papas fritas", price: 2500 },
      { id: "menu", name: "Menú del día", price: 5900, tag: "almuerzo" },
    ],
  },
  floreria: {
    label: "Florería", icon: "💐", color: "#c2185b",
    names: ["Florería Las Camelias", "Florería Primavera"],
    items: [
      { id: "rosas", name: "Ramo de rosas", price: 9900, tag: "flores" },
      { id: "clavel", name: "Clavel", price: 1500, tag: "flores" },
      { id: "suculenta", name: "Maceta con suculenta", price: 3500 },
    ],
  },
  libreria: {
    label: "Librería", icon: "📚", color: "#5e35b1",
    names: ["Librería El Lector", "Librería y Papelería Central"],
    items: [
      { id: "cuaderno", name: "Cuaderno universitario", price: 1990 },
      { id: "lapiz", name: "Lápiz pasta", price: 500 },
      { id: "mapa", name: "Mapa de Santiago", price: 2500 },
      { id: "libro", name: "Libro de bolsillo", price: 7900 },
    ],
  },
};

/** Locales que hay en todas las estaciones; el resto se reparten según la semilla. */
const ALWAYS = ["panaderia", "almacen", "farmacia", "banco"];
const OPTIONAL = ["cafeteria", "fuente", "floreria", "libreria"];
/** Fachadas de la vereda este (z del centro de cada local). */
const SLOTS = [-66, -44, -22, 22, 44, 66];
/** Kiosko: puesto en la vereda. */
const KIOSK = { x: 10.1, z: -11 };

/** Número pseudoaleatorio reproducible a partir de un texto. */
export function seededRandom(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();

/**
 * Plan de la calle de una estación.
 * @returns {{ station, landmark, shops: Array<{kind, label, icon, color, name, items, x, z, door:{x,z}, stand:boolean}> }}
 */
export function streetPlan(station) {
  if (cache.has(station.name)) return { ...cache.get(station.name), station };
  const rnd = seededRandom(station.name);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const optional = [...OPTIONAL].sort(() => rnd() - 0.5).slice(0, 2);
  const kinds = [...ALWAYS, ...optional].sort(() => rnd() - 0.5);

  const shops = kinds.map((kind, i) => {
    const def = SHOPS[kind];
    const z = SLOTS[i];
    return { kind, label: def.label, icon: def.icon, color: def.color, name: pick(def.names), items: def.items, x: STREET.walkHalf, z, door: { x: STREET.doorX, z }, stand: false };
  });
  const k = SHOPS.kiosko;
  shops.push({ kind: "kiosko", label: k.label, icon: k.icon, color: k.color, name: pick(k.names), items: k.items, x: KIOSK.x, z: KIOSK.z, door: { x: KIOSK.x - 1.9, z: KIOSK.z }, stand: true });

  const plan = { landmark: landmarkFor(station), shops, seed: Math.floor(rnd() * 1e9) };
  cache.set(station.name, plan);
  return { ...plan, station };
}

/** Local de un rubro en una estación (o null). */
export function shopAt(station, kind) {
  return streetPlan(station).shops.find(s => s.kind === kind) || null;
}
