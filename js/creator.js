/* ==========================================================================
   MetroSim — 1.0 · creator.js
   MODO CREADOR: acceso completo y gratis para el creador del juego.

   Con el modo activo:
     · La Tienda Metro aparece entera como comprada: licencias de todas las
       líneas, libreas, contratos, el depto con sus muebles y los recuerdos.
     · Compras en locales, pasajes del torniquete, tarjeta bip! y cargas no
       descuentan nada (quedan en los movimientos como "gratis · creador").
     · Sueldos y recompensas se siguen abonando normalmente.
   Lo que tenías comprado y tu saldo real no se tocan: al desactivarlo todo
   vuelve a como estaba.

   Activación: abrir el juego con ?creador al final de la dirección y
   escribir la clave. En el código solo está su huella SHA-256 (con sal), que
   se genera con:   node tools/clave-creador.mjs "tu clave"
   Para desactivarlo: el botón del Modo Creador en la pantalla inicial, o
   abrir con ?creador=off.

   (Es un juego que corre en el navegador: esto evita que otros jugadores lo
   activen por casualidad o leyendo el código, no es una seguridad bancaria.)
   Sin Three.js: lo usan economy.js, card.js y shop.js.
   ========================================================================== */

/** Huella SHA-256 de "metrosim-creador:" + clave. La escribe tools/clave-creador.mjs. */
export const CREATOR_HASH = "53f0dc5413de06f519b655108e75d723b62aaff3fe7037e2bbf71167591babb1";

const KEY = "metrosim.creator";
const SALT = "metrosim-creador:";

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** ¿Está activo el Modo Creador en este navegador? (si cambia la clave, se desactiva solo) */
export function isCreator() {
  return !!CREATOR_HASH && stored() === CREATOR_HASH;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function disableCreator() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

/**
 * Atiende ?creador / ?creador=off en la dirección y muestra el botón del modo.
 * Si cambia el estado, recarga la página para que todo arranque con él.
 * @param {HTMLButtonElement|null} badge  botón "Modo Creador" de la pantalla inicial (oculto al principio)
 */
export async function setupCreator(badge) {
  const url = new URL(location.href);
  if (url.searchParams.has("creador")) {
    const off = url.searchParams.get("creador") === "off";
    url.searchParams.delete("creador");
    history.replaceState(null, "", url.pathname + url.search + url.hash);   // que no quede en la dirección
    if (off) {
      if (isCreator()) { disableCreator(); location.reload(); return; }
    } else if (!isCreator()) {
      if (!CREATOR_HASH) alert("El Modo Creador aún no tiene clave.\nGenérala con:  node tools/clave-creador.mjs \"tu clave\"");
      else if (!crypto?.subtle) alert("El Modo Creador necesita https o localhost.");
      else {
        const pass = prompt("Clave de creador de MetroSim:");
        if (pass) {
          if (await sha256(SALT + pass) === CREATOR_HASH) {
            try { localStorage.setItem(KEY, CREATOR_HASH); } catch { /* sin almacenamiento */ }
            location.reload();
            return;
          }
          alert("Clave incorrecta.");
        }
      }
    }
  }
  if (!badge || !isCreator()) return;
  badge.hidden = false;
  badge.addEventListener("click", () => {
    if (!confirm("¿Desactivar el Modo Creador?\nVuelves a tus compras y tu saldo normales.")) return;
    disableCreator();
    location.reload();
  });
}
