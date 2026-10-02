/* ==========================================================================
   MetroSim — Motor · route.js
   Rutas: los dos sentidos de circulación de la Línea 3.

     Ruta A · vía 1 (x = +2): Plaza Quilicura → Fernando Castillo Velasco
     Ruta B · vía 2 (x = -2): Fernando Castillo Velasco → Plaza Quilicura

   Truco de diseño: cada ruta tiene sus propias "coordenadas de simulación"
   en las que el tren SIEMPRE avanza hacia -Z y la primera estación de la
   ruta es la de mayor Z. Para la ruta A coinciden con el mundo; para la B
   son el espejo (zSim = K − zMundo). Así la física (sim.js), las señales,
   los horarios y la conducción automática funcionan igual en ambos sentidos
   sin duplicar código.
   ========================================================================== */

import { CONFIG, STATIONS, WORLD_SPEED_LIMITS } from "../config.js";

const K = STATIONS[0].z + STATIONS.at(-1).z;      // constante del espejo

function makeRoute(dir) {
  const S = CONFIG.station, tail = CONFIG.track.tail, L = CONFIG.train.length;
  const toSimZ = dir === 1 ? (z) => z : (z) => K - z;
  const toWorldZ = toSimZ;                         // el espejo es su propia inversa

  const order = dir === 1 ? STATIONS : [...STATIONS].reverse();
  const stations = order.map((st, index) => {
    const z = toSimZ(st.z);
    return { ...st, world: st, worldIndex: st.index, index, z, stopZ: z + S.stopOffset };
  });
  const first = stations[0], last = stations.at(-1);

  const track = {
    start: first.z + tail,                         // fondo de saco tras la terminal de origen
    end: last.z - tail,                            // fondo de saco tras la terminal de destino
    depotZ: first.z + 200,                         // aparición de trenes que entran en servicio
    rearLimitZ: first.z + tail - L - 2,            // marcha atrás: límite del testero
    // Fin de la cola de maniobras: el testero queda donde, tras cambiar de cabina,
    // el otro extremo del tren coincide con el punto de entrada de la vía contraria.
    retireZ: last.z - 200 - L,
    bumperZ: last.z - 300,                         // topera
    railTop: CONFIG.track.railTop,
  };

  // Limitaciones de velocidad en coordenadas de la ruta (from > to)
  const limits = WORLD_SPEED_LIMITS.map(l => {
    const a = toSimZ(l.from), b = toSimZ(l.to);
    return { ...l, from: Math.max(a, b), to: Math.min(a, b) };
  });
  limits.push({ from: last.z + 300, to: track.end, kmh: 40, label: "ENTRADA A TERMINAL" });
  limits.push({ from: track.start, to: first.z + S.hallHalf, kmh: 25, label: "SALIDA DE COCHERAS" });

  const route = {
    id: dir === 1 ? "A" : "B",
    dir,
    trackX: dir * S.trackX,                        // A: x = +2 · B: x = -2
    side: dir,                                     // lado del andén en el mundo (+1 o -1)
    stations, first, last, track, limits,
    toSimZ, toWorldZ,
    label: `Dirección ${last.name}`,
    shortLabel: last.short,
    lineLength: first.stopZ - last.stopZ,

    /** Límite (km/h) en una coordenada de la ruta. */
    speedLimitAt(z) {
      let limit = CONFIG.defaultSpeedLimit;
      for (const l of limits) if (z <= l.from && z >= l.to) limit = Math.min(limit, l.kmh);
      return limit;
    },
    /** Estación de la ruta que corresponde a una estación del mundo. */
    stationOf(worldStation) { return stations.find(s => s.worldIndex === worldStation.index); },
  };
  stations.forEach(s => (s.route = route));
  return route;
}

export const ROUTES = [makeRoute(1), makeRoute(-1)];
export const ROUTE_A = ROUTES[0];
export const ROUTE_B = ROUTES[1];

/** Ruta que sale desde el andén de un lado (+1 → A, -1 → B). */
export const routeForSide = (side) => (side > 0 ? ROUTE_A : ROUTE_B);

/** Ruta del sentido contrario. */
export const oppositeRoute = (route) => (route === ROUTE_A ? ROUTE_B : ROUTE_A);
