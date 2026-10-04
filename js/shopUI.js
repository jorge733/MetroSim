/* ==========================================================================
   MetroSim — shopUI.js
   Panel de la TIENDA METRO (DOM): pestañas Conductor · Mi depto · Colección.
   El catálogo y lo comprado están en shop.js; aquí solo se muestra y se
   compra. Se abre desde la pantalla de inicio o con la tecla K en el juego.
   ========================================================================== */

import { formatCLP } from "./config.js";
import { LINES } from "./engine/network.js";
import { LICENSES, LIVERIES, CONTRACTS, HOME, FURNITURE, SOUVENIR_PRICE, ALBUM_REWARD, souvenirId } from "./shop.js";

const hex = (n) => "#" + n.toString(16).padStart(6, "0");
const lineTitle = (l) => l.name.charAt(0) + l.name.slice(1).toLowerCase();

/**
 * Abre la tienda.
 * @param {object} o
 * @param {import("./shop.js").Inventory} o.inventory
 * @param {import("./economy.js").BankAccount} o.bank
 * @param {string} [o.tab]       "driver" | "home" | "album"
 * @param {string} [o.notice]    aviso inicial (p. ej. "necesitas la licencia")
 * @param {(item) => void} [o.onBought]  tras una compra (sonido, HUD…)
 * @param {() => void} [o.onClose]
 * @returns {() => void} cerrar
 */
