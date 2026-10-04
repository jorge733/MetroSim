/* ==========================================================================
   MetroSim — Alpha 0.9 · hud.js
   HUD HTML superpuesto: reloj, esquema de la línea activa, selector de mando,
   inversor, velocímetro, estación, señal, horario, puertas, panel del
   pasajero a pie, tarjeta bip!, panel de boletería / tótem, fundido de
   pantalla, mensajes y resumen de servicio.
   Alpha 0.9: saldo de la cuenta bancaria (ambos modos) con el sueldo que
   sube flotando, locales de la calle y cajero, tablero y seguimiento de
   misiones y destello de la cámara de fotos.
   ========================================================================== */

import { STATIONS, LINE, NOTCHES, NOTCH_INDEX, WORLD, FARES, formatCLP, fareBandAt } from "./config.js";
import { $, clamp, formatClock, formatStopError } from "./utils.js";
import { formatDelay } from "./engine/schedule.js";
import { BANK_NAME } from "./economy.js";

export class Hud {
  constructor() {
    this.el = {
      modeLabel: $("modeLabel"), clock: $("clock"), soundButton: $("soundButton"),
      selector: $("selectorHud"), notchList: $("notchList"), reverser: $("reverserPills"),
      driver: $("driverHud"), passenger: $("passengerHud"), help: $("controlsHelp"), crosshair: $("crosshair"),
      speed: $("speed"), speedArc: $("speedArc"), limitTick: $("limitTick"), speedLimit: $("speedLimit"),
      stationTitle: $("stationTitle"), nextStation: $("nextStation"), distance: $("distance"),
      precision: $("precision"), precisionMarker: $("precisionMarker"), precisionText: $("precisionText"),
      signalId: $("signalId"), signalDist: $("signalDist"), scheduleLabel: $("scheduleLabel"), scheduleDelay: $("scheduleDelay"),
      doorLamp: $("doorLamp"), doorStatus: $("doorStatus"), doorHint: $("doorHint"), onboard: $("onboardCount"),
      paxTitle: $("paxTitle"), paxStation: $("paxStation"), paxSub: $("paxSub"), paxHint: $("paxHint"),
      lineStrip: $("lineStrip"), lineStripTrain: $("lineStripTrain"),
      message: $("message"),
      summary: $("summary"), summaryKicker: $("summaryKicker"), summaryTitle: $("summaryTitle"), summaryList: $("summaryList"),
      summaryContinue: $("summaryContinue"), summaryMenu: $("summaryMenu"), summaryAlt: $("summaryAlt"),
      cardPill: $("cardPill"),
      scorePill: $("scorePill"), scoreTotal: $("scoreTotal"), scoreStreak: $("scoreStreak"), scoreBest: $("scoreBest"), scoreFloat: $("scoreFloat"), fade: $("fade"), fadeText: $("fadeText"),
      ticket: $("ticketPanel"), ticketKicker: $("ticketKicker"), ticketTitle: $("ticketTitle"),
      ticketBalance: $("ticketBalance"), ticketCardNo: $("ticketCardNo"), ticketFares: $("ticketFares"),
      ticketAmounts: $("ticketAmounts"), ticketPay: $("ticketPay"), ticketStatus: $("ticketStatus"),
      ticketConfirm: $("ticketConfirm"), ticketClose: $("ticketClose"), ticketBuy: $("ticketBuy"),
      bankPill: $("bankPill"), bankAmount: $("bankAmount"), moneyFloat: $("moneyFloat"),
      tracker: $("missionTracker"), trackerTitle: $("trackerTitle"), trackerSteps: $("trackerSteps"),
      store: $("storePanel"), storeIcon: $("storeIcon"), storeKicker: $("storeKicker"), storeTitle: $("storeTitle"),
      storeBalance: $("storeBalance"), storeCardNo: $("storeCardNo"), storeList: $("storeList"), storeStatus: $("storeStatus"), storeClose: $("storeClose"),
      missions: $("missionPanel"), missionActive: $("missionActive"), missionOffers: $("missionOffers"),
      missionShuffle: $("missionShuffle"), missionStats: $("missionStats"), missionClose: $("missionClose"),
      photoFlash: $("photoFlash"),
    };
    this.signalLamps = [...document.querySelectorAll(".signal-head i")];
    this.buildNotchList();
    this.buildLineStrip();
    this.messageTimer = null;
  }

