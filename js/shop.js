/* ==========================================================================
   MetroSim — shop.js
   TIENDA METRO: en qué gastar lo que ganas (sin Three.js).

   Pensada para que convenga jugar el modo Conductor (ahí se gana el sueldo)
   y para tener metas caras a las que juntar dinero:
     · CONDUCTOR   licencias para conducir otras líneas, libreas (colores)
                   para tu tren y contratos que suben el sueldo para siempre.
     · MI DEPTO    un departamento propio que vas amoblando mueble a mueble.
     · COLECCIÓN   un recuerdo de cada estación, que solo se compra en el
                   kiosko de su calle (modo Pasajero). Completar el álbum de
                   una línea paga un premio.

   Todo se paga con la cuenta bancaria del juego (economy.js) y lo comprado
   se guarda en el navegador (localStorage), compartido entre los modos.
   La interfaz está en shopUI.js.
   ========================================================================== */

import { LINES } from "./engine/network.js";
import { formatCLP } from "./config.js";
import { isCreator } from "./creator.js";

const KEY = "metrosim.owned";

/** Línea que se puede conducir desde el principio (sin licencia). */
export const FREE_LINE = "3";

/** Licencias de conductor: una por línea (salvo la gratuita). */
const LICENSE_PRICE = { "1": 30000, "2": 20000, "4": 25000, "4A": 12000, "5": 25000, "6": 15000 };
export const LICENSES = LINES.filter(l => l.id !== FREE_LINE).map(l => ({
  id: `license-${l.id}`, lineId: l.id, kind: "license", icon: "🪪",
  name: `Licencia ${l.name.charAt(0) + l.name.slice(1).toLowerCase()}`,
  desc: `Habilita el modo Conductor en la ${l.name.charAt(0) + l.name.slice(1).toLowerCase()} (${l.stations[0].short} ⇄ ${l.stations.at(-1).short}, ${l.stations.length} estaciones).`,
  price: LICENSE_PRICE[l.id] ?? 20000, color: l.color,
}));

/** Libreas de tu tren (color de la carrocería y de la franja). null = la de siempre. */
export const LIVERIES = [
  { id: "livery-clasica", kind: "livery", icon: "🚇", name: "Clásica", desc: "Acero inoxidable con la franja del color de la línea.", price: 0, body: null, stripe: null },
  { id: "livery-plata", kind: "livery", icon: "🚇", name: "Plata y rojo", desc: "Como los primeros trenes del Metro de Santiago: plata con franja roja.", price: 8000, body: 0xdfe3e6, stripe: 0xd42026 },
  { id: "livery-noche", kind: "livery", icon: "🌙", name: "Azul noche", desc: "Carrocería azul profundo con franja celeste.", price: 15000, body: 0x1d2f55, stripe: 0x4fd6ff },
  { id: "livery-cordillera", kind: "livery", icon: "🏔️", name: "Verde cordillera", desc: "Verde bosque con franja blanca, como la nieve de los Andes.", price: 15000, body: 0x2f6b45, stripe: 0xf2f4f2 },
  { id: "livery-metro", kind: "livery", icon: "🔴", name: "Rojo Metro", desc: "Rojo corporativo con franja blanca. Imposible no verlo llegar.", price: 20000, body: 0xc4262e, stripe: 0xffffff },
  { id: "livery-dorada", kind: "livery", icon: "✨", name: "Dorada aniversario", desc: "Edición especial dorada con franja negra. Para conductores de elite.", price: 50000, body: 0xc9a13b, stripe: 0x15181b, metal: 0.85 },
];

/** Contratos: suben el sueldo de conductor para siempre (el mejor que tengas). */
export const CONTRACTS = [
  { id: "contract-senior", kind: "contract", icon: "📈", name: "Conductor Senior", desc: "+25 % de sueldo en cada estación y en el bono de fin de servicio.", price: 40000, mult: 1.25 },
  { id: "contract-jefe", kind: "contract", icon: "🎖️", name: "Jefe de Tren", desc: "+60 % de sueldo en cada estación y en el bono de fin de servicio. Requiere ser Conductor Senior.", price: 120000, mult: 1.6, requires: "contract-senior" },
];

