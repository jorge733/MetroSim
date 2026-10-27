/* ==========================================================================
   MetroSim — Alpha 0.6 · announcements.js
   Frases de megafonía de los trenes del Metro de Santiago.

   Se usan SOLO frases documentadas de la locución real de Metro (voz de
   Gloria Loyola), por ejemplo:
     "Próxima estación, Plaza de Armas, combinación a línea 3"
     "Se inicia el cierre de puertas"
     "Permite bajar antes de subir"
     "Estación terminal, todos deben descender del tren"
     "Que no se te olviden tus cosas, por tu preferencia muchas gracias"
     "Para un viaje más seguro, por favor no te sientes en el suelo del tren"

   1.3 · Avisos de la operación (tren detenido en plena vía, tren que se
   retira del servicio, tren que no admite pasajeros): no son grabaciones de
   la locución sino avisos que da el personal por megafonía, así que no
   tienen archivo en audio/voz/ y siempre los lee la voz sintetizada.

   Cada anuncio es una lista de fragmentos { key, text }. "key" es el nombre
   del archivo de audio opcional en audio/voz/ (ver audio/voz/LEEME.md);
   "text" es lo que dice la voz sintetizada si no hay grabación.
   ========================================================================== */

import { STATIONS, spokenName } from "./config.js";

const combos = (st) => st.combos.map((c, i) => ({
  key: `combinacion-linea-${c}`,
  text: `combinación a línea ${c}${i === st.combos.length - 1 ? "." : ","}`,
}));

export const PHRASES = {
  /** "Próxima estación, <nombre>[, combinación a línea N]." */
  nextStation: (st) => [
    { key: "proxima-estacion", text: "Próxima estación," },
    { key: `estacion-${st.id}`, text: `${spokenName(st.name)}${st.combos.length ? "," : "."}` },
    ...combos(st),
  ],
  /** Justo antes de llegar: "<nombre>[, combinación a línea N]." (mismas grabaciones, sin "Próxima estación") */
  arriving: (st) => [
    { key: `estacion-${st.id}`, text: `${spokenName(st.name)}${st.combos.length ? "," : "."}` },
    ...combos(st),
  ],
  doorsClosing: () => [{ key: "cierre-puertas", text: "Se inicia el cierre de puertas." }],
  letOff: () => [{ key: "permite-bajar", text: "Permite bajar antes de subir." }],
  terminal: () => [
    { key: "estacion-terminal", text: "Estación terminal, todos deben descender del tren." },
    { key: "no-olvides", text: "Que no se te olviden tus cosas, por tu preferencia muchas gracias." },
  ],
  safety: () => [{ key: "viaje-seguro", text: "Para un viaje más seguro, por favor no te sientes en el suelo del tren." }],

  /* ----- Avisos de la operación (voz sintetizada) ----- */
  /** Tren detenido entre estaciones; motivo: "nuestro tren se encuentra detenido por regulación de frecuencia". */
  lineStop: (reason) => [{ key: "aviso-detencion", text: `Estimados pasajeros, ${reason}. Reanudaremos la marcha en breves momentos. Agradecemos su comprensión.` }],
  /** Detenido un rato sin motivo informado (señal en rojo, tren delante). */
  briefStop: () => [{ key: "aviso-detencion-breve", text: "Estimados pasajeros, nos encontramos detenidos momentáneamente. Reanudaremos la marcha en breves momentos." }],
  resume: () => [{ key: "aviso-reanuda", text: "Reanudamos la marcha. Gracias por su comprensión." }],
  outOfService: () => [{ key: "aviso-retiro", text: "Estimados pasajeros, este tren se retira del servicio. Todos los pasajeros deben descender del tren. Por favor, esperen el próximo tren." }],
  noPassengers: () => [{ key: "aviso-no-admite", text: "Estimados pasajeros, el próximo tren no admite pasajeros. Por favor, no suba al tren." }],
};

/** Todos los nombres de archivo posibles (para el LEEME y el manifest). */
export function allClipKeys() {
  const keys = ["proxima-estacion", "cierre-puertas", "permite-bajar", "estacion-terminal", "no-olvides", "viaje-seguro"];
  STATIONS.forEach(st => keys.push(`estacion-${st.id}`));
  [...new Set(STATIONS.flatMap(st => st.combos))].forEach(c => keys.push(`combinacion-linea-${c}`));
  return keys;
}
