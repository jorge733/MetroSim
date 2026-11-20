/* ==========================================================================
   MetroSim — shopUI.js
   Panel de la TIENDA REDMOVI (DOM): pestañas Conductor · Mi depto · Colección.
   Mi depto (2.24) se recorre pieza por pieza, de día o de noche.
   El catálogo y lo comprado están en shop.js; aquí solo se muestra y se
   compra. Se abre desde la pantalla de inicio o con la tecla K en el juego
   (1·2·3 cambian de pestaña).
   ========================================================================== */

import { formatCLP, lineLabel } from "./config.js";
import { icon } from "./icons.js";
import { SANTIAGO_LINES as LINES } from "./engine/network.js";   // 2.18 · el álbum es de Santiago (sin la bonus de Valparaíso)
import { WAGE, shiftBonus } from "./economy.js";
import { LICENSES, LIVERIES, CONTRACTS, HOME, HOME_LEVELS, PAINTS, ROOMS, ROOM_REWARD, FURNITURE, SOUVENIR_PRICE, ALBUM_REWARD, souvenirId } from "./shop.js";

const hex = (n) => "#" + n.toString(16).padStart(6, "0");
const lineTitle = (l) => lineLabel(l.id);

/** Compras desde este precio piden confirmación (un segundo toque) para no gastar por error. */
const CONFIRM_FROM = 20000;
/** Preferencia del jugador: ocultar lo que ya compró (solo comodidad de este dispositivo). */
const HIDE_KEY = "metrosim.shopHideOwned";
const loadHide = () => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };
const saveHide = (v) => { try { localStorage.setItem(HIDE_KEY, v ? "1" : "0"); } catch { /* sin almacenamiento */ } };

/** Sueldo aproximado de una estación bien servida (para estimar cuánto falta conduciendo). */
const stationEstimate = (mult) => (WAGE.base + WAGE.perfect / 2 + 40 * WAGE.perPoint) * mult;

/** Lo que se vende en cada pestaña (los recuerdos se compran en la calle, no aquí). */
const tabItems = (tab, inv) =>
  tab === "driver" ? [...CONTRACTS, ...LIVERIES.filter(l => l.price > 0), ...LICENSES]
  : tab === "home" ? [...HOME_LEVELS, ...(inv.has(HOME.id) ? [...FURNITURE, ...PAINTS.filter(p => p.price > 0)] : [])]
  : [];