export function openShopUI(o) {
  const inv = o.inventory, bank = o.bank;
  let tab = o.tab || "driver";
  const root = document.createElement("div");
  root.className = "shop-overlay";
  root.innerHTML = `
    <div class="shop-card" role="dialog" aria-label="Tienda Metro">
      <header class="shop-head">
        <div><p class="shop-kicker">Gasta lo que ganas como conductor</p><h2>🛒 Tienda Metro</h2></div>
        <div class="shop-balance"><span>Tu cuenta</span><b></b></div>
        <button class="shop-close" aria-label="Cerrar">✕</button>
      </header>
      <nav class="shop-tabs">
        <button data-tab="driver">🚇 Conductor</button>
        <button data-tab="home">🏠 Mi depto</button>
        <button data-tab="album">🎟️ Colección</button>
      </nav>
      <p class="shop-notice hidden"></p>
      <div class="shop-body"></div>
    </div>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const body = $(".shop-body");

  const notice = (text, level = "info") => {
    const n = $(".shop-notice");
    n.textContent = text;
    n.className = `shop-notice ${level}`;
  };
  if (o.notice) notice(o.notice, "warn");

  const buy = (item) => {
    const r = inv.buy(item, bank);
    notice(r.text, r.ok ? "ok" : "warn");
    if (r.ok) o.onBought?.(item);
    render();
  };

  /** Tarjeta de un artículo con su botón. */
  const card = (item, { owned, extra = null, action = null, actionLabel = null, disabled = false, preview = null }) => {
    const el = document.createElement("div");
    el.className = "shop-item" + (owned ? " owned" : "");
    el.innerHTML = `<div class="shop-item-icon"></div><div class="shop-item-text"><b></b><p></p></div><div class="shop-item-buy"></div>`;
    const icon = el.querySelector(".shop-item-icon");
    if (preview) icon.append(preview); else icon.textContent = item.icon;
    el.querySelector("b").textContent = item.name;
    el.querySelector("p").textContent = item.desc;
    const side = el.querySelector(".shop-item-buy");
    if (extra) side.append(extra);
    const btn = document.createElement("button");
    if (action) {
      btn.textContent = actionLabel;
      btn.className = "ghost-button";
      btn.onclick = action;
    } else if (owned) {
      btn.textContent = "✓ Tuyo";
      btn.className = "ghost-button";
      btn.disabled = true;
    } else {
      btn.textContent = item.price ? formatCLP(item.price) : "Gratis";
      btn.className = "go-button" + (bank.canPay(item.price) ? "" : " poor");
      btn.disabled = disabled;
      btn.onclick = () => buy(item);
    }
    side.append(btn);
    return el;
  };

  const section = (title, sub) => {
    const h = document.createElement("div");
    h.className = "shop-section";
    h.innerHTML = "<h3></h3><p></p>";
    h.querySelector("h3").textContent = title;
    h.querySelector("p").textContent = sub;
    return h;
  };

  /* ----- Pestaña Conductor ----- */
  const renderDriver = () => {
    const out = [];
    out.push(section("Contratos", `Suben tu sueldo de conductor para siempre. Ahora ganas ×${inv.wageMultiplier.toFixed(2).replace(".", ",")}.`));
    for (const c of CONTRACTS) {
      out.push(card(c, { owned: inv.has(c.id), disabled: !!c.requires && !inv.has(c.requires) }));
    }
    out.push(section("Libreas de tu tren", "Elige los colores de tu tren en el modo Conductor."));
    for (const l of LIVERIES) {
      const owned = inv.has(l.id), using = inv.livery === l.id;
      out.push(card(l, {
        owned, preview: trainPreview(l),
        action: owned ? (using ? () => {} : () => { inv.equip(l.id); notice(`Librea ${l.name} lista para tu próximo servicio.`, "ok"); render(); }) : null,
        actionLabel: using ? "✓ En uso" : "Usar",
      }));
    }
    out.push(section("Licencias de línea", "Para conducir en otras líneas. La Línea 3 viene incluida."));
    for (const lic of LICENSES) {
      const badge = document.createElement("span");
      badge.className = "line-dot";
      badge.style.background = lic.color;
      badge.textContent = lic.lineId;
      out.push(card(lic, { owned: inv.has(lic.id), preview: badge }));
    }
    return out;
  };

  /* ----- Pestaña Mi depto ----- */
  const renderHome = () => {
    const out = [];
    if (!inv.has(HOME.id)) {
      out.push(section("Tu propio departamento", "La meta grande: un depto propio para amoblar con lo que ganas."));
      out.push(drawRoom(inv, true));
      out.push(card(HOME, { owned: false }));
      return out;
    }
    const { have, total } = inv.furnished;
    out.push(section(HOME.name, have === total ? "🏆 ¡Depto completamente amoblado!" : `Amoblado: ${have} de ${total} muebles.`));
    out.push(drawRoom(inv, false));
    for (const f of FURNITURE) out.push(card(f, { owned: inv.has(f.id) }));
    return out;
  };

  /* ----- Pestaña Colección ----- */
  const renderAlbum = () => {
    const out = [section("Álbum de recuerdos", `Un recuerdo por estación (${formatCLP(SOUVENIR_PRICE)}), a la venta solo en el kiosko de su calle (modo Pasajero). Completa una línea y ganas ${formatCLP(ALBUM_REWARD)}.`)];
    for (const line of LINES) {
      const { have, total } = inv.album(line);
      const row = document.createElement("div");
      row.className = "album-line";
      row.innerHTML = `<div class="album-head"><span class="line-dot"></span><b></b><span class="album-count"></span></div><div class="album-bar"><i></i></div><ul></ul>`;
      const dot = row.querySelector(".line-dot");
      dot.style.background = line.color; dot.textContent = line.id;
      row.querySelector("b").textContent = lineTitle(line);
      row.querySelector(".album-count").textContent = have === total ? "🏆 completo" : `${have}/${total}`;
      const bar = row.querySelector(".album-bar i");
      bar.style.width = `${(have / total) * 100}%`;
      bar.style.background = line.color;
      row.querySelector("ul").replaceChildren(...line.stations.map(st => {
        const li = document.createElement("li");
        li.textContent = st.short;
        li.title = st.name;
        if (inv.has(souvenirId(line.id, st.name))) { li.className = "got"; li.style.borderColor = line.color; }
        return li;
      }));
      out.push(row);
    }
    return out;
  };

  const render = () => {
    $(".shop-balance b").textContent = bank.label;
    root.querySelectorAll(".shop-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    body.replaceChildren(...(tab === "home" ? renderHome() : tab === "album" ? renderAlbum() : renderDriver()));
  };
  root.querySelectorAll(".shop-tabs button").forEach(b => b.onclick = () => { tab = b.dataset.tab; $(".shop-notice").className = "shop-notice hidden"; render(); body.scrollTop = 0; });
  render();

  const close = () => {
    window.removeEventListener("keydown", onKey, true);
    root.remove();
    o.onClose?.();
  };
  const onKey = (ev) => {
    const k = ev.key.toLowerCase();
    if (k === "escape" || k === "k") { ev.preventDefault(); close(); }
    ev.stopPropagation();                         // el juego no recibe teclas con la tienda abierta
  };
  window.addEventListener("keydown", onKey, true);
  $(".shop-close").onclick = close;
  root.addEventListener("click", (ev) => { if (ev.target === root) close(); });
  return close;
}

/** Vista lateral de un coche con la librea (para la tarjeta). */
function trainPreview(l) {
  const c = document.createElement("canvas");
  c.width = 120; c.height = 48;
  const g = c.getContext("2d");
  const body = l.body != null ? hex(l.body) : "#c9d0d6", stripe = l.stripe != null ? hex(l.stripe) : "#8b5a2b";
  g.fillStyle = body; g.beginPath(); g.roundRect(4, 8, 112, 30, 7); g.fill();
  g.fillStyle = "#1c2733"; for (let x = 14; x < 104; x += 22) g.fillRect(x, 13, 14, 10);       // ventanas
  g.fillStyle = stripe; g.fillRect(4, 26, 112, 5);
  g.fillStyle = "#2a2e33"; [22, 98].forEach(x => { g.beginPath(); g.arc(x, 40, 5, 0, 7); g.fill(); });
  c.className = "train-preview";
  return c;
}

/** Ilustración del living del depto: lo comprado a color, lo que falta como silueta. */
function drawRoom(inv, locked) {
  const W = 640, H = 300, c = document.createElement("canvas");
  c.width = W; c.height = H; c.className = "home-room";
  const g = c.getContext("2d");
  // Muro, zócalo y piso de parquet
  const wall = g.createLinearGradient(0, 0, 0, H * 0.62);
  wall.addColorStop(0, "#f1e6d2"); wall.addColorStop(1, "#e3d3b8");
  g.fillStyle = wall; g.fillRect(0, 0, W, H * 0.62);
  g.fillStyle = "#b78a58"; g.fillRect(0, H * 0.62, W, H * 0.38);
  g.strokeStyle = "#a07546"; g.lineWidth = 2;
  for (let x = -H; x < W; x += 34) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.38, H * 0.62); g.stroke(); }
  g.fillStyle = "#fff"; g.fillRect(0, H * 0.6, W, 7);
  // Ventana con la ciudad y la cordillera
  const wx = W * 0.62, wy = 26, ww = 150, wh = 110;
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, "#8fc3ee"); sky.addColorStop(1, "#d8ecf7");
  g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
  g.fillStyle = "#9aa6b8"; g.beginPath(); g.moveTo(wx, wy + 70); g.lineTo(wx + 40, wy + 40); g.lineTo(wx + 75, wy + 62); g.lineTo(wx + 110, wy + 30); g.lineTo(wx + ww, wy + 58); g.lineTo(wx + ww, wy + wh); g.lineTo(wx, wy + wh); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.moveTo(wx + 100, wy + 38); g.lineTo(wx + 110, wy + 30); g.lineTo(wx + 122, wy + 40); g.fill();
  g.fillStyle = "#5d6878"; [[8, 60], [30, 45], [58, 70], [92, 52], [122, 66]].forEach(([x, h]) => g.fillRect(wx + x, wy + wh - h * 0.6, 20, h * 0.6));
  g.strokeStyle = "#fff"; g.lineWidth = 6; g.strokeRect(wx, wy, ww, wh);
  g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke();
  // Muebles (emoji): lo que tienes, a color; lo que falta, como silueta tenue
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const f of [...FURNITURE].sort((a, b) => (b.floor ? 1 : 0) - (a.floor ? 1 : 0))) {
    const own = !locked && inv.has(f.id);
    const size = 66 * f.size;
    g.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.globalAlpha = own ? 1 : 0.12;
    if (f.floor && own) { g.fillStyle = "#8c2f39"; g.beginPath(); g.ellipse(f.x * W, f.y * H, 150, 26, 0, 0, 7); g.fill(); }
    else if (!f.floor) g.fillText(f.icon, f.x * W, f.y * H);
    g.globalAlpha = 1;
  }
  if (locked) {
    g.fillStyle = "#0009"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.font = "800 26px Arial"; g.fillText("🔒 Aún no tienes departamento", W / 2, H / 2);
  }
  return c;
}
