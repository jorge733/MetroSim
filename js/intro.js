/* ==========================================================================
   MetroSim — 1.0 · intro.js
   Introducción cinematográfica (solo al abrir la página).

   Escenas, dibujadas en un canvas 2D a pantalla completa:
     1. VIAJE POR EL TÚNEL: el tren acelera entre anillos, luminarias,
        rieles y chispas de la catenaria; al fondo se abre la boca del túnel.
     2. SALIDA A LA CIUDAD: destello y aparece Santiago con el cielo de la
        HORA REAL (noche estrellada, atardecer o día), la cordillera de los
        Andes, el perfil de edificios con la Gran Torre, un viaducto por el
        que cruzan trenes de distintas líneas y una avenida con estelas de
        autos. Todo con paralaje: se mueve suavemente con el ratón.
   Encima aparece la portada: logo, sello de la versión, título con letras
   que caen, contadores (líneas, estaciones, hitos, artículos de la tienda),
   un plano esquemático de la red que se dibuja línea por línea con trenes
   recorriéndola, y tarjetas con lo que se puede hacer en la 1.0 (cabina,
   viaje a pie con combinaciones y ascensores, ciudad, libreta de misiones,
   Tienda Metro y Centro de Control). "Comenzar" (o cualquier tecla / clic)
   toca el gong, da la bienvenida por voz y pasa al menú; Esc salta sin sonido.

   El módulo crea su propio HTML y CSS para no tocar el resto de la interfaz.
   ========================================================================== */

import { LINES } from "./engine/network.js";
import { LANDMARKS } from "./city/catalog.js";
import { bestSpanishVoice } from "./audio.js";
import { VERSION, LINE_COLORS } from "./config.js";
import { LICENSES, LIVERIES, CONTRACTS, FURNITURE } from "./shop.js";

const TUNNEL_TIME = 4.6;           // segundos de viaje por el túnel antes de salir a la ciudad

