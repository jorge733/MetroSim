/* ==========================================================================
   MetroSim — 1.0 · pwa.js
   App instalable (PWA): registra el service worker (sw.js) y muestra el
   botón "Instalar MetroSim" en la pantalla inicial.

     · Chrome / Edge / Android: el navegador avisa que se puede instalar
       (beforeinstallprompt); el botón abre su diálogo de instalación.
     · iPhone / iPad (Safari): no hay diálogo; el botón explica cómo
       hacerlo con Compartir → "Agregar a inicio".
     · Ya instalada (abierta como app) o abierta con doble clic (file://):
       el botón no aparece.
   ========================================================================== */

const installed = () => matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * @param {HTMLButtonElement|null} button  botón de instalar (oculto al principio)
 */
export function setupPWA(button) {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("MetroSim: no se pudo registrar el service worker", err));
  }
  if (!button || installed()) return;

  let deferred = null;
  const show = (on) => { button.hidden = !on; };

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();                 // se usa nuestro botón en vez de la barra del navegador
    deferred = e;
    show(true);
  });
  window.addEventListener("appinstalled", () => { deferred = null; show(false); });

  if (isIOS()) show(true);

  button.addEventListener("click", async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === "accepted") show(false);
    } else if (isIOS()) {
      alert("Para instalar MetroSim en tu iPhone o iPad:\n\n1. Toca Compartir (el cuadrado con la flecha).\n2. Elige «Agregar a inicio».\n\nSe abrirá a pantalla completa, como una app.");
    }
  });
}
