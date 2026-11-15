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
    { name: "Estación Central", s: 40, hint: "Terminal · combinación con Línea 1" },
    { name: "Unión Latinoamericana", s: 640 },
    { name: "República", s: 1180 },
    { name: "Los Héroes", s: 1740, hint: "Combinación con Líneas 1 y 2" },
    { name: "La Moneda", s: 2260 },
    { name: "Universidad de Chile", s: 2680, hint: "Combinación con Líneas 1 y 3" },
    { name: "Santa Lucía", s: 3160 },
    { name: "Universidad Católica", s: 3560 },
    { name: "Plaza Baquedano", s: 4120, hint: "Fin del recorrido · combinación con Líneas 1 y 5" },
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
