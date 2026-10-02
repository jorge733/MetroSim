/* ==========================================================================
   MetroSim — Alpha 0.6 · config.js
   Configuración global: Línea 3 del Metro de Santiago, geometría de
   estaciones y trenes, mando, horarios y demanda.

   Ejes del MUNDO: Plaza Quilicura está en z = 0 y la línea avanza hacia -Z
   (Fernando Castillo Velasco ≈ z = -23 400). Altura y = 0: nivel de la losa.
   Doble vía: la vía 1 (hacia F. Castillo Velasco) está en x = +2 y la vía 2
   (hacia Plaza Quilicura) en x = -2. Cada vía tiene su andén lateral.

   Cada sentido de circulación es una "ruta" (route.js) con sus propias
   coordenadas de simulación; ver route.js.

   Las distancias entre estaciones son APROXIMADAS; el orden, los nombres y
   las combinaciones son reales.
   ========================================================================== */

export const VERSION = "ALPHA 0.6";

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
 * Estaciones de la L3 (norte → oriente).
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
const CAR_LENGTH = 18, CAR_GAP = 0.6, CARS = 5;

export const CONFIG = {
  startTime: 8 * 3600,                 // 08:00:00
  station: {
    hallHalf: 60,                      // media longitud del vestíbulo de andenes
    platformHalf: 50,                  // media longitud del andén (cabe un tren de 5 coches)
    stopOffset: -47,                   // la marca de parada (cabeza del tren) está 47 m por delante del centro
    stopTolerance: 2.5,                // ± metros para poder abrir puertas
    trackX: 2.0,                       // ejes de vía en x = ±2
    platformTop: 1.2,
    platformEdgeX: 3.55,               // |x| del borde del andén
    wallX: 8.5,                        // |x| de los muros laterales
    ceilingY: 10.5,                    // techo alto: la mezanina queda dentro del vestíbulo
    platformCeilingY: 6.4,             // altura de las bandejas de luz sobre los andenes
  },
  // Mezanina (vestíbulo superior) con torniquetes. Cotas z relativas al centro de la estación.
  mezzanine: {
    y: 7.2,                            // nivel del piso de la mezanina
    z0: 34, z1: 52,                    // extensión a lo largo de la estación
    gateZ: 44,                         // línea de torniquetes (zona pagada z < gateZ)
    gates: [-2.75, -1.65, -0.55, 0.55, 1.65, 2.75],   // ejes de los pasos de torniquete
    gateHalf: 0.27,                    // medio ancho de paso
    stairZ0: 20, stairZ1: 34,          // escalera desde el andén (abajo) hasta la mezanina (arriba)
    stairX0: 7.0, stairX1: 8.3,        // |x| de la escalera fija (pegada al muro)
    escX0: 5.6, escX1: 6.85,           // |x| de la escalera mecánica de subida
    escSpeed: 0.5,                     // m/s de avance de la escalera mecánica (a lo largo del andén)
    exitHalf: 1.6,                     // medio ancho de la salida a la calle
    // Boletería (zona no pagada, lado −X) y tótems de autoservicio (lado +X)
    booth: { x0: -7.9, x1: -5.3, z0: 46.5, z1: 51.7, windowZ: 47.6 },
    totems: [5.0, 6.3], totemZ: 51.0,
    queue: [[-4.6, 47.6], [-4.6, 48.4], [-4.6, 49.2], [-4.6, 50.0], [-3.8, 50.8], [-3.0, 50.8], [-2.2, 50.8]],
  },
  tunnel: { radius: 5.6, centerY: 1.6, floorY: -0.05 },   // túnel de doble vía (como el NATM de la L3)
  catenary: { contactY: 4.55 },        // catenaria rígida 1500 V CC
  train: {
    cars: CARS,
    carLength: CAR_LENGTH,
    carGap: CAR_GAP,
    length: CARS * CAR_LENGTH + (CARS - 1) * CAR_GAP,      // ≈ 92,4 m (5 coches AS-2014)
    halfWidth: 1.4,
    floorY: 1.25,
    roofY: 3.45,
    doorWidth: 1.4,
    doorHeight: 2.0,
    doorTime: 2.4,                     // segundos en abrir/cerrar
    maxSpeed: 70 / 3.6,
    reverseMaxSpeed: 10 / 3.6,
    tractionBaseSpeed: 9,
  },
  track: { tail: 320, railTop: 0.27 }, // metros de cola de maniobra tras cada terminal
  people: {
    maxWaitingPerSide: 20,             // máx. de viajeros DIBUJADOS esperando en cada andén (las cifras reales: engine/passengers.js)
    maxVisibleOnboard: 70,             // máximo de viajeros dibujados por tren (el resto se cuenta)
    activeRadius: 330,                 // solo se dibujan viajeros a esta distancia de la cámara
    capacity: 700,                     // máximo de personas dibujadas a la vez
  },
  schedule: {
    minDwell: 20,
    peakHeadway: 240,                  // 4 min en hora punta
    offPeakHeadway: 360,               // 6 min fuera de punta
    playerDeparture: 8 * 3600 + 90,    // tu servicio sale de Plaza Quilicura a las 08:01:30
    reverseOffset: 120,                // los servicios de vuelta están desfasados 2 min
    punctualWindow: 30,
  },
  signals: {
    maxBlock: 450,
    stopMargin: 8,
  },
  defaultSpeedLimit: 70,
  renderRadius: 420,
  turnback: {
    cabChangeTime: 40,                 // segundos que tarda un conductor automático en cambiar de cabina
    crossoverFrom: 80, crossoverTo: 135,   // tramo del cambio de vía tras cada terminal (m desde el centro de la estación)
  },
};

