/* ==========================================================================
   MetroSim — Alpha 0.6 · intro.js
   Introducción de bienvenida: viaje animado por un túnel, logo, título,
   esquema de una línea que se enciende y tres tarjetas de presentación.
   "Comenzar" (o cualquier tecla) toca el gong, da la bienvenida por voz y
   pasa al menú. Solo se muestra al abrir la página.
   El módulo crea su propio HTML y CSS para no tocar el resto de la interfaz.
   ========================================================================== */

import { STATIONS, LINE } from "./config.js";
import { bestSpanishVoice } from "./audio.js";

const CSS = `
.intro{position:fixed;inset:0;z-index:50;background:#020305;overflow:hidden;transition:opacity .8s}
.intro.leaving{opacity:0;pointer-events:none}
.intro canvas{position:absolute;inset:0;width:100%;height:100%}
.intro-content{position:relative;height:100%;display:grid;place-content:center;justify-items:center;gap:14px;padding:16px;text-align:center}
.intro-content>*{opacity:0;transform:translateY(14px);animation:introIn .9s forwards}
.intro-logo{display:grid;place-items:center;width:84px;height:84px;border-radius:22px;background:#e1251b;font:900 50px Inter,system-ui,sans-serif;color:#fff;box-shadow:0 0 60px #e1251b88;animation-delay:.4s!important}
.intro-title{font:800 clamp(46px,9vw,92px)/1 Inter,system-ui,sans-serif;letter-spacing:-3px;color:#fff;text-shadow:0 8px 40px #000;animation-delay:1s!important}
.intro-sub{color:#c9d5e2;font-size:15px;letter-spacing:1px;animation-delay:1.6s!important}
.intro-dot{display:inline-grid;place-items:center;width:22px;height:22px;margin-right:6px;border-radius:50%;background:${LINE.color};color:#fff;font-weight:900;font-size:12px}
.intro-line{position:relative;width:min(80vw,620px);height:14px;margin:6px 0;animation-delay:2.1s!important}
.intro-line::before{content:"";position:absolute;left:0;right:0;top:5px;height:4px;border-radius:2px;background:${LINE.color}}
.intro-line i{position:absolute;top:2px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#2a2f35;border:2px solid ${LINE.color};transition:background .25s,box-shadow .25s}
.intro-line i.on{background:#fff;box-shadow:0 0 10px #fff}
.intro-cards{display:grid;grid-template-columns:repeat(3,minmax(0,190px));gap:10px;animation-delay:3.2s!important}
.intro-cards div{padding:12px;border:1px solid #ffffff22;border-radius:12px;background:#0a121bcc;color:#c9d5e2;font-size:12px;text-align:left}
.intro-cards b{display:block;margin-bottom:4px;color:#fff;font-size:14px}
.intro-start{padding:12px 26px;border:0;border-radius:12px;background:${LINE.color};color:#fff;font:700 16px Inter,system-ui,sans-serif;cursor:pointer;animation-delay:3.9s!important}
.intro-start:hover{filter:brightness(1.15)}
.intro-hint{color:#7f8fa2;font-size:11px;animation-delay:4.3s!important}
@keyframes introIn{to{opacity:1;transform:none}}
@media(max-width:640px){.intro-cards{grid-template-columns:1fr}}
`;

