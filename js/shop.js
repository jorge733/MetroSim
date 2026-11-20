/* ==========================================================================
   MetroSim — shop.js
   TIENDA REDMOVI: en qué gastar lo que ganas (sin Three.js).

   Pensada para que convenga jugar el modo Conductor (ahí se gana el sueldo)
   y para tener metas caras a las que juntar dinero:
     · CONDUCTOR   licencias para conducir otras líneas, libreas (colores)
                   para tu tren y contratos que suben el sueldo para siempre.
     · MI DEPTO    un departamento propio que vas amoblando pieza por pieza
                   (living, dormitorio, cocina), pintando y mejorando con
                   mudanzas a barrios con mejor vista.
     · COLECCIÓN   un recuerdo de cada estación, que solo se compra en el
                   kiosko de su calle (modo Pasajero). Completar el álbum de
                   una línea paga un premio.

   Todo se paga con la cuenta bancaria del juego (economy.js) y lo comprado
   se guarda en el navegador (localStorage), compartido entre los modos.
   La interfaz está en shopUI.js.
   ========================================================================== */

import { LINES, lineById } from "./engine/network.js";
import { formatCLP, lineLabel, lineArticle } from "./config.js";
import { isCreator } from "./creator.js";

const KEY = "metrosim.owned";

/** Línea que se puede conducir desde el principio (sin licencia). */
export const FREE_LINE = "3";

/** Licencias de conductor: una por línea (salvo la gratuita). */
const LICENSE_PRICE = { "1": 30000, "2": 20000, "4": 25000, "4A": 12000, "5": 25000, "6": 15000, "NOS": 18000, "RAN": 25000 };
export const LICENSES = LINES.filter(l => l.id !== FREE_LINE && !l.bonus).map(l => ({
  id: `license-${l.id}`, lineId: l.id, kind: "license", icon: "🪪",
  name: `Licencia ${lineLabel(l.id)}`,
  desc: `Habilita el modo Conductor en ${lineArticle(l.id)} ${lineLabel(l.id)} (${l.stations[0].short} ⇄ ${l.stations.at(-1).short}, ${l.stations.length} estaciones).`,
  price: LICENSE_PRICE[l.id] ?? 20000, color: l.color,
}));

/** Libreas de tu tren (color de la carrocería y de la franja). null = la de siempre. */
export const LIVERIES = [
  { id: "livery-clasica", kind: "livery", icon: "🚇", name: "Clásica", desc: "Acero inoxidable con la franja del color de la línea.", price: 0, body: null, stripe: null },
  { id: "livery-plata", kind: "livery", icon: "🚇", name: "Plata y rojo", desc: "Como los primeros trenes del Metro de Santiago: plata con franja roja.", price: 8000, body: 0xdfe3e6, stripe: 0xd42026 },
  { id: "livery-noche", kind: "livery", icon: "🌙", name: "Azul noche", desc: "Carrocería azul profundo con franja celeste.", price: 15000, body: 0x1d2f55, stripe: 0x4fd6ff },
  { id: "livery-cordillera", kind: "livery", icon: "🏔️", name: "Verde cordillera", desc: "Verde bosque con franja blanca, como la nieve de los Andes.", price: 15000, body: 0x2f6b45, stripe: 0xf2f4f2 },
  { id: "livery-metro", kind: "livery", icon: "🔴", name: "Rojo Metro", desc: "Rojo corporativo con franja blanca. Imposible no verlo llegar.", price: 20000, body: 0xc4262e, stripe: 0xffffff },
  { id: "livery-celeste", kind: "livery", icon: "🩵", name: "Celeste cielo", desc: "Celeste claro con franja azul marino, como un día despejado en Santiago.", price: 12000, body: 0x9fd3ef, stripe: 0x1d4f91 },
  { id: "livery-atardecer", kind: "livery", icon: "🌇", name: "Atardecer", desc: "Naranjo con franja morada, el color del cerro cuando se pone el sol.", price: 25000, body: 0xe8743b, stripe: 0x6a2c70 },
  { id: "livery-carbon", kind: "livery", icon: "🖤", name: "Carbón y oro", desc: "Negro mate con franja dorada. Elegante a cualquier hora.", price: 35000, body: 0x24272b, stripe: 0xffc247, metal: 0.6 },
  { id: "livery-dorada", kind: "livery", icon: "✨", name: "Dorada aniversario", desc: "Edición especial dorada con franja negra. Para conductores de elite.", price: 50000, body: 0xc9a13b, stripe: 0x15181b, metal: 0.85 },
];

