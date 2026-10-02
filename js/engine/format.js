/* ==========================================================================
   MetroSim — Motor · format.js
   Utilidades puras (sin Three.js ni DOM): matemáticas y formato de textos.
   ========================================================================== */

import { CONFIG } from "../config.js";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Hora del día en formato HH:MM:SS a partir de segundos desde medianoche. */
export function formatClock(seconds) {
  const s = Math.floor(seconds) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Error de parada en texto: positivo = el tren quedó antes de la marca. */
export function formatStopError(error) {
  if (Math.abs(error) < 0.05) return "en la marca";
  return error > 0 ? `${error.toFixed(1)} m antes` : `${(-error).toFixed(1)} m pasado`;
}

export function gradeStop(error) {
  const e = Math.abs(error);
  if (e <= 0.5) return "EXCELENTE";
  if (e <= 1.5) return "BUENA";
  if (e <= CONFIG.station.stopTolerance) return "ACEPTABLE";
  return "FUERA DE POSICIÓN";
}
