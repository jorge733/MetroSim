/* ==========================================================================
   MetroSim — Motor · network.js
   La RED de Metro de Santiago: líneas 1, 2, 3, 4, 4A, 5 y 6.

   Cada línea tiene sus estaciones en sus propias coordenadas (la primera en
   z = 0 y avanza hacia −Z). El motor simula todas a la vez con el mismo
   reloj; el jugador elige al empezar la línea "activa", que es la que se
   construye en 3D (route.js → setActiveLine).

   Combinaciones: dos líneas se conectan en las estaciones con el mismo
   nombre (por ejemplo Universidad de Chile, L1 ⇄ L3). Por ahí pasa gente de
   una línea a la otra (transbordos), así que lo que pasa en una afecta a
   las demás.

   El orden, los nombres y las combinaciones son reales; las distancias
   entre estaciones son APROXIMADAS. Por simplicidad todas las líneas se
   representan subterráneas (en la realidad hay tramos en viaducto o en
   superficie en las líneas 2, 4, 4A y 5).
   ========================================================================== */

import { LINE_COLORS } from "../config.js";

/** Convierte una lista { name, short, gap, combos } en estaciones con z, índice e id. */
function buildStations(data, lineId) {
  let acc = 0;
  return data.map((s, index) => {
    acc += s.gap;
    return {
      ...s,
      id: `${lineId}-` + s.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-"),
      index,
      combos: s.combos || [],
      z: -acc,
      km: acc / 1000,
    };
  });
}

/** Crea una línea. Los sentidos se llaman <id>A / <id>B (la L3 conserva A / B). */
function makeLine({ id, name, data, speedLimits = () => [], scheduleOffset = 0, description }) {
  const stations = buildStations(data, id);
  return {
    id,
    name,
    description,
    color: LINE_COLORS[id],
    colorHex: parseInt(LINE_COLORS[id].slice(1), 16),
    stations,
    speedLimits: speedLimits(stations),
    routeIds: id === "3" ? ["A", "B"] : [`${id}A`, `${id}B`],
    tripPrefix: [`L${id}`, `L${id}V`],
    signalPrefix: id === "3" ? ["1", "2"] : [`${id}1`, `${id}2`],
    scheduleOffset,                    // desfase de su malla respecto a la de referencia
  };
}

/* ---------- Línea 1: San Pablo → Los Dominicos ---------- */
export const L1 = makeLine({
  id: "1", name: "LÍNEA 1", scheduleOffset: 30,
  description: "La línea más antigua y concurrida, bajo la Alameda y Providencia.",
  data: [
    { name: "SAN PABLO",                 short: "SAN PABLO",        gap: 0,    combos: ["5"] },
    { name: "NEPTUNO",                   short: "NEPTUNO",          gap: 1100 },
    { name: "PAJARITOS",                 short: "PAJARITOS",        gap: 850 },
    { name: "LAS REJAS",                 short: "LAS REJAS",        gap: 1100 },
    { name: "ECUADOR",                   short: "ECUADOR",          gap: 800 },
    { name: "SAN ALBERTO HURTADO",       short: "S. A. HURTADO",    gap: 750 },
    { name: "UNIVERSIDAD DE SANTIAGO",   short: "U. DE SANTIAGO",   gap: 700 },
    { name: "ESTACIÓN CENTRAL",          short: "EST. CENTRAL",     gap: 650 },
    { name: "UNIÓN LATINOAMERICANA",     short: "U. LATINOAMER.",   gap: 700 },
    { name: "REPÚBLICA",                 short: "REPÚBLICA",        gap: 650 },
    { name: "LOS HÉROES",                short: "LOS HÉROES",       gap: 700,  combos: ["2"] },
    { name: "LA MONEDA",                 short: "LA MONEDA",        gap: 650 },
    { name: "UNIVERSIDAD DE CHILE",      short: "U. DE CHILE",      gap: 550,  combos: ["3"] },
    { name: "SANTA LUCÍA",               short: "SANTA LUCÍA",      gap: 600 },
    { name: "UNIVERSIDAD CATÓLICA",      short: "U. CATÓLICA",      gap: 600 },
    { name: "BAQUEDANO",                 short: "BAQUEDANO",        gap: 650,  combos: ["5"] },
    { name: "SALVADOR",                  short: "SALVADOR",         gap: 900 },
    { name: "MANUEL MONTT",              short: "MANUEL MONTT",     gap: 800 },
    { name: "PEDRO DE VALDIVIA",         short: "P. DE VALDIVIA",   gap: 650 },
    { name: "LOS LEONES",                short: "LOS LEONES",       gap: 600,  combos: ["6"] },
    { name: "TOBALABA",                  short: "TOBALABA",         gap: 650,  combos: ["4"] },
    { name: "EL GOLF",                   short: "EL GOLF",          gap: 700 },
    { name: "ALCÁNTARA",                 short: "ALCÁNTARA",        gap: 650 },
    { name: "ESCUELA MILITAR",           short: "E. MILITAR",       gap: 700 },
    { name: "MANQUEHUE",                 short: "MANQUEHUE",        gap: 950 },
    { name: "HERNANDO DE MAGALLANES",    short: "H. MAGALLANES",    gap: 800 },
    { name: "LOS DOMINICOS",             short: "LOS DOMINICOS",    gap: 1300 },
  ],
});

