/* ==========================================================================
   MetroSim — 1.2 · icons.js
   Íconos de trazo en SVG para la interfaz (sustituyen a los emojis, que se ven
   distinto en cada sistema) y utilidades de color de la interfaz.
   Uso: icon("train") devuelve el <svg> como texto; en el HTML se usa el mismo
   marcado con class="ico".
   ========================================================================== */

const PATHS = {
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 17l-2 4M15 17l2 4"/><path d="M9 14h.01M15 14h.01"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M7 12l3-4h4l2 4 3 1M11 15l-1-4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M6 10h3l2-3 2 5 2-2h3"/>',
  bag: '<path d="M4 7h16l-1.5 13h-13zM9 7V5a3 3 0 0 1 6 0v2"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  soundOn: '<path d="M11 5 6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  soundOff: '<path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M15 7v10"/>',
};

/** Ícono como texto SVG (hereda el color del texto). */
export function icon(name, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ""}</svg>`;
}

/**
 * Texto legible sobre un color de fondo: blanco mientras contraste al menos 3:1
 * (texto grande y en negrita de botones e insignias); si no, casi negro
 * (L2 amarilla, L4A celeste).
 */
export function textOn(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= 3 ? "#fff" : "#14110a";
}