  /** Escalera del selector: P4 arriba, EMERGENCIA abajo. */
  buildNotchList() {
    this.notchItems = [];
    [...NOTCHES].reverse().forEach(n => {
      const li = document.createElement("li");
      li.className = n.type + (n.id === "EM" ? " separator" : "");
      li.innerHTML = `<b>${n.id}</b><small>${n.label}</small>`;
      this.el.notchList.append(li);
      this.notchItems[NOTCH_INDEX[n.id]] = li;
    });
  }

  /**
   * Cambia la línea mostrada (al empezar una partida): esquema, nombre,
   * insignia y color de acento de toda la interfaz.
   */
  setLine() {
    document.documentElement.style.setProperty("--line", LINE.color);
    this.setText($("hudLineBadge"), LINE.id);
    this.setText($("hudLineLabel"), `METRO DE SANTIAGO · ${LINE.name}`);
    this.setText($("hudLineRoute"), `${STATIONS[0].name} ⇄ ${STATIONS.at(-1).name}`);
    this.stripDots?.forEach(d => d.remove());
    this.buildLineStrip();
  }

  /** Estaciones colocadas según su distancia; solo se rotulan terminales y la actual. */
  buildLineStrip() {
    this.stripDots = STATIONS.map((s, i) => {
      const dot = document.createElement("div");
      dot.className = "line-strip-stop" + (i === 0 || i === STATIONS.length - 1 ? " terminal" : "") + (s.combos.length ? " combo" : "");
      dot.style.left = `${this.progressOf(s.z) * 100}%`;
      dot.innerHTML = `<span>${s.short}</span>`;
      dot.title = s.name;
      this.el.lineStrip.insertBefore(dot, this.el.lineStripTrain);
      return dot;
    });
  }

  /** Posición (0..1) de una coordenada z del mundo en el esquema de línea. */
  progressOf(z) { return clamp((STATIONS[0].z - z) / WORLD.lineLength, 0, 1); }

  setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  setMode(mode) {
    const driver = mode === "driver";
    this.setText(this.el.modeLabel, driver ? "CONDUCTOR" : "PASAJERO A PIE");
    this.el.cardPill.classList.toggle("hidden", driver);
    this.el.scorePill.classList.toggle("hidden", !driver);
    this.el.tracker.classList.toggle("hidden", driver);
    this.el.selector.classList.toggle("hidden", !driver);
    this.el.driver.classList.toggle("hidden", !driver);
    this.el.passenger.classList.toggle("hidden", driver);
    this.el.crosshair.classList.toggle("hidden", driver);
    document.querySelectorAll(".help-driver").forEach(e => e.classList.toggle("hidden", !driver));
    document.querySelectorAll(".help-walker").forEach(e => e.classList.toggle("hidden", driver));
    this.hideSummary();
  }

  setSound(on) {
    this.setText(this.el.soundButton, on ? "🔊 Sonido" : "🔇 Silencio");
    this.el.soundButton.classList.toggle("off", !on);
  }

  toggleHelp() { this.el.help.classList.toggle("hidden"); }

  /** Esquema de línea: marcador en z y estación resaltada. */
  updateStrip(z, highlight) {
    this.el.lineStripTrain.style.left = `${this.progressOf(z) * 100}%`;
    const idx = highlight ? (highlight.worldIndex ?? highlight.index) : -1;
    this.stripDots.forEach((d, i) => d.classList.toggle("current", i === idx));
  }