/**
 * Mi depto: primero el departamento, después los muebles. x, y (0..1) es
 * dónde se dibuja cada mueble en la ilustración del living (shopUI.js).
 */
export const HOME = { id: "home-depto", kind: "home", icon: "🏠", name: "Departamento en Ñuñoa", desc: "Un depto de un dormitorio a pasos del Metro. Llega vacío: amóblalo a tu gusto.", price: 60000 };
export const FURNITURE = [
  { id: "f-alfombra", icon: "🟫", name: "Alfombra", price: 6000, x: 0.5, y: 0.86, size: 1.0, floor: true },
  { id: "f-sofa", icon: "🛋️", name: "Sofá", price: 15000, x: 0.3, y: 0.72, size: 1.6 },
  { id: "f-mesa", icon: "🪑", name: "Mesa y sillas", price: 9000, x: 0.7, y: 0.76, size: 1.2 },
  { id: "f-tv", icon: "📺", name: "Televisor", price: 25000, x: 0.52, y: 0.52, size: 1.3 },
  { id: "f-lampara", icon: "💡", name: "Lámpara de pie", price: 4000, x: 0.1, y: 0.62, size: 1.0 },
  { id: "f-planta", icon: "🪴", name: "Planta", price: 3000, x: 0.92, y: 0.7, size: 1.1 },
  { id: "f-estante", icon: "📚", name: "Estantería con libros", price: 8000, x: 0.82, y: 0.42, size: 1.2 },
  { id: "f-cafetera", icon: "☕", name: "Cafetera", price: 7000, x: 0.66, y: 0.6, size: 0.7 },
  { id: "f-cuadro", icon: "🖼️", name: "Cuadro de la cordillera", price: 10000, x: 0.24, y: 0.3, size: 1.1 },
  { id: "f-poster", icon: "🗺️", name: "Póster del plano del Metro", price: 5000, x: 0.5, y: 0.22, size: 1.0 },
  { id: "f-cama", icon: "🛏️", name: "Cama (dormitorio)", price: 12000, x: 0.1, y: 0.86, size: 1.2 },
  { id: "f-maqueta", icon: "🚆", name: "Maqueta del tren AS-2014", price: 30000, x: 0.36, y: 0.5, size: 0.9 },
].map(f => ({ ...f, kind: "furniture", desc: "Para tu departamento." }));

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
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ owned: [...this.owned], livery: this.livery, albums: [...this.albums] })); } catch { /* sin almacenamiento */ }
  }

  /** ¿Lo tiene? En Modo Creador, todo. */
  has(id) { return isCreator() || this.owned.has(id) || id === "livery-clasica"; }

  /**
   * Compra con la cuenta. Devuelve { ok, text }.
   * @param {object} item  del catálogo (id, name, price)
   * @param {import("./economy.js").BankAccount} bank
   */
  buy(item, bank) {
    if (this.has(item.id)) return { ok: false, text: "Ya lo tienes." };
    if (item.requires && !this.has(item.requires)) return { ok: false, text: "Primero necesitas el contrato anterior." };
    if (item.kind === "furniture" && !this.has(HOME.id)) return { ok: false, text: "Primero compra el departamento." };
    const r = bank.charge(item.price, `Tienda Metro: ${item.name}`);
    if (!r.ok) return { ok: false, text: `Te faltan ${formatCLP(item.price - bank.balance)}. Gana más en el modo Conductor: cada estación bien servida paga.` };
    this.owned.add(item.id);
    if (item.kind === "livery") this.livery = item.id;          // se estrena al tiro
    this.save();
    return { ok: true, text: `¡Compraste ${item.name}!` };
  }

  /** Elige una librea ya comprada. */
  equip(id) {
    if (!this.has(id)) return;
    this.livery = id;
    this.save();
  }

  get currentLivery() { return LIVERIES.find(l => l.id === this.livery) || LIVERIES[0]; }

  /** ¿Puede conducir esta línea? */
  canDrive(lineId) { return lineId === FREE_LINE || this.has(`license-${lineId}`); }

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
  get furnished() { return { have: FURNITURE.filter(f => this.has(f.id)).length, total: FURNITURE.length }; }
}