const CSS = `
.intro{position:fixed;inset:0;z-index:50;background:#020305;overflow:hidden;transition:opacity .9s;color:#fff;font-family:Inter,system-ui,sans-serif}
.intro.leaving{opacity:0;pointer-events:none}
.intro>canvas{position:absolute;inset:0;width:100%;height:100%}
.intro-ui{position:relative;height:100%;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);align-items:safe center;overflow-y:auto;gap:28px;padding:28px clamp(16px,5vw,64px);opacity:0;transition:opacity 1.2s}
.intro.city .intro-ui{opacity:1}
.intro-left{display:grid;gap:14px;justify-items:start}
.intro-brand{display:flex;align-items:center;gap:16px}
.intro-logo{width:clamp(84px,10vw,120px);height:auto;filter:drop-shadow(0 0 30px #e1251b88);transform:scale(.4) rotate(-12deg);opacity:0;transition:transform 1s cubic-bezier(.2,1.6,.4,1),opacity .6s}
.intro.city .intro-logo{transform:none;opacity:1}
.intro-title{font-weight:900;font-size:clamp(48px,8vw,104px);line-height:.9;letter-spacing:-3px;text-shadow:0 10px 50px #000c}
.intro-title span{display:inline-block;opacity:0;transform:translateY(-60px) rotate(-8deg)}
.intro.city .intro-title span{animation:introDrop .7s cubic-bezier(.2,1.4,.4,1) forwards}
.intro-brand>div{display:grid;gap:8px;justify-items:start}
.intro-eyebrow{font-size:12px;letter-spacing:4px;color:#ffd166;font-weight:700}
.intro-version{display:inline-flex;align-items:center;gap:7px;padding:4px 10px 4px 8px;border:1px solid #ffd16655;border-radius:999px;background:#ffd16614;color:#ffe3a3;font-size:11px;font-weight:800;letter-spacing:2px;opacity:0;transform:translateY(8px);transition:opacity .6s 1.1s,transform .6s 1.1s}
.intro-version::before{content:"";width:7px;height:7px;border-radius:50%;background:#3ddc84;box-shadow:0 0 8px #3ddc84}
.intro.city .intro-version{opacity:1;transform:none}
.intro-sub{max-width:520px;color:#d4dfeb;font-size:clamp(14px,1.5vw,17px);line-height:1.45;text-shadow:0 2px 12px #000}
.intro-sub .caret{display:inline-block;width:2px;height:1em;margin-left:2px;background:#ffd166;vertical-align:-2px;animation:introBlink .8s steps(2) infinite}
.intro-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;width:min(100%,580px)}
.intro-stats div{padding:9px 12px;border:1px solid #ffffff26;border-radius:12px;background:#08101acc;backdrop-filter:blur(8px)}
.intro-stats b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
.intro-stats small{display:block;color:#9fb0c2;font-size:10.5px;line-height:1.2;letter-spacing:1px}
.intro-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:min(100%,580px)}
.intro-cards div{padding:9px 12px;border:1px solid #ffffff1f;border-left:4px solid var(--c);border-radius:11px;background:#08101add;backdrop-filter:blur(8px);color:#c9d5e2;font-size:12px;line-height:1.35;opacity:0;transform:translateX(-24px)}
.intro.city .intro-cards div{animation:introSlide .6s ease-out forwards}
.intro-cards b{display:block;margin-bottom:3px;color:#fff;font-size:14px}
.intro-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.intro-start{position:relative;padding:14px 30px;border:0;border-radius:14px;background:linear-gradient(135deg,#e1251b,#b3121f);color:#fff;font:800 17px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px #e1251b55;overflow:hidden}
.intro-start::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,#ffffff55 50%,transparent 70%);transform:translateX(-120%);animation:introShine 2.8s 2s infinite}
.intro-start:hover{filter:brightness(1.12);transform:translateY(-1px)}
.intro-hint{color:#8fa0b3;font-size:11px}
.intro-mapbox{position:relative;justify-self:center;width:min(100%,520px);aspect-ratio:1/1;border:1px solid #ffffff1c;border-radius:22px;background:radial-gradient(circle at 50% 45%,#0e1a28ee,#060b12f2);box-shadow:0 30px 80px #000a;overflow:clip;opacity:0;transform:perspective(900px) rotateY(-14deg) scale(.92);transition:opacity 1s .6s,transform 1.4s .6s cubic-bezier(.2,1,.3,1)}
.intro.city .intro-mapbox{opacity:1;transform:perspective(900px) rotateY(-6deg)}
.intro-mapbox canvas{width:100%;height:100%;display:block}
.intro-maplabel{position:absolute;left:16px;top:12px;font-size:11px;letter-spacing:2px;color:#9fb0c2}
.intro-legend{position:absolute;left:12px;right:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:5px;justify-content:center}
.intro-legend span{padding:3px 8px;border-radius:999px;font-size:10px;font-weight:800;background:var(--c);opacity:0;transform:scale(.6);transition:opacity .4s,transform .4s}
.intro-legend span.on{opacity:1;transform:none}
.intro-skip{position:absolute;right:18px;top:16px;z-index:2;padding:7px 12px;border:1px solid #ffffff33;border-radius:9px;background:#0008;color:#dfe7f0;font-size:12px;cursor:pointer}
@keyframes introDrop{to{opacity:1;transform:none}}
@keyframes introSlide{to{opacity:1;transform:none}}
@keyframes introBlink{50%{opacity:0}}
@keyframes introShine{0%{transform:translateX(-120%)}40%,100%{transform:translateX(120%)}}
@media(max-height:820px) and (min-width:861px){
  .intro-ui{padding-block:18px}
  .intro-left{gap:10px}
  .intro-logo{width:76px}
  .intro-title{font-size:clamp(44px,6.4vw,80px)}
  .intro-sub{font-size:14px}
  .intro-stats div{padding:7px 12px}
  .intro-stats b{font-size:22px}
  .intro-cards div{padding:7px 11px;font-size:11.5px}
  .intro-cards b{font-size:13px;margin-bottom:1px}
}
@media(max-width:860px){
  .intro-ui{grid-template-columns:1fr;align-content:start;overflow:auto;gap:16px;padding-top:56px}
  .intro-mapbox{width:min(100%,360px);order:-1}   /* overflow:clip (no hidden): así su aspect-ratio cuenta para la fila y no se monta sobre el texto */
  .intro-cards{grid-template-columns:1fr}
}
`;

/* ==========================================================================
   Utilidades
   ========================================================================== */

