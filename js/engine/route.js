/* ==========================================================================
   MetroSim — Motor · route.js
   Rutas: los dos sentidos de circulación de cada línea.

     L3 · ruta A · vía 1 (x = +2): Plaza Quilicura → Fernando Castillo Velasco
     L3 · ruta B · vía 2 (x = -2): Fernando Castillo Velasco → Plaza Quilicura
     L6 · rutas 6A / 6B: Cerrillos ⇄ Los Leones (simulada, sin dibujo)

   Truco de diseño: cada ruta tiene sus propias "coordenadas de simulación"
   en las que el tren SIEMPRE avanza hacia -Z y la primera estación de la
   ruta es la de mayor Z. Para la ruta de ida coinciden con las de la línea;
   para la de vuelta son el espejo (zSim = K − zLínea). Así la física
   (sim.js), las señales, los horarios y la conducción automática funcionan
   igual en ambos sentidos y en todas las líneas sin duplicar código.
   ========================================================================== */

import { CONFIG } from "../config.js";
import { L3, LINES } from "./network.js";

function makeRoute(line, dir) {
  const S = CONFIG.station, tail = CONFIG.track.tail, L = CONFIG.train.length;
  const LS = line.stations;
  const K = LS[0].z + LS.at(-1).z;                 // constante del espejo
  const toSimZ = dir === 1 ? (z) => z : (z) => K - z;
  const toWorldZ = toSimZ;                         // el espejo es su propia inversa
  const k = dir === 1 ? 0 : 1;

  const order = dir === 1 ? LS : [...LS].reverse();
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
  const limits = line.speedLimits.map(l => {
    const a = toSimZ(l.from), b = toSimZ(l.to);
    return { ...l, from: Math.max(a, b), to: Math.min(a, b) };
  });
  limits.push({ from: last.z + 300, to: track.end, kmh: 40, label: "ENTRADA A TERMINAL" });
  limits.push({ from: track.start, to: first.z + S.hallHalf, kmh: 25, label: "SALIDA DE COCHERAS" });

  const route = {
    id: line.routeIds[k],
    line,
    dir,
    trackX: dir * S.trackX,                        // ida: x = +2 · vuelta: x = -2
    side: dir,                                     // lado del andén (+1 o -1)
    stations, first, last, track, limits,
    toSimZ, toWorldZ,
    tripPrefix: line.tripPrefix[k],
    signalPrefix: line.signalPrefix[k],
    label: `Dirección ${last.name}`,
    shortLabel: last.short,
    lineLength: first.stopZ - last.stopZ,
    opposite: null,                                // se enlaza abajo

    /** Límite (km/h) en una coordenada de la ruta. */
    speedLimitAt(z) {
      let limit = CONFIG.defaultSpeedLimit;
      for (const l of limits) if (z <= l.from && z >= l.to) limit = Math.min(limit, l.kmh);
      return limit;
    },
    /** Estación de la ruta que corresponde a una estación de la línea (el mismo objeto o el mismo nombre). */
    stationOf(lineStation) {
      return stations.find(s => s.world === lineStation) || stations.find(s => s.name === lineStation?.name) || null;
    },
  };
  stations.forEach(s => (s.route = route));
  return route;
}

/** Los dos sentidos de una línea: [ida, vuelta]. */
function makeLineRoutes(line) {
  const routes = [makeRoute(line, 1), makeRoute(line, -1)];
  routes[0].opposite = routes[1];
  routes[1].opposite = routes[0];
  line.routes = routes;
  return routes;
}

/** Sentidos de todas las líneas de la red. */
export const ALL_ROUTES = LINES.flatMap(makeLineRoutes);

/* ----- Línea 3 (la que se dibuja y se juega): nombres de siempre ----- */
export const ROUTES = L3.routes;
export const ROUTE_A = ROUTES[0];
export const ROUTE_B = ROUTES[1];

/** Ruta de la L3 que sale desde el andén de un lado (+1 → A, -1 → B). */
export const routeForSide = (side) => (side > 0 ? ROUTE_A : ROUTE_B);

/** Ruta del sentido contrario (de la misma línea). */
export const oppositeRoute = (route) => route.opposite;