/** Todo lo que se vende en Mi depto (para el contador de la pestaña). */
const HOME_SHOP = [...HOME_LEVELS, ...FURNITURE, ...PAINTS.filter(p => p.price > 0)];

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
    <div class="shop-card" role="dialog" aria-label="Tienda RedMovi">
      <header class="shop-head">
        <div><p class="shop-kicker">Gasta lo que ganas como conductor</p><h2>${icon("bag")} Tienda RedMovi</h2></div>
        <div class="shop-balance"><span>Tu cuenta</span><b></b></div>
        <button class="shop-close" aria-label="Cerrar">${icon("close")}</button>
      </header>
      <nav class="shop-tabs">
        <button data-tab="driver">${icon("train")} Conductor <small></small></button>
        <button data-tab="home">${icon("home")} Mi depto <small></small></button>
        <button data-tab="album">${icon("ticket")} Colección <small></small></button>
      </nav>
      <div class="shop-progress"><span></span><div class="album-bar"><i></i></div><label><input type="checkbox"> Ocultar lo que ya tengo</label></div>
      <p class="shop-notice hidden"></p>
      <div class="shop-body"></div>
    </div>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const body = $(".shop-body");
  let hideOwned = loadHide(), justBought = null, confirming = null, confirmTimer = 0;
  let room = "living", night = null;               // pieza que se mira en Mi depto · null = día o noche según la hora real
  const hideBox = $(".shop-progress input");
  hideBox.checked = hideOwned;
  hideBox.onchange = () => { hideOwned = hideBox.checked; saveHide(hideOwned); render(); };

  const notice = (text, level = "info") => {
    const n = $(".shop-notice");
    n.textContent = text;
    n.className = `shop-notice ${level}`;
  };
  if (o.notice) notice(o.notice, "warn");

  const buy = (item) => {
    // Lo caro pide un segundo toque: el primero deja el botón en «¿Confirmar?» por unos segundos
    if (item.price >= CONFIRM_FROM && bank.canPay(item.price) && confirming !== item.id) {
      confirming = item.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirming = null; render(); }, 4000);
      notice(`Toca de nuevo para comprar ${item.name} por ${formatCLP(item.price)}. Te quedarían ${formatCLP(Math.max(0, bank.balance - item.price))}.`, "info");
      render();
      return;
    }
    confirming = null;
    clearTimeout(confirmTimer);
    const r = inv.buy(item, bank);
    notice(r.text + (r.ok ? afterBuyTip(item) : ""), r.ok ? "ok" : "warn");
    if (r.ok) {
      justBought = item.id;
      o.onBought?.({ ...item, reward: r.reward || 0 });
      const bal = $(".shop-balance b");
      bal.classList.remove("flash"); void bal.offsetWidth; bal.classList.add("flash");
    }
    render();
    justBought = null;
  };

  /** Consejo tras comprar: qué se puede hacer ahora con lo comprado. */
  const afterBuyTip = (item) =>
    item.kind === "license" ? ` Ya puedes elegir ${lineLabel(item.lineId)} al conducir.`
    : item.kind === "livery" ? " Tu tren la estrena en el próximo servicio."
    : item.kind === "contract" ? ` Desde ahora ganas ×${item.mult.toFixed(2).replace(".", ",")}.`
    : item.kind === "home" ? " Ahora puedes amoblarlo pieza por pieza: living, dormitorio y cocina."
    : item.kind === "homeUpgrade" ? " ¡Mira la nueva vista por la ventana!"
    : item.kind === "paint" ? " Los muros ya están pintados."
    : "";

  /** Tarjeta de un artículo con su botón. */
  const card = (item, { owned, extra = null, action = null, actionLabel = null, disabled = false, preview = null }) => {
    const el = document.createElement("div");
    el.className = "shop-item" + (owned ? " owned" : "") + (justBought === item.id ? " just-bought" : "");
    el.innerHTML = `<div class="shop-item-icon"></div><div class="shop-item-text"><b></b><p></p></div><div class="shop-item-buy"></div>`;
    const icon = el.querySelector(".shop-item-icon");
    if (preview) icon.append(preview); else icon.textContent = item.icon;
    el.querySelector("b").textContent = item.name;
    el.querySelector("p").textContent = item.desc;
    if (item.note) {
      const n = document.createElement("p");
      n.className = "shop-item-note";
      n.textContent = item.note;
      el.querySelector(".shop-item-text").append(n);
    }
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
      const poor = !bank.canPay(item.price);
      btn.className = "go-button" + (poor ? " poor" : "");
      btn.innerHTML = "<span></span>";
      btn.firstChild.textContent = item.price ? formatCLP(item.price) : "Gratis";
      // Sin dinero suficiente: el botón se ve apagado y dice cuánto falta (antes parecía comprable)
      if (poor) {
        const short = document.createElement("small");
        short.textContent = `faltan ${formatCLP(item.price - bank.balance)}`;
        btn.append(short);
        btn.title = "Gana dinero conduciendo para comprarlo";
        // Cuánto llevas juntado para este artículo
        const bar = document.createElement("div");
        bar.className = "shop-save-bar";
        bar.innerHTML = "<i></i>";
        bar.firstChild.style.width = `${Math.min(100, (bank.balance / item.price) * 100)}%`;
        el.querySelector(".shop-item-text").append(bar);
      } else if (confirming === item.id) {
        btn.classList.add("confirm");
        btn.firstChild.textContent = "¿Confirmar?";
        const sm = document.createElement("small");
        sm.textContent = formatCLP(item.price);
        btn.append(sm);
      }
      btn.disabled = disabled;
      btn.onclick = () => buy(item);
    }
    side.append(btn);
    return el;
  };

  /** «Tu próxima meta»: lo más barato que aún no tienes en esta pestaña y cuánto te falta. */
  const goal = (items) => {
    const open = items.filter(i => !inv.has(i.id) && !(i.requires && !inv.has(i.requires)) && !((i.kind === "furniture" || i.kind === "paint") && !inv.has(HOME.id)))
      .sort((a, b) => a.price - b.price);
    if (!open.length) return null;
    const ready = open.filter(i => bank.canPay(i.price)), next = open.find(i => !bank.canPay(i.price));
    const el = document.createElement("div");
    el.className = "shop-goal";
    if (ready.length) {
      const best = ready.at(-1);                         // lo mejor que ya te alcanza
      el.classList.add("ready");
      el.innerHTML = `${icon("coins")}<div><b></b><p></p></div>`;
      el.querySelector("b").textContent = ready.length === 1 ? `Ya te alcanza para ${best.name}` : `Ya te alcanza para ${ready.length} cosas`;
      el.querySelector("p").textContent = ready.length === 1 ? `Cuesta ${formatCLP(best.price)}.` : `La más cara: ${best.name} (${formatCLP(best.price)}).`;
      return el;
    }
    const missing = next.price - bank.balance, stations = Math.max(1, Math.ceil(missing / stationEstimate(inv.wageMultiplier)));
    el.innerHTML = `${icon("target")}<div><b></b><p></p><div class="shop-save-bar"><i></i></div></div>`;
    el.querySelector("b").textContent = `Tu próxima meta: ${next.name}`;
    el.querySelector("p").textContent = `Te faltan ${formatCLP(missing)} · unas ${stations} ${stations === 1 ? "estación" : "estaciones"} bien servidas en el modo Conductor.`;
    el.querySelector("i").style.width = `${Math.min(100, (bank.balance / next.price) * 100)}%`;
    return el;
  };

  /** Agrega la tarjeta salvo que el jugador oculte lo que ya tiene. */
  const push = (out, item, opts) => { if (!(hideOwned && opts.owned)) out.push(card(item, opts)); };

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
    const out = [goal(tabItems("driver", inv))].filter(Boolean);
    out.push(section("Contratos", `Suben tu sueldo de conductor para siempre. Ahora ganas ×${inv.wageMultiplier.toFixed(2).replace(".", ",")}.`));
    for (const c of CONTRACTS) {
      const note = `Estación perfecta ${formatCLP(WAGE.base + WAGE.perfect)} → ${formatCLP(Math.round((WAGE.base + WAGE.perfect) * c.mult / 10) * 10)} · bono S ${formatCLP(shiftBonus("S"))} → ${formatCLP(shiftBonus("S", c.mult))}`;
      push(out, { ...c, note }, { owned: inv.has(c.id), disabled: !!c.requires && !inv.has(c.requires) });
    }
    out.push(section("Libreas de tu tren", "Elige los colores de tu tren en el modo Conductor."));
    for (const l of LIVERIES) {
      const owned = inv.has(l.id), using = inv.livery === l.id;
      if (hideOwned && owned && !using) continue;
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
      push(out, lic, { owned: inv.has(lic.id), preview: badge });
    }
    return out;
  };

  /* ----- Pestaña Mi depto ----- */
  const renderHome = () => {
    const out = [];
    if (!inv.has(HOME.id)) {
      out.push(section("Tu propio departamento", "La meta grande: un depto propio para amoblar con lo que ganas."));
      out.push(drawRoom(inv, "living", true, isNight()));
      out.push(card(HOME, { owned: false }));
      return out;
    }
    const home = inv.currentHome, { have, total } = inv.furnished;
    const left = FURNITURE.filter(f => !inv.has(f.id)).reduce((t, f) => t + f.price, 0);
    out.push(section(home.name, have === total ? "🏆 ¡Depto completamente amoblado!" : `Amoblado: ${have} de ${total} muebles · amoblarlo entero cuesta ${formatCLP(left)} más. Cada pieza completa paga un premio de ${formatCLP(ROOM_REWARD)}.`));
    out.push(roomTabs());
    out.push(drawRoom(inv, room, false, isNight()));
    const r = ROOMS.find(x => x.id === room), rf = inv.roomFurnished(room);
    const roomItems = FURNITURE.filter(f => f.room === room);
    const g = goal(roomItems);
    if (g) out.push(g);
    out.push(section(`Muebles · ${r.name}`, rf.have === rf.total ? `🏆 ${r.name} completo.`
      : `${rf.have} de ${rf.total} · al completar ${r.article} ${r.name.toLowerCase()} ganas ${formatCLP(ROOM_REWARD)}${inv.rooms.has(room) ? " (ya cobrado)" : ""}.`));
    for (const f of [...roomItems].sort((a, b) => inv.has(a.id) - inv.has(b.id) || a.price - b.price)) push(out, f, { owned: inv.has(f.id) });
    out.push(section("Pintura de los muros", "Cambia el color de todo el depto. Lo que compras queda para volver a usarlo."));
    for (const p of PAINTS) {
      const owned = inv.has(p.id), using = inv.paint === p.id;
      if (hideOwned && owned && !using) continue;
      out.push(card(p, {
        owned, preview: paintPreview(p),
        action: owned ? (using ? () => {} : () => { inv.paintWith(p.id); notice(`Muros pintados: ${p.name}.`, "ok"); render(); }) : null,
        actionLabel: using ? "✓ En uso" : "Pintar",
      }));
    }
    out.push(section("Mudanzas", "Cámbiate a un barrio con mejor vista: te llevas todos los muebles."));
    for (const h of HOME_LEVELS.slice(1)) push(out, h, { owned: inv.has(h.id), disabled: !inv.has(h.requires) });
    return out;
  };

  /** ¿Se dibuja de noche? Según la hora real, salvo que el jugador lo cambie. */
  const isNight = () => night ?? (() => { const h = new Date().getHours(); return h < 7 || h >= 20; })();

  /** Botones de las piezas y de día/noche sobre la ilustración. */
  const roomTabs = () => {
    const bar = document.createElement("div");
    bar.className = "home-rooms";
    for (const r of ROOMS) {
      const b = document.createElement("button"), n = inv.roomFurnished(r.id);
      b.className = "home-room-tab" + (r.id === room ? " active" : "") + (n.have === n.total ? " complete" : "");
      b.innerHTML = "<span></span><small></small>";
      b.firstChild.textContent = `${r.icon} ${r.name}`;
      b.lastChild.textContent = `${n.have}/${n.total}`;
      b.onclick = () => { room = r.id; render(); };
      bar.append(b);
    }
    const dn = document.createElement("button");
    dn.className = "home-room-tab daynight";
    dn.textContent = isNight() ? "🌙 Noche" : "☀️ Día";
    dn.title = "Ver el depto de día o de noche";
    dn.onclick = () => { night = !isNight(); render(); };
    bar.append(dn);
    return bar;
  };

  /* ----- Pestaña Colección ----- */
  const renderAlbum = () => {
    const done = LINES.filter(l => { const a = inv.album(l); return a.have === a.total; }).length;
    const out = [section("Álbum de recuerdos", `Un recuerdo por estación (${formatCLP(SOUVENIR_PRICE)}), a la venta solo en el kiosko de su calle (modo Pasajero). Completa una línea y ganas ${formatCLP(ALBUM_REWARD)}. Llevas ${done} de ${LINES.length} líneas completas.`)];
    for (const line of LINES) {
      const { have, total } = inv.album(line);
      if (hideOwned && have === total) continue;
      const row = document.createElement("div");
      row.className = "album-line";
      row.innerHTML = `<div class="album-head"><span class="line-dot"></span><b></b><span class="album-count"></span></div><div class="album-bar"><i></i></div><ul></ul>`;
      const dot = row.querySelector(".line-dot");
      dot.style.background = line.color; dot.textContent = line.id;
      row.querySelector("b").textContent = lineTitle(line);
      row.querySelector(".album-count").textContent = have === total ? "🏆 completo" : `${have}/${total} · faltan ${formatCLP((total - have) * SOUVENIR_PRICE)}`;
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

  /** Lo que tienes / lo que hay, por pestaña. */
  const counts = () => {
    const owned = (list) => list.filter(i => inv.has(i.id)).length;
    const shopDriver = [...CONTRACTS, ...LIVERIES.filter(l => l.price > 0), ...LICENSES];
    const shopHome = HOME_SHOP;
    const sv = LINES.reduce((a, l) => { const x = inv.album(l); return { have: a.have + x.have, total: a.total + x.total }; }, { have: 0, total: 0 });
    return {
      driver: { have: owned(shopDriver), total: shopDriver.length },
      home: { have: owned(shopHome), total: shopHome.length },
      album: sv,
    };
  };

  const render = () => {
    $(".shop-balance b").textContent = bank.label;
    const c = counts();
    root.querySelectorAll(".shop-tabs button").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
      const n = c[b.dataset.tab];
      b.querySelector("small").textContent = `${n.have}/${n.total}`;
      b.classList.toggle("complete", n.have === n.total);
    });
    // Promedio de las tres pestañas (si no, los 164 recuerdos pesarían casi todo)
    const pct = Math.round(Object.values(c).reduce((t, n) => t + n.have / n.total, 0) / 3 * 100);
    $(".shop-progress span").textContent = `Tienda completada: ${pct} %`;
    $(".shop-progress i").style.width = `${pct}%`;
    body.replaceChildren(...(tab === "home" ? renderHome() : tab === "album" ? renderAlbum() : renderDriver()));
  };
  root.querySelectorAll(".shop-tabs button").forEach(b => b.onclick = () => { tab = b.dataset.tab; $(".shop-notice").className = "shop-notice hidden"; render(); body.scrollTop = 0; });
  render();

  const close = () => {
    clearTimeout(confirmTimer);
    window.removeEventListener("keydown", onKey, true);
    root.remove();
    o.onClose?.();
  };
  const onKey = (ev) => {
    const k = ev.key.toLowerCase();
    if (k === "escape" || k === "k") { ev.preventDefault(); close(); }
    else if (["1", "2", "3"].includes(k) && !ev.target.closest?.("input, textarea")) {       // 1·2·3 cambian de pestaña
      ev.preventDefault();
      root.querySelectorAll(".shop-tabs button")[Number(k) - 1].click();
    }
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

/** Muestra de una pintura (para la tarjeta). */
function paintPreview(p) {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 48;
  paintWall(c.getContext("2d"), p, 0, 0, 96, 48);
  c.className = "train-preview";
  return c;
}

/** Pinta un muro con la pintura elegida (color liso, rayas o ladrillo). */
function paintWall(g, p, x, y, w, h) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, p.top); grad.addColorStop(1, p.bottom);
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  if (p.pattern === "rayas") {
    g.fillStyle = p.ink;
    for (let i = x; i < x + w; i += 22) g.fillRect(i, y, 7, h);
  } else if (p.pattern === "ladrillo") {
    g.strokeStyle = p.ink; g.globalAlpha = 0.45; g.lineWidth = 1.5;
    for (let r = 0, yy = y; yy < y + h; r++, yy += 12) {
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
      for (let xx = x + (r % 2 ? 14 : 0); xx < x + w; xx += 28) { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy + 12); g.stroke(); }
    }
  }
  g.restore();
}

