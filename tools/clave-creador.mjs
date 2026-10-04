/* ==========================================================================
   MetroSim · tools/clave-creador.mjs
   Define (o cambia) la clave del Modo Creador.

   Uso, desde la carpeta MetroSim:
       node tools/clave-creador.mjs "tu clave secreta"

   Escribe en js/creator.js solo la huella SHA-256 de la clave (con sal);
   la clave en sí no se guarda en ningún archivo. Usa una frase larga: la
   huella queda pública en GitHub y una clave corta se podría adivinar.
   Al cambiar la clave, el modo se desactiva en los navegadores donde
   estaba activo (hay que volver a entrar con ?creador).
   ========================================================================== */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pass = process.argv[2];
if (!pass || pass.length < 10) {
  console.error('Uso: node tools/clave-creador.mjs "tu clave"   (mínimo 10 caracteres; mejor una frase)');
  process.exit(1);
}
const hash = createHash("sha256").update("metrosim-creador:" + pass).digest("hex");
const file = fileURLToPath(new URL("../js/creator.js", import.meta.url));
const src = readFileSync(file, "utf8");
const out = src.replace(/export const CREATOR_HASH = [^;]*;/, `export const CREATOR_HASH = "${hash}";`);
if (out === src && !src.includes(hash)) { console.error("No encontré CREATOR_HASH en js/creator.js"); process.exit(1); }
writeFileSync(file, out);
console.log("Listo: clave del Modo Creador guardada en js/creator.js (solo su huella).");
console.log("Actívalo abriendo el juego con ?creador al final de la dirección.");
