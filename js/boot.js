/* ==========================================================================
   MetroSim — 1.8.3 · boot.js
   Arranque de la página. La intro no necesita Three.js ni el motor, así que
   empieza al instante; mientras corre, se carga el juego (main.js, que trae
   Three.js de la CDN y arma la red). La portada sale recién cuando la intro
   termina y el juego ya cargó, así nunca se ve antes de la intro.
   ========================================================================== */

import { playIntro } from "./intro.js";
import { ACTIVA, saltarMantencion, mostrarMantencion } from "./mantencion.js";
import { syncAtBoot } from "./cuenta.js";

/** El sonido silenciado se guarda en el navegador (lo cambia main.js con la tecla M). */
const isMuted = () => { try { return localStorage.getItem("metrosim.muted") === "1"; } catch { return false; } };

// En mantención (js/mantencion.js) no se carga el juego, salvo con ?probar en la dirección.
if (ACTIVA && !saltarMantencion()) {
  mostrarMantencion();
} else {
  // 2.11 · Con sesión iniciada, primero se trae la partida de la nube (mientras corre la intro, máx. 4 s)
  const game = syncAtBoot().then(() => import("./main.js"));
  playIntro({ isMuted, menuReady: game });
  game.catch(err => {
    console.error("RedMoviSim no pudo cargar el juego:", err);
    // 2.16.3 · Que se vea: antes quedaba la pantalla en negro sin explicación
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;inset:auto 16px 16px 16px;z-index:99999;padding:14px 16px;border-radius:12px;background:#1b1f24;color:#fff;font:500 15px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px #0008";
    box.textContent = navigator.onLine === false
      ? "No se pudo cargar RedMoviSim sin conexión. Conéctate a internet una vez y vuelve a abrirlo."
      : "No se pudo cargar RedMoviSim. Recarga la página para intentarlo de nuevo.";
    document.body.append(box);
  });
}