/* ---------- Línea 2: Vespucio Norte → Hospital El Pino ---------- */
export const L2 = makeLine({
  id: "2", name: "LÍNEA 2", scheduleOffset: 50,
  description: "De norte a sur por el centro, hasta San Bernardo.",
  data: [
    { name: "VESPUCIO NORTE",            short: "VESPUCIO NORTE",   gap: 0 },
    { name: "ZAPADORES",                 short: "ZAPADORES",        gap: 1050 },
    { name: "DORSAL",                    short: "DORSAL",           gap: 900 },
    { name: "EINSTEIN",                  short: "EINSTEIN",         gap: 850 },
    { name: "CEMENTERIOS",               short: "CEMENTERIOS",      gap: 800 },
    { name: "CERRO BLANCO",              short: "CERRO BLANCO",     gap: 750 },
    { name: "PATRONATO",                 short: "PATRONATO",        gap: 650 },
    { name: "PUENTE CAL Y CANTO",        short: "CAL Y CANTO",      gap: 800,  combos: ["3"] },
    { name: "SANTA ANA",                 short: "SANTA ANA",        gap: 800,  combos: ["5"] },
    { name: "LOS HÉROES",                short: "LOS HÉROES",       gap: 750,  combos: ["1"] },
    { name: "TOESCA",                    short: "TOESCA",           gap: 700 },
    { name: "PARQUE O'HIGGINS",          short: "PQUE. O'HIGGINS",  gap: 750 },
    { name: "RONDIZZONI",                short: "RONDIZZONI",       gap: 800 },
    { name: "FRANKLIN",                  short: "FRANKLIN",         gap: 750,  combos: ["6"] },
    { name: "EL LLANO",                  short: "EL LLANO",         gap: 900 },
    { name: "SAN MIGUEL",                short: "SAN MIGUEL",       gap: 750 },
    { name: "LO VIAL",                   short: "LO VIAL",          gap: 750 },
    { name: "DEPARTAMENTAL",             short: "DEPARTAMENTAL",    gap: 800 },
    { name: "CIUDAD DEL NIÑO",           short: "CIUDAD DEL NIÑO",  gap: 850 },
    { name: "LO OVALLE",                 short: "LO OVALLE",        gap: 900 },
    { name: "EL PARRÓN",                 short: "EL PARRÓN",        gap: 900 },
    { name: "LA CISTERNA",               short: "LA CISTERNA",      gap: 950,  combos: ["4A"] },
    { name: "EL BOSQUE",                 short: "EL BOSQUE",        gap: 1100 },
    { name: "OBSERVATORIO",              short: "OBSERVATORIO",     gap: 1000 },
    { name: "COPA LO MARTÍNEZ",          short: "C. LO MARTÍNEZ",   gap: 950 },
    { name: "HOSPITAL EL PINO",          short: "HOSP. EL PINO",    gap: 1050 },
  ],
});