/** Ventana por pieza y mudanza: [x, y, ancho, alto] en píxeles del lienzo de 640×300. */
const WINDOWS = {
  living: [[256, 24, 166, 112], [230, 18, 220, 140], [170, 10, 330, 172]],
  dormitorio: [[40, 30, 120, 96], [30, 24, 150, 120], [22, 14, 190, 160]],
  cocina: [[250, 24, 120, 84], [240, 20, 140, 92], [230, 14, 160, 100]],
};

/** Lo que se ve por la ventana: cielo, cordillera y ciudad según la mudanza y la hora. */
function drawView(g, level, night, [wx, wy, ww, wh]) {
  g.save();
  g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  if (night) { sky.addColorStop(0, "#0b1430"); sky.addColorStop(1, "#2a2f5a"); }
  else { sky.addColorStop(0, "#8fc3ee"); sky.addColorStop(1, "#d8ecf7"); }
  g.fillStyle = sky; g.fillRect(wx, wy, ww, wh);
  if (night) {
    g.fillStyle = "#fff";
    for (let i = 0; i < 18; i++) g.fillRect(wx + ((i * 53) % ww), wy + ((i * 29) % (wh * 0.4)), 1.6, 1.6);
    g.fillStyle = "#f4f1d0"; g.beginPath(); g.arc(wx + ww * 0.8, wy + wh * 0.18, 7, 0, 7); g.fill();
  }
  // Cordillera: más alta y nevada mientras más arriba vives
  const mh = [0.42, 0.5, 0.62][level], base = wy + wh * (level === 2 ? 0.72 : 0.62);
  const peaks = [[0, 0.3], [0.12, 0.62], [0.25, 0.4], [0.4, 0.95], [0.55, 0.5], [0.7, 0.85], [0.85, 0.45], [1, 0.7]]
    .map(([x, y]) => [wx + x * ww, base - y * wh * mh]);
  g.fillStyle = night ? "#3a4060" : "#9aa6b8";
  g.beginPath(); g.moveTo(wx, base);
  for (const [x, y] of peaks) g.lineTo(x, y);
  g.lineTo(wx + ww, wy + wh); g.lineTo(wx, wy + wh); g.fill();
  g.fillStyle = night ? "#c9cde0" : "#fff";        // nieve en las cumbres altas, siguiendo las laderas
  const snow = 0.18 + level * 0.06;
  for (let i = 1; i < peaks.length - 1; i++) {
    const [px, py] = peaks[i], [lx, ly] = peaks[i - 1], [rx, ry] = peaks[i + 1];
    if (py > base - wh * mh * 0.6) continue;
    g.beginPath(); g.moveTo(px + (lx - px) * snow, py + (ly - py) * snow); g.lineTo(px, py); g.lineTo(px + (rx - px) * snow, py + (ry - py) * snow); g.fill();
  }
  // Edificios: casas bajas en Ñuñoa, torres en Providencia, ciudad lejana en Las Condes
  const bld = level === 0 ? [[0.04, 0.3, 0.16], [0.24, 0.22, 0.14], [0.42, 0.34, 0.16], [0.64, 0.26, 0.14], [0.82, 0.32, 0.16]]
    : level === 1 ? [[0.02, 0.45, 0.12], [0.16, 0.6, 0.1], [0.3, 0.38, 0.14], [0.47, 0.82, 0.07], [0.58, 0.5, 0.12], [0.74, 0.66, 0.1], [0.87, 0.42, 0.12]]
    : [[0.05, 0.12, 0.08], [0.15, 0.18, 0.06], [0.24, 0.1, 0.08], [0.36, 0.22, 0.05], [0.44, 0.14, 0.08], [0.56, 0.28, 0.04], [0.63, 0.16, 0.07], [0.74, 0.12, 0.08], [0.85, 0.2, 0.06]];
  for (const [bx, bh, bw] of bld) {
    const x = wx + bx * ww, h = bh * wh, w = bw * ww, y = wy + wh - h;
    g.fillStyle = night ? "#1c2238" : level === 1 ? "#6d7a8c" : "#5d6878";
    if (level === 1 && bh > 0.8) {                  // la torre más alta, de vidrio y con punta
      g.fillStyle = night ? "#22304d" : "#7fa0bf";
      g.beginPath(); g.moveTo(x, wy + wh); g.lineTo(x + w * 0.1, y); g.lineTo(x + w * 0.9, y); g.lineTo(x + w, wy + wh); g.fill();
      g.fillRect(x + w * 0.4, y - 8, w * 0.2, 8);
    } else g.fillRect(x, y, w, h);
    if (night) {                                    // ventanas encendidas
      g.fillStyle = "#ffd77a";
      for (let yy = y + 4; yy < wy + wh - 3; yy += 7) for (let xx = x + 3; xx < x + w - 3; xx += 6) if ((xx * 7 + yy * 3) % 5 < 2) g.fillRect(xx, yy, 2.5, 3);
    }
  }
  g.restore();
  // Marco
  g.strokeStyle = "#fff"; g.lineWidth = level === 2 ? 4 : 6; g.strokeRect(wx, wy, ww, wh);
  const parts = level === 2 ? 3 : 2;
  for (let i = 1; i < parts; i++) { g.beginPath(); g.moveTo(wx + (ww * i) / parts, wy); g.lineTo(wx + (ww * i) / parts, wy + wh); g.stroke(); }
}