/** Contratos: suben el sueldo de conductor para siempre (el mejor que tengas). */
export const CONTRACTS = [
  { id: "contract-senior", kind: "contract", icon: "📈", name: "Conductor Senior", desc: "+25 % de sueldo en cada estación y en el bono de fin de servicio.", price: 40000, mult: 1.25 },
  { id: "contract-jefe", kind: "contract", icon: "🎖️", name: "Jefe de Tren", desc: "+60 % de sueldo en cada estación y en el bono de fin de servicio. Requiere ser Conductor Senior.", price: 120000, mult: 1.6, requires: "contract-senior" },
  { id: "contract-inspector", kind: "contract", icon: "🏅", name: "Inspector de Red", desc: "×2 de sueldo en cada estación y en el bono de fin de servicio. Requiere ser Jefe de Tren.", price: 300000, mult: 2, requires: "contract-jefe" },
];

/**
 * Mi depto: primero el departamento, después los muebles, pieza por pieza.
 * Las mudanzas (HOME_LEVELS) cambian la vista de la ventana y el piso; las
 * pinturas (PAINTS) el color de los muros. x, y (0..1) es dónde se dibuja
 * cada mueble en la ilustración de su pieza (shopUI.js); `shape` son los que
 * se dibujan a mano en vez de con emoji.
 */
export const HOME = { id: "home-depto", kind: "home", icon: "🏠", name: "Departamento en Ñuñoa", short: "Ñuñoa", desc: "Un depto de un dormitorio a pasos del Metro. Llega vacío: amóblalo a tu gusto.", price: 60000, level: 0 };
export const HOME_LEVELS = [
  HOME,
  { id: "home-providencia", kind: "homeUpgrade", icon: "🏢", name: "Depto en Providencia", short: "Providencia", desc: "Te cambias a un piso 14 con ventanal hacia los edificios y la Torre. Los muebles se van contigo.", price: 150000, level: 1, requires: HOME.id },
  { id: "home-lascondes", kind: "homeUpgrade", icon: "🌄", name: "Penthouse en Las Condes", short: "Las Condes", desc: "Ventanal de muro a muro con la cordillera nevada y piso de porcelanato. La meta de los conductores de elite.", price: 400000, level: 2, requires: "home-providencia" },
];

/** Pintura de los muros. La primera viene con el depto. */
export const PAINTS = [
  { id: "paint-crema", kind: "paint", icon: "🎨", name: "Crema", desc: "El color con que te entregan el depto.", price: 0, top: "#f1e6d2", bottom: "#e3d3b8" },
  { id: "paint-celeste", kind: "paint", icon: "🎨", name: "Celeste", desc: "Fresco y luminoso.", price: 3000, top: "#d9ecf5", bottom: "#bcd8e6" },
  { id: "paint-salvia", kind: "paint", icon: "🎨", name: "Verde salvia", desc: "Tranquilo, combina con las plantas.", price: 4000, top: "#d6e2cf", bottom: "#b9c9ae" },
  { id: "paint-terracota", kind: "paint", icon: "🎨", name: "Terracota", desc: "Cálido, como las casas antiguas de Santiago.", price: 5000, top: "#e7b896", bottom: "#d09673" },
  { id: "paint-grafito", kind: "paint", icon: "🎨", name: "Gris grafito", desc: "Moderno y sobrio.", price: 6000, top: "#8d939b", bottom: "#737a83" },
  { id: "paint-rayas", kind: "paint", icon: "🧻", name: "Papel mural de rayas", desc: "Rayas verticales, estilo departamento antiguo del centro.", price: 9000, top: "#efe2c6", bottom: "#e0cfa8", pattern: "rayas", ink: "#d2b98a" },
  { id: "paint-ladrillo", kind: "paint", icon: "🧱", name: "Muro de ladrillo", desc: "Ladrillo a la vista, como un loft de Barrio Italia.", price: 12000, top: "#b5634b", bottom: "#9c5240", pattern: "ladrillo", ink: "#e8d5c4" },
];