/* ---------- Línea 3: Plaza Quilicura → Fernando Castillo Velasco ---------- */
export const L3 = makeLine({
  id: "3", name: "LÍNEA 3", scheduleOffset: 0,
  description: "De Quilicura a La Reina pasando por el centro y Ñuñoa.",
  data: [
    { name: "PLAZA QUILICURA",           short: "PLAZA QUILICURA",  gap: 0 },
    { name: "LO CRUZAT",                 short: "LO CRUZAT",        gap: 1500 },
    { name: "FERROCARRIL",               short: "FERROCARRIL",      gap: 1300 },
    { name: "LOS LIBERTADORES",          short: "LOS LIBERTADORES", gap: 1700 },
    { name: "CARDENAL CARO",             short: "CARDENAL CARO",    gap: 1600 },
    { name: "VIVACETA",                  short: "VIVACETA",         gap: 1250 },
    { name: "CONCHALÍ",                  short: "CONCHALÍ",         gap: 1150 },
    { name: "PLAZA CHACABUCO",           short: "PZA. CHACABUCO",   gap: 1050 },
    { name: "HOSPITALES",                short: "HOSPITALES",       gap: 1150 },
    { name: "PUENTE CAL Y CANTO",        short: "CAL Y CANTO",      gap: 1400, combos: ["2"] },
    { name: "PLAZA DE ARMAS",            short: "PLAZA DE ARMAS",   gap: 650,  combos: ["5"] },
    { name: "UNIVERSIDAD DE CHILE",      short: "U. DE CHILE",      gap: 750,  combos: ["1"] },
    { name: "PARQUE ALMAGRO",            short: "PARQUE ALMAGRO",   gap: 950 },
    { name: "MATTA",                     short: "MATTA",            gap: 1050 },
    { name: "IRARRÁZAVAL",               short: "IRARRÁZAVAL",      gap: 1350, combos: ["5"] },
    { name: "MONSEÑOR EYZAGUIRRE",       short: "M. EYZAGUIRRE",    gap: 1200 },
    { name: "ÑUÑOA",                     short: "ÑUÑOA",            gap: 1000, combos: ["6"] },
    { name: "CHILE ESPAÑA",              short: "CHILE ESPAÑA",     gap: 1050 },
    { name: "VILLA FREI",                short: "VILLA FREI",       gap: 950 },
    { name: "PLAZA EGAÑA",               short: "PLAZA EGAÑA",      gap: 1050, combos: ["4"] },
    { name: "FERNANDO CASTILLO VELASCO", short: "F. CASTILLO V.",   gap: 1300 },
  ],
  // Zona céntrica: 50 km/h entre Puente Cal y Canto y Plaza de Armas
  speedLimits: (st) => [{ from: st[9].z + 300, to: st[10].z - 200, kmh: 50, label: "ZONA CÉNTRICA" }],
});

/* ---------- Línea 4: Tobalaba → Plaza de Puente Alto ---------- */
export const L4 = makeLine({
  id: "4", name: "LÍNEA 4", scheduleOffset: 90,
  description: "Por Américo Vespucio y Vicuña Mackenna hasta Puente Alto.",
  data: [
    { name: "TOBALABA",                  short: "TOBALABA",         gap: 0,    combos: ["1"] },
    { name: "CRISTÓBAL COLÓN",           short: "CRISTÓBAL COLÓN",  gap: 1200 },
    { name: "FRANCISCO BILBAO",          short: "F. BILBAO",        gap: 1050 },
    { name: "PRÍNCIPE DE GALES",         short: "P. DE GALES",      gap: 1000 },
    { name: "SIMÓN BOLÍVAR",             short: "SIMÓN BOLÍVAR",    gap: 900 },
    { name: "PLAZA EGAÑA",               short: "PLAZA EGAÑA",      gap: 1000, combos: ["3"] },
    { name: "LOS ORIENTALES",            short: "LOS ORIENTALES",   gap: 950 },
    { name: "GRECIA",                    short: "GRECIA",           gap: 1100 },
    { name: "LOS PRESIDENTES",           short: "LOS PRESIDENTES",  gap: 950 },
    { name: "QUILÍN",                    short: "QUILÍN",           gap: 1150 },
    { name: "LAS TORRES",                short: "LAS TORRES",       gap: 1000 },
    { name: "MACUL",                     short: "MACUL",            gap: 1100 },
    { name: "VICUÑA MACKENNA",           short: "V. MACKENNA",      gap: 1150, combos: ["4A"] },
    { name: "VICENTE VALDÉS",            short: "VICENTE VALDÉS",   gap: 1300, combos: ["5"] },
    { name: "ROJAS MAGALLANES",          short: "R. MAGALLANES",    gap: 1100 },
    { name: "TRINIDAD",                  short: "TRINIDAD",         gap: 1050 },
    { name: "SAN JOSÉ DE LA ESTRELLA",   short: "S. J. ESTRELLA",   gap: 1050 },
    { name: "LOS QUILLAYES",             short: "LOS QUILLAYES",    gap: 1100 },
    { name: "ELISA CORREA",              short: "ELISA CORREA",     gap: 1050 },
    { name: "HOSPITAL SÓTERO DEL RÍO",   short: "H. SÓTERO DEL RÍO", gap: 1050 },
    { name: "PROTECTORA DE LA INFANCIA", short: "PROTECTORA",       gap: 1000 },
    { name: "LAS MERCEDES",              short: "LAS MERCEDES",     gap: 1050 },
    { name: "PLAZA DE PUENTE ALTO",      short: "PUENTE ALTO",      gap: 1100 },
  ],
});

