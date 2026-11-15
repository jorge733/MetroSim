/* ==========================================================================
   RedMoviSim — 1.20.5 · mantencion.js
   Pantalla «En mantención». Con ACTIVA = true, boot.js muestra esta pantalla
   y NO carga el juego (ni la intro). Para entrar igual a revisar el juego
   mientras está en mantención: agregar ?probar a la dirección
   (redmovisim.cl/?probar); se recuerda mientras la pestaña siga abierta.

   Los estilos van aquí mismo (no en styles.css) para que la pantalla no
   dependa de la interfaz del juego.
   ========================================================================== */

/** true = el sitio muestra la pantalla de mantención en vez del juego. */
export const ACTIVA = false;

const CLAVE = "redmovisim.probar";

/** ¿Quien entra pidió saltarse la mantención (?probar)? */
export function saltarMantencion() {
  try {
    if (new URLSearchParams(location.search).has("probar")) sessionStorage.setItem(CLAVE, "1");
    return sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return new URLSearchParams(location.search).has("probar");
  }
}

const CSS = `
.mant{position:fixed;inset:0;z-index:9999;overflow:hidden auto;display:flex;align-items:center;justify-content:center;
  padding:max(72px,env(safe-area-inset-top)) 16px max(72px,env(safe-area-inset-bottom));
  background:radial-gradient(ellipse at 50% 30%,#1e2a3f 0%,#0d131d 55%,#05070a 100%);color:#fff;
  font-family:"Barlow",system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
.mant-tape{position:fixed;left:-10%;width:120%;height:46px;display:flex;align-items:center;justify-content:center;
  background:repeating-linear-gradient(-45deg,#f4b400 0 28px,#111 28px 56px);box-shadow:0 6px 20px #0009;pointer-events:none}
.mant-tape span{background:#111;color:#f4b400;font:800 15px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.3em;padding:7px 18px}
.mant-tape.t1{top:14px;transform:rotate(-2.5deg)}
.mant-tape.t2{bottom:14px;transform:rotate(2deg)}
.mant-box{max-width:560px;display:flex;flex-direction:column;align-items:center;gap:18px}
.mant-logo{width:112px;height:auto}
.mant h1{font:800 clamp(34px,7vw,56px)/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:-.01em}
.mant h1 em{display:block;margin-top:10px;font-style:normal;font-size:.5em;letter-spacing:.12em;color:#f4b400}
.mant p{font-size:clamp(15px,2.4vw,18px);line-height:1.45;color:#c9d2df}
.mant p b{color:#fff}
.mant-lines{display:flex;width:min(360px,80vw);height:8px;border-radius:4px;overflow:hidden}
.mant-lines i{flex:1}
.mant-board{font:600 clamp(13px,2.4vw,16px)/1.3 "JetBrains Mono",ui-monospace,monospace;background:#000;border:2px solid #333;
  border-radius:8px;padding:10px 18px;color:#ffb000;letter-spacing:.06em;text-shadow:0 0 8px #ff9000}
.mant small{color:#7f8b9c;font-size:13px}
@media (max-height:480px){.mant{padding:44px 16px}.mant-box{gap:8px;max-width:640px}.mant-logo{width:52px}
  .mant h1{font-size:30px}.mant h1 em{margin-top:4px}.mant p{font-size:14px}.mant-board{padding:6px 14px;font-size:13px}
  .mant-tape{height:26px}.mant-tape span{font-size:11px;padding:4px 12px}.mant-tape.t1{top:4px}.mant-tape.t2{bottom:4px}}
@media (prefers-reduced-motion:no-preference){.mant-board{animation:mant-blink 2.4s steps(1) infinite}}
@keyframes mant-blink{50%{opacity:.75}}
`;

const LOGO = `<svg class="mant-logo" viewBox="0 0 200 130" aria-hidden="true"><rect x="6" y="6" width="188" height="118" rx="30" fill="#d7262e"/>
<path d="M30 94H78L122 36H170" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M100 18V112" fill="none" stroke="#ffd2d5" stroke-width="9" stroke-linecap="round" stroke-dasharray="0.1 17"/>
<circle cx="30" cy="94" r="10" fill="#fff"/><circle cx="170" cy="36" r="10" fill="#fff"/>
<circle cx="100" cy="65" r="17" fill="#fff"/><circle cx="100" cy="65" r="8" fill="#d7262e"/></svg>`;

const COLORES = ["#e1251b", "#f4b400", "#8b5a2b", "#1d3f95", "#3c86c6", "#00965e", "#9b26b6", "#fff"];

/** Reemplaza la página por la pantalla de mantención. */
export function mostrarMantencion() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  for (const s of document.querySelectorAll("body > .screen")) s.classList.add("hidden");

  const el = document.createElement("main");
  el.className = "mant";
  el.innerHTML = `
    <div class="mant-tape t1" aria-hidden="true"><span>EN MANTENCIÓN</span></div>
    <div class="mant-box">
      ${LOGO}
      <h1>Estamos renovando RedMoviSim<em>VOLVEMOS PRONTO</em></h1>
      <div class="mant-lines" aria-hidden="true">${COLORES.map(c => `<i style="background:${c}"></i>`).join("")}</div>
      <p>Estamos rehaciendo la interfaz completa: <b>más simple, más clara y pensada para el Metro, los trenes y los buses por igual.</b></p>
      <div class="mant-board">PRÓXIMA ESTACIÓN: RedMoviSim 2.0</div>
      <small>Tu cuenta, tu tarjeta bip! y tus misiones quedan guardadas en este dispositivo.</small>
    </div>
    <div class="mant-tape t2" aria-hidden="true"><span>OBRAS EN LA VÍA</span></div>`;
  document.body.appendChild(el);
  document.title = "RedMoviSim · En mantención";
}
