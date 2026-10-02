/* ==========================================================================
   MetroSim — Alpha 0.4 · config.js
   Configuración global: Línea 3 del Metro de Santiago, mando, señales,
   horarios y demanda.

   Ejes: el tren avanza hacia -Z (sentido Fernando Castillo Velasco).
   La "posición" de un tren es la Z de su testero delantero.
   Altura de referencia: y = 0 es el nivel de la losa.

   Las distancias entre estaciones son APROXIMADAS (la línea real mide ~25 km
   incluyendo colas de maniobra); el orden, nombres y combinaciones son reales.
   ========================================================================== */

export const VERSION = "ALPHA 0.4";

/* ---------- Línea ---------- */
export const LINE = {
  id: "3",
  name: "LÍNEA 3",
  color: "#8b5a2b",             // café, color oficial de la L3
  colorHex: 0x8b5a2b,
  operator: "METRO DE SANTIAGO",
};

/** Colores de las líneas con las que hay combinación. */
export const LINE_COLORS = {
  "1": "#e1251b", "2": "#f4b400", "3": "#8b5a2b", "4": "#1d3f95",
  "4A": "#3c86c6", "5": "#00965e", "6": "#9b26b6",
};

/**
 * Estaciones de la L3 en orden de servicio (norte → oriente).
 * gap = metros desde la estación anterior (aproximados).
 * combos = líneas de Metro con combinación.
 */
const STATION_DATA = [
  { name: "PLAZA QUILICURA",            short: "PLAZA QUILICURA",   gap: 0 },
  { name: "LO CRUZAT",                  short: "LO CRUZAT",         gap: 1500 },
  { name: "FERROCARRIL",                short: "FERROCARRIL",       gap: 1300 },
  { name: "LOS LIBERTADORES",           short: "LOS LIBERTADORES",  gap: 1700 },
  { name: "CARDENAL CARO",              short: "CARDENAL CARO",     gap: 1600 },
  { name: "VIVACETA",                   short: "VIVACETA",          gap: 1250 },
  { name: "CONCHALÍ",                   short: "CONCHALÍ",          gap: 1150 },
  { name: "PLAZA CHACABUCO",            short: "PZA. CHACABUCO",    gap: 1050 },
  { name: "HOSPITALES",                 short: "HOSPITALES",        gap: 1150 },
  { name: "PUENTE CAL Y CANTO",         short: "CAL Y CANTO",       gap: 1400, combos: ["2"] },
  { name: "PLAZA DE ARMAS",             short: "PLAZA DE ARMAS",    gap: 650,  combos: ["5"] },
  { name: "UNIVERSIDAD DE CHILE",       short: "U. DE CHILE",       gap: 750,  combos: ["1"] },
  { name: "PARQUE ALMAGRO",             short: "PARQUE ALMAGRO",    gap: 950 },
  { name: "MATTA",                      short: "MATTA",             gap: 1050 },
  { name: "IRARRÁZAVAL",                short: "IRARRÁZAVAL",       gap: 1350, combos: ["5"] },
  { name: "MONSEÑOR EYZAGUIRRE",        short: "M. EYZAGUIRRE",     gap: 1200 },
  { name: "ÑUÑOA",                      short: "ÑUÑOA",             gap: 1000, combos: ["6"] },
  { name: "CHILE ESPAÑA",               short: "CHILE ESPAÑA",      gap: 1050 },
  { name: "VILLA FREI",                 short: "VILLA FREI",        gap: 950 },
  { name: "PLAZA EGAÑA",                short: "PLAZA EGAÑA",       gap: 1050, combos: ["4"] },
  { name: "FERNANDO CASTILLO VELASCO",  short: "F. CASTILLO V.",    gap: 1300 },
];

/* ---------- Parámetros generales ---------- */
export const CONFIG = {
  startTime: 8 * 3600,                 // 08:00:00
  track: {},                           // se completa más abajo (depende de las estaciones)
  station: {
    hallHalf: 45,                      // media longitud del vestíbulo de andenes
    platformHalf: 35,                  // media longitud del andén
    stopOffset: -25,                   // la marca de parada está 25 m por delante del centro
    stopTolerance: 2.5,                // ± metros para poder abrir puertas
    platformTop: 1.2,
    platformEdgeX: 1.55,
    wallX: 7,
    ceilingY: 6.6,
    accessZ: 31,                       // accesos (salidas) a ±31 m del centro de la estación
  },
  tunnel: { radius: 3.9, centerY: 2.2, floorY: -0.05 },
  catenary: { contactY: 4.55 },        // catenaria rígida 1500 V CC (como la L3 real)
  train: {
    length: 18,
    halfWidth: 1.4,
    floorY: 1.25,
    roofY: 3.45,
    doorCenters: [6.2, 13.2],
    doorWidth: 1.4,
    doorHeight: 2.0,
    doorTime: 2.4,                     // segundos en abrir/cerrar
    maxSpeed: 70 / 3.6,                // 70 km/h en m/s
    reverseMaxSpeed: 10 / 3.6,         // marcha atrás limitada a 10 km/h
    tractionBaseSpeed: 9,              // por encima de ~32 km/h la tracción cae (potencia constante)
  },
  people: {
    maxWaitingPerStation: 22,
    maxOnboard: 48,
    activeRadius: 330,                 // solo se dibujan viajeros a esta distancia de la cámara
  },
  schedule: {
    minDwell: 20,                      // segundos mínimos de parada
    peakHeadway: 240,                  // 4 min en hora punta
    offPeakHeadway: 360,               // 6 min fuera de punta
    playerDeparture: 8 * 3600 + 90,    // tu servicio sale de Plaza Quilicura a las 08:01:30
    punctualWindow: 30,                // ±30 s se considera puntual
  },
  signals: {
    maxBlock: 450,                     // separación máxima entre señales intermedias
    stopMargin: 8,                     // los trenes automáticos se detienen 8 m antes de una señal roja
  },
  defaultSpeedLimit: 70,
  renderRadius: 420,                   // estaciones y trenes más lejos que esto no se dibujan
};