  /* ---------------------------------------------------------------------
     Conductor
     --------------------------------------------------------------------- */
  updateDriver(sim, info, extra) {
    const e = this.el;
    this.setText(e.clock, formatClock(extra.clock));
    this.updateStrip(sim.route.toWorldZ(sim.position), info.docked || info.next);

    const kmh = sim.speedKmh;
    const over = kmh > info.limit + 0.5;

    // Velocímetro
    this.setText(e.speed, String(Math.round(kmh)));
    e.speedArc.style.strokeDasharray = `${(clamp(kmh / 80, 0, 1) * 235.6).toFixed(1)} 314.2`;
    e.speedArc.classList.toggle("over", over);
    e.limitTick.setAttribute("transform", `rotate(${(info.limit / 80) * 270 - 135} 60 60)`);
    this.setText(e.speedLimit, String(info.limit));

    // Selector e inversor
    this.notchItems.forEach((li, i) => li.classList.toggle("active", i === sim.notch));
    [...e.reverser.children].forEach(pill => pill.classList.toggle("active", Number(pill.dataset.dir) === sim.reverser));

    // Estación
    if (info.docked) {
      this.setText(e.stationTitle, "EN ESTACIÓN");
      this.setText(e.nextStation, info.docked.name);
      this.setText(e.distance, info.next ? `Siguiente: ${info.next.name}` : "Fin de línea · R reiniciar");
    } else if (info.next) {
      this.setText(e.stationTitle, sim.movingBackwards ? "RETROCEDIENDO" : "PRÓXIMA ESTACIÓN");
      this.setText(e.nextStation, info.next.name);
      this.setText(e.distance, `${Math.max(0, Math.round(info.distance))} m`);
    } else {
      const d = Math.round(sim.position - sim.route.track.retireZ);
      this.setText(e.stationTitle, "COLA DE MANIOBRAS");
      this.setText(e.nextStation, "FIN DE MANIOBRA");
      this.setText(e.distance, Math.abs(d) <= 15 && sim.isStopped ? "En posición · pulsa T para cambiar de cabina" : `${d} m · detente en el cartel`);
    }

    // Precisión de parada (±10 m en la escala)
    e.precision.classList.toggle("hidden", !info.approach);
    if (info.approach) {
      const err = info.approach.error;
      e.precisionMarker.style.left = `${50 + clamp(-err / 10, -1, 1) * 50}%`;
      this.setText(e.precisionText, `Marca de parada: ${formatStopError(err)}`);
    }

    // Señal
    const sig = info.signal;
    this.setText(e.signalId, sig ? `S${sig.id}` : "S---");
    this.setText(e.signalDist, sig ? `${Math.round(sig.distance)} m · ${{ red: "ROJO", yellow: "AMARILLO", green: "VERDE" }[sig.aspect]}` : "—");
    this.signalLamps.forEach(l => l.classList.toggle("on", !!sig && l.dataset.a === sig.aspect));

    // Horario
    if (info.schedule) {
      this.setText(e.scheduleLabel, info.schedule.label);
      this.setText(e.scheduleDelay, info.schedule.delayText);
      e.scheduleDelay.className = `delay ${info.schedule.cls}`;
    }

    // Puertas y viajeros
    const doorText = { closed: "CERRADAS", opening: "ABRIENDO…", open: "ABIERTAS", closing: "CERRANDO…" }[sim.doorState];
    this.setText(e.doorStatus, doorText);
    e.doorLamp.classList.toggle("open", sim.doorState === "open");
    e.doorLamp.classList.toggle("moving", sim.doorState === "opening" || sim.doorState === "closing");
    let hint;
    if (sim.doorState === "open") hint = extra.boardingBusy ? "Viajeros subiendo y bajando…" : "Embarque completo · D cerrar";
    else if (!sim.doorsClosed) hint = "Tracción bloqueada";
    else if (!sim.isStopped) hint = "Bloqueadas en marcha";
    else if (sim.dockedStation()) hint = sim.isBraking ? "D abrir · tren en posición" : "Aplica freno para abrir";
    else hint = "Fuera de andén";
    this.setText(e.doorHint, hint);
    e.doorHint.classList.toggle("ready", sim.doorState === "open" && !extra.boardingBusy);
    this.setText(e.onboard, `A bordo: ${extra.onboard} viajeros`);
  }

