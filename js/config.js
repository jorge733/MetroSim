/* ==========================================================================
   MetroSim — 1.1 · config.js
   Configuración global: geometría de estaciones y trenes, mando, horarios,
   calendario (día laboral / sábado / domingo-festivo), demanda y la LÍNEA
   ACTIVA (la que se juega y se construye en 3D).

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

   1.1 — Realismo: tren AS-2014 real (5 coches, ~120 m, 1.299 personas a
   6 p/m², 80 km/h), andenes de 125 m, horario comercial según el tipo de día
   y curva de demanda horaria de un día real de Santiago.
   ========================================================================== */

export const VERSION = "1.2";

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
// AS-2014 (CAF) de las líneas 3 y 6: 5 coches, ~120 m de largo total
const CAR_LENGTH = 23.4, CAR_GAP = 0.6, CARS = 5;

export const CONFIG = {
  startTime: 8 * 3600,                 // 08:00:00
  dayType: "laboral",                  // tipo de día (lo fija main.js con la fecha local: dayTypeOf)
  station: {
    // Cotas z relativas al centro de la estación. El andén mide 125 m (cabe el
    // tren de 120 m); la mezanina queda sobre el extremo +Z, así que el andén y
    // el vestíbulo se alargan hacia −Z. Cada sentido para con la cabeza del
    // tren a stopMargin del final del andén por el que sale (route.js).
    hallZ0: -80, hallZ1: 60,           // vestíbulo de andenes (bóveda de la estación)
    platformZ0: -75, platformZ1: 50,   // andenes
    stopMargin: 2,                     // m entre la cabeza del tren detenido y el final del andén
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
    length: CARS * CAR_LENGTH + (CARS - 1) * CAR_GAP,      // ≈ 119,4 m (5 coches AS-2014)
    halfWidth: 1.4,
    floorY: 1.25,
    roofY: 3.45,
    doorWidth: 1.4,
    doorHeight: 2.0,
    doorTime: 2.6,                     // segundos en abrir/cerrar
    maxSpeed: 80 / 3.6,                // velocidad máxima del AS-2014
    reverseMaxSpeed: 10 / 3.6,
  },
  track: { tail: 430, railTop: 0.27 }, // metros de cola de maniobra tras cada terminal
  people: {
    liftShare: 0.12,                   // parte de los viajeros dibujados que usa el ascensor (si no va lleno)
    maxWaitingPerSide: 55,             // máx. de viajeros DIBUJADOS esperando en cada andén (las cifras reales: engine/passengers.js)
    maxVisibleOnboard: 170,            // máximo de viajeros dibujados por tren (el resto se cuenta)
    activeRadius: 330,                 // solo se dibujan viajeros a esta distancia de la cámara
    capacity: 1000,                    // máximo de personas dibujadas a la vez
  },
  schedule: {
    minDwell: 16,                      // parada mínima (s) del ATO con puertas abiertas
    peakHeadway: 200,                  // intervalo de referencia (cada línea tiene el suyo: network.js)
    offPeakHeadway: 360,
    nightHeadway: 900,                 // fuera del horario comercial: servicio simbólico cada 15 min
    playerDeparture: 8 * 3600 + 90,    // referencia de las mallas (en el juego: ~15–20 s después de la hora local)
    reverseOffset: 120,                // los servicios de vuelta están desfasados 2 min
    punctualWindow: 30,
  },
  signals: {
    maxBlock: 450,
    stopMargin: 8,
  },
  defaultSpeedLimit: 80,
  renderRadius: 420,
  turnback: {
    cabChangeTime: 45,                 // segundos que tarda un conductor automático en cambiar de cabina
    crossoverFrom: 100, crossoverTo: 165,  // tramo del cambio de vía tras cada terminal (m desde el centro de la estación)
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

/* ---------- Mando ----------
   Como en un tren real, cada punto del manipulador PIDE una aceleración
   (tracción) o una deceleración (freno), en m/s². La física (engine/sim.js)
   decide cuánto se consigue de verdad: con el tren lleno, cuesta arriba o a
   alta velocidad (potencia limitada) la tracción rinde menos. El freno está
   compensado por carga (pesaje), así que frena igual vacío o lleno; en
   pendiente, la gravedad suma o resta. */
export const NOTCHES = [
  { id: "EM", label: "EMERGENCIA", accel: -1.30, type: "emergency" },
  { id: "B3", label: "FRENO 3",    accel: -1.00, type: "brake" },
  { id: "B2", label: "FRENO 2",    accel: -0.70, type: "brake" },
  { id: "B1", label: "FRENO 1",    accel: -0.35, type: "brake" },
  { id: "N",  label: "NEUTRO",     accel: 0,     type: "neutral" },
  { id: "P1", label: "TRACCIÓN 1", accel: 0.28,  type: "power" },
  { id: "P2", label: "TRACCIÓN 2", accel: 0.55,  type: "power" },
  { id: "P3", label: "TRACCIÓN 3", accel: 0.83,  type: "power" },
  { id: "P4", label: "TRACCIÓN 4", accel: 1.10,  type: "power" },
];
export const NOTCH_INDEX = Object.fromEntries(NOTCHES.map((n, i) => [n.id, i]));

export const REVERSER = {
  1:  { id: "F", label: "ADELANTE" },
  0:  { id: "N", label: "NEUTRO" },
  "-1": { id: "R", label: "ATRÁS" },
};

/* ---------- Calendario y demanda ----------
   El Metro no funciona igual todos los días: de lunes a viernes (laboral)
   hay dos puntas muy marcadas; el sábado la demanda es menor y repartida; el
   domingo y los festivos, menor aún, y el servicio abre más tarde. */

/** Festivos de fecha fija en Chile (mes-día). */
const FIXED_HOLIDAYS = new Set(["01-01", "05-01", "05-21", "06-29", "07-16", "08-15", "09-18", "09-19", "10-12", "10-31", "11-01", "12-08", "12-25"]);

/** Domingo de Pascua de un año (algoritmo de Butcher). */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

/** Tipo de día: "laboral" | "sabado" | "domingo" (domingos, festivos y Viernes/Sábado Santo). */
export function dayTypeOf(date = new Date()) {
  const md = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const easter = easterSunday(date.getFullYear());
  const holy = [2, 1].map(n => new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - n));
  const same = (a, b) => a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (date.getDay() === 0 || FIXED_HOLIDAYS.has(md) || holy.some(d => same(d, date))) return "domingo";
  if (date.getDay() === 6) return "sabado";
  return "laboral";
}

/** Nombre para mostrar de cada tipo de día. */
export const DAY_TYPE_LABEL = { laboral: "Día laboral", sabado: "Sábado", domingo: "Domingo o festivo" };

/** Horario comercial (h) de cada tipo de día: apertura y cierre de las estaciones. */
export const SERVICE_HOURS = {
  laboral: [6.0, 23.0],
  sabado:  [6.5, 23.0],
  domingo: [7.5, 22.5],
};

/** ¿Está abierto el Metro a esta hora (s)? */
export function inService(clockSeconds, dayType = CONFIG.dayType) {
  const h = (clockSeconds / 3600) % 24, [a, b] = SERVICE_HOURS[dayType] || SERVICE_HOURS.laboral;
  return h >= a && h < b;
}

/**
 * Perfil horario de la demanda (fracción de la punta de la mañana de un día
 * laboral), por tramos [hora, valor]. Forma típica de un día de Santiago:
 * punta mañana 07:00–09:00 (la más fuerte), valle al mediodía con un repunte
 * a la hora de almuerzo, punta tarde 17:30–20:00 (más larga y algo más baja)
 * y caída por la noche hasta el cierre.
 */
const DEMAND_PROFILE = {
  laboral: [[5.9, 0], [6.0, 0.22], [6.5, 0.55], [7.0, 0.86], [7.5, 1.0], [8.0, 1.0], [8.5, 0.86], [9.0, 0.62], [9.5, 0.5],
            [10, 0.42], [12, 0.42], [13, 0.5], [14, 0.48], [15, 0.43], [16, 0.5], [17, 0.66], [17.5, 0.8], [18, 0.92],
            [18.5, 0.95], [19, 0.86], [19.5, 0.68], [20, 0.5], [21, 0.32], [22, 0.2], [22.9, 0.1], [23.0, 0]],
  sabado:  [[6.4, 0], [6.5, 0.12], [8, 0.2], [10, 0.32], [12, 0.42], [13.5, 0.45], [16, 0.4], [18, 0.38], [20, 0.28],
            [22, 0.15], [22.9, 0.06], [23.0, 0]],
  domingo: [[7.4, 0], [7.5, 0.08], [9, 0.14], [11, 0.24], [13, 0.3], [17, 0.3], [19, 0.26], [21, 0.14], [22.4, 0.04], [22.5, 0]],
};
/** Demanda mínima fuera del horario comercial (servicio nocturno simbólico del juego). */
const NIGHT_DEMAND = 0.03;

/** Demanda de viajeros según la hora (0..1) para el tipo de día vigente. */
export function demandAt(clockSeconds, dayType = CONFIG.dayType) {
  const h = (clockSeconds / 3600) % 24;
  const p = DEMAND_PROFILE[dayType] || DEMAND_PROFILE.laboral;
  if (h <= p[0][0] || h >= p.at(-1)[0]) return NIGHT_DEMAND;
  for (let i = 1; i < p.length; i++) {
    if (h <= p[i][0]) {
      const [h0, v0] = p[i - 1], [h1, v1] = p[i];
      return Math.max(NIGHT_DEMAND, v0 + (v1 - v0) * (h - h0) / (h1 - h0));
    }
  }
  return NIGHT_DEMAND;
}

/**
 * Sentido dominante de los viajes: "am" (de la periferia hacia el centro),
 * "pm" (del centro hacia la periferia) u "off" (repartido). Solo en días laborales.
 */
export function flowPeriodAt(clockSeconds, dayType = CONFIG.dayType) {
  if (dayType !== "laboral") return "off";
  const h = (clockSeconds / 3600) % 24;
  if (h >= 6 && h < 10) return "am";
  if (h >= 16.5 && h < 21) return "pm";
  return "off";
}

/** Nombre en formato natural para la voz ("PLAZA DE ARMAS" → "Plaza de Armas"). */
export function spokenName(name) {
  const small = new Set(["de", "y", "del", "la"]);
  return name.toLowerCase().split(" ").map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
