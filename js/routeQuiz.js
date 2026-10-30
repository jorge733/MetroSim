/* ==========================================================================
   MetroSim — routeQuiz.js
   Preguntas de "¿cómo llego a…?" del turista perdido (modo Pasajero).

   Con la red real (engine/network.js) arma una pregunta desde la estación
   donde está el jugador hacia otra estación, y tres indicaciones de las que
   solo una es correcta:
     · misma línea:  la dirección correcta (la terminal hacia la que va),
                     la contraria y una combinación que no lleva al destino;
     · otra línea:   ir hasta la estación de combinación y cambiar de línea en
                     la dirección correcta; las equivocadas fallan una de las
                     dos direcciones.
   Solo destinos a los que se llega con UNA combinación como máximo.

   Sin Three.js (se puede probar en Node).
   ========================================================================== */

import { LINES, TRANSFERS } from "./engine/network.js";
import { spokenName } from "./config.js";

const nice = spokenName;
const pickOf = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

/** Terminal hacia la que hay que ir en una línea para ir de una estación a otra. */
function towards(line, from, to) {
  return to.index > from.index ? line.stations.at(-1) : line.stations[0];
}
function away(line, from, to) {
  return to.index > from.index ? line.stations[0] : line.stations.at(-1);
}
const dir = (line, terminal) => `Línea ${line.id} dirección ${nice(terminal.name)}`;
/** "Línea 1 dirección X hasta Y" (o "Línea 1 hasta Y, la terminal" si Y es la terminal). */
const leg = (line, from, to) => {
  const t = towards(line, from, to);
  return t === to || t.name === to.name ? `Línea ${line.id} hasta ${nice(to.name)} (terminal)` : `${dir(line, t)} hasta ${nice(to.name)}`;
};

/** Estaciones de combinación entre dos líneas: [{ here, there }] (la estación en cada línea). */
function transfersBetween(a, b) {
  const out = [];
  for (const t of TRANSFERS) {
    if (t.a.line === a && t.b.line === b) out.push({ here: t.a.station, there: t.b.station });
    else if (t.b.line === a && t.a.line === b) out.push({ here: t.b.station, there: t.a.station });
  }
  return out;
}

/**
 * Pregunta de ruta.
 * @param {object} line      línea donde está el jugador
 * @param {object} station   estación de esa línea
 * @param {() => number} [rnd]
 * @returns {{ dest, destLine, stops, options: Array<{text, correct}>, answer: string, explain: string }}
 */
export function routeQuestion(line, station, rnd = Math.random) {
  const onLine = new Set(line.stations.map(s => s.name));
  // Otras líneas a las que se llega con una combinación desde esta
  const linked = LINES.filter(l => l !== line && transfersBetween(line, l).length);
  const other = linked.length && rnd() < 0.45;

  if (other) {
    const destLine = pickOf(linked, rnd);
    const via = transfersBetween(line, destLine);
    // Destino de la otra línea que no esté en la nuestra (si no, sería de la misma línea)
    const candidates = destLine.stations.filter(s => !onLine.has(s.name));
    if (candidates.length) {
      const dest = pickOf(candidates, rnd);
      // La combinación más cercana a donde estás
      const t = via.reduce((b, x) => (Math.abs(x.here.index - station.index) < Math.abs(b.here.index - station.index) ? x : b));
      const here = t.here === station || t.here.name === station.name;
      const leg2 = towards(destLine, t.there, dest), wrong2 = away(destLine, t.there, dest);
      const correct = here
        ? `Aquí mismo, cambia a la ${dir(destLine, leg2)}`
        : `${leg(line, station, t.here)}, y ahí cambia a la ${dir(destLine, leg2)}`;
      const wrongs = [];
      if (here) {
        if (wrong2 !== t.there) wrongs.push(`Aquí mismo, cambia a la ${dir(destLine, wrong2)}`);
        const lt = line.stations.at(-1) === station ? line.stations[0] : line.stations.at(-1);
        wrongs.push(`Sigue en la ${dir(line, lt)}: ${nice(dest.name)} queda en esta línea`);
      } else {
        const w1 = away(line, station, t.here);
        if (w1 !== station) wrongs.push(`${dir(line, w1)} hasta ${nice(t.here.name)}, y ahí cambia a la ${dir(destLine, leg2)}`);
        if (wrong2 !== t.there) wrongs.push(`${leg(line, station, t.here)}, y ahí cambia a la ${dir(destLine, wrong2)}`);
      }
      // De respaldo: combinar en una estación donde NO pasa la otra línea
      const noTransfer = line.stations.filter(s => s !== station && s !== t.here && !via.some(x => x.here === s));
      while (wrongs.length < 2 && noTransfer.length) {
        const s = noTransfer.splice(Math.floor(rnd() * noTransfer.length), 1)[0];
        wrongs.push(`${leg(line, station, s)}, y ahí cambia a la ${dir(destLine, leg2)}`);
      }
      return finish({ dest, destLine, correct, wrongs, stops: null, rnd,
        explain: here ? `Aquí se combina con la Línea ${destLine.id}.` : `Se combina con la Línea ${destLine.id} en ${nice(t.here.name)}.` });
    }
  }

  // Misma línea: al menos dos estaciones de distancia
  const far = line.stations.filter(s => Math.abs(s.index - station.index) >= 2);
  const dest = pickOf(far.length ? far : line.stations.filter(s => s !== station), rnd);
  const stops = Math.abs(dest.index - station.index);
  const correct = dir(line, towards(line, station, dest));
  const wrongs = [];
  const opp = away(line, station, dest);
  if (opp !== station) wrongs.push(dir(line, opp));
  // Una combinación que no lleva al destino
  const via = linked.flatMap(l => transfersBetween(line, l).map(t => ({ l, t }))).filter(x => !x.l.stations.some(s => s.name === dest.name));
  if (via.length) {
    const { l, t } = pickOf(via, rnd);
    wrongs.push(t.here === station
      ? `Aquí mismo, cambia a la ${dir(l, l.stations.at(-1))}`
      : `${leg(line, station, t.here)}, y ahí cambia a la ${dir(l, pickOf([l.stations[0], l.stations.at(-1)], rnd))}`);
  }
  if (wrongs.length < 2) wrongs.push(`Sal a la calle: ${nice(dest.name)} no tiene Metro`);
  return finish({ dest, destLine: line, correct, wrongs, stops, rnd,
    explain: `Son ${stops} estacion${stops === 1 ? "" : "es"} en la Línea ${line.id}.` });
}

function finish({ dest, destLine, correct, wrongs, stops, rnd, explain }) {
  const options = [{ text: correct, correct: true }, ...wrongs.slice(0, 2).map(text => ({ text, correct: false }))];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { dest, destLine, stops, options, answer: correct, explain };
}
