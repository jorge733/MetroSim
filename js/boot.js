/* ==========================================================================
   MetroSim — 1.8.3 · boot.js
   Arranque de la página. La intro no necesita Three.js ni el motor, así que
   empieza al instante; mientras corre, se carga el juego (main.js, que trae
   Three.js de la CDN y arma la red). La portada sale recién cuando la intro
   termina y el juego ya cargó, así nunca se ve antes de la intro.
   ========================================================================== */

import { playIntro } from "./intro.js";
import { ACTIVA, saltarMantencion, mostrarMantencion } from "./mantencion.js";

/** El sonido silenciado se guarda en el navegador (lo cambia main.js con la tecla M). */
const isMuted = () => { try { return localStorage.getItem("metrosim.muted") === "1"; } catch { return false; } };

// En mantención (js/mantencion.js) no se carga el juego, salvo con ?probar en la dirección.
if (ACTIVA && !saltarMantencion()) {
  mostrarMantencion();
} else {
  const game = import("./main.js");
  playIntro({ isMuted, menuReady: game });
  game.catch(err => console.error("RedMoviSim no pudo cargar el juego:", err));
}
