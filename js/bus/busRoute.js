/* ==========================================================================
   MetroSim — 1.13 · bus/busRoute.js
   MicroSim (beta): el recorrido de bus que se maneja.

   Un recorrido de prueba por la Alameda, de Estación Central a Plaza
   Baquedano. Los paraderos llevan el nombre del lugar real donde están; las
   distancias son APROXIMADAS y el número de recorrido es ficticio.

   Igual que una línea del metro, el recorrido es una sola dimensión: la
   distancia recorrida `s` (metros) desde el primer paradero. En el mundo 3D
   el bus avanza hacia -Z (z = -s), como los trenes.

   Sin Three.js: se puede usar en Node.
   ========================================================================== */

/** Carriles del sentido en que va el bus (x del centro del carril, en metros). 0 = pista Solo Bus, junto a la vereda. */
export const LANES = [5.1, 1.7, -1.7];
export const LANE_WIDTH = 3.4;
/** Borde de la vereda del lado del bus y borde del bandejón central. */
export const CURB_X = 6.8;
export const MEDIAN_X = -3.4;

export const BUS_ROUTE = {
  id: "A01",
  name: "Alameda",
  from: "Estación Central",
  to: "Plaza Baquedano",
  color: "#d7262e",
  speedLimit: 50 / 3.6,                       // m/s: 50 km/h en la ciudad
  /** Paraderos: s = punto donde debe quedar la puerta delantera. */
  stops: [
    { name: "Estación Central", s: 40, metro: "ESTACIÓN CENTRAL", hint: "Terminal · Metro L1 y Tren Nos" },
    { name: "Unión Latinoamericana", s: 640, metro: "UNIÓN LATINOAMERICANA" },
    { name: "República", s: 1180, metro: "REPÚBLICA" },
    { name: "Los Héroes", s: 1740, metro: "LOS HÉROES", hint: "Metro L1 y L2" },
    { name: "La Moneda", s: 2260, metro: "LA MONEDA" },
    { name: "Universidad de Chile", s: 2680, metro: "UNIVERSIDAD DE CHILE", hint: "Metro L1 y L3" },
    { name: "Santa Lucía", s: 3160, metro: "SANTA LUCÍA" },
    { name: "Universidad Católica", s: 3560, metro: "UNIVERSIDAD CATÓLICA" },
    { name: "Plaza Baquedano", s: 4120, metro: "BAQUEDANO", hint: "Terminal · Metro L1 y L5" },
  ],
  /** Semáforos: s = línea de detención; ciclo en segundos y desfase. */
  lights: [
    { s: 330, street: "Exposición" },
    { s: 900, street: "Av. España" },
    { s: 1460, street: "Av. Brasil" },
    { s: 1990, street: "Amunátegui" },
    { s: 2470, street: "Morandé" },
    { s: 2920, street: "San Antonio" },
    { s: 3360, street: "Carmen" },
    { s: 3850, street: "Portugal" },
  ].map((l, i) => ({ ...l, cycle: 42, green: 24, amber: 3, offset: (i * 13) % 42 })),
  length: 4260,
};

/**
 * 1.15 · El recorrido en sentido contrario (Plaza Baquedano → Estación Central), para el pasajero:
 * los mismos paraderos y semáforos, espejados sobre el largo del recorrido.
 */
function reversed(r) {
  const span = r.stops[0].s + r.stops.at(-1).s;
  return {
    ...r,
    from: r.to, to: r.from,
    stops: r.stops.slice().reverse().map(st => ({ ...st, s: span - st.s })),
    lights: r.lights.slice().reverse().map(l => ({ ...l, s: span - l.s - 16 })),
  };
}
export const BUS_ROUTE_BACK = reversed(BUS_ROUTE);
/** Sentidos del recorrido: "ida" (hacia Plaza Baquedano) y "vuelta" (hacia Estación Central). */
export const busRouteFor = (dir) => dir === "vuelta" ? BUS_ROUTE_BACK : BUS_ROUTE;

/** Nombres de las estaciones de Metro que tienen un paradero del recorrido en su calle. */
export const BUS_METRO_STOPS = new Set(BUS_ROUTE.stops.map(st => st.metro));

/**
 * Viajes en bus que se pueden tomar en la calle de una estación de Metro:
 * [{ dir, route, from }] (from = índice del paradero en ese sentido). Sin los que terminan ahí.
 */
export function busTripsFrom(metroName) {
  const out = [];
  for (const dir of ["ida", "vuelta"]) {
    const route = busRouteFor(dir);
    const from = route.stops.findIndex(st => st.metro === metroName);
    if (from >= 0 && from < route.stops.length - 1) out.push({ dir, route, from });
  }
  return out;
}

/** Estado de un semáforo a la hora `t` (segundos): "green" | "amber" | "red". */
export function lightState(light, t) {
  const p = ((t + light.offset) % light.cycle + light.cycle) % light.cycle;
  if (p < light.green) return "green";
  if (p < light.green + light.amber) return "amber";
  return "red";
}

/** Segundos que faltan para que el semáforo cambie de estado. */
export function lightRemaining(light, t) {
  const p = ((t + light.offset) % light.cycle + light.cycle) % light.cycle;
  if (p < light.green) return light.green - p;
  if (p < light.green + light.amber) return light.green + light.amber - p;
  return light.cycle - p;
}

/**
 * Horario del servicio: hora de paso prevista por cada paradero.
 * Velocidad comercial de unos 21 km/h (con detenciones), como un bus por la Alameda en hora normal.
 */
export function makeTimetable(route, departure) {
  const commercial = 21 / 3.6;
  return route.stops.map((st, i) => ({
    index: i,
    time: Math.round(departure + (st.s - route.stops[0].s) / commercial),
  }));
}
