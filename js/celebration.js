/* ==========================================================================
   MetroSim — celebration.js
   Celebración al completar la LIBRETA DE MISIONES de una línea (una misión
   de cada tipo, ver missions.js): pantalla de triunfo con medalla de la
   línea, lluvia de confeti de colores, fanfarria, anuncio por megafonía y
   un gran premio en la cuenta. Si con eso quedan completas TODAS las líneas,
   la celebración es doble: "Gran Maestro del Metro de Santiago".

   Solo DOM y un canvas 2D (sin Three.js); se dibuja encima del juego.
   ========================================================================== */

import { LINE_COLORS, formatCLP } from "./config.js";
import { MISSION_TYPES } from "./missions.js";

/**
 * Muestra la celebración.
 * @param {object} o
 * @param {object} o.line        línea completada ({ id, name, color })
 * @param {number} o.completed   misiones cumplidas en la línea
 * @param {number} o.reward      premio depositado
 * @param {boolean} o.grand      además quedaron completas todas las líneas
 * @param {number} o.grandReward premio extra por todas las líneas
 * @param {Array} o.lines        todas las líneas (para las medallas)
 * @param {(id:string)=>boolean} o.isMastered
 * @param {() => void} o.onClose
 */
export function celebrate(o) {
  const color = o.line.color || LINE_COLORS[o.line.id] || "#ffd23f";
  const root = document.createElement("div");
  root.className = "celebration";
  root.style.setProperty("--medal", color);
  root.innerHTML = `
    <canvas class="confetti"></canvas>
    <div class="celebration-card">
      <div class="celebration-rays"></div>
      <div class="medal"><span class="medal-ribbon"></span><span class="medal-disc"><b></b></span></div>
      <p class="celebration-kicker">Libreta de misiones completa</p>
      <h2 class="celebration-title"></h2>
      <p class="celebration-sub"></p>
      <ul class="celebration-types"></ul>
      <div class="celebration-stats">
        <div><span>Misiones cumplidas</span><b class="c-done"></b></div>
        <div><span>Premio</span><b class="c-reward">$0</b></div>
      </div>
      <div class="celebration-grand hidden">
        <p>🏆 GRAN MAESTRO DEL METRO DE SANTIAGO 🏆</p>
        <span>Completaste las misiones de todas las líneas · premio extra <b class="c-grand"></b></span>
      </div>
      <ul class="celebration-lines"></ul>
      <button class="go-button">¡Seguir viajando! ›</button>
    </div>`;
  document.body.append(root);

  const $ = (s) => root.querySelector(s);
  $(".medal-disc b").textContent = o.line.id;
  $(".celebration-title").textContent = `¡LÍNEA ${o.line.id} COMPLETADA!`;
  $(".celebration-sub").textContent = `Ahora eres Pasajero Ilustre de la ${titleCase(o.line.name)}`;
  $(".c-done").textContent = String(o.completed);
  $(".celebration-types").replaceChildren(...MISSION_TYPES.map((t, i) => {
    const li = document.createElement("li");
    li.textContent = `${t.icon} ${t.label}`;
    li.style.animationDelay = `${0.9 + i * 0.12}s`;
    return li;
  }));
  // Medallas de todas las líneas (la recién ganada brilla)
  $(".celebration-lines").replaceChildren(...o.lines.map(l => {
    const li = document.createElement("li");
    li.textContent = l.id;
    li.style.setProperty("--c", l.color || LINE_COLORS[l.id] || "#888");
    if (o.isMastered(l.id)) li.className = l.id === o.line.id ? "won new" : "won";
    li.title = l.name;
    return li;
  }));
  if (o.grand) {
    $(".celebration-grand").classList.remove("hidden");
    $(".c-grand").textContent = formatCLP(o.grandReward);
  }

  // El premio "cuenta" hacia arriba
  const total = o.reward + (o.grand ? o.grandReward : 0);
  const t0 = performance.now() + 900;
  const counter = () => {
    const k = Math.min(1, Math.max(0, (performance.now() - t0) / 1600));
    $(".c-reward").textContent = formatCLP(Math.round(total * (1 - (1 - k) ** 3) / 10) * 10);
    if (k < 1 && root.isConnected) requestAnimationFrame(counter);
  };
  requestAnimationFrame(counter);

  const stopConfetti = confetti($(".confetti"), [color, "#ffd23f", "#ffffff", "#4fd6ff", "#ff5d8f", "#6fe39a"], o.grand ? 9 : 6);

  const close = () => {
    stopConfetti();
    root.classList.add("leaving");
    setTimeout(() => root.remove(), 350);
    window.removeEventListener("keydown", onKey, true);
    o.onClose?.();
  };
  const onKey = (ev) => {
    if (ev.key === "Enter" || ev.key === "Escape" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); close(); }
    else ev.stopPropagation();                      // el juego no recibe teclas mientras se celebra
  };
  $(".go-button").onclick = close;
  // Se puede cerrar recién cuando terminó de entrar (evita cerrarla sin querer al caminar)
  setTimeout(() => window.addEventListener("keydown", onKey, true), 1200);
  return close;
}

const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Lluvia de confeti: dos cañonazos desde las esquinas inferiores y luego
 * confeti que cae desde arriba, girando y meciéndose.
 * @returns {() => void} detener
 */
function confetti(canvas, colors, seconds) {
  const g = canvas.getContext("2d");
  let W = 0, H = 0;
  const resize = () => { W = canvas.width = innerWidth; H = canvas.height = innerHeight; };
  resize();
  window.addEventListener("resize", resize);
  const parts = [];
  const spawn = (x, y, vx, vy) => parts.push({
    x, y, vx, vy, w: 6 + Math.random() * 7, h: 3 + Math.random() * 5,
    rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12, sway: Math.random() * 6.28,
    color: colors[Math.floor(Math.random() * colors.length)], round: Math.random() < 0.25,
  });
  const cannon = (fromLeft) => {
    for (let i = 0; i < 140; i++) {
      const a = (fromLeft ? -1.05 : -2.09) + (Math.random() - 0.5) * 0.6, s = 700 + Math.random() * 650;
      spawn(fromLeft ? 0 : W, H, Math.cos(a) * s, Math.sin(a) * s);
    }
  };
  cannon(true); cannon(false);
  setTimeout(() => { cannon(true); cannon(false); }, 900);

  let last = performance.now(), run = true, rain = seconds;
  const frame = (now) => {
    if (!run) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    rain -= dt;
    if (rain > 0) for (let i = 0; i < 4; i++) spawn(Math.random() * W, -20, (Math.random() - 0.5) * 60, 60 + Math.random() * 90);
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 520 * dt; p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.4 * dt;          // gravedad y roce del aire
      p.sway += dt * 3;
      p.x += (p.vx + Math.sin(p.sway) * 40) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = p.color;
      if (p.round) { g.beginPath(); g.arc(0, 0, p.h * 0.7, 0, 6.28); g.fill(); }
      else { g.scale(1, Math.abs(Math.cos(p.rot * 0.7)) + 0.15); g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      g.restore();
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].y > H + 40) parts.splice(i, 1);
    if (rain > 0 || parts.length) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => { run = false; window.removeEventListener("resize", resize); };
}
