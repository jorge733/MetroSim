/* ==========================================================================
   MetroSim — Alpha 0.9 · missions.js
   Misiones del modo Pasajero (sin Three.js).

   Cada misión es una lista de PASOS que se cumplen en orden. Tipos:
     · Compras      viajar a una estación y comprar algo en un local de su
                    calle (pan para la once, almuerzo, remedios, flores...)
     · Turismo      visitar el hito de una estación y sacarle una foto
     · Encargo      retirar un paquete en el kiosko y entregarlo en otra estación
     · Contrarreloj llegar a una estación antes de una hora
     · Ahorro       viajar pagando tarifa de horario valle o bajo
     · Trabajo      presentarse en una terminal para el turno de conductor
   La primera misión de cada línea es un tutorial: comprar la bip!,
   cargarla, viajar y comprar pan (en Plaza Egaña si la línea pasa por ahí).

   El juego avisa de lo que pasa con notify(tipo, datos):
     "street" {station, ride}            saliste a la calle en una estación
     "buy"    {station, shop, item}      compraste en un local
     "photo"  {station}                  sacaste una foto del hito
     "action" {station, shop, action}    retiraste / entregaste un encargo
   y tick(ctx) revisa los pasos de estado (tener bip!, tener saldo) y los
   plazos. Las misiones se guardan por línea en localStorage.
   ========================================================================== */

import { streetPlan, SHOPS } from "./city/plan.js";
import { landmarkFor } from "./city/catalog.js";
import { fareBandAt, formatCLP, spokenName } from "./config.js";
import { formatClock } from "./engine/format.js";

const OFFERS = 3;

/** Compras con tema: rubro, etiqueta de producto, título y relato. */
const THEMES = [
  { tag: "pan", kinds: ["panaderia"], title: "Pan para la once", brief: (st, shop) => `En tu casa piden pan para la once. Cómpralo en ${shop.name}, en ${st}.` },
  { tag: "almuerzo", kinds: ["fuente", "cafeteria"], title: "Hora de almuerzo", brief: (st, shop) => `Se te antojó almorzar en ${shop.name}, cerca de ${st}.` },
  { tag: "remedio", kinds: ["farmacia"], title: "Remedios para la abuela", brief: (st, shop) => `Tu abuela necesita un remedio que solo tienen en ${shop.name}, en ${st}.` },
  { tag: "flores", kinds: ["floreria"], title: "Un regalo especial", brief: (st, shop) => `Hoy es un día especial: compra flores en ${shop.name}, en ${st}.` },
  { tag: "cafe", kinds: ["cafeteria"], title: "Un café con calma", brief: (st, shop) => `Nada mejor que un café en ${shop.name}, junto a ${st}.` },
  { tag: null, kinds: ["almacen", "kiosko", "libreria", "panaderia"], title: "Encargo de la casa", brief: (st, shop) => `Te encargaron algo de ${shop.name}, en ${st}.` },
];

const pickOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nice = (name) => spokenName(name);

export class MissionSystem {
  /**
   * @param {string} lineId
   * @param {Array} stations  estaciones de la línea activa
   */
  constructor(lineId, stations) {
    this.key = `metrosim.missions.${lineId}`;
    this.stations = stations;
    const s = this.read();
    this.active = s?.active ?? null;
    this.offers = s?.offers ?? [];
    this.completed = s?.completed ?? 0;
    this.failed = s?.failed ?? 0;
    this.tutorialDone = s?.tutorialDone ?? false;
    this.seq = s?.seq ?? 1;
    // Descarta misiones guardadas que apunten a estaciones que ya no existen
    const valid = (m) => m.steps.every(st => !st.station || this.byName(st.station));
    if (this.active && !valid(this.active)) this.active = null;
    this.offers = this.offers.filter(valid);
  }

