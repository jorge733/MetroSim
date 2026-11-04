/* ==========================================================================
   MetroSim — encounters.js
   Encuentros del modo Pasajero: situaciones con otros viajeros que piden una
   decisión, como en un viaje de verdad en el Metro de Santiago.

     · seat     vas sentado, el coche va lleno y sube una persona mayor:
                levántate (F) para cederle el asiento
     · tourist  un turista perdido en el andén pregunta cómo llegar a una
                estación (routeQuiz.js): elige la indicación correcta
     · lost     alguien olvidó una mochila, un celular… en un asiento del
                coche: recógelo (E) y entrégalo en una boletería
     · vendor   un vendedor ambulante entra desde el coche vecino con su
                caja de mercadería y recorre el pasillo pregonando: puedes
                comprarle; al final pasa al coche siguiente o se baja
     · music    un músico entra con su guitarra, acordeón o charango, se
                planta en el pasillo y toca (se oye): puedes darle una moneda
     · faint    un pasajero se siente mal: avísale al conductor por el
                citófono de emergencia (E) y el tren espera en la próxima
                estación a que lo atienda el personal ("control.hold")

   Quien protagoniza el encuentro es uno de los viajeros dibujados
   (people.js), marcado con un ícono flotante; el vendedor y el músico son
   personajes propios (performers.js) que suben solo para eso. Ayudar suma
   civismo (civics.js). Un encuentro a la vez, cada uno o dos minutos.

   Además, los músicos de los andenes y los comerciantes de la mezanina
   (performers.js) atienden con la misma tecla E cuando estás cerca.

   main.js llama a update(dt) en cada fotograma, interact() con la tecla E
   y deliverAtBooth() al abrir la boletería.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, formatCLP, spokenName } from "./config.js";
import { carAt, carLoads } from "./engine/passengers.js";
import { routeQuestion } from "./routeQuiz.js";
import { MusicBox, INSTRUMENTS, STYLES, STALL_ITEMS, dressMusician, dressVendor, musicVolume } from "./performers.js";

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nice = spokenName;

/** Segundos entre encuentros (después de uno) y antes del primero. */
const GAP = [70, 130], FIRST = [25, 45];
/** Distancia (m) a la que se puede interactuar. */
const REACH = { tourist: 2.6, lost: 1.9, vendor: 4, music: 4.5, faint: 3.5 };

/** Objetos olvidados: nombre, recompensa del dueño y aspecto. */
const LOST_ITEMS = [
  { name: "una mochila", reward: 2000, size: [0.32, 0.38, 0.17], color: 0x23344d },
  { name: "un celular", reward: 3000, size: [0.08, 0.015, 0.16], color: 0x111111 },
  { name: "una billetera", reward: 2500, size: [0.11, 0.025, 0.09], color: 0x5a3b22 },
  { name: "un paraguas", reward: 1000, size: [0.06, 0.06, 0.8], color: 0x6e1f2a },
  { name: "una bolsa de compras", reward: 1500, size: [0.28, 0.3, 0.14], color: 0xc7862f },
];
const VENDOR_ITEMS = [
  { name: "Chocolates (3 por $1.000)", price: 1000, bag: "Chocolates de un vendedor del Metro" },
  { name: "Calugas de leche", price: 500, bag: "Calugas de leche" },
  { name: "Pañuelos desechables", price: 500, bag: "Pañuelos desechables" },
  { name: "Cargador de celular", price: 2000, bag: "Cargador de celular" },
];
const VENDOR_LINES = [
  "«¡Buenas tardes! Disculpe la molestia: chocolates, tres por mil…»",
  "«Señores pasajeros, no les quito mucho tiempo: calugas de leche a quinientos…»",
  "«Para el resfrío, pañuelos desechables a quinientos, lleve, lleve…»",
];
/** Coches del tren (coordenadas locales: el coche c va de c·PITCH a c·PITCH + CAR_LEN). */
const T = CONFIG.train, CAR_LEN = T.carLength, PITCH = T.carLength + T.carGap, F = T.floorY;
const carSpan = (car) => [car * PITCH, car * PITCH + CAR_LEN];
/** Extremos del coche con pasillo de intercomunicación (los coches de punta tienen la cabina en un extremo). */
const gangways = (car) => [...(car > 0 ? [carSpan(car)[0] + 0.3] : []), ...(car < T.cars - 1 ? [carSpan(car)[1] - 0.3] : [])];
const TIPS = [{ name: "Darle una moneda", price: 200, pts: 1 }, { name: "Darle $500", price: 500, pts: 2 }, { name: "Darle $1.000", price: 1000, pts: 3 }];
const TOURIST_FROM = ["Brasil", "Argentina", "Perú", "Alemania", "Estados Unidos", "Francia", "Japón", "Colombia"];
const TOURIST_HELLO = ["«Hola, disculpa…", "«Hi! Sorry…", "«Olá! Desculpa…", "«Perdón, ¿me ayudas?"];