/* ---------- Estaciones con coordenadas ---------- */
let acc = 0;
export const STATIONS = STATION_DATA.map((s, index) => {
  acc += s.gap;
  const z = -acc;
  return {
    ...s,
    id: s.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-"),
    index,
    combos: s.combos || [],
    z,
    stopZ: z + CONFIG.station.stopOffset,
    km: acc / 1000,
  };
});

const first = STATIONS[0], last = STATIONS.at(-1);
Object.assign(CONFIG.track, {
  start: first.z + 260,                // fondo de saco tras Plaza Quilicura (cocheras)
  depotZ: first.stopZ + 150,           // aquí aparecen los trenes que entran en servicio
  rearLimitZ: first.z + 238,           // marcha atrás: límite del testero
  retireZ: last.stopZ - 140,           // aquí se retiran los trenes al terminar
  bumperZ: last.stopZ - 200,           // topera final
  end: last.stopZ - 209,               // muro final
  railTop: 0.27,
});
export const LINE_LENGTH = first.stopZ - last.stopZ;

/* ---------- Limitaciones de velocidad (z "from" > z "to") ---------- */
export const SPEED_LIMITS = [
  { from: STATIONS[9].z + 300, to: STATIONS[10].z - 200, kmh: 50, label: "CURVAS BAJO EL MAPOCHO" },
  { from: last.z + 300, to: CONFIG.track.end, kmh: 40, label: "ENTRADA A TERMINAL" },
  { from: CONFIG.track.start, to: first.z + 46, kmh: 25, label: "SALIDA DE COCHERAS" },
];

/* ---------- Mando ---------- */
// Posiciones del manipulador combinado tracción/freno. accel en m/s².
export const NOTCHES = [
  { id: "EM", label: "EMERGENCIA", accel: -1.45, type: "emergency" },
  { id: "B3", label: "FRENO 3",    accel: -1.05, type: "brake" },
  { id: "B2", label: "FRENO 2",    accel: -0.70, type: "brake" },
  { id: "B1", label: "FRENO 1",    accel: -0.35, type: "brake" },
  { id: "N",  label: "NEUTRO",     accel: 0,     type: "neutral" },
  { id: "P1", label: "TRACCIÓN 1", accel: 0.30,  type: "power" },
  { id: "P2", label: "TRACCIÓN 2", accel: 0.55,  type: "power" },
  { id: "P3", label: "TRACCIÓN 3", accel: 0.80,  type: "power" },
  { id: "P4", label: "TRACCIÓN 4", accel: 1.05,  type: "power" },
];
export const NOTCH_INDEX = Object.fromEntries(NOTCHES.map((n, i) => [n.id, i]));

// Inversor (sentido de marcha): 1 = adelante, 0 = neutro, -1 = atrás.
export const REVERSER = {
  1:  { id: "F", label: "ADELANTE" },
  0:  { id: "N", label: "NEUTRO" },
  "-1": { id: "R", label: "ATRÁS" },
};

/** Límite de velocidad (km/h) vigente en la coordenada z. */
export function speedLimitAt(z) {
  let limit = CONFIG.defaultSpeedLimit;
  for (const s of SPEED_LIMITS) if (z <= s.from && z >= s.to) limit = Math.min(limit, s.kmh);
  return limit;
}

/**
 * Demanda de viajeros según la hora (0..1).
 * Picos en hora punta de mañana (~08:15) y tarde (~18:00).
 */
export function demandAt(clockSeconds) {
  const h = (clockSeconds / 3600) % 24;
  const peak = (center, width, height) => height * Math.exp(-(((h - center) / width) ** 2));
  const night = h < 6 || h > 23.5 ? 0.05 : 0.22;
  return Math.min(1, night + peak(8.25, 1.1, 0.85) + peak(18, 1.3, 0.75) + peak(14, 1.5, 0.2));
}

/** Nombre en formato natural para la voz ("PLAZA DE ARMAS" → "Plaza de Armas"). */
export function spokenName(name) {
  const small = new Set(["de", "y", "del", "la"]);
  return name.toLowerCase().split(" ").map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