/* ---------- Línea 4A: Vicuña Mackenna → La Cisterna ---------- */
export const L4A = makeLine({
  id: "4A", name: "LÍNEA 4A", scheduleOffset: 110,
  description: "Corta y rápida, une la L4 con la L2 por Américo Vespucio Sur.",
  data: [
    { name: "VICUÑA MACKENNA",           short: "V. MACKENNA",      gap: 0,    combos: ["4"] },
    { name: "SANTA JULIA",               short: "SANTA JULIA",      gap: 1300 },
    { name: "LA GRANJA",                 short: "LA GRANJA",        gap: 1600 },
    { name: "SANTA ROSA",                short: "SANTA ROSA",       gap: 1700 },
    { name: "SAN RAMÓN",                 short: "SAN RAMÓN",        gap: 1500 },
    { name: "LA CISTERNA",               short: "LA CISTERNA",      gap: 1600, combos: ["2"] },
  ],
});

/* ---------- Línea 5: Plaza de Maipú → Vicente Valdés ---------- */
export const L5 = makeLine({
  id: "5", name: "LÍNEA 5", scheduleOffset: 20,
  description: "De Maipú a La Florida cruzando el centro: la más larga de la red.",
  data: [
    { name: "PLAZA DE MAIPÚ",            short: "PLAZA DE MAIPÚ",   gap: 0 },
    { name: "SANTIAGO BUERAS",           short: "S. BUERAS",        gap: 1100 },
    { name: "DEL SOL",                   short: "DEL SOL",          gap: 1150 },
    { name: "MONTE TABOR",               short: "MONTE TABOR",      gap: 1000 },
    { name: "LAS PARCELAS",              short: "LAS PARCELAS",     gap: 1100 },
    { name: "LAGUNA SUR",                short: "LAGUNA SUR",       gap: 1200 },
    { name: "BARRANCAS",                 short: "BARRANCAS",        gap: 1100 },
    { name: "PUDAHUEL",                  short: "PUDAHUEL",         gap: 1000 },
    { name: "SAN PABLO",                 short: "SAN PABLO",        gap: 1150, combos: ["1"] },
    { name: "LO PRADO",                  short: "LO PRADO",         gap: 900 },
    { name: "BLANQUEADO",                short: "BLANQUEADO",       gap: 900 },
    { name: "GRUTA DE LOURDES",          short: "G. DE LOURDES",    gap: 850 },
    { name: "QUINTA NORMAL",             short: "QUINTA NORMAL",    gap: 750 },
    { name: "CUMMING",                   short: "CUMMING",          gap: 850 },
    { name: "SANTA ANA",                 short: "SANTA ANA",        gap: 750,  combos: ["2"] },
    { name: "PLAZA DE ARMAS",            short: "PLAZA DE ARMAS",   gap: 600,  combos: ["3"] },
    { name: "BELLAS ARTES",              short: "BELLAS ARTES",     gap: 600 },
    { name: "BAQUEDANO",                 short: "BAQUEDANO",        gap: 900,  combos: ["1"] },
    { name: "PARQUE BUSTAMANTE",         short: "P. BUSTAMANTE",    gap: 750 },
    { name: "SANTA ISABEL",              short: "SANTA ISABEL",     gap: 700 },
    { name: "IRARRÁZAVAL",               short: "IRARRÁZAVAL",      gap: 900,  combos: ["3"] },
    { name: "ÑUBLE",                     short: "ÑUBLE",            gap: 850,  combos: ["6"] },
    { name: "RODRIGO DE ARAYA",          short: "R. DE ARAYA",      gap: 950 },
    { name: "CARLOS VALDOVINOS",         short: "C. VALDOVINOS",    gap: 950 },
    { name: "CAMINO AGRÍCOLA",           short: "C. AGRÍCOLA",      gap: 900 },
    { name: "SAN JOAQUÍN",               short: "SAN JOAQUÍN",      gap: 900 },
    { name: "PEDRERO",                   short: "PEDRERO",          gap: 950 },
    { name: "MIRADOR",                   short: "MIRADOR",          gap: 1000 },
    { name: "BELLAVISTA DE LA FLORIDA",  short: "BELLAVISTA",       gap: 1100 },
    { name: "VICENTE VALDÉS",            short: "VICENTE VALDÉS",   gap: 1050, combos: ["4"] },
  ],
});