/** Ícono flotante sobre quien protagoniza el encuentro. */
const markerCache = new Map();
function marker(symbol, color) {
  const key = symbol + color;
  let tex = markerCache.get(key);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = color;
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.lineWidth = 4; g.strokeStyle = "#0b1118"; g.stroke();
    g.fillStyle = "#0b1118";
    g.font = "bold 38px system-ui, Arial";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(symbol, 32, 35);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    markerCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.setScalar(0.32);
  s.renderOrder = 10;
  return s;
}

export class EncounterSystem {
  /**
   * @param {object} o
   * @param {import("./people.js").PeopleSystem} o.people
   * @param {import("./walker.js").Walker} o.walker
   * @param {import("./engine/engine.js").MetroEngine} o.engine
   * @param {object} o.line        línea activa (la que se dibuja)
   * @param {import("./civics.js").Civics} o.civics
   * @param {object} o.audio
   * @param {(text:string, level?:string, ms?:number) => void} o.say          aviso en el HUD
   * @param {(amount:number, concept:string) => void} o.reward               depósito en la cuenta
   * @param {(amount:number, concept:string, bag?:string) => string|null} o.charge  cobro (devuelve un error o null)
   * @param {(o:object) => void} o.dialog   ventana con opciones (hud.openStore)
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = null;
    this.cooldown = rand(...FIRST);
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.v = new THREE.Vector3();
  }

  /* ----- Consultas ----- */
  alive(p) { return !!p && p.state !== "gone" && this.people.people.includes(p); }

  /** Distancia del jugador a un viajero (en el tren, en coordenadas del coche). */
  dist(p) {
    const w = this.walker;
    if (w.space === "train") return p.space === "train" && p.unit === w.unit ? Math.hypot(p.root.position.x - w.pos.x, p.root.position.z - w.pos.z) : Infinity;
    if (p.space !== "world") return Infinity;
    return Math.hypot(p.root.position.x - w.pos.x, p.root.position.z - w.pos.z) + Math.abs(p.root.position.y - w.pos.y) * 3;
  }

  /** Distancia del jugador al objeto olvidado (los dos en coordenadas del tren). */
  propDist(a) {
    const w = this.walker;
    return w.space === "train" && w.unit === a.unit ? Math.hypot(a.prop.position.x - w.pos.x, a.prop.position.z - w.pos.z) : Infinity;
  }

  /** Viajeros a bordo del coche del jugador, a menos de r metros. */
  inCar(r, filter = () => true) {
    const w = this.walker, car = carAt(w.pos.z);
    return this.people.people.filter(p => p.space === "train" && p.unit === w.unit && p.state === "onboard" && p.slot?.car === car
      && !p.encounter && filter(p) && this.dist(p) < r);
  }