  /* ---------------------------------------------------------------------
     Pasajero a pie
     data: { clock, worldZ, title, station, sub, hint, highlight }
     --------------------------------------------------------------------- */
  updatePassenger(data) {
    this.lastClock = data.clock;
    const e = this.el;
    this.setText(e.clock, formatClock(data.clock));
    this.updateStrip(data.worldZ, data.highlight);
    this.setText(e.paxTitle, data.title);
    this.setText(e.paxStation, data.station);
    this.setText(e.paxSub, data.sub);
    this.setText(e.paxHint, data.hint);
  }

  /* ---------------------------------------------------------------------
     Puntaje del conductor (scoring.js)
     ev: { total, points, streak, multiplier, detail?, important?, best? }
     --------------------------------------------------------------------- */
  updateScore(ev) {
    const e = this.el;
    this.setText(e.scoreTotal, String(ev.total));
    this.setText(e.scoreStreak, ev.streak >= 2 ? `RACHA ${ev.streak} · ×${ev.multiplier.toFixed(1)}` : "");
    if (ev.best !== undefined) this.setText(e.scoreBest, ev.best ? `récord ${ev.best}` : "");
    if (!ev.points) return;
    // Cifra flotante (+300 / −150) que sube y se desvanece
    const f = e.scoreFloat;
    f.textContent = ev.points > 0 ? `+${ev.points}` : `−${-ev.points}`;
    f.className = `score-float ${ev.points > 0 ? "gain" : "loss"}`;
    void f.offsetWidth;                                  // reinicia la animación
    f.classList.add("show");
    e.scorePill.classList.toggle("perfect", !!ev.perfect);
    if (!ev.important && ev.detail) this.showMessage(ev.detail, "warn", 1800);
  }