/** Las piezas del depto (premio la primera vez que dejas una completa). */
export const ROOMS = [
  { id: "living", icon: "🛋️", name: "Living", article: "el" },
  { id: "dormitorio", icon: "🛏️", name: "Dormitorio", article: "el" },
  { id: "cocina", icon: "🍳", name: "Cocina", article: "la" },
];
export const ROOM_REWARD = 12000;

export const FURNITURE = [
  // Living
  { id: "f-alfombra", room: "living", icon: "🟫", name: "Alfombra", desc: "Una alfombra burdeo para el living.", price: 6000, x: 0.5, y: 0.87, size: 1.0, shape: "rug" },
  { id: "f-sofa", room: "living", icon: "🛋️", name: "Sofá", desc: "Para descansar después de un servicio largo.", price: 15000, x: 0.28, y: 0.74, size: 1.6 },
  { id: "f-tv", room: "living", icon: "📺", name: "Televisor", desc: "Para ver las noticias del Metro.", price: 25000, x: 0.74, y: 0.6, size: 1.2 },
  { id: "f-lampara", room: "living", icon: "💡", name: "Lámpara de pie", desc: "Da luz cálida en la noche.", price: 4000, x: 0.07, y: 0.62, size: 1.0, light: true },
  { id: "f-planta", room: "living", icon: "🪴", name: "Planta", desc: "Un poco de verde junto a la ventana.", price: 3000, x: 0.94, y: 0.72, size: 1.1 },
  { id: "f-estante", room: "living", icon: "📚", name: "Estantería con libros", desc: "Novelas, mapas y manuales de conducción.", price: 8000, x: 0.9, y: 0.42, size: 1.2 },
  { id: "f-cuadro", room: "living", icon: "🖼️", name: "Cuadro de la cordillera", desc: "Los Andes nevados, enmarcados.", price: 10000, x: 0.13, y: 0.28, size: 1.1 },
  { id: "f-poster", room: "living", icon: "🗺️", name: "Póster del plano del Metro", desc: "Todas las líneas, para planear el próximo viaje.", price: 5000, x: 0.3, y: 0.26, size: 0.9 },
  { id: "f-maqueta", room: "living", icon: "🚆", name: "Maqueta del tren AS-2014", desc: "Escala 1:87, con luces que se encienden.", price: 30000, x: 0.53, y: 0.66, size: 0.85 },
  { id: "f-consola", room: "living", icon: "🎮", name: "Consola de videojuegos", desc: "Para jugar a conducir trenes… en tu día libre.", price: 22000, x: 0.66, y: 0.8, size: 0.7 },
  { id: "f-radio", room: "living", icon: "📻", name: "Radio antigua", desc: "Música de los 80 mientras ordenas.", price: 7000, x: 0.83, y: 0.66, size: 0.7 },
  { id: "f-perro", room: "living", icon: "🐕", name: "Perro adoptado", desc: "Te espera en la puerta cada vez que vuelves del turno.", price: 18000, x: 0.44, y: 0.88, size: 0.85 },
  // Dormitorio
  { id: "f-cama", room: "dormitorio", icon: "🛏️", name: "Cama", desc: "Dos plazas, con plumón.", price: 12000, x: 0.42, y: 0.74, size: 1.9 },
  { id: "f-ropero", room: "dormitorio", icon: "🚪", name: "Ropero", desc: "Para guardar los uniformes.", price: 14000, x: 0.88, y: 0.5, size: 1.0, shape: "closet" },
  { id: "f-despertador", room: "dormitorio", icon: "⏰", name: "Velador con despertador", desc: "Para no llegar tarde al primer tren de las 6:00.", price: 4000, x: 0.66, y: 0.66, size: 0.6, light: true },
  { id: "f-escritorio", room: "dormitorio", icon: "🖥️", name: "Escritorio con computador", desc: "Para revisar los horarios de mañana.", price: 28000, x: 0.69, y: 0.48, size: 0.9, shape: "desk" },
  { id: "f-guitarra", room: "dormitorio", icon: "🎸", name: "Guitarra", desc: "Para sacar canciones en el tiempo libre.", price: 11000, x: 0.06, y: 0.72, size: 1.0 },
  { id: "f-espejo", room: "dormitorio", icon: "🪞", name: "Espejo", desc: "Para salir impecable al turno.", price: 5000, x: 0.5, y: 0.3, size: 0.9 },
  { id: "f-gato", room: "dormitorio", icon: "🐈", name: "Gato adoptado", desc: "Duerme a los pies de la cama.", price: 15000, x: 0.3, y: 0.89, size: 0.75 },
  { id: "f-bicicleta", room: "dormitorio", icon: "🚲", name: "Bicicleta", desc: "Para llegar a la estación los domingos.", price: 16000, x: 0.66, y: 0.86, size: 1.0 },
  // Cocina
  { id: "f-refri", room: "cocina", icon: "🧊", name: "Refrigerador", desc: "Grande, con dispensador de agua fría.", price: 26000, x: 0.1, y: 0.42, size: 1.0, shape: "fridge" },
  { id: "f-cocina", room: "cocina", icon: "🍳", name: "Cocina con horno", desc: "Cuatro platos y horno para las empanadas del domingo.", price: 20000, x: 0.76, y: 0.5, size: 1.0, shape: "stove" },
  { id: "f-mesa", room: "cocina", icon: "🪑", name: "Mesa y sillas", desc: "Comedor para cuatro.", price: 9000, x: 0.48, y: 0.84, size: 1.3, shape: "table" },
  { id: "f-cafetera", room: "cocina", icon: "☕", name: "Cafetera", desc: "El primer café antes del turno de la mañana.", price: 7000, x: 0.3, y: 0.47, size: 0.6 },
  { id: "f-hervidor", room: "cocina", icon: "🫖", name: "Tetera", desc: "Para la once con pan amasado.", price: 3000, x: 0.6, y: 0.47, size: 0.55 },
  { id: "f-frutero", room: "cocina", icon: "🍇", name: "Frutero", desc: "Uvas, duraznos y chirimoyas de la feria.", price: 2500, x: 0.48, y: 0.72, size: 0.5 },
  { id: "f-hierbas", room: "cocina", icon: "🌿", name: "Hierbas en la ventana", desc: "Albahaca, cilantro y menta.", price: 3500, x: 0.47, y: 0.33, size: 0.5 },
  { id: "f-reloj", room: "cocina", icon: "🕰️", name: "Reloj de pared", desc: "Siempre a la hora, como el Metro.", price: 6000, x: 0.9, y: 0.2, size: 0.7 },
].map(f => ({ ...f, kind: "furniture" }));