/** Muebles dibujados a mano (los que no tienen buen emoji). */
const SHAPES = {
  rug(g, f, W, H) { g.fillStyle = "#8c2f39"; g.beginPath(); g.ellipse(f.x * W, f.y * H, 150, 26, 0, 0, 7); g.fill(); g.strokeStyle = "#d9a24a"; g.lineWidth = 3; g.beginPath(); g.ellipse(f.x * W, f.y * H, 138, 20, 0, 0, 7); g.stroke(); },
  closet(g, f, W, H) {
    const x = f.x * W - 50, y = H * 0.18, w = 100, h = H * 0.62;
    g.fillStyle = "#8a5a34"; g.fillRect(x, y, w, h);
    g.strokeStyle = "#6b4325"; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, w / 2 - 6, h - 8); g.strokeRect(x + w / 2 + 2, y + 4, w / 2 - 6, h - 8);
    g.fillStyle = "#e0c27a"; g.fillRect(x + w / 2 - 8, y + h / 2, 4, 14); g.fillRect(x + w / 2 + 4, y + h / 2, 4, 14);
  },
  desk(g, f, W, H) {
    const x = f.x * W - 55, y = H * 0.6;
    g.fillStyle = "#a9773f"; g.fillRect(x, y, 110, 9);
    g.fillRect(x + 4, y + 9, 7, 50); g.fillRect(x + 99, y + 9, 7, 50);
    emoji(g, f.icon, f.x * W, y - 20, 50);
  },
  fridge(g, f, W, H) {
    const x = f.x * W - 34, y = H * 0.16, w = 68, h = H * 0.68;
    g.fillStyle = "#e9eef2"; g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill();
    g.strokeStyle = "#b6c0c8"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + h * 0.36); g.lineTo(x + w, y + h * 0.36); g.stroke();
    g.fillStyle = "#9aa6b0"; g.fillRect(x + w - 12, y + h * 0.14, 4, 22); g.fillRect(x + w - 12, y + h * 0.46, 4, 30);
  },
  stove(g, f, W, H) {
    const x = f.x * W - 45, y = H * 0.5, w = 90, h = H * 0.34;
    g.fillStyle = "#d8dde1"; g.fillRect(x, y, w, h);
    g.fillStyle = "#2a2e33"; g.fillRect(x + 10, y + 22, w - 20, h - 32);
    g.fillStyle = "#f19a3e"; g.globalAlpha *= 0.5; g.fillRect(x + 14, y + 26, w - 28, h - 40); g.globalAlpha /= 0.5;
    g.fillStyle = "#3b3f44"; [x + 22, x + 46, x + 68].forEach(cx => { g.beginPath(); g.arc(cx, y + 10, 4, 0, 7); g.fill(); });
    emoji(g, f.icon, x + w / 2, y - 12, 34);
  },
  table(g, f, W, H) {
    const cx = f.x * W, y = f.y * H - 24;
    g.fillStyle = "#9a6a3a"; g.beginPath(); g.ellipse(cx, y, 92, 18, 0, 0, 7); g.fill();
    g.fillRect(cx - 4, y, 8, 40);
    emoji(g, "🪑", cx - 112, y + 18, 54); emoji(g, "🪑", cx + 112, y + 18, 54);
  },
};