  /** ¿Hay algo con lo que interactuar (E) cerca? (botón "Usar" en pantallas táctiles) */
  near() {
    if (this.walker.frozen) return false;
    return this.nearActive() || !!this.stationPerformer();
  }

  /** ¿Estás al alcance de quien protagoniza el encuentro en curso? */
  nearActive() {
    const a = this.active;
    if (!a || a.done || this.walker.frozen) return false;
    if (a.kind === "lost") return this.propDist(a) < REACH.lost;
    return REACH[a.kind] ? this.alive(a.npc) && this.dist(a.npc) < REACH[a.kind] : false;
  }

  /** Músico del andén o comerciante de la mezanina al alcance (performers.js). */
  stationPerformer() {
    const w = this.walker;
    return w.space === "world" && !w.frozen ? this.performers?.nearest(w.pos) ?? null : null;
  }

  /** Ayuda de controles mientras dura el encuentro. */
  hint() {
    const a = this.active;
    const close = this.nearActive();
    if ((!a || a.done || !close) && a?.kind !== "seat") {
      const sp = this.stationPerformer();
      if (sp) return sp.kind === "musician"
        ? `E · darle una moneda al músico (toca ${STYLES[sp.who.style].name} en ${sp.who.inst.label})`
        : "E · ver lo que vende el comerciante ambulante";
    }
    if (!a || a.done) return null;
    if (a.kind === "seat") return "F · levantarte y cederle el asiento a la persona mayor";
    const what = { tourist: "orientar al turista", lost: `recoger ${a.item?.name}`, vendor: "comprarle al vendedor", music: "darle una moneda al músico", faint: "usar el citófono de emergencia" }[a.kind];
    return close ? `E · ${what}` : `Acércate al ícono ${a.symbol} para ${what}`;
  }

  /* ----- Paso por fotograma ----- */
  update(dt) {
    const a = this.active;
    if (a) {
      if (a.marker) a.marker.position.y = (a.markerY ?? 2.05) + Math.sin(performance.now() / 260) * 0.05;
      a.until -= dt;
      this.tick(a, dt);
      return;
    }
    if (this.walker.frozen) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = rand(6, 12);                       // si nada sirve ahora, se vuelve a intentar pronto
    const options = this.eligible();
    if (!options.length) return;
    const total = options.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    const choice = options.find(x => (r -= x.w) <= 0) || options.at(-1);
    if (choice.start()) this.cooldown = rand(...GAP);
  }

  /** Encuentros posibles ahora mismo, con su peso. */
  eligible() {
    const w = this.walker, out = [];
    if (w.space === "train") {
      const u = w.unit, sim = u.sim;
      const docked = sim.isStopped && sim.dockedStation() && sim.doorState === "open";
      const moving = sim.speed > 4;
      const next = sim.nextStation();
      const car = carAt(w.pos.z);
      if (docked && w.seat?.place?.type === "seat") {
        const seats = u.slots.filter(s => s.type === "seat" && s.car === car).length;
        if (carLoads(u)[car] >= seats * 0.9 && this.inCar(6, p => p.slot.type === "stand").length) out.push({ w: 4, start: () => this.startSeat() });
      }
      if (!this.civics.carrying && u.slots.some(s => s.type === "seat" && s.car === car && !s.occupant)) out.push({ w: 2, start: () => this.startLost() });
      if (moving && this.inCar(9).length) {
        out.push({ w: 2, start: () => this.startVendor() });
        out.push({ w: 1.5, start: () => this.startMusic() });
        if (next && next !== u.route.last && !u.ato?.outOfService && u.ato) out.push({ w: 1, start: () => this.startFaint() });
      }
    } else if (w.space === "world" && this.touristCandidates().length) {
      out.push({ w: 4, start: () => this.startTourist() });
    }
    return out;
  }