/** Túnel en perspectiva con anillos, luces y vías (canvas 2D). */
function startTunnel(canvas) {
  const g = canvas.getContext("2d");
  let raf = 0, t = 0, last = performance.now();
  const draw = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const w = canvas.width = canvas.clientWidth, h = canvas.height = canvas.clientHeight;
    const cx = w / 2, cy = h * 0.52, f = Math.min(w, h) * 0.9;
    g.fillStyle = "#020305"; g.fillRect(0, 0, w, h);
    const speed = 9 / (1 + t * 0.12);                       // frena poco a poco
    const offset = (t * speed) % 4;
    for (let i = 40; i >= 1; i--) {
      const z = i * 4 - offset;
      if (z <= 0.6) continue;
      const r = (f * 5.6) / z, fog = Math.min(1, 6 / z);
      g.strokeStyle = `rgba(150,160,170,${0.55 * fog})`;
      g.lineWidth = Math.max(1, 60 / z);
      g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.95, Math.PI * 2.05); g.stroke();
      if (i % 3 === 0) {                                     // luminarias del túnel
        const side = i % 2 ? 1 : -1;
        g.fillStyle = `rgba(255,220,170,${fog})`;
        g.beginPath(); g.arc(cx + side * r * 0.88, cy - r * 0.35, Math.max(1.5, 40 / z), 0, Math.PI * 2); g.fill();
      }
    }
    // Vías convergiendo al punto de fuga
    g.strokeStyle = "rgba(190,200,210,.35)"; g.lineWidth = 2;
    [-0.7, 0.7].forEach(x => { g.beginPath(); g.moveTo(cx + x * f * 1.4, h); g.lineTo(cx, cy); g.stroke(); });
    // Brillo de faros al fondo
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, f * 0.35);
    glow.addColorStop(0, "rgba(255,240,210,.35)"); glow.addColorStop(1, "rgba(255,240,210,0)");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}

/** Gong de dos tonos y bienvenida por voz (necesita el gesto del usuario). */
function welcomeSound(muted) {
  if (muted) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    [[659, 0], [523, 0.55]].forEach(([fq, s]) => {
      const o = ctx.createOscillator(), gn = ctx.createGain(), t0 = ctx.currentTime + s;
      o.frequency.value = fq; o.connect(gn).connect(ctx.destination);
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
      o.start(t0); o.stop(t0 + 1.3);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* sin audio */ }
  if (!("speechSynthesis" in window)) return;
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance("Bienvenido a MetroSim. Metro de Santiago.");
    const v = bestSpanishVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "es-CL";
    u.rate = 0.92;
    speechSynthesis.speak(u);
  }, 1300);
}

/**
 * Muestra la introducción y oculta el menú hasta que termina.
 * @param {object} opts
 * @param {() => boolean} opts.isMuted
 */
export function playIntro({ isMuted = () => false } = {}) {
  const menu = document.getElementById("startScreen");
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const root = document.createElement("section");
  root.className = "intro";
  root.innerHTML = `
    <canvas></canvas>
    <div class="intro-content">
      <div class="intro-logo">M</div>
      <h1 class="intro-title">MetroSim</h1>
      <p class="intro-sub">Bienvenido al Metro de Santiago · 7 líneas</p>
      <div class="intro-line"></div>
      <div class="intro-cards">
        <div><b>🚇 Conduce</b>Trenes de 5 coches con señales, horarios y maniobra de retorno.</div>
        <div><b>🚶 Viaja</b>Recorre las estaciones reales de cualquier línea, con mezanina y escaleras.</div>
        <div><b>💳 bip!</b>Carga tu tarjeta en la boletería y valida en el torniquete.</div>
      </div>
      <button class="intro-start">Comenzar ›</button>
      <p class="intro-hint">Pulsa cualquier tecla · Esc para saltar</p>
    </div>`;
  document.body.append(root);
  menu?.classList.add("hidden");

  // Estaciones del esquema que se encienden una tras otra
  const line = root.querySelector(".intro-line");
  const first = STATIONS[0].z, span = first - STATIONS.at(-1).z;
  const dots = STATIONS.map(st => {
    const d = document.createElement("i");
    d.style.left = `${((first - st.z) / span) * 100}%`;
    d.title = st.name;
    line.append(d);
    return d;
  });
  dots.forEach((d, i) => setTimeout(() => d.classList.add("on"), 2400 + i * 80));

  const stopTunnel = startTunnel(root.querySelector("canvas"));
  let done = false;
  const finish = (withSound) => {
    if (done) return;
    done = true;
    window.removeEventListener("keydown", onKey);
    if (withSound) welcomeSound(isMuted());
    root.classList.add("leaving");
    menu?.classList.remove("hidden");
    setTimeout(() => { stopTunnel(); root.remove(); }, 900);
  };
  const onKey = (e) => finish(e.key !== "Escape");
  window.addEventListener("keydown", onKey);
  root.querySelector(".intro-start").addEventListener("click", () => finish(true));
}