/** Dibuja un emoji centrado. */
function emoji(g, ch, x, y, size) {
  g.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(ch, x, y);
}

/** Ilustración de una pieza del depto: lo comprado a color, lo que falta como silueta. */
function drawRoom(inv, room, locked, night) {
  const W = 640, H = 300, c = document.createElement("canvas");
  c.width = W; c.height = H; c.className = "home-room";
  const g = c.getContext("2d");
  const level = Math.max(0, inv.homeLevel), wallH = H * 0.62;
  // Muro con la pintura elegida y zócalo
  paintWall(g, inv.currentPaint, 0, 0, W, wallH);
  // Piso: parquet en Ñuñoa, parquet claro en Providencia, porcelanato en Las Condes; baldosas en la cocina
  if (room === "cocina") {
    for (let y = wallH, r = 0; y < H; y += 20, r++) for (let x = 0; x < W; x += 20) { g.fillStyle = (x / 20 + r) % 2 ? "#e9e4da" : "#c9c1b2"; g.fillRect(x, y, 20, 20); }
  } else if (level === 2) {
    g.fillStyle = "#e6e2dc"; g.fillRect(0, wallH, W, H - wallH);
    g.strokeStyle = "#cfc9bf"; g.lineWidth = 1.5;
    for (let x = 0; x < W; x += 80) { g.beginPath(); g.moveTo(x, wallH); g.lineTo(x - 40, H); g.stroke(); }
    g.beginPath(); g.moveTo(0, wallH + 50); g.lineTo(W, wallH + 50); g.stroke();
  } else {
    g.fillStyle = level === 1 ? "#d2a774" : "#b78a58"; g.fillRect(0, wallH, W, H - wallH);
    g.strokeStyle = level === 1 ? "#bd915e" : "#a07546"; g.lineWidth = 2;
    for (let x = -H; x < W; x += 34) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.38, wallH); g.stroke(); }
  }
  g.fillStyle = "#fff"; g.fillRect(0, wallH - 6, W, 7);
  drawView(g, level, night, WINDOWS[room][level]);
  if (room === "cocina") {                          // mueble de cocina con lavaplatos (viene con el depto)
    g.fillStyle = "#f4f1ea"; g.fillRect(160, H * 0.52, 300, H * 0.32);
    g.fillStyle = "#4b4f55"; g.fillRect(156, H * 0.5, 308, 8);
    g.strokeStyle = "#d6d0c4"; g.lineWidth = 2; for (let x = 160; x < 460; x += 75) g.strokeRect(x + 4, H * 0.55, 67, H * 0.26);
    g.fillStyle = "#b8c2ca"; g.fillRect(286, H * 0.5 - 2, 60, 6); g.fillRect(312, H * 0.42, 6, 18);
  }
  // Muebles: lo que tienes a color, lo que falta como silueta tenue (las alfombras primero)
  const list = FURNITURE.filter(f => f.room === room).sort((a, b) => (b.shape === "rug") - (a.shape === "rug"));
  for (const f of list) {
    const own = !locked && inv.has(f.id);
    g.globalAlpha = own ? 1 : 0.12;
    if (f.shape) SHAPES[f.shape](g, f, W, H);
    else emoji(g, f.icon, f.x * W, f.y * H, 66 * f.size);
    g.globalAlpha = 1;
  }
  // De noche: la pieza a media luz y las lámparas que tengas, encendidas
  if (night) {
    g.fillStyle = "#0a1430"; g.globalAlpha = 0.45; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    g.globalCompositeOperation = "lighter";
    for (const f of list.filter(f => f.light && !locked && inv.has(f.id))) {
      const glow = g.createRadialGradient(f.x * W, f.y * H - 20, 4, f.x * W, f.y * H - 20, 170);
      glow.addColorStop(0, "#ffcf7a66"); glow.addColorStop(1, "#ffcf7a00");
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = "source-over";
  }
  if (locked) {
    g.fillStyle = "#0009"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.font = "800 26px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("🔒 Aún no tienes departamento", W / 2, H / 2);
  }
  return c;
}