/* ---------- Tarjeta bip! y tarifas ----------
   Valores de REFERENCIA para el juego (pesos chilenos). Las tarifas reales de
   Metro cambian con el tiempo: ajústalas aquí si quieres que coincidan con
   las vigentes. Los tramos horarios siguen el esquema punta / valle / baja. */
export const FARES = {
  cardPrice: 1550,                     // precio de una tarjeta bip! nueva
  startBalance: 350,                   // saldo inicial de la tarjeta del jugador
  maxBalance: 25000,
  loadAmounts: [1000, 2000, 3000, 5000, 10000],
  bands: [
    { id: "punta", label: "Hora punta", price: 870, ranges: [[7, 9], [18, 20]] },
    { id: "valle", label: "Hora valle", price: 790, ranges: [[6.5, 7], [9, 18], [20, 20.75]] },
    { id: "baja",  label: "Hora baja",  price: 710, ranges: [[6, 6.5], [20.75, 23]] },
  ],
};

/** Tramo tarifario vigente a una hora (s). Fuera de servicio se usa el de hora baja. */
export function fareBandAt(clockSeconds) {
  const h = (clockSeconds / 3600) % 24;
  return FARES.bands.find(b => b.ranges.some(([a, c]) => h >= a && h < c)) || FARES.bands.at(-1);
}

/** Formato de pesos chilenos: 2350 → "$2.350". */
export const formatCLP = (n) => "$" + Math.round(n).toLocaleString("es-CL");

/* ---------- Estaciones (coordenadas del mundo) ---------- */
let acc = 0;
export const STATIONS = STATION_DATA.map((s, index) => {
  acc += s.gap;
  return {
    ...s,
    id: s.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-"),
    index,
    combos: s.combos || [],
    z: -acc,
    km: acc / 1000,
  };
});

/** Extremos del mundo (incluyendo colas de maniobra en ambos terminales). */
export const WORLD = {
  start: STATIONS[0].z + CONFIG.track.tail,
  end: STATIONS.at(-1).z - CONFIG.track.tail,
  lineLength: STATIONS[0].z - STATIONS.at(-1).z,
};

/* ---------- Limitaciones de velocidad (coordenadas del mundo, from > to) ---------- */
export const WORLD_SPEED_LIMITS = [
  { from: STATIONS[9].z + 300, to: STATIONS[10].z - 200, kmh: 50, label: "ZONA CÉNTRICA" },
];

/* ---------- Mando ---------- */
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

export const REVERSER = {
  1:  { id: "F", label: "ADELANTE" },
  0:  { id: "N", label: "NEUTRO" },
  "-1": { id: "R", label: "ATRÁS" },
};

/** Demanda de viajeros según la hora (0..1): picos ~08:15 y ~18:00. */
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
