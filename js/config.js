/* ==========================================================================
   MetroSim — Alpha 0.6 · config.js
   Configuración global: geometría de estaciones y trenes, mando, horarios,
   demanda y la LÍNEA ACTIVA (la que se juega y se construye en 3D).

   Las estaciones de todas las líneas están en engine/network.js. Al empezar
   una partida se elige una línea (route.js → setActiveLine) y LINE,
   STATIONS, WORLD y WORLD_SPEED_LIMITS pasan a ser los de esa línea: todos
   los módulos que los importan ven el cambio (enlaces "vivos" de los
   módulos ES).

   Ejes del MUNDO: la primera estación de la línea está en z = 0 y la línea
   avanza hacia -Z. Altura y = 0: nivel de la losa. Doble vía: la vía 1 (de
   ida) está en x = +2 y la vía 2 (de vuelta) en x = -2. Cada vía tiene su
   andén lateral.

   Cada sentido de circulación es una "ruta" (route.js) con sus propias
   coordenadas de simulación; ver route.js.

   Las distancias entre estaciones son APROXIMADAS; el orden, los nombres y
   las combinaciones son reales.
   ========================================================================== */

export const VERSION = "ALPHA 0.9";

/* ---------- Colores oficiales de las líneas ---------- */
export const LINE_COLORS = {
  "1": "#e1251b", "2": "#f4b400", "3": "#8b5a2b", "4": "#1d3f95",
  "4A": "#3c86c6", "5": "#00965e", "6": "#9b26b6",
};

/* ---------- Línea activa (la que se juega) ---------- */
/** Datos de la línea activa: id, nombre, color… */
export let LINE = null;
/** Estaciones de la línea activa (coordenadas del mundo). */
export let STATIONS = [];
/** Extremos del mundo de la línea activa (incluyendo colas de maniobra). */
export let WORLD = null;
/** Limitaciones de velocidad de la línea activa (coordenadas del mundo, from > to). */
export let WORLD_SPEED_LIMITS = [];

/**
 * Cambia la línea activa (lo llama route.js → setActiveLine).
 * @param {object} line  línea de engine/network.js
 */
export function setActiveLineData(line) {
  LINE = { id: line.id, name: line.name, color: line.color, colorHex: line.colorHex, operator: "METRO DE SANTIAGO" };
  STATIONS = line.stations;
  WORLD = {
    start: STATIONS[0].z + CONFIG.track.tail,
    end: STATIONS.at(-1).z - CONFIG.track.tail,
    lineLength: STATIONS[0].z - STATIONS.at(-1).z,
  };
  WORLD_SPEED_LIMITS = line.speedLimits;
}

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
    // Pasillo de combinación (muro +X, zona pagada, entre la escalera y el ascensor)
    transfer: { z0: 36.4, z1: 39.2, h: 2.6 },
    // Boletería (zona no pagada, lado −X) y tótems de autoservicio (lado +X)
    booth: { x0: -7.9, x1: -5.3, z0: 46.5, z1: 51.7, windowZ: 47.6 },
    totems: [5.0, 6.3], totemZ: 51.0,
    queue: [[-4.6, 47.6], [-4.6, 48.4], [-4.6, 49.2], [-4.6, 50.0], [-3.8, 50.8], [-3.0, 50.8], [-2.2, 50.8]],
  },
  // Salida a la calle SIN teletransporte: desde la puerta de la mezanina (z = +52) un pasillo y un
  // primer tramo de escalera suben hasta un descanso; desde ahí sigue la escalera del acceso de la
  // calle (city/city.js), que está construida justo encima de la estación. Cotas z relativas al centro.
  exit: {
    halfW: 1.25,                       // medio ancho de la escalera (igual que la del acceso de la calle)
    corridorZ1: 56,                    // fin del pasillo a nivel de mezanina (empieza en la puerta, +52)
    flightZ1: 62.4,                    // fin del primer tramo de escalera = inicio del descanso
    rise: 3.0,                         // desnivel del primer tramo (mezanina → descanso)
    // Calle: su origen local (centro de la vereda del acceso en x=9,6) queda en estas cotas del mundo
    streetX: -9.6, streetY: 13.2, streetDz: 65.6,
  },
  // Ascensor de accesibilidad (uno por andén, zona pagada): andén ↔ mezanina. Cotas como la mezanina.
  elevator: {
    x0: 6.6, x1: 8.45,                 // |x| del pozo (pegado al muro; la puerta mira a las vías)
    z0: 40.2, z1: 42.6,                // extensión a lo largo de la estación
    doorHalf: 0.55,                    // medio ancho de la puerta
    doorTime: 1.6,                     // s en abrir / cerrar
    dwell: 6,                          // s con las puertas abiertas antes de cerrar solas
    speed: 1.0,                        // m/s de la cabina (6 m de desnivel ≈ 7 s)
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
    liftShare: 0.12,                   // parte de los viajeros dibujados que usa el ascensor (si no va lleno)
    maxWaitingPerSide: 20,             // máx. de viajeros DIBUJADOS esperando en cada andén (las cifras reales: engine/passengers.js)
    maxVisibleOnboard: 70,             // máximo de viajeros dibujados por tren (el resto se cuenta)
    activeRadius: 330,                 // solo se dibujan viajeros a esta distancia de la cámara
    capacity: 700,                     // máximo de personas dibujadas a la vez
  },
  schedule: {
    minDwell: 20,
    peakHeadway: 240,                  // 4 min en hora punta
    offPeakHeadway: 360,               // 6 min fuera de punta
    playerDeparture: 8 * 3600 + 90,    // referencia de las mallas (en el juego: ~1,5 min después de la hora local)
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
  startBalance: 0,                     // (Alpha 0.9) el jugador empieza sin tarjeta: la compra y la carga con su débito
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