function rng(seed) {
  let a = seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (t) => t * t * (3 - 2 * t);

/** Cielo según la hora local: noche, amanecer/atardecer o día. */
function skyNow() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  const sun = Math.sin(Math.PI * (h - 6.8) / 13.6);
  const day = clamp01(sun * 2.2 + 0.15);
  const dusk = clamp01(1 - Math.abs(sun - 0.08) / 0.22);
  const mix = (n, dd, ds) => n.map((v, i) => Math.round(lerp(lerp(v, dd[i], day), ds[i], dusk * 0.6)));
  return {
    day, dusk, night: day < 0.3,
    top: mix([4, 8, 22], [64, 132, 205], [58, 52, 110]),
    bottom: mix([18, 28, 52], [170, 210, 240], [246, 150, 92]),
  };
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* ==========================================================================
   Escena 3D falsa (canvas 2D): túnel y ciudad
   ========================================================================== */

function startScene(canvas, root) {
  const g = canvas.getContext("2d");
  const sky = skyNow();
  const R = rng(20251003);
  let W = 0, H = 0, layers = null;
  let raf = 0, t = 0, last = performance.now();
  let mx = 0, my = 0, pmx = 0, pmy = 0;                    // paralaje con el ratón (suavizado)
  const onMove = (e) => { mx = (e.clientX / innerWidth - 0.5) * 2; my = (e.clientY / innerHeight - 0.5) * 2; };
  window.addEventListener("pointermove", onMove);

  const lineColors = LINES.map(l => l.color);
  const sparks = [];
  const trains = [];
  const cars = Array.from({ length: 26 }, (_, i) => ({ x: R(), lane: i % 2, speed: 0.06 + R() * 0.07, len: 0.03 + R() * 0.04 }));
  let nextTrain = 0.5;
  let cityStarted = false;

  /** Capas fijas de la ciudad (se rehacen al cambiar el tamaño). */
  function buildLayers() {
    const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const r = rng(7);
    // Estrellas
    const stars = mk(W, H), sg = stars.getContext("2d");
    if (sky.night) for (let i = 0; i < 260; i++) { sg.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.7})`; sg.fillRect(r() * W, r() * H * 0.6, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1); }
    // Cordillera
    const andes = mk(W * 1.3, H), ag = andes.getContext("2d");
    const baseY = H * 0.62;
    ag.fillStyle = sky.night ? "#1a2233" : rgb([110, 124, 150]);
    ag.beginPath(); ag.moveTo(0, H);
    const peaks = [];
    for (let x = 0; x <= andes.width; x += andes.width / 14) {
      const y = baseY - H * (0.12 + r() * 0.2);
      peaks.push([x, y]); ag.lineTo(x, y);
    }
    ag.lineTo(andes.width, H); ag.closePath(); ag.fill();
    ag.fillStyle = sky.night ? "rgba(200,215,235,.35)" : "rgba(250,252,255,.9)";       // nieve
    for (let i = 1; i < peaks.length; i++) {
      const [x0, y0] = peaks[i - 1], [x1, y1] = peaks[i];
      const top = y0 < y1 ? [x0, y0] : [x1, y1];
      ag.beginPath(); ag.moveTo(top[0] - 34, top[1] + 26); ag.lineTo(top[0], top[1]); ag.lineTo(top[0] + 34, top[1] + 26);
      ag.lineTo(top[0] + 12, top[1] + 18); ag.lineTo(top[0] - 8, top[1] + 30); ag.closePath(); ag.fill();
    }
    // Perfil de edificios (dos planos) con ventanas encendidas
    const skyline = (seed, tint, minH, maxH, litP) => {
      const c = mk(W * 1.5, H), cg = c.getContext("2d"), rr = rng(seed);
      for (let x = 0; x < c.width;) {
        const bw = 26 + rr() * 70, bh = H * (minH + rr() * (maxH - minH));
        cg.fillStyle = tint; cg.fillRect(x, H * 0.78 - bh, bw, bh + H);
        for (let wy = H * 0.78 - bh + 8; wy < H * 0.78 - 6; wy += 9) for (let wx = x + 5; wx < x + bw - 6; wx += 8) {
          if (rr() < litP) { cg.fillStyle = rr() < 0.7 ? "rgba(255,214,150,.85)" : "rgba(190,220,255,.7)"; cg.fillRect(wx, wy, 4, 5); }
        }
        x += bw + 2 + rr() * 6;
      }
      return c;
    };
    const lit = sky.night ? 0.32 : sky.dusk > 0.4 ? 0.18 : 0.03;
    const far = skyline(11, sky.night ? "#0e1522" : "#5b6b80", 0.08, 0.26, lit * 0.8);
    const near = skyline(23, sky.night ? "#070b12" : "#3b4656", 0.12, 0.34, lit);
    layers = { stars, andes, far, near };
  }

  function resize() {
    W = canvas.width = canvas.clientWidth;
    H = canvas.height = canvas.clientHeight;
    buildLayers();
  }
  resize();
  window.addEventListener("resize", resize);

  /* ---------- Escena 1: túnel ---------- */
  function drawTunnel(tt) {
    const cx = W / 2 + pmx * 20, cy = H * 0.52 + pmy * 12, f = Math.min(W, H) * 0.9;
    g.fillStyle = "#020305"; g.fillRect(0, 0, W, H);
    const speed = 6 + tt * tt * 3.2;                        // acelera
    const offset = (tt * speed) % 4;
    // Boca del túnel al final: un disco de luz que crece
    const exitP = clamp01((tt - TUNNEL_TIME + 1.6) / 1.6);
    if (exitP > 0) {
      const rr = f * (0.04 + ease(exitP) * 1.2);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, rgb(sky.bottom, 1)); gr.addColorStop(0.7, rgb(sky.top, 0.9)); gr.addColorStop(1, rgb(sky.top, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
    }
    for (let i = 46; i >= 1; i--) {
      const z = i * 4 - offset;
      if (z <= 0.5) continue;
      if (exitP > 0 && z > lerp(184, 4, ease(exitP))) continue;                 // el túnel se acaba
      const r = (f * 5.6) / z, fog = Math.min(1, 7 / z);
      g.strokeStyle = `rgba(120,130,142,${0.6 * fog})`;
      g.lineWidth = Math.max(1, 70 / z);
      g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.93, Math.PI * 2.07); g.stroke();
      if (i % 3 === 0) {                                     // luminarias del túnel con estela
        const side = i % 2 ? 1 : -1;
        const lx = cx + side * r * 0.88, ly = cy - r * 0.36;
        g.strokeStyle = `rgba(255,214,160,${fog})`; g.lineWidth = Math.max(1.5, 34 / z);
        g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + (lx - cx) * 0.12 * speed / 10, ly + (ly - cy) * 0.12 * speed / 10); g.stroke();
      }
      if (i % 6 === 0) {                                     // señal verde
        const sx = cx - r * 0.7, sy = cy + r * 0.05;
        g.fillStyle = `rgba(80,255,140,${fog})`; g.beginPath(); g.arc(sx, sy, Math.max(1.2, 22 / z), 0, Math.PI * 2); g.fill();
      }
    }
    // Rieles y durmientes
    g.strokeStyle = "rgba(200,208,216,.5)"; g.lineWidth = 3;
    [-0.55, 0.55].forEach(x => { g.beginPath(); g.moveTo(cx + x * f * 1.5, H); g.lineTo(cx + x * 6, cy + 6); g.stroke(); });
    for (let i = 1; i < 30; i++) {
      const z = i * 1.6 - (tt * speed) % 1.6;
      if (z < 0.4) continue;
      const y = cy + (f * 0.9) / z, half = (f * 1.0) / z;
      if (y > H) continue;
      g.strokeStyle = `rgba(90,80,70,${Math.min(0.8, 3 / z)})`; g.lineWidth = Math.max(1, 14 / z);
      g.beginPath(); g.moveTo(cx - half, y); g.lineTo(cx + half, y); g.stroke();
    }
    // Catenaria y chispas
    g.strokeStyle = "rgba(160,170,180,.35)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, -10); g.lineTo(cx, cy - 6); g.stroke();
    if (Math.random() < 0.08 + tt * 0.02) for (let k = 0; k < 6; k++) sparks.push({ x: cx + (Math.random() - 0.5) * 30, y: H * 0.12, vx: (Math.random() - 0.5) * 380, vy: Math.random() * 120, life: 0.5 });
    // Líneas de velocidad
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1;
    for (let k = 0; k < 40; k++) {
      const a = R() * Math.PI * 2, r0 = f * (0.2 + R() * 0.6), len = speed * 6;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); g.stroke();
    }
  }

  /* ---------- Escena 2: ciudad ---------- */
  function drawCity(ct, dt) {
    const grad = g.createLinearGradient(0, 0, 0, H * 0.8);
    grad.addColorStop(0, rgb(sky.top)); grad.addColorStop(1, rgb(sky.bottom));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    if (sky.night) {
      g.globalAlpha = 0.7 + Math.sin(ct * 0.7) * 0.15; g.drawImage(layers.stars, pmx * -6, pmy * -4); g.globalAlpha = 1;
      g.fillStyle = "rgba(245,245,230,.95)"; g.beginPath(); g.arc(W * 0.8 - pmx * 10, H * 0.16, Math.min(W, H) * 0.035, 0, Math.PI * 2); g.fill();
    } else {
      const sg = g.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, H * 0.4);
      sg.addColorStop(0, "rgba(255,245,215,.9)"); sg.addColorStop(1, "rgba(255,245,215,0)");
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
    }
    const drift = (ct * 6) % (W * 0.5);                       // el plano se desplaza lentamente
    g.drawImage(layers.andes, -W * 0.15 - pmx * 12 - drift * 0.1, pmy * -4);
    g.drawImage(layers.far, -W * 0.25 - pmx * 24 - drift * 0.3, pmy * -6);

    // Gran Torre Santiago con baliza roja
    const tx = W * 0.62 - pmx * 30 - drift * 0.38, base = H * 0.78;
    g.fillStyle = sky.night ? "#0b1220" : "#4a5c72";
    g.beginPath(); g.moveTo(tx - 24, base); g.lineTo(tx - 15, base - H * 0.5); g.lineTo(tx + 15, base - H * 0.5); g.lineTo(tx + 24, base); g.fill();
    g.strokeStyle = sky.night ? "#26364c" : "#6c7f95"; g.lineWidth = 2;
    for (let k = -1; k <= 1; k += 2) { g.beginPath(); g.moveTo(tx + k * 15, base - H * 0.5); g.lineTo(tx + k * 9, base - H * 0.55); g.stroke(); }
    if (Math.floor(ct * 1.2) % 2 === 0) { g.fillStyle = "#ff2a2a"; g.beginPath(); g.arc(tx, base - H * 0.555, 3, 0, Math.PI * 2); g.fill(); }
    if (sky.night) for (let y = base - H * 0.48; y < base - 10; y += 7) { g.fillStyle = `rgba(190,220,255,${0.25 + 0.2 * Math.sin(y * 0.3 + ct)})`; g.fillRect(tx - 12, y, 24, 2); }

    g.drawImage(layers.near, -W * 0.25 - pmx * 40 - drift * 0.6, pmy * -8);

    // Viaducto con pilares
    const vy = H * 0.8 + pmy * 6;
    g.fillStyle = sky.night ? "#05080d" : "#2c333c";
    g.fillRect(0, vy, W, 10);
    for (let x = -((ct * 0) % 80) - pmx * 50; x < W; x += 80) g.fillRect(x, vy + 10, 9, H - vy);
    // Trenes que cruzan el viaducto (colores de las líneas)
    nextTrain -= dt;
    if (nextTrain <= 0) {
      const dir = trains.length % 2 ? -1 : 1;
      trains.push({ x: dir > 0 ? -W * 0.6 : W * 1.1, dir, v: W * (0.28 + Math.random() * 0.1), color: lineColors[Math.floor(Math.random() * lineColors.length)] });
      nextTrain = 3.5 + Math.random() * 3;
    }
    for (let i = trains.length - 1; i >= 0; i--) {
      const tr = trains[i];
      tr.x += tr.v * tr.dir * dt;
      if (tr.x > W * 1.3 || tr.x < -W * 0.8) { trains.splice(i, 1); continue; }
      const carW = Math.max(60, W * 0.075), y = vy - 26;
      for (let c = 0; c < 5; c++) {
        const x = tr.x + c * (carW + 3) * (tr.dir > 0 ? -1 : 1) - pmx * 50;
        g.fillStyle = "#d9dde2"; g.fillRect(x, y, carW, 24);
        g.fillStyle = tr.color; g.fillRect(x, y + 16, carW, 4);
        g.fillStyle = sky.night ? "rgba(255,236,190,.95)" : "rgba(40,60,80,.85)";
        for (let wx = x + 6; wx < x + carW - 10; wx += 13) g.fillRect(wx, y + 4, 9, 8);
      }
      const head = tr.x + (tr.dir > 0 ? carW : 0) - pmx * 50;
      const hg = g.createRadialGradient(head, vy - 12, 0, head, vy - 12, 90);
      hg.addColorStop(0, "rgba(255,250,220,.55)"); hg.addColorStop(1, "rgba(255,250,220,0)");
      g.fillStyle = hg; g.fillRect(head - 90, vy - 100, 180, 180);
    }

    // Avenida con estelas de autos
    const ay = H * 0.9 + pmy * 8;
    g.fillStyle = sky.night ? "#030508" : "#22272e"; g.fillRect(0, ay - 6, W, H);
    for (const c of cars) {
      c.x += c.speed * dt * (c.lane ? -1 : 1);
      if (c.x > 1.1) c.x -= 1.2; if (c.x < -0.1) c.x += 1.2;
      const x = c.x * W, y = ay + (c.lane ? 18 : 6);
      const tail = c.len * W * (c.lane ? 1 : -1);
      const lg = g.createLinearGradient(x, 0, x + tail, 0);
      const col = c.lane ? "255,60,50" : "255,245,215";
      lg.addColorStop(0, `rgba(${col},.95)`); lg.addColorStop(1, `rgba(${col},0)`);
      g.strokeStyle = lg; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + tail, y); g.stroke();
    }
    // Viñeta y bruma
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.7)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const cg = g.createLinearGradient(0, 0, W * 0.65, 0);                    // contraste para el texto
    cg.addColorStop(0, "rgba(2,4,8,.5)"); cg.addColorStop(1, "rgba(2,4,8,0)");
    g.fillStyle = cg; g.fillRect(0, 0, W * 0.65, H);
  }

  const draw = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    pmx += (mx - pmx) * Math.min(1, dt * 3); pmy += (my - pmy) * Math.min(1, dt * 3);
    if (t < TUNNEL_TIME) drawTunnel(t);
    else {
      if (!cityStarted) { cityStarted = true; root.classList.add("city"); }
      drawCity(t - TUNNEL_TIME, dt);
      const flash = 1 - clamp01((t - TUNNEL_TIME) / 0.9);                 // destello al salir del túnel
      if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 0.9})`; g.fillRect(0, 0, W, H); }
    }
    // Chispas (sobre todo en el túnel)
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt; s.vy += 900 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      g.fillStyle = `rgba(160,210,255,${s.life * 2})`; g.fillRect(s.x, s.y, 2, 2);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return {
    skip() { if (t < TUNNEL_TIME) t = TUNNEL_TIME; },
    stop() { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); window.removeEventListener("resize", resize); },
  };
}