  tick(a, dt) {
    const w = this.walker;
    // Quien protagoniza mira al jugador cuando está cerca
    if (a.npc && this.alive(a.npc) && !a.done && this.dist(a.npc) < 6) {
      const p = a.npc.root.position;
      a.npc.targetYaw = Math.atan2(w.pos.x - p.x, w.pos.z - p.z);
    }
    switch (a.kind) {
      case "seat": {
        if (!this.alive(a.npc) || w.unit !== a.unit) return this.end();
        if (!w.seat) {
          // Te levantaste: la persona mayor se sienta en tu lugar
          const seat = a.seat;
          if (!seat.occupant) {
            const p = a.npc;
            if (p.slot && p.slot.occupant === p) p.slot.occupant = null;
            p.slot = seat;
            seat.occupant = p;
            this.people.settleInSlot(p);
          }
          this.help(6, "seat", "«¡Muchas gracias, qué amable!» · le cediste el asiento");
          return this.end();
        }
        if (a.until <= 0) { this.say("La persona mayor sigue de pie, afirmada de la barra…", "info", 3500); return this.end(); }
        return;
      }
      case "tourist":
        if (!this.alive(a.npc) || (a.until <= 0 && !a.talking)) return this.end();
        return;
      case "lost":
        if (w.unit !== a.unit || a.until <= 0) return this.end();
        return;
      case "vendor": return this.tickVendor(a, dt);
      case "music": return this.tickMusic(a, dt);
      case "faint": {
        if (!this.alive(a.npc) || w.unit !== a.unit) return this.end();
        if (a.until <= 0) {
          this.say("Otro pasajero avisó por el citófono: en la próxima estación lo atenderá personal de Metro", "info", 4500);
          this.callHelp(a, false);
          return this.end();
        }
        return;
      }
    }
  }

  /* ----- Comienzo de cada encuentro ----- */
  begin(kind, npc, symbol, color, extra = {}) {
    const m = marker(symbol, color);
    const a = { kind, npc, symbol, until: 60, total: 60, marker: m, ...extra };
    a.total = a.until;
    if (npc) { npc.encounter = kind; npc.root.add(m); m.position.set(0, a.markerY ?? 2.05, 0); }
    this.active = a;
    this.audio?.tone?.(880, { duration: 0.09, gain: 0.05 });
    return a;
  }

  startSeat() {
    const w = this.walker;
    if (w.space !== "train" || w.seat?.place?.type !== "seat") return false;
    const npc = this.inCar(6, p => p.slot.type === "stand").sort((x, y) => this.dist(x) - this.dist(y))[0];
    if (!npc) return false;
    // Pelo canoso: es una persona mayor
    for (const part of npc.mesh.parts) if (part.kind === "hair") part.color = new THREE.Color(0xd9d9d9);
    this.begin("seat", npc, "!", "#ffc247", { unit: w.unit, seat: w.seat.place, until: 35 });
    this.say("Subió una persona mayor y no quedan asientos libres: pulsa F para levantarte y cederle el tuyo", "warn", 6500);
    return true;
  }

  touristCandidates() {
    const w = this.walker;
    const st = w.stationAt(w.pos.z);
    if (!st) return [];
    return this.people.people.filter(p => p.space === "world" && p.state === "waiting" && !p.spot?.bench && !p.encounter && p.station === st
      && Math.abs(p.root.position.y - w.pos.y) < 1 && this.dist(p) > 3 && this.dist(p) < 28);
  }

  startTourist() {
    const w = this.walker;
    const npc = pick(this.touristCandidates());
    const st = w.stationAt(w.pos.z);
    const here = this.line.stations.find(s => s.name === st?.name);
    if (!npc || !here) return false;
    npc.state = "chatting";                           // no sube a ningún tren mientras te pregunta
    const q = routeQuestion(this.line, here);
    this.begin("tourist", npc, "?", "#5cc8ff", { q, until: 150, from: pick(TOURIST_FROM) });
    this.say("Un turista parece perdido en el andén: busca el ícono «?», acércate y pulsa E", "info", 5500);
    return true;
  }

