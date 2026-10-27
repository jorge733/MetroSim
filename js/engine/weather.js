/* ==========================================================================
   MetroSim — Motor · weather.js
   1.5 · El CLIMA de Santiago y cómo afecta al Metro.

   Bajo tierra el tiempo no se nota, pero en los tramos AL AIRE LIBRE
   (viaductos y trincheras, ver sections.js) sí:
     · LLUVIA: el riel mojado (o la pista de los neumáticos) agarra mucho
       menos. El tren patina al arrancar y desliza al frenar: el control
       antipatinaje recorta la tracción y el freno, y las distancias de
       frenado se alargan. La DMI avisa "PATINAJE" / "DESLIZAMIENTO".
     · MÁS VIAJEROS: con lluvia la micro y el auto van lentos y más gente
       toma el Metro (y en invierno, con frío, también algo más).
   El dibujo (render/outdoor.js) pone el cielo gris, la lluvia y el sonido.

   El estado del tiempo es uno solo para toda la red (WEATHER). Lo fija el
   juego al empezar: el tiempo REAL de Santiago (main.js lo pide a un
   servicio meteorológico público) o, si no hay conexión, uno típico de la
   estación del año. También se puede elegir en la pantalla inicial.
   Este módulo es lógica pura: funciona también en Node.
   ========================================================================== */

/** Tipos de tiempo, con su lluvia (0..1), nubosidad (0..1) y texto. */
export const WEATHER_KINDS = {
  despejado: { label: "Despejado", icon: "☀️", rain: 0, cloud: 0.05 },
  nublado:   { label: "Nublado",   icon: "☁️", rain: 0, cloud: 0.8 },
  llovizna:  { label: "Llovizna",  icon: "🌦️", rain: 0.35, cloud: 0.9 },
  lluvia:    { label: "Lluvia",    icon: "🌧️", rain: 0.75, cloud: 1 },
  temporal:  { label: "Temporal",  icon: "⛈️", rain: 1, cloud: 1 },
};

/** Estado del tiempo vigente (uno para toda la red). */
export const WEATHER = {
  kind: "despejado",
  rain: 0,
  cloud: 0.05,
  temp: 18,                            // °C
  source: "simulado",                  // "real" | "simulado" | "elegido"
  /** Humedad del riel 0..1 (sube con la lluvia y tarda en secarse). */
  wet: 0,
};

/** Fija el tiempo. */
export function setWeather(kind, { temp = WEATHER.temp, source = "elegido" } = {}) {
  const k = WEATHER_KINDS[kind] ? kind : "despejado";
  Object.assign(WEATHER, { kind: k, rain: WEATHER_KINDS[k].rain, cloud: WEATHER_KINDS[k].cloud, temp, source });
  WEATHER.wet = WEATHER.rain > 0 ? Math.max(WEATHER.wet, 0.6 + 0.4 * WEATHER.rain) : 0;
}

/** Texto para la interfaz: "🌧️ Lluvia · 9 °C". */
export function weatherLabel(w = WEATHER) {
  const k = WEATHER_KINDS[w.kind] || WEATHER_KINDS.despejado;
  return `${k.icon} ${k.label} · ${Math.round(w.temp)} °C`;
}

/**
 * Tiempo típico para una fecha en Santiago (clima mediterráneo: llueve casi
 * solo de mayo a agosto). Determinista por día: el mismo día da el mismo tiempo.
 */
export function typicalWeather(date = new Date()) {
  const m = date.getMonth();                                       // 0 = enero
  // Probabilidad de un día de lluvia y temperatura media de cada mes
  const RAIN = [0.01, 0.01, 0.03, 0.08, 0.18, 0.25, 0.25, 0.2, 0.1, 0.06, 0.03, 0.01];
  const TEMP = [22, 21, 19, 15, 12, 9, 8, 10, 12, 15, 18, 21];
  const seed = date.getFullYear() * 400 + m * 32 + date.getDate();
  const x = ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const y = ((Math.sin(seed * 78.233) * 12345.678) % 1 + 1) % 1;
  let kind = "despejado";
  if (x < RAIN[m]) kind = y < 0.15 ? "temporal" : y < 0.6 ? "lluvia" : "llovizna";
  else if (x < RAIN[m] * 2.5 + 0.1) kind = "nublado";
  return { kind, temp: TEMP[m] + (y - 0.5) * 6 };
}

/**
 * Traduce un código WMO (el que usan los servicios meteorológicos) a un tipo
 * de tiempo del juego.
 */
export function kindFromWmo(code, precipitation = 0) {
  if (code >= 95) return "temporal";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return precipitation > 4 || code === 65 || code === 82 ? "temporal" : "lluvia";
  if (code >= 51 && code <= 57) return "llovizna";
  if (code >= 71 && code <= 77) return "lluvia";                 // nieve: en Santiago, casi nunca
  if (code >= 2) return "nublado";
  return precipitation > 0.2 ? "llovizna" : "despejado";
}

/**
 * Agarre disponible (coeficiente de adherencia) para un tren en un punto.
 * @param {object} stock     modelo de tren (fleet.js)
 * @param {boolean} exposed  la vía está al aire libre (viaducto o trinchera)
 */
export function adhesionFor(stock, exposed) {
  if (!exposed || WEATHER.wet <= 0) return stock.adhesion;
  const wet = stock.wetAdhesion ?? stock.adhesion * 0.5;
  return stock.adhesion + (wet - stock.adhesion) * Math.min(1, WEATHER.wet);
}

/** Multiplicador de la demanda de viajeros por el tiempo (lluvia y frío: más gente en el Metro). */
export function weatherDemandFactor(w = WEATHER) {
  const cold = w.temp < 8 ? 0.04 : 0;
  return 1 + 0.18 * w.rain + cold;
}