/* ---------- Línea 6: Cerrillos → Los Leones ---------- */
export const L6 = makeLine({
  id: "6", name: "LÍNEA 6", scheduleOffset: 75,
  description: "La más moderna: de Cerrillos a Providencia, sin conductor en la realidad.",
  data: [
    { name: "CERRILLOS",                      short: "CERRILLOS",     gap: 0 },
    { name: "LO VALLEDOR",                    short: "LO VALLEDOR",   gap: 1900 },
    { name: "PRESIDENTE PEDRO AGUIRRE CERDA", short: "P. A. CERDA",   gap: 1500 },
    { name: "FRANKLIN",                       short: "FRANKLIN",      gap: 2400, combos: ["2"] },
    { name: "BIO BÍO",                        short: "BIO BÍO",       gap: 950 },
    { name: "ÑUBLE",                          short: "ÑUBLE",         gap: 1150, combos: ["5"] },
    { name: "ESTADIO NACIONAL",               short: "E. NACIONAL",   gap: 1600 },
    { name: "ÑUÑOA",                          short: "ÑUÑOA",         gap: 1200, combos: ["3"] },
    { name: "INÉS DE SUÁREZ",                 short: "I. DE SUÁREZ",  gap: 1450 },
    { name: "LOS LEONES",                     short: "LOS LEONES",    gap: 1700, combos: ["1"] },
  ],
});

/** Todas las líneas de la red, en el orden de la pantalla principal. */
export const LINES = [L1, L2, L3, L4, L4A, L5, L6];

/** Línea por id ("1", "4A"...). */
export const lineById = (id) => LINES.find(l => l.id === String(id)) || null;

/**
 * Estaciones de combinación entre líneas:
 * [{ name, a: { line, station }, b: { line, station } }]
 */
export const TRANSFERS = [];
for (let i = 0; i < LINES.length; i++) {
  for (let j = i + 1; j < LINES.length; j++) {
    for (const sa of LINES[i].stations) {
      const sb = LINES[j].stations.find(s => s.name === sa.name);
      if (sb) TRANSFERS.push({ name: sa.name, a: { line: LINES[i], station: sa }, b: { line: LINES[j], station: sb } });
    }
  }
}

/** Estación de otra línea con la que se combina (o null). */
export function transferOf(line, station, otherLine) {
  const t = TRANSFERS.find(t =>
    (t.a.line === line && t.a.station === station && t.b.line === otherLine) ||
    (t.b.line === line && t.b.station === station && t.a.line === otherLine));
  if (!t) return null;
  return t.a.line === line ? t.b.station : t.a.station;
}