  startLost() {
    const w = this.walker, u = w.unit, car = carAt(w.pos.z);
    const seats = u.slots.filter(s => s.type === "seat" && s.car === car && !s.occupant);
    if (!seats.length) return false;
    const seat = seats.sort((x, y) => Math.abs(x.pos.z - w.pos.z) - Math.abs(y.pos.z - w.pos.z))[Math.min(seats.length - 1, Math.floor(Math.random() * 3))];
    const item = pick(LOST_ITEMS);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(...item.size), new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.7 }));
    prop.position.set(seat.pos.x, seat.seatY + item.size[1] / 2 + 0.02, seat.pos.z);
    u.group.add(prop);
    seat.occupant = prop;                              // nadie se sienta encima
    const a = this.begin("lost", null, "!", "#ffd166", { unit: u, seat, prop, item, until: 600 });
    prop.add(a.marker);
    a.markerY = 0.55;
    this.say(`Alguien olvidó ${item.name} en un asiento del coche ${car + 1}: recógela (E) y entrégala en una boletería`, "info", 6000);
    return true;
  }

  /**
   * Personaje que entra al coche del jugador desde el coche vecino (pasillo de
   * intercomunicación) para vender o tocar. Es un viajero más de people.js,
   * pero con estado "performer": no ocupa plaza ni se baja con los demás.
   */
  boardPerformer() {
    const w = this.walker, u = w.unit, car = carAt(w.pos.z);
    const ends = gangways(car);
    if (!ends.length) return null;
    const from = pick(ends);
    const st = (u.sim.nextStation() ?? u.route.last).world;
    const p = this.people.newPerson(st, u.route.side);
    p.state = "performer";
    p.root.removeFromParent();
    u.group.add(p.root);
    p.space = "train"; p.unit = u;
    p.root.position.set(0, F, from);
    p.root.rotation.y = p.targetYaw = from > (carSpan(car)[0] + carSpan(car)[1]) / 2 ? Math.PI : 0;
    return { p, car, from };
  }

  startVendor() {
    const b = this.boardPerformer();
    if (!b) return false;
    const { p: npc, car, from } = b;
    dressVendor(npc);
    // Recorre el coche hasta el otro extremo, parando cada pocos metros a pregonar
    const [z0, z1] = carSpan(car), dir = from < (z0 + z1) / 2 ? 1 : -1;
    const stops = [];
    for (let z = from + dir * 3.5; dir > 0 ? z < z1 - 1.5 : z > z0 + 1.5; z += dir * rand(3.5, 5)) stops.push(z);
    const out = gangways(car).find(g => Math.abs(g - from) > 3) ?? null;     // ¿hay coche vecino al otro lado?
    this.begin("vendor", npc, "$", "#34d17c", { unit: this.walker.unit, until: 100, stops, out, pauseT: 0.6, shoutT: 2, markerY: 2.15 });
    const line = pick(VENDOR_LINES);
    this.say(`📢 Un vendedor ambulante entra al coche con su caja: ${line} · E para comprarle`, "info", 6000);
    this.audio?.shout?.(line.replace(/[«»…]/g, ""));
    return true;
  }

  startMusic() {
    const b = this.boardPerformer();
    if (!b) return false;
    const { p: npc, car, from } = b;
    const instrument = pick(Object.keys(INSTRUMENTS)), inst = INSTRUMENTS[instrument];
    const style = pick(inst.styles);
    dressMusician(npc, instrument);
    npc.performer.playing = false;
    // Se planta en el pasillo, cerca del centro del coche
    const [z0, z1] = carSpan(car), mid = (z0 + z1) / 2;
    const a = this.begin("music", npc, "♪", "#ff7ad9", { unit: this.walker.unit, until: 95, style, instrument, inst, box: new MusicBox(this.audio, instrument, style) });
    this.people.walk(npc, [this.v.set(0, F, mid + (from < mid ? -1 : 1) * rand(1, 3)).clone()], () => {
      npc.performer.playing = true;
      a.playing = true;
    });
    this.say(`🎶 Un músico entra al coche con su ${inst.label} y toca ${STYLES[style].name} · si te gusta, acércate (E) y dale una moneda`, "info", 6000);
    return true;
  }

  /** Vendedor del coche: avanza de parada en parada; al terminar pasa al coche siguiente o se baja en la estación. */
  tickVendor(a, dt) {
    const w = this.walker, p = a.npc;
    if (!this.alive(p) || w.unit !== a.unit) return this.end();
    if (p.state !== "performer") return this.end();
    if (a.talking) {
      if (p.path.length) { p.path.length = 0; p.pose = "stand"; if (a.target != null) a.stops.unshift(a.target); }
      return;
    }
    const sim = a.unit.sim, docked = sim.isStopped && sim.dockedStation() && sim.doorState === "open";
    if (!p.path.length) {
      a.pauseT -= dt;
      a.shoutT -= dt;
      if (a.shoutT <= 0 && this.dist(p) < 9) { a.shoutT = rand(12, 18); this.audio?.shout?.(pick(VENDOR_LINES).replace(/[«»…]/g, "")); }
      if (a.pauseT <= 0 && a.stops.length) {
        a.target = a.stops.shift();
        this.people.walk(p, [this.v.set(0, F, a.target).clone()], () => { a.target = null; a.pauseT = rand(5, 8); });
      } else if (a.pauseT <= 0) a.traversed = true;
    }
    if (a.traversed && a.out !== null) { this.say("El vendedor pasó al coche siguiente", "info", 3000); return this.end(); }
    if (docked && (a.traversed || a.until <= 0) && a.until < a.total - 15) { this.say("El vendedor se bajó en la estación", "info", 3000); return this.end(); }
    if (a.until <= -90) return this.end();
  }

  /** Músico del coche: toca mientras viaja y se baja en la próxima estación (si ya tocó un rato). */
  tickMusic(a) {
    const w = this.walker, p = a.npc;
    if (!this.alive(p) || w.unit !== a.unit || p.state !== "performer") return this.end();
    const sim = a.unit.sim, docked = sim.isStopped && sim.dockedStation() && sim.doorState === "open";
    if (!a.talking && docked && (a.until < a.total - 25 || a.until <= 0)) {
      this.say("El músico terminó su tema, agradeció y se bajó en la estación", "info", 3000);
      return this.end();
    }
    if (!a.talking && a.until <= -60) return this.end();
    if (a.playing) a.box.play(musicVolume(this.dist(p)));
  }

  /** El vendedor o el músico se va: por la puerta si el tren está abierto, si no al coche vecino. */
  dismiss(a) {
    const p = a.npc, u = a.unit;
    if (!this.alive(p) || p.state !== "performer" || p.space !== "train") return;
    if (p.performer) p.performer.playing = false;
    const docked = u.sim.isStopped && u.sim.dockedStation();
    if (docked && this.people.leaveTrain(p, u, docked.world)) return;
    const car = carAt(p.root.position.z), z = p.root.position.z;
    const out = gangways(car).sort((x, y) => Math.abs(x - z) - Math.abs(y - z))[0];
    if (out === undefined) return this.people.remove(p);
    this.people.walk(p, [this.v.set(0, F, out).clone()], () => this.people.remove(p));
  }

  startFaint() {
    const npc = this.inCar(9).sort((x, y) => this.dist(x) - this.dist(y))[0];
    if (!npc) return false;
    this.begin("faint", npc, "+", "#ff4d4d", { unit: this.walker.unit, until: 35, markerY: npc.pose === "sit" ? 1.6 : 2.05 });
    this.say("¡Un pasajero se siente mal cerca de ti! Acércate (E) y usa el citófono de emergencia para avisar al conductor", "alert", 7000);
    return true;
  }

  /* ----- Tecla E ----- */
  /** @returns {boolean} si la tecla la usó un encuentro */
  interact() {
    const a = this.active;
    if (!a || a.done || !this.nearActive()) {
      const sp = this.stationPerformer();
      if (!sp) return false;
      if (sp.kind === "musician") this.tipStationMusician(sp.site);
      else this.buyFromStall(sp.site);
      return true;
    }
    switch (a.kind) {
      case "tourist": return this.askTourist(a), true;
      case "lost": {
        this.civics.setCarrying({ name: a.item.name, reward: a.item.reward });
        this.say(`Recogiste ${a.item.name}. Entrégala en cualquier boletería (E en la ventanilla) para que se la devuelvan a su dueño`, "ok", 6000);
        this.end();
        return true;
      }
      case "vendor":
        a.talking = true;
        this.dialog({
          icon: "🍫", kicker: "Vendedor ambulante", title: "«¿Qué va a llevar?»", status: "El comercio ambulante está prohibido en el Metro, pero igual pasa…",
          items: () => VENDOR_ITEMS,
          onBuy: async (item) => {
            const err = this.charge(item.price, `Vendedor del Metro · ${item.name}`, item.bag);
            if (err) throw new Error(err);
            return `Compraste ${item.name.toLowerCase()} · «¡Gracias, que le vaya bien!»`;
          },
          onClose: () => { a.talking = false; a.pauseT = Math.max(a.pauseT, 2); },
        });
        return true;
      case "music":
        a.talking = true;
        this.dialog({
          icon: a.inst.icon, kicker: "Músico del Metro", title: `Toca ${STYLES[a.style].name} en ${a.inst.label}`, status: "Una moneda ayuda a que siga la música",
          items: () => a.paid ? [] : TIPS,
          onBuy: async (item) => {
            const err = this.charge(item.price, "Moneda a un músico del Metro");
            if (err) throw new Error(err);
            a.paid = true;
            this.help(item.pts, "music", null);
            return `«¡Gracias, amigo! Un aplauso para el público» · +${item.pts} civismo`;
          },
          onClose: () => { a.talking = false; },
        });
        return true;
      case "faint":
        this.callHelp(a, true);
        this.end();
        return true;
    }
    return false;
  }

  /** Músico de un andén: moneda (una vez por músico) y, después, pedirle otra canción. */
  tipStationMusician(site) {
    const m = site.musician;
    this.dialog({
      icon: m.inst.icon, kicker: "Músico en el andén",
      title: `Toca ${STYLES[m.style].name} en ${m.inst.label}`,
      status: m.paid ? "Ya le diste una moneda: puedes pedirle otro tema" : "Una moneda en el estuche ayuda a que siga la música",
      items: () => m.paid ? [{ name: "Pedirle otra canción", action: true, tag: "pedir", request: true }] : TIPS,
      onBuy: async (item) => {
        if (item.request) return `«¡Va, ahora una de ${this.performers.request(site).replace(/^(una?|un) /, "")}!»`;
        const err = this.charge(item.price, "Moneda a un músico del Metro");
        if (err) throw new Error(err);
        this.performers.tip(site);
        this.help(item.pts, "music", null);
        return `La moneda suena en el estuche · «¡Gracias! ¿Le toco otra?» · +${item.pts} civismo`;
      },
    });
  }

  /** Paño de un comerciante en la mezanina. */
  buyFromStall(site) {
    const v = site.vendor;
    v.talking = true;
    this.dialog({
      icon: "🧺", kicker: "Comerciante ambulante", title: "«¡Pase, vea, sin compromiso!»",
      status: "Está prohibido vender en el Metro: si llegan los guardias, se va con todo",
      items: () => STALL_ITEMS,
      onBuy: async (item) => {
        const err = this.charge(item.price, `Comerciante ambulante · ${item.name}`, item.bag);
        if (err) throw new Error(err);
        return `Compraste ${item.name.toLowerCase()} · «¡Gracias, casero, que le vaya bonito!»`;
      },
      onClose: () => { v.talking = false; },
    });
  }

  askTourist(a) {
    a.talking = true;
    this.dialog({
      icon: "🧳", kicker: `Turista de ${a.from}`, title: `${pick(TOURIST_HELLO)} ¿cómo llego a ${nice(a.q.dest.name)}?»`,
      status: `Estás en ${nice(this.walker.stationAt(this.walker.pos.z)?.name ?? "")}. Elige la indicación correcta.`,
      items: () => a.answered ? [] : a.q.options.map(o => ({ name: o.text, action: true, tag: "indicar", opt: o })),
      onBuy: async (item) => {
        a.answered = true;
        a.npc.state = "waiting";                        // ya puede seguir su viaje
        if (item.opt.correct) {
          const tip = Math.round(rand(8, 15)) * 100;
          this.reward(tip, `Propina de un turista de ${a.from}`);
          this.help(5, "tourist", null);
          return `«¡Muchas gracias!» Te deja una propina de ${formatCLP(tip)} · +5 civismo. ${a.q.explain}`;
        }
        this.civics.add(-2);
        return `El turista se fue por el camino equivocado… Lo correcto era: ${a.q.answer}. ${a.q.explain} · −2 civismo`;
      },
      onClose: () => {
        a.talking = false;
        if (!a.answered) return;                        // cerró sin responder: puede volver a preguntarle
        this.end();
      },
    });
  }

  /** Aviso por el citófono: el tren espera en la próxima estación y el pasajero baja ahí. */
  callHelp(a, byPlayer) {
    const u = a.unit, next = u.sim.nextStation();
    if (!next) return;
    a.npc.dest = next.world.index;
    this.engine.command("control.hold", { trainId: u.id, seconds: 40, source: "pasajero" });
    if (!byPlayer) return;
    const text = `Recibido. En ${nice(next.name)} subirá personal de Metro a atender al pasajero; el tren esperará unos segundos.`;
    this.audio?.radio?.(text);
    this.help(8, "faint", `📞 Citófono: «${text}»`);
  }

  /** Objeto olvidado entregado en la boletería (texto del aviso) o null si no llevas nada. */
  deliverAtBooth() {
    const item = this.civics.carrying;
    if (!item) return null;
    this.civics.setCarrying(null);
    this.reward(item.reward, `Recompensa por devolver ${item.name}`);
    this.help(10, "lost", null);
    return `Entregaste ${item.name} en la boletería: «Gracias, lo vamos a devolver a su dueño». El dueño te deja ${formatCLP(item.reward)} de recompensa · +10 civismo`;
  }

  /** Suma civismo y avisa (también del premio de un nivel nuevo). */
  help(points, kind, text) {
    const r = this.civics.add(points, kind);
    if (text) this.say(`${text} · +${points} civismo`, "ok", 5000);
    if (r.levelUp) {
      this.reward(r.levelUp.reward, `Nivel de civismo: ${r.levelUp.name}`);
      setTimeout(() => this.say(`🏅 ¡Subiste de nivel de civismo: ${r.levelUp.name}! Premio ${formatCLP(r.levelUp.reward)}`, "ok", 6000), 2500);
    }
  }

  end() {
    const a = this.active;
    if (!a) return;
    a.done = true;
    a.marker?.removeFromParent();
    if (a.npc) {
      a.npc.encounter = null;
      if (a.npc.state === "chatting") a.npc.state = "waiting";
    }
    if (a.kind === "vendor" || a.kind === "music") this.dismiss(a);
    if (a.kind === "lost") {
      a.prop.removeFromParent();
      a.prop.geometry.dispose();
      a.prop.material.dispose();
      if (a.seat.occupant === a.prop) a.seat.occupant = null;
    }
    this.active = null;
  }

  destroy() { this.end(); }
}