/* ==========================================================================
   Plano esquemático de la red: se dibuja línea por línea y circulan trenes
   ========================================================================== */

/** Trazado aproximado de cada línea sobre Santiago (coordenadas 0..1). */
const MAP_PATHS = {
  "1": [[0.06, 0.5], [0.3, 0.5], [0.5, 0.47], [0.7, 0.4], [0.94, 0.34]],
  "2": [[0.47, 0.06], [0.46, 0.3], [0.47, 0.5], [0.46, 0.75], [0.45, 0.95]],
  "3": [[0.38, 0.07], [0.44, 0.3], [0.5, 0.47], [0.62, 0.56], [0.82, 0.6]],
  "4": [[0.73, 0.4], [0.76, 0.55], [0.74, 0.75], [0.7, 0.95]],
  "4A": [[0.46, 0.8], [0.6, 0.8], [0.74, 0.78]],
  "5": [[0.07, 0.6], [0.28, 0.54], [0.47, 0.49], [0.6, 0.6], [0.66, 0.78], [0.72, 0.9]],
  "6": [[0.2, 0.72], [0.4, 0.66], [0.56, 0.62], [0.72, 0.56]],
};

function startMap(canvas, legend) {
  const g = canvas.getContext("2d");
  const lines = LINES.map((l, i) => {
    const pts = MAP_PATHS[l.id] || [[0.1, 0.5], [0.9, 0.5]];
    const seg = [];
    let total = 0;
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(d); total += d; }
    return { line: l, pts, seg, total, start: 0.6 + i * 0.45, trains: [Math.random(), Math.random()].map((p, k) => ({ p, dir: k ? -1 : 1 })) };
  });
  const at = (L, u) => {                                   // punto a la fracción u del recorrido
    let d = u * L.total;
    for (let k = 0; k < L.seg.length; k++) {
      if (d <= L.seg[k]) { const f = d / L.seg[k], a = L.pts[k], b = L.pts[k + 1]; return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]; }
      d -= L.seg[k];
    }
    return L.pts.at(-1);
  };
  let raf = 0, t = 0, last = performance.now(), started = false;
  const draw = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (started) t += dt;
    const w = canvas.width = canvas.clientWidth * 2, h = canvas.height = canvas.clientHeight * 2;
    const pad = w * 0.08, S = (p) => [pad + p[0] * (w - 2 * pad), pad + p[1] * (h - 2.6 * pad)];
    g.clearRect(0, 0, w, h);
    // Río Mapocho
    g.strokeStyle = "rgba(70,140,200,.35)"; g.lineWidth = w * 0.012; g.lineCap = "round";
    g.beginPath(); [[0.05, 0.36], [0.3, 0.4], [0.5, 0.38], [0.7, 0.3], [0.95, 0.22]].forEach((p, i) => { const [x, y] = S(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    for (const L of lines) {
      const prog = ease(clamp01((t - L.start) / 1.1));
      if (prog <= 0) continue;
      g.strokeStyle = L.line.color; g.lineWidth = w * 0.014; g.lineJoin = "round";
      g.beginPath();
      const steps = 60;
      for (let k = 0; k <= steps * prog; k++) { const [x, y] = S(at(L, k / steps)); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      // Estaciones
      const n = L.line.stations.length;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        if (u > prog) break;
        const [x, y] = S(at(L, u));
        const combo = L.line.stations[k].combos.length > 0;
        g.fillStyle = "#fff"; g.strokeStyle = combo ? "#111" : L.line.color; g.lineWidth = w * 0.004;
        g.beginPath(); g.arc(x, y, w * (combo ? 0.009 : 0.0055), 0, Math.PI * 2); g.fill(); g.stroke();
      }
      if (prog >= 1) {
        legend[L.line.id]?.classList.add("on");
        for (const tr of L.trains) {                       // trenes que recorren la línea
          tr.p += tr.dir * dt * 0.06;
          if (tr.p > 1) { tr.p = 1; tr.dir = -1; } if (tr.p < 0) { tr.p = 0; tr.dir = 1; }
          const [x, y] = S(at(L, tr.p));
          const gl = g.createRadialGradient(x, y, 0, x, y, w * 0.03);
          gl.addColorStop(0, "rgba(255,255,255,.95)"); gl.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = gl; g.beginPath(); g.arc(x, y, w * 0.03, 0, Math.PI * 2); g.fill();
        }
      }
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return { start() { started = true; }, stop() { cancelAnimationFrame(raf); } };
}

/* ==========================================================================
   Sonido de bienvenida
   ========================================================================== */

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

/* ==========================================================================
   Portada
   ========================================================================== */

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

  const stations = new Set(LINES.flatMap(l => l.stations.map(s => s.name))).size;
  const landmarks = Object.keys(LANDMARKS).length;
  // Artículos de la Tienda Metro: licencias, libreas de pago, contratos, el depto, sus muebles y un recuerdo por estación de cada línea
  const shopItems = LICENSES.length + LIVERIES.filter(l => l.price > 0).length + CONTRACTS.length + 1 + FURNITURE.length
    + LINES.reduce((n, l) => n + l.stations.length, 0);
  const title = "MetroSim".split("").map((ch, i) => `<span style="animation-delay:${0.25 + i * 0.07}s">${ch}</span>`).join("");
  const C = LINE_COLORS;
  const cards = [
    [C["1"], "🚇 Conduce desde la cabina", "DMI, mandos y señales reales. Cada estación bien servida te paga al instante."],
    [C["2"], "🚶 Viaja a pie", "Combina entre líneas por los pasillos, usa los ascensores y sal caminando a la calle."],
    [C["4A"], "🏙️ Sal a la ciudad", `${landmarks} hitos: La Moneda, Costanera Center, la Catedral, el Estadio Nacional…`],
    [C["5"], "🎯 Libreta de misiones", "Compras, fotos, encargos y contrarreloj. Completar una línea se celebra."],
    [C["3"], "🛍️ Tienda Metro", "Licencias, libreas para tu tren, contratos con más sueldo, tu depto y recuerdos."],
    [C["6"], "🖥️ Centro de Control", `Supervisa las ${LINES.length} líneas en tiempo real: retén trenes y regula intervalos.`],
  ];

  const root = document.createElement("section");
  root.className = "intro";
  root.innerHTML = `
    <canvas></canvas>
    <button class="intro-skip">Saltar ›</button>
    <div class="intro-ui">
      <div class="intro-left">
        <div class="intro-brand"><img class="intro-logo" src="logo.svg" alt="MetroSim"><div><span class="intro-eyebrow">SIMULADOR · METRO DE SANTIAGO</span><span class="intro-version">VERSIÓN ${VERSION} · ESTABLE</span></div></div>
        <h1 class="intro-title">${title}</h1>
        <p class="intro-sub"><span class="typed"></span><span class="caret"></span></p>
        <div class="intro-stats">
          <div><b data-count="${LINES.length}">0</b><small>LÍNEAS</small></div>
          <div><b data-count="${stations}">0</b><small>ESTACIONES</small></div>
          <div><b data-count="${landmarks}">0</b><small>HITOS DE LA CIUDAD</small></div>
          <div><b data-count="${shopItems}">0</b><small>ARTÍCULOS EN TIENDA</small></div>
        </div>
        <div class="intro-cards">${cards.map(([c, b, txt], i) => `<div style="--c:${c};animation-delay:${1.6 + i * 0.12}s"><b>${b}</b>${txt}</div>`).join("")}</div>
        <div class="intro-actions"><button class="intro-start">Comenzar ›</button><span class="intro-hint">Pulsa cualquier tecla · Esc para saltar</span></div>
      </div>
      <div class="intro-mapbox">
        <canvas></canvas>
        <span class="intro-maplabel">RED DE METRO · EN VIVO</span>
        <div class="intro-legend">${LINES.map(l => `<span style="--c:${l.color}" data-id="${l.id}">L${l.id}</span>`).join("")}</div>
      </div>
    </div>`;
  document.body.append(root);
  menu?.classList.add("hidden");

  const scene = startScene(root.querySelector(":scope > canvas"), root);
  const legend = Object.fromEntries([...root.querySelectorAll(".intro-legend span")].map(s => [s.dataset.id, s]));
  const map = startMap(root.querySelector(".intro-mapbox canvas"), legend);

  // Cuando aparece la ciudad: texto que se escribe solo, contadores y plano
  const typed = root.querySelector(".typed");
  const text = "Conduce desde la cabina, viaja a pie y recorre Santiago. Un Metro vivo que funciona aunque no lo mires: gana tu sueldo, cumple misiones y gástalo en la Tienda Metro.";
  let typer = 0, counters = 0;
  const onCity = () => {
    map.start();
    let i = 0;
    typer = setInterval(() => { typed.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typer); }, 22);
    const els = [...root.querySelectorAll("[data-count]")];
    const t0 = performance.now();
    counters = setInterval(() => {
      const p = ease(clamp01((performance.now() - t0) / 1600));
      els.forEach(el => { el.textContent = String(Math.round(Number(el.dataset.count) * p)); });
      if (p >= 1) clearInterval(counters);
    }, 30);
  };
  const watch = new MutationObserver(() => { if (root.classList.contains("city")) { watch.disconnect(); onCity(); } });
  watch.observe(root, { attributes: true, attributeFilter: ["class"] });

  let done = false;
  const finish = (withSound) => {
    if (done) return;
    done = true;
    window.removeEventListener("keydown", onKey);
    clearInterval(typer); clearInterval(counters); watch.disconnect();
    if (withSound) welcomeSound(isMuted());
    root.classList.add("leaving");
    menu?.classList.remove("hidden");
    setTimeout(() => { scene.stop(); map.stop(); root.remove(); style.remove(); }, 950);
  };
  // Durante el túnel, cualquier tecla adelanta a la ciudad; después, entra al menú
  const onKey = (e) => {
    if (e.key === "Escape") return finish(false);
    if (!root.classList.contains("city")) return scene.skip();
    finish(true);
  };
  window.addEventListener("keydown", onKey);
  root.querySelector(".intro-start").addEventListener("click", () => finish(true));
  root.querySelector(".intro-skip").addEventListener("click", () => finish(false));
  root.querySelector(":scope > canvas").addEventListener("click", () => { if (!root.classList.contains("city")) scene.skip(); });
}