  read() { try { return JSON.parse(localStorage.getItem(this.key) || "null"); } catch { return null; } }
  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ active: this.active, offers: this.offers, completed: this.completed, failed: this.failed, tutorialDone: this.tutorialDone, seq: this.seq }));
    } catch { /* sin almacenamiento */ }
  }

  byName(name) { return this.stations.find(s => s.name === name) || null; }

  /** Paso actual de la misión activa. */
  get step() { return this.active ? this.active.steps[this.active.step] : null; }

  /* ---------------------------------------------------------------------
     Ofertas y elección
     ctx: { station (donde está el jugador), clock, card }
     --------------------------------------------------------------------- */

  /** Asegura que haya misiones disponibles (y una activa si no hay ninguna todavía). */
  ensure(ctx) {
    if (!this.tutorialDone && !this.active) {
      this.active = this.makeTutorial(ctx);
      this.tutorialDone = true;
    }
    if (this.offers.length < OFFERS) this.refill(ctx);
    this.save();
  }

  refill(ctx) {
    const makers = [this.makeShopping, this.makeTourism, this.makeDelivery, this.makeTimed, this.makeSaver, this.makeWork, this.makeShopping];
    const used = new Set(this.offers.map(o => o.type));
    let guard = 0;
    while (this.offers.length < OFFERS && guard++ < 40) {
      const m = pickOf(makers).call(this, ctx);
      if (!m || (used.has(m.type) && guard < 30)) continue;
      used.add(m.type);
      this.offers.push(m);
    }
  }

  /** Acepta una oferta (reemplaza la misión activa, que se pierde). */
  accept(index, ctx) {
    const m = this.offers.splice(index, 1)[0];
    if (!m) return null;
    // Los plazos se cuentan desde que se acepta
    m.steps.forEach(s => { if (s.minutes) s.deadline = ctx.clock + s.minutes * 60; });
    this.active = m;
    this.refill(ctx);
    this.save();
    return m;
  }

  abandon(ctx) {
    if (!this.active) return;
    this.active = null;
    this.refill(ctx);
    this.save();
  }

  /** Cambia todas las ofertas por otras nuevas. */
  shuffle(ctx) {
    this.offers = [];
    this.refill(ctx);
    this.save();
  }

  /* ---------------------------------------------------------------------
     Avance
     --------------------------------------------------------------------- */

  /**
   * Suceso del juego. Devuelve la lista de avisos:
   *   [{ text, level, completed?: mission, failed?: mission }]
   */
  notify(type, data, ctx) {
    const out = this.tick(ctx);              // primero los pasos de estado (p. ej. ya cargaste la bip!)
    const step = this.step;
    if (!step) return out;
    const here = data.station?.name;
    let done = false;

    if (step.kind === "arrive" && type === "street" && here === step.station) {
      if (step.deadline && ctx.clock > step.deadline) return this.fail(`Llegaste tarde: el plazo era a las ${formatClock(step.deadline).slice(0, 5)}`, ctx);
      if (step.fare === "offpeak" && data.ride?.fare?.id === "punta") return this.fail("Pagaste tarifa de hora punta: el viaje no fue económico", ctx);
      if (step.fare === "offpeak" && !data.ride?.fare) return out;            // hay que llegar viajando en Metro
      done = true;
    }
    if (step.kind === "buy" && type === "buy" && here === step.station && data.shop === step.shop) {
      done = step.item ? data.item.id === step.item : step.tag ? data.item.tag === step.tag : true;
    }
    if (step.kind === "photo" && type === "photo" && here === step.station) done = true;
    if (step.kind === "action" && type === "action" && here === step.station && data.shop === step.shop && data.action === step.action) done = true;

    if (done) this.advance(out, ctx);
    return out;
  }

  /** Revisa los pasos de estado y los plazos (se llama cada segundo). */
  tick(ctx) {
    const out = [];
    const step = this.step;
    if (!step) return out;
    if (step.kind === "bipCard" && ctx.card.hasCard) this.advance(out, ctx);
    else if (step.kind === "bipLoad" && ctx.card.hasCard && ctx.card.balance >= fareBandAt(ctx.clock).price) this.advance(out, ctx);
    else if (step.deadline && ctx.clock > step.deadline + 1) return this.fail(`Se acabó el tiempo (${formatClock(step.deadline).slice(0, 5)})`, ctx);
    return out;
  }

  advance(out, ctx) {
    const m = this.active;
    m.step++;
    if (m.step >= m.steps.length) {
      this.completed++;
      this.active = null;
      this.refill(ctx);
      out.push({ text: `✔ Misión cumplida: ${m.title} · recompensa ${formatCLP(m.reward)}`, level: "ok", completed: m });
    } else {
      out.push({ text: `✔ ${m.steps[m.step - 1].text} · ahora: ${m.steps[m.step].text}`, level: "ok" });
      // El siguiente paso puede estar cumplido ya (p. ej. ya tienes bip!)
      out.push(...this.tick(ctx));
    }
    this.save();
  }

  fail(reason, ctx) {
    const m = this.active;
    this.failed++;
    this.active = null;
    this.refill(ctx);
    this.save();
    return [{ text: `✖ Misión fallida: ${m.title} · ${reason}`, level: "alert", failed: m }];
  }

  /** Acciones de misión disponibles en un local (retirar / entregar un encargo). */
  actionsAt(station, shopKind) {
    const s = this.step;
    if (!s || s.kind !== "action" || s.station !== station.name || s.shop !== shopKind) return [];
    return [{ id: s.action, label: s.label }];
  }

  /** ¿El paso actual se cumple en esta estación? (para resaltar el destino en el HUD) */
  get targetStation() {
    const s = this.step;
    return s?.station ? this.byName(s.station) : null;
  }

  /* ---------------------------------------------------------------------
     Generadores
     --------------------------------------------------------------------- */

  newMission(type, icon, title, brief, steps, reward) {
    return { id: `M${this.seq++}`, type, icon, title, brief, steps: steps.map(s => ({ ...s })), reward, step: 0 };
  }

  /** Estaciones candidatas a destino: no la actual, a ≥ minStops paradas. */
  destinations(ctx, minStops = 2, filter = () => true) {
    const cur = ctx.station ? this.stations.findIndex(s => s.name === ctx.station.name) : -1;
    return this.stations.filter((s, i) => (cur < 0 || Math.abs(i - cur) >= minStops) && filter(s));
  }

  stops(ctx, st) {
    const cur = this.stations.findIndex(s => s.name === ctx.station?.name);
    return cur < 0 ? 5 : Math.abs(this.stations.indexOf(st) - cur);
  }

  arriveStep(st, extra = {}) {
    return { kind: "arrive", station: st.name, text: `Viaja a ${nice(st.name)} y sal a la calle`, ...extra };
  }

  makeTutorial(ctx) {
    const egana = this.destinations(ctx, 1, s => s.name === "PLAZA EGAÑA")[0];
    const st = egana || pickOf(this.destinations(ctx, 2, s => landmarkFor(s))) || pickOf(this.destinations(ctx, 2));
    const shop = streetPlan(st).shops.find(s => s.kind === "panaderia");
    const steps = [];
    if (!ctx.card.hasCard) steps.push({ kind: "bipCard", text: "Compra una tarjeta bip! en la boletería de la estación" });
    steps.push({ kind: "bipLoad", text: "Carga saldo en tu bip! (boletería o tótem)" });
    steps.push(this.arriveStep(st));
    steps.push({ kind: "buy", station: st.name, shop: "panaderia", tag: "pan", text: `Compra pan en ${shop.name}` });
    const where = landmarkFor(st) ? `${nice(st.name)} (${landmarkFor(st).name})` : nice(st.name);
    return this.newMission("tutorial", "🥖", "Pan para la once",
      `Primer día en Santiago. En tu casa piden pan para la once: baja al Metro, compra y carga tu bip!, viaja a ${where} y compra pan. Pagas todo con tu tarjeta de débito.`,
      steps, 800);
  }

  makeShopping(ctx) {
    const hour = (ctx.clock / 3600) % 24;
    let themes = THEMES;
    if (hour >= 12 && hour < 15) themes = [...THEMES, THEMES[1], THEMES[1]];        // a mediodía, más almuerzos
    if (hour >= 16 && hour < 21) themes = [...THEMES, THEMES[0], THEMES[0]];        // en la tarde, más once
    const theme = pickOf(themes);
    const options = this.destinations(ctx, 2, s => streetPlan(s).shops.some(sh => theme.kinds.includes(sh.kind)));
    if (!options.length) return null;
    const landmarkOnes = options.filter(s => landmarkFor(s));
    const st = landmarkOnes.length && Math.random() < 0.5 ? pickOf(landmarkOnes) : pickOf(options);
    const shop = pickOf(streetPlan(st).shops.filter(sh => theme.kinds.includes(sh.kind)));
    const items = shop.items.filter(i => !theme.tag || i.tag === theme.tag);
    const item = pickOf(items.length ? items : shop.items);
    const buy = theme.tag
      ? { kind: "buy", station: st.name, shop: shop.kind, tag: theme.tag, text: `Compra ${item.name.toLowerCase()} (o algo parecido) en ${shop.name}` }
      : { kind: "buy", station: st.name, shop: shop.kind, item: item.id, text: `Compra ${item.name.toLowerCase()} en ${shop.name}` };
    return this.newMission("compras", SHOPS[shop.kind].icon, theme.title, theme.brief(nice(st.name), shop),
      [this.arriveStep(st), buy], 300 + Math.min(6, this.stops(ctx, st)) * 60);
  }

  makeTourism(ctx) {
    const options = this.destinations(ctx, 1, s => landmarkFor(s));
    if (!options.length) return null;
    const st = pickOf(options), lm = landmarkFor(st);
    return this.newMission("turismo", "📷", `Turismo: ${lm.name}`,
      `Dicen que no conoces Santiago si no has visto ${lm.name}. Viaja a ${nice(st.name)} y sácale una foto.`,
      [this.arriveStep(st), { kind: "photo", station: st.name, text: `Saca una foto de ${lm.name} (E frente al hito)` }],
      900);
  }

  makeDelivery(ctx) {
    const from = ctx.station ? this.byName(ctx.station.name) : null;
    if (!from) return null;
    const options = this.destinations(ctx, 3);
    if (!options.length) return null;
    const to = pickOf(options);
    const kiosk = streetPlan(from).shops.find(s => s.kind === "kiosko");
    const dest = pickOf(streetPlan(to).shops.filter(s => s.kind !== "banco" && s.kind !== "kiosko"));
    return this.newMission("encargo", "📦", "Encargo urgente",
      `${kiosk.name} necesita que alguien lleve un paquete a ${dest.name}, en ${nice(to.name)}. Pagan bien.`,
      [
        { kind: "action", station: from.name, shop: "kiosko", action: "pickup", label: "📦 Retirar el paquete", text: `Retira el paquete en ${kiosk.name} (${nice(from.name)})` },
        this.arriveStep(to),
        { kind: "action", station: to.name, shop: dest.kind, action: "deliver", label: "📦 Entregar el paquete", text: `Entrega el paquete en ${dest.name}` },
      ],
      900 + Math.min(10, this.stops(ctx, to)) * 70);
  }

  makeTimed(ctx) {
    const options = this.destinations(ctx, 3);
    if (!options.length) return null;
    const st = pickOf(options);
    const minutes = Math.ceil(this.stops(ctx, st) * 2.4 + 8);
    return this.newMission("contrarreloj", "⏱️", `Reunión en ${nice(st.name)}`,
      `Tienes una reunión importante cerca de ${nice(st.name)}. Tienes ${minutes} minutos desde que aceptes.`,
      [this.arriveStep(st, { minutes, text: `Llega a ${nice(st.name)} y sal a la calle antes de ${minutes} min` })],
      1000 + minutes * 15);
  }

  makeSaver(ctx) {
    if (fareBandAt(ctx.clock).id === "punta") return null;
    const options = this.destinations(ctx, 2);
    if (!options.length) return null;
    const st = pickOf(options);
    return this.newMission("ahorro", "💰", "Viaje económico",
      `Viaja a ${nice(st.name)} pagando tarifa de horario valle o bajo (evita la hora punta: 07–09 y 18–20 h).`,
      [this.arriveStep(st, { fare: "offpeak", text: `Viaja en Metro a ${nice(st.name)} sin pagar tarifa punta` })],
      700);
  }

  makeWork(ctx) {
    const ends = [this.stations[0], this.stations.at(-1)].filter(s => s.name !== ctx.station?.name);
    const st = pickOf(ends);
    if (!st) return null;
    return this.newMission("trabajo", "🚇", "Turno de conductor",
      `Te toca turno: preséntate en la terminal ${nice(st.name)}. Después juega el modo Conductor para ganar tu sueldo en cada estación.`,
      [this.arriveStep(st, { text: `Preséntate en la terminal ${nice(st.name)} (sal a la calle)` })],
      1000);
  }
}