  /* ---------------------------------------------------------------------
     Mensajes y resumen
     --------------------------------------------------------------------- */
  showMessage(text, level = "info", duration = 2800) {
    const m = this.el.message;
    m.textContent = text;
    m.className = `message visible ${level}`;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => m.classList.remove("visible"), duration);
  }

  /**
   * @param {object} s  { kicker, title, rows: [[etiqueta, valor]], continueLabel, onContinue, onMenu,
   *                      altLabel?, onAlt? }
   */
  showSummary(s) {
    const e = this.el;
    this.setText(e.summaryKicker, s.kicker);
    this.setText(e.summaryTitle, s.title);
    e.summaryList.replaceChildren(...s.rows.map(([k, v]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span><b></b>`;
      li.firstChild.textContent = k;
      li.lastChild.textContent = v;
      return li;
    }));
    e.summaryContinue.textContent = s.continueLabel;
    e.summaryContinue.onclick = () => { this.hideSummary(); s.onContinue(); };
    e.summaryMenu.onclick = () => { this.hideSummary(); s.onMenu(); };
    e.summaryAlt.classList.toggle("hidden", !s.altLabel);
    if (s.altLabel) { e.summaryAlt.textContent = s.altLabel; e.summaryAlt.onclick = () => { this.hideSummary(); s.onAlt(); }; }
    e.summary.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  hideSummary() { this.el.summary.classList.add("hidden"); }

  /* ---------------------------------------------------------------------
     Tarjeta bip!, boletería y tótem
     --------------------------------------------------------------------- */
  setCard(card) {
    this.setText(this.el.cardPill, card.hasCard ? `bip! ${formatCLP(card.balance)}` : "bip! · sin tarjeta");
    this.el.cardPill.classList.toggle("low", card.hasCard && card.balance < fareBandAt(0 + (this.lastClock || 0)).price);
  }

  /**
   * Abre el panel de atención.
   * @param {object} o
   * @param {"boleteria"|"totem"} o.kind
   * @param {object} o.station
   * @param {import("./card.js").BipCard} o.card
   * @param {import("./economy.js").BankAccount} o.bank  cuenta con la que se paga
   * @param {number} o.clock
   * @param {(amount:number, method:string)=>Promise<string>} o.onLoad  realiza la carga; devuelve el texto de resultado
   * @param {()=>Promise<string>} o.onBuyCard
   * @param {()=>void} o.onClose
   */
  openTicketPanel(o) {
    const e = this.el;
    const booth = o.kind === "boleteria";
    this.ticketBusy = false;
    this.setText(e.ticketKicker, booth ? "BOLETERÍA · ATENCIÓN PRESENCIAL" : "TÓTEM DE AUTOSERVICIO");
    this.setText(e.ticketTitle, o.station.name);
    const refresh = () => {
      this.setText(e.ticketBalance, o.card.hasCard ? formatCLP(o.card.balance) : "—");
      const bip = o.card.hasCard ? `Tarjeta bip! ${o.card.maskedNumber} · ${o.card.trips} viajes` : "No tienes tarjeta bip!";
      this.setText(e.ticketCardNo, `${bip} · tu cuenta: ${formatCLP(o.bank.balance)}`);
      this.setBank(o.bank);
      this.setCard(o.card);
    };
    refresh();

    // Tarifas vigentes, con el tramo actual resaltado
    const band = fareBandAt(o.clock);
    e.ticketFares.replaceChildren(...FARES.bands.map(b => {
      const row = document.createElement("div");
      row.className = "fare-row" + (b === band ? " current" : "");
      row.innerHTML = "<span></span><b></b>";
      row.firstChild.textContent = b.label + (b === band ? " · ahora" : "");
      row.lastChild.textContent = formatCLP(b.price);
      return row;
    }));

    // Importes
    let amount = FARES.loadAmounts[0];
    e.ticketAmounts.replaceChildren(...FARES.loadAmounts.map(a => {
      const btn = document.createElement("button");
      btn.textContent = formatCLP(a);
      btn.className = "amount" + (a === amount ? " selected" : "");
      btn.onclick = () => {
        amount = a;
        [...e.ticketAmounts.children].forEach(c => c.classList.toggle("selected", c === btn));
      };
      return btn;
    }));

    // Medio de pago: tu tarjeta de débito (se descuenta de tu cuenta bancaria)
    let method = "debito";
    const methods = [["debito", `Débito ${BANK_NAME} ${o.bank.maskedNumber}`]];
    e.ticketPay.replaceChildren(...methods.map(([id, label]) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = "pay" + (id === method ? " selected" : "");
      btn.onclick = () => { method = id; [...e.ticketPay.children].forEach(c => c.classList.toggle("selected", c === btn)); };
      return btn;
    }));

    e.ticketBuy.classList.toggle("hidden", !booth);
    e.ticketBuy.textContent = o.card.hasCard ? `Comprar otra tarjeta (${formatCLP(FARES.cardPrice)})` : `Comprar tarjeta bip! (${formatCLP(FARES.cardPrice)})`;
    this.setText(e.ticketStatus, booth ? "El cajero te atiende. Elige el monto a cargar; pagas con tu tarjeta de débito." : "Toca un monto y acerca tu tarjeta de débito al lector.");
    e.ticketStatus.className = "ticket-status";

    const run = async (fn) => {
      if (this.ticketBusy) return;
      this.ticketBusy = true;
      e.ticket.classList.add("busy");
      try {
        const msg = await fn();
        this.setText(e.ticketStatus, msg);
        e.ticketStatus.className = "ticket-status ok";
      } catch (err) {
        this.setText(e.ticketStatus, err.message || String(err));
        e.ticketStatus.className = "ticket-status error";
      }
      refresh();
      this.ticketBusy = false;
      e.ticket.classList.remove("busy");
    };
    e.ticketConfirm.onclick = () => run(() => o.onLoad(amount, method, (t) => this.setText(e.ticketStatus, t)));
    e.ticketBuy.onclick = () => run(() => o.onBuyCard((t) => this.setText(e.ticketStatus, t)));
    const close = () => { if (this.ticketBusy) return; e.ticket.classList.add("hidden"); o.onClose(); };
    e.ticketClose.onclick = close;
    this.closeTicket = close;
    e.ticket.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  get ticketOpen() { return !this.el.ticket.classList.contains("hidden"); }

  /* ---------------------------------------------------------------------
     Cuenta bancaria
     --------------------------------------------------------------------- */
  setBank(bank) {
    this.setText(this.el.bankAmount, formatCLP(bank.balance));
    this.el.bankPill.classList.toggle("low", bank.balance < 1000);
  }

  /** Cifra que sube junto al saldo (+$350 sueldo / −$2.100 compra). */
  moneyFloat(amount) {
    const f = this.el.moneyFloat;
    f.textContent = amount >= 0 ? `+${formatCLP(amount)}` : `−${formatCLP(-amount)}`;
    f.className = `money-float ${amount >= 0 ? "gain" : "loss"}`;
    void f.offsetWidth;                                  // reinicia la animación
    f.classList.add("show");
  }

  /* ---------------------------------------------------------------------
     Misiones
     --------------------------------------------------------------------- */

  /** Seguimiento de la misión activa (arriba a la izquierda). */
  updateTracker(missions) {
    const e = this.el, m = missions.active;
    const key = m ? `${m.id}:${m.step}` : "none";
    if (key === this.trackerKey) return;
    this.trackerKey = key;
    if (!m) {
      this.setText(e.trackerTitle, "Sin misión activa");
      const li = document.createElement("li");
      li.textContent = "Pulsa J para elegir una misión";
      e.trackerSteps.replaceChildren(li);
      return;
    }
    this.setText(e.trackerTitle, `${m.icon} ${m.title}`);
    e.trackerSteps.replaceChildren(...m.steps.map((s, i) => {
      const li = document.createElement("li");
      li.textContent = s.text;
      li.className = i < m.step ? "done" : i === m.step ? "current" : "";
      return li;
    }));
  }

  /**
   * Tablero de misiones.
   * @param {object} o  { missions, onAccept(i), onAbandon(), onShuffle(), onClose() }
   */
  openMissions(o) {
    const e = this.el;
    const render = () => {
      const ms = o.missions, m = ms.active;
      if (m) {
        e.missionActive.replaceChildren(this.missionCard(m, { active: true, button: "Abandonar", onClick: () => { o.onAbandon(); render(); } }));
      } else {
        const p = document.createElement("p");
        p.className = "station-sub";
        p.textContent = "No tienes una misión activa: elige una de la lista.";
        e.missionActive.replaceChildren(p);
      }
      e.missionOffers.replaceChildren(...ms.offers.map((off, i) => this.missionCard(off, {
        button: m ? "Cambiar a esta" : "Aceptar",
        onClick: () => { o.onAccept(i); render(); },
      })));
      this.setText(e.missionStats, `Cumplidas: ${ms.completed} · fallidas: ${ms.failed}`);
    };
    render();
    e.missionShuffle.onclick = () => { o.onShuffle(); render(); };
    const close = () => { e.missions.classList.add("hidden"); o.onClose(); };
    e.missionClose.onclick = close;
    this.closeMissions = close;
    e.missions.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  missionCard(m, { active = false, button, onClick }) {
    const card = document.createElement("div");
    card.className = "mission-item" + (active ? " active" : "");
    card.innerHTML = '<div class="mission-item-head"><b></b><span class="mission-reward"></span></div><p></p><ol></ol><button class="go-button"></button>';
    card.querySelector("b").textContent = `${m.icon} ${m.title}`;
    card.querySelector(".mission-reward").textContent = `+${formatCLP(m.reward)}`;
    card.querySelector("p").textContent = m.brief;
    card.querySelector("ol").replaceChildren(...m.steps.map((s, i) => {
      const li = document.createElement("li");
      li.textContent = s.text;
      if (active) li.className = i < m.step ? "done" : i === m.step ? "current" : "";
      return li;
    }));
    const btn = card.querySelector("button");
    btn.textContent = button;
    if (active) btn.className = "ghost-button";
    btn.onclick = onClick;
    return card;
  }

  get missionsOpen() { return !this.el.missions.classList.contains("hidden"); }

  /* ---------------------------------------------------------------------
     Locales de la calle y cajero automático
     --------------------------------------------------------------------- */

  /**
   * @param {object} o
   *   icon, kicker, title, bank, status (texto inicial)
   *   items: () => [{ name, price, note?, action? }]   productos y acciones de misión
   *   rows:  () => [[texto, valor]]                     en vez de productos (movimientos del cajero)
   *   onBuy(item) → Promise<string>   compra o acción; el texto es el resultado
   *   onClose()
   */
  openStore(o) {
    const e = this.el;
    this.storeBusy = false;
    e.storeIcon.textContent = o.icon;
    this.setText(e.storeKicker, o.kicker);
    this.setText(e.storeTitle, o.title);
    const refresh = () => {
      this.setText(e.storeBalance, formatCLP(o.bank.balance));
      this.setText(e.storeCardNo, `${BANK_NAME} · débito ${o.bank.maskedNumber}`);
      this.setBank(o.bank);
    };
    const build = () => {
      if (o.rows) {
        e.storeList.replaceChildren(...o.rows().map(([k, v]) => {
          const row = document.createElement("div");
          row.className = "fare-row";
          row.innerHTML = "<span></span><b></b>";
          row.firstChild.textContent = k;
          row.lastChild.textContent = v;
          return row;
        }));
        return;
      }
      e.storeList.replaceChildren(...o.items().map(item => {
        const btn = document.createElement("button");
        btn.className = "store-item" + (item.action ? " mission" : "") + (!item.action && item.price > o.bank.balance ? " expensive" : "");
        btn.innerHTML = "<span></span><b></b>";
        btn.firstChild.textContent = item.name + (item.note ? ` · ${item.note}` : "");
        btn.lastChild.textContent = item.action ? "misión" : formatCLP(item.price);
        btn.onclick = () => run(item);
        return btn;
      }));
    };
    const run = async (item) => {
      if (this.storeBusy) return;
      this.storeBusy = true;
      e.store.classList.add("busy");
      try {
        this.setText(e.storeStatus, await o.onBuy(item));
        e.storeStatus.className = "ticket-status ok";
      } catch (err) {
        this.setText(e.storeStatus, err.message || String(err));
        e.storeStatus.className = "ticket-status error";
      }
      refresh();
      build();
      this.storeBusy = false;
      e.store.classList.remove("busy");
    };
    refresh();
    build();
    this.setText(e.storeStatus, o.status || "—");
    e.storeStatus.className = "ticket-status";
    const close = () => { if (this.storeBusy) return; e.store.classList.add("hidden"); o.onClose(); };
    e.storeClose.onclick = close;
    this.closeStore = close;
    e.store.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  get storeOpen() { return !this.el.store.classList.contains("hidden"); }

  /** Destello blanco de la cámara de fotos. */
  photoFlash() {
    const f = this.el.photoFlash;
    f.classList.remove("show");
    void f.offsetWidth;
    f.classList.add("show");
  }

  /* ---------------------------------------------------------------------
     Fundido a negro (cambio de cabina)
     --------------------------------------------------------------------- */
  fadeOut(text) {
    this.setText(this.el.fadeText, text);
    this.el.fade.classList.add("visible");
  }
  fadeIn() { this.el.fade.classList.remove("visible"); }
  get summaryOpen() { return !this.el.summary.classList.contains("hidden"); }
}

export { formatDelay };