/** Recuerdo de una estación (solo en el kiosko de su calle). */
export const SOUVENIR_PRICE = 1500, ALBUM_REWARD = 10000;
export const souvenirId = (lineId, stationName) => `souvenir-${lineId}-${stationName}`;

/** Inventario del jugador: lo comprado y la librea elegida. */
export class Inventory {
  constructor() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* sin almacenamiento */ }
    this.owned = new Set(s?.owned ?? []);
    this.livery = s?.livery ?? "livery-clasica";
    this.albums = new Set(s?.albums ?? []);       // líneas con el álbum de recuerdos completo (premio cobrado)
    this.paint = s?.paint ?? PAINTS[0].id;          // 2.24 · pintura de los muros del depto
    this.rooms = new Set(s?.rooms ?? []);           // 2.24 · piezas completas (premio cobrado)
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ owned: [...this.owned], livery: this.livery, albums: [...this.albums], paint: this.paint, rooms: [...this.rooms] })); } catch { /* sin almacenamiento */ }
  }

  /** ¿Lo tiene? En Modo Creador, todo. */
  has(id) { return isCreator() || this.owned.has(id) || id === "livery-clasica" || id === PAINTS[0].id; }

  /**
   * Compra con la cuenta. Devuelve { ok, text }.
   * @param {object} item  del catálogo (id, name, price)
   * @param {import("./economy.js").BankAccount} bank
   */
  buy(item, bank) {
    if (this.has(item.id)) return { ok: false, text: "Ya lo tienes." };
    if (item.requires && !this.has(item.requires)) return { ok: false, text: item.kind === "homeUpgrade" ? "Primero necesitas la mudanza anterior." : "Primero necesitas el contrato anterior." };
    if ((item.kind === "furniture" || item.kind === "paint") && !this.has(HOME.id)) return { ok: false, text: "Primero compra el departamento." };
    const r = bank.charge(item.price, `Tienda RedMovi: ${item.name}`);
    if (!r.ok) return { ok: false, text: `Te faltan ${formatCLP(item.price - bank.balance)}. Gana más en el modo Conductor: cada estación bien servida paga.` };
    this.owned.add(item.id);
    if (item.kind === "livery") this.livery = item.id;          // se estrena al tiro
    if (item.kind === "paint") this.paint = item.id;            // se pinta al tiro
    let extra = "";
    // 2.24 · Pieza completa por primera vez: premio
    const room = item.kind === "furniture" && ROOMS.find(r => r.id === item.room);
    if (room && !this.rooms.has(room.id) && FURNITURE.filter(f => f.room === room.id).every(f => this.owned.has(f.id))) {
      this.rooms.add(room.id);
      bank.deposit(ROOM_REWARD, `Pieza amoblada · ${room.name}`);
      extra = ` 🏆 ¡${room.name} completo! Premio de ${formatCLP(ROOM_REWARD)}.`;
    }
    this.save();
    return { ok: true, text: `¡Compraste ${item.name}!${extra}`, reward: extra ? ROOM_REWARD : 0 };
  }

  /** Elige una pintura ya comprada. */
  paintWith(id) {
    if (!this.has(id)) return;
    this.paint = id;
    this.save();
  }

  get currentPaint() { return PAINTS.find(p => p.id === this.paint) || PAINTS[0]; }

  /** Mudanza actual (0 Ñuñoa, 1 Providencia, 2 Las Condes); -1 sin depto. */
  get homeLevel() { return HOME_LEVELS.reduce((lv, h) => this.has(h.id) ? h.level : lv, -1); }
  get currentHome() { return HOME_LEVELS[Math.max(0, this.homeLevel)]; }

  /** Elige una librea ya comprada. */
  equip(id) {
    if (!this.has(id)) return;
    this.livery = id;
    this.save();
  }

  get currentLivery() { return LIVERIES.find(l => l.id === this.livery) || LIVERIES[0]; }

  /** ¿Puede conducir esta línea? */
  canDrive(lineId) { return lineId === FREE_LINE || !!lineById(lineId)?.bonus || this.has(`license-${lineId}`); }   // 2.18 · la bonus es gratis

  /** Multiplicador de sueldo según el mejor contrato. */
  get wageMultiplier() {
    return CONTRACTS.filter(c => this.has(c.id)).reduce((m, c) => Math.max(m, c.mult), 1);
  }

  /** Recuerdos de una línea: { have, total }. */
  album(line) {
    const have = line.stations.filter(st => this.has(souvenirId(line.id, st.name))).length;
    return { have, total: line.stations.length };
  }

  /** Muebles comprados / total. */
  get furnished() { return this.roomFurnished(null); }

  /** Muebles comprados / total de una pieza (null = todo el depto). */
  roomFurnished(room) {
    const list = room ? FURNITURE.filter(f => f.room === room) : FURNITURE;
    return { have: list.filter(f => this.has(f.id)).length, total: list.length };
  }
}

