/* ==========================================================================
   MetroSim — Alpha 0.9 · city/city.js
   La CALLE de la estación: lo que ve el Pasajero al salir del Metro.

   · Avenida de doble sentido con veredas, faroles, autos y micros.
   · Vereda este: la boca del acceso al Metro, el kiosko y los locales del
     plan (panadería, almacén, farmacia, cajero...), con su letrero.
   · Lado oeste: el HITO de la estación (city/landmarks.js) o, si la
     estación no tiene, edificios genéricos.
   · Peatones que caminan por las veredas.
   · Cielo, sol y faroles según la hora real del juego (día, atardecer, noche).

   Solo existe UNA calle a la vez (la de la estación donde estás): al salir
   en otra estación se descarga la anterior y se construye la nueva.

   Se dibuja lejos del túnel (x = STREET.originX) para no superponerse con
   la estación subterránea; las coordenadas del jugador en la calle son del
   mundo, y aquí se pasan a locales (lx, lz).
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox } from "../utils.js";
import { LINE } from "../config.js";
import { STREET, streetPlan, seededRandom } from "./plan.js";
import { buildLandmark } from "./landmarks.js";
import { cityMaterials, genericBuilding, signMaterial, facingPlane, streetLamp, tree, bench, addMesh } from "./kit.js";

const S = STREET;
const GROUND = 0;
const LANES = [{ x: -5.2, dir: 1 }, { x: -1.9, dir: 1 }, { x: 1.9, dir: -1 }, { x: 5.2, dir: -1 }];

/** Hora (s) → luz del día: sol (0..1), color del cielo y si es de noche. */
function skyAt(clock) {
  const h = (clock / 3600) % 24;
  const sun = Math.sin(Math.PI * (h - 6.8) / 13.6);              // > 0 entre ~06:50 y ~20:25
  const day = THREE.MathUtils.clamp(sun * 2.2 + 0.15, 0, 1);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(sun - 0.08) / 0.22, 0, 1) * (h > 12 ? 1 : 0.7);
  const color = new THREE.Color(0x0a1224).lerp(new THREE.Color(0x8fc3ee), day).lerp(new THREE.Color(0xf09a5e), dusk * 0.55);
  return { sun, day, dusk, color, night: day < 0.25 ? 1 : 0 };
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.active = false;
    this.station = null;
    this.timeT = 0;
  }

  /* ---------------------------------------------------------------------
     Carga / descarga
     --------------------------------------------------------------------- */

  /** Construye la calle de una estación (descarta la anterior). */
  load(station, clock) {
    if (this.station === station && this.group) { this.setTime(clock); return; }
    this.unload();
    this.station = station;
    this.plan = streetPlan(station);
    this.sky = skyAt(clock);
    const night = this.sky.night;
    const M = this.M = cityMaterials(night);
    const rnd = seededRandom(station.name + "#city");
    const g = this.group = new THREE.Group();
    g.position.set(S.originX, GROUND, station.z);
    g.visible = this.active;
    this.scene.add(g);
    this.blocks = [];                       // rectángulos no transitables (coordenadas locales)
    this.walkRects = [{ x0: -S.walkHalf + 0.35, x1: S.walkHalf - 0.35, z0: -S.halfLen, z1: S.halfLen }];

    this.buildGround(g, M);
    this.buildAccess(g, M);
    this.buildEastSide(g, M, rnd, night);
    this.buildWestSide(g, M, rnd, night);
    this.buildFurniture(g, M, rnd);
    this.buildBackdrop(g, M, rnd, night);
    this.buildVehicles(g, rnd);
    this.buildPedestrians(g, rnd);

    // Luz del día: hemisférica + sol (solo existen mientras hay calle)
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a4238, 1);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1);
    this.sun.position.set(-60, 120, 40);
    this.sun.target.position.set(0, 0, 0);
    g.add(this.hemi, this.sun, this.sun.target);
    this.setTime(clock);
  }

  unload() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse(o => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach(m => { m.map?.dispose(); m.dispose(); });
    });
    this.group = null;
    this.station = null;
  }

  /** El jugador sale a la calle: cielo de día o de noche en vez del túnel. */
  enter() {
    if (this.active) return;
    this.active = true;
    this.savedBg = this.scene.background;
    this.savedFog = this.scene.fog;
    this.scene.fog = new THREE.Fog(this.sky.color.getHex(), 70, 330);
    this.scene.background = this.sky.color.clone();
    if (this.group) this.group.visible = true;
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    this.scene.background = this.savedBg;
    this.scene.fog = this.savedFog;
    if (this.group) this.group.visible = false;
  }

  /** Ajusta el cielo y el sol a la hora del juego. */
  setTime(clock) {
    const sky = this.sky = skyAt(clock);
    if (this.hemi) {
      this.hemi.intensity = 0.25 + 1.0 * sky.day;
      this.sun.intensity = 2.4 * sky.day;
      this.sun.color.setHex(sky.dusk > 0.4 ? 0xffb37a : 0xfff1dc);
    }
    if (this.active) {
      this.scene.background.copy(sky.color);
      this.scene.fog.color.copy(sky.color);
    }
  }

  /* ---------------------------------------------------------------------
     Construcción
     --------------------------------------------------------------------- */

  buildGround(g, M) {
    const L = 2 * 330;
    addBox(g, S.roadHalf * 2, 0.1, L, M.asphalt, 0, -0.05, 0);
    [-1, 1].forEach(s => {
      addBox(g, S.walkHalf - S.roadHalf, 0.2, L, M.sidewalk, s * (S.roadHalf + S.walkHalf) / 2, 0.0, 0);   // vereda (borde a y = 0,1)
      addBox(g, 0.3, 0.22, L, M.curb, s * (S.roadHalf + 0.15), 0.0, 0);
    });
    // Líneas de pista y bandejón central
    addBox(g, 0.5, 0.18, L, M.curb, 0, 0.0, 0);
    for (let z = -330; z < 330; z += 9) [-3.55, 3.55].forEach(x => addBox(g, 0.15, 0.02, 4, M.paint, x, 0.01, z));
    // Pasos de cebra junto al acceso y en los extremos
    for (const cz of [-16, 16, -84, 84]) for (let x = -6.4; x <= 6.4; x += 1.1) addBox(g, 0.6, 0.02, 3.2, M.paint, x, 0.012, cz);
    // Suelo lejano (para que el horizonte no quede vacío)
    addBox(g, 900, 0.1, L, std(0x5b5a55, { rough: 1 }), 0, -0.2, 0);
  }

  /** Boca del acceso al Metro: escalera que baja, barandas y tótem con el logo y el nombre. */
  buildAccess(g, M) {
    const a = S.access;
    const x0 = a.x - a.halfX, x1 = a.x + a.halfX, z0 = a.z - a.halfZ, z1 = a.z + a.halfZ;
    // Hueco con peldaños que bajan hacia −Z
    for (let i = 0; i < 10; i++) addBox(g, a.halfX * 2 - 0.2, 0.05, 0.6, M.stone, a.x, 0.06 - i * 0.28, z1 - 0.3 - i * 0.62);
    addBox(g, a.halfX * 2, 0.02, a.halfZ * 2, M.black, a.x, -2.9, a.z);
    // Barandas en tres lados (la boca queda abierta hacia +Z)
    const rail = std(0xc9ced3, { metal: 0.7, rough: 0.3 });
    addBox(g, 0.08, 1.05, a.halfZ * 2, rail, x0, 0.6, a.z);
    addBox(g, 0.08, 1.05, a.halfZ * 2, rail, x1, 0.6, a.z);
    addBox(g, a.halfX * 2, 1.05, 0.08, rail, a.x, 0.6, z0);
    addBox(g, 0.18, 0.22, a.halfZ * 2, std(0x9a9a9a), x0, 0.15, a.z);
    addBox(g, 0.18, 0.22, a.halfZ * 2, std(0x9a9a9a), x1, 0.15, a.z);
    this.blocks.push({ x0: x0 - 0.3, x1: x1 + 0.3, z0: z0 - 0.3, z1: z1 - 1.0 });   // el último metro de la boca se puede pisar para bajar
    // Tótem del Metro
    const tx = x1 + 0.7, tz = z1 + 0.6;
    addBox(g, 0.16, 3.4, 0.16, M.metal, tx, 1.7, tz);
    const logo = signMaterial("METRO", { bg: "#e1251b", font: "900 110px Arial" });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 1.6), [logo, logo, M.metal, M.metal, logo, logo]);
    sign.position.set(tx, 3.6, tz);
    g.add(sign);
    const nameMat = signMaterial(this.station.name, { bg: "#1b1f24", font: "800 80px Arial" });
    const name = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 2.6), [nameMat, nameMat, M.metal, M.metal, M.metal, M.metal]);
    name.position.set(tx, 2.75, tz);
    g.add(name);
    const badge = signMaterial(`LÍNEA ${LINE.id}`, { bg: LINE.color, font: "900 90px Arial" });
    const bdg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 1.3), [badge, badge, M.metal, M.metal, M.metal, M.metal]);
    bdg.position.set(tx, 2.3, tz);
    g.add(bdg);
    this.blocks.push({ x0: tx - 0.25, x1: tx + 0.25, z0: tz - 0.25, z1: tz + 0.25 });
  }

  /** Vereda este: locales en planta baja, kiosko y edificios encima. */
  buildEastSide(g, M, rnd, night) {
    const fx = S.walkHalf;
    // Edificio sobre el acceso (oficinas)
    genericBuilding(g, { x: fx + 9, z: 0, w: 18, d: 20, h: 34, style: "glass", night, rnd });
    for (const shop of this.plan.shops) {
      if (shop.stand) { this.buildKiosk(g, M, shop); continue; }
      const h = 12 + Math.floor(rnd() * 6) * 5;
      genericBuilding(g, { x: fx + 9, z: shop.z, w: 18, d: 21.6, h, night, rnd });
      this.buildShopFront(g, M, shop);
    }
    // Extremos de la cuadra
    for (const z of [-84, 84]) genericBuilding(g, { x: fx + 9, z, w: 18, d: 14, h: 20 + rnd() * 20, night, rnd });
  }

  /** Fachada de un local: vidriera iluminada, puerta, toldo de color y letrero con su nombre. */
  buildShopFront(g, M, shop) {
    const fx = S.walkHalf - 0.04, z = shop.z;
    facingPlane(g, 12, 3.2, M.shopGlow, fx, 1.9, z, -1);
    facingPlane(g, 2, 2.6, M.darkGlass, fx - 0.02, 1.4, z, -1);
    const awn = addBox(g, 1.6, 0.12, 12.4, std(new THREE.Color(shop.color), { rough: 0.8 }), fx - 0.8, 3.75, z);
    awn.rotation.z = -0.25;
    facingPlane(g, 11, 1.25, signMaterial(shop.name.toUpperCase(), { bg: shop.color, font: "800 76px Arial" }), fx - 0.03, 4.6, z, -1);
    if (shop.kind === "banco") {
      facingPlane(g, 1, 1.6, glow(0x2a7fd4), fx - 0.05, 1.5, z + 3.5, -1);    // cajero automático
    }
  }

  buildKiosk(g, M, shop) {
    const k = new THREE.Group();
    addBox(k, 2, 2.3, 2.4, std(0x2f6b3a, { rough: 0.7 }), 0, 1.15, 0);
    addBox(k, 2.8, 0.12, 3.2, std(new THREE.Color(shop.color)), -0.2, 2.45, 0);
    facingPlane(k, 2, 1, M.shopGlow, -1.02, 1.4, 0, -1);
    facingPlane(k, 2.6, 0.5, signMaterial(shop.name.toUpperCase(), { bg: shop.color, font: "800 70px Arial" }), -1.62, 2.8, 0, -1);
    k.position.set(shop.x, 0, shop.z);
    g.add(k);
    this.blocks.push({ x0: shop.x - 1.15, x1: shop.x + 1.15, z0: shop.z - 1.35, z1: shop.z + 1.35 });
  }

  /** Lado oeste: el hito (si la estación tiene) y edificios genéricos alrededor. */
  buildWestSide(g, M, rnd, night) {
    const fx = -S.walkHalf;
    let halfZ = 0;
    const lm = this.plan.landmark;
    if (lm) {
      const built = buildLandmark(lm, M, { night });
      built.group.position.x = fx;
      g.add(built.group);
      halfZ = built.halfZ;
      this.landmark = { ...lm, halfZ, plaza: built.plaza };
      // Explanada transitable y sus obstáculos (pasados a coordenadas locales)
      this.walkRects.push({ x0: fx - built.plaza + 0.4, x1: fx + 0.5, z0: -halfZ + 0.4, z1: halfZ - 0.4 });
      built.blocks.forEach(b => this.blocks.push({ x0: b.x0 + fx, x1: b.x1 + fx, z0: b.z0, z1: b.z1 }));
    } else this.landmark = null;
    // Edificios genéricos donde no está el hito
    for (let z = -S.halfLen; z < S.halfLen; ) {
      const w = 14 + Math.floor(rnd() * 3) * 4;
      const cz = z + w / 2;
      if (!lm || Math.abs(cz) - w / 2 >= halfZ) genericBuilding(g, { x: fx - 10, z: cz, w: 20, d: w - 0.6, h: 14 + rnd() * 34, night, rnd });
      z += w;
    }
  }

  /** Faroles, árboles, bancos y paradero. */
  buildFurniture(g, M, rnd) {
    for (let z = -84; z <= 84; z += 24) {
      streetLamp(g, M, S.roadHalf + 0.6, z + 6, -1);
      streetLamp(g, M, -S.roadHalf - 0.6, z - 6, 1);
      this.blocks.push({ x0: S.roadHalf + 0.45, x1: S.roadHalf + 0.75, z0: z + 5.85, z1: z + 6.15 });
      this.blocks.push({ x0: -S.roadHalf - 0.75, x1: -S.roadHalf - 0.45, z0: z - 6.15, z1: z - 5.85 });
    }
    // Árboles de la vereda este (en tazas, junto a la solera)
    for (let z = -78; z <= 78; z += 24) {
      if (Math.abs(z) < 8) continue;
      tree(g, M, S.roadHalf + 1.3, z, 0.9);
      this.blocks.push({ x0: S.roadHalf + 0.8, x1: S.roadHalf + 1.8, z0: z - 0.5, z1: z + 0.5 });
    }
    if (!this.landmark) {
      for (let z = -78; z <= 78; z += 24) { tree(g, M, -S.roadHalf - 1.3, z + 12, 0.9); this.blocks.push({ x0: -S.roadHalf - 1.8, x1: -S.roadHalf - 0.8, z0: z + 11.5, z1: z + 12.5 }); }
    }
    // Paradero de micro
    const pz = 34;
    addBox(g, 1.6, 0.08, 5, std(0x2b6cb0, { transparent: true, opacity: 0.75 }), S.roadHalf + 1.4, 2.6, pz);
    addBox(g, 0.08, 2.6, 5, std(0x9fc6e0, { transparent: true, opacity: 0.35 }), S.roadHalf + 2.2, 1.3, pz);
    bench(g, M, S.roadHalf + 1.7, pz, Math.PI / 2);
    this.blocks.push({ x0: S.roadHalf + 1.2, x1: S.roadHalf + 2.3, z0: pz - 2.5, z1: pz + 2.5 });
  }

  /** La avenida sigue más allá de la cuadra (decorado, no transitable). */
  buildBackdrop(g, M, rnd, night) {
    for (const s of [-1, 1]) {
      for (let z = 100; z < 320; z += 22) {
        genericBuilding(g, { x: s * (S.walkHalf + 10), z, w: 20, d: 20, h: 12 + rnd() * 40, night, rnd });
        genericBuilding(g, { x: s * (S.walkHalf + 10), z: -z, w: 20, d: 20, h: 12 + rnd() * 40, night, rnd });
      }
    }
  }

  /* ---------------------------------------------------------------------
     Autos, micros y peatones
     --------------------------------------------------------------------- */

  buildVehicles(g, rnd) {
    this.vehicles = [];
    const colors = [0xd8d8d8, 0x1d1f22, 0x9b1c1c, 0x2c4f8a, 0x8a8f96, 0xf1f1ee, 0x2f6b3a, 0xc9a227];
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 10);
    const wheelMat = std(0x111111);
    const glass = std(0x22303d, { metal: 0.5, rough: 0.2 });
    for (let i = 0; i < 12; i++) {
      const lane = LANES[i % 4];
      const bus = i % 5 === 2;
      const v = new THREE.Group();
      const L = bus ? 12 : 4.3, W = bus ? 2.5 : 1.8, H = bus ? 3.1 : 1.45;
      const bodyColor = bus ? 0xd9d9d9 : colors[Math.floor(rnd() * colors.length)];
      addBox(v, W, bus ? H - 0.4 : 0.75, L, std(bodyColor, { metal: 0.4, rough: 0.4 }), 0, bus ? (H - 0.4) / 2 + 0.35 : 0.72, 0);
      if (bus) {
        addBox(v, W + 0.02, 1.1, L * 0.9, glass, 0, 2.1, 0);
        addBox(v, W + 0.03, 0.35, L, std(0xc8102e), 0, 0.9, 0);       // franja roja de la red de buses
      } else {
        addBox(v, W * 0.9, 0.6, L * 0.5, glass, 0, 1.35, -0.2);
      }
      for (const [x, z] of [[-W / 2, L * 0.33], [W / 2, L * 0.33], [-W / 2, -L * 0.33], [W / 2, -L * 0.33]]) {
        const w = addMesh(v, wheelGeo, wheelMat, x, 0.34, z);
        w.rotation.z = Math.PI / 2;
      }
      // Faros delanteros y luces traseras
      addBox(v, W * 0.8, 0.15, 0.05, glow(0xfff6d8), 0, bus ? 0.8 : 0.8, L / 2 * lane.dir);
      addBox(v, W * 0.8, 0.15, 0.05, glow(0xb01010), 0, bus ? 0.8 : 0.8, -L / 2 * lane.dir);
      const z = -300 + (i * 600) / 12 + rnd() * 20;
      v.position.set(lane.x, 0, z);
      g.add(v);
      const vmax = bus ? 9 : 11 + rnd() * 4;
      this.vehicles.push({ mesh: v, lane, z, v: vmax, vmax, len: L });
    }
  }

  /**
   * Peatones con piernas y brazos articulados. Cada uno elige destinos en
   * su vereda (puntos al azar, puertas de locales, el acceso al Metro),
   * camina hacia ellos esquivando faroles, árboles, kiosko, a los demás
   * peatones y al jugador, se detiene un rato y elige otro destino.
   */
  buildPedestrians(g, rnd) {
    this.walkers = [];
    const shirts = [0x2d5f9a, 0x9a2d2d, 0x3b3b3b, 0xe0d6c3, 0x4a7a3a, 0x7a4a8a, 0xc98b2c, 0x1f2a36, 0xb8b8b8];
    const pants = [0x262a33, 0x30435e, 0x3d3229, 0x1b1b1d, 0x55585e];
    const skin = [0xe6c3a0, 0xc99a72, 0x8d5b3a, 0xf1d6bd];
    const hair = [0x1a1410, 0x3b2a1e, 0x6b4a2b, 0x9a9a9a, 0x2a2018];
    const torsoGeo = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8);
    const legGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.82, 6);
    legGeo.translate(0, -0.41, 0);                           // pivote en la cadera
    const armGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6);
    armGeo.translate(0, -0.3, 0);                            // pivote en el hombro
    const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const hairGeo = new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const shoeGeo = new THREE.BoxGeometry(0.11, 0.07, 0.22);
    shoeGeo.translate(0, -0.84, 0.04);
    const shoeMat = std(0x141414);
    const rand = (a) => a[Math.floor(rnd() * a.length)];

    for (let i = 0; i < 18; i++) {
      const p = new THREE.Group();
      const s = 0.9 + rnd() * 0.2;                           // estatura
      const body = new THREE.Group();
      body.scale.setScalar(s);
      p.add(body);
      const pantMat = std(rand(pants), { rough: 0.9 }), shirtMat = std(rand(shirts), { rough: 0.9 }), skinMat = std(rand(skin));
      const legs = [-0.1, 0.1].map(x => {
        const leg = addMesh(body, legGeo, pantMat, x, 0.9, 0);
        addMesh(leg, shoeGeo, shoeMat, 0, 0, 0);
        return leg;
      });
      addMesh(body, torsoGeo, shirtMat, 0, 1.22, 0);
      const arms = [-0.25, 0.25].map(x => addMesh(body, armGeo, shirtMat, x, 1.5, 0));
      addMesh(body, headGeo, skinMat, 0, 1.68, 0);
      addMesh(body, hairGeo, std(rand(hair)), 0, 1.7, -0.015);
      const side = i % 2 ? 1 : -1;
      const ped = { mesh: p, legs, arms, side, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 1.05 + rnd() * 0.45, phase: rnd() * 6, wait: rnd() * 3, target: null, stuck: 0 };
      const start = this.randomSidewalkPoint(side, rnd);
      ped.x = start.x; ped.z = start.z;
      ped.yaw = rnd() * Math.PI * 2;
      p.position.set(ped.x, 0.1, ped.z);
      g.add(p);
      this.walkers.push(ped);
    }
    this.pedRnd = rnd;
  }

  /** ¿Puede pisar un peatón el punto local (lx, lz)? (veredas y explanada, sin obstáculos) */
  pedFree(lx, lz, margin = 0.35) {
    if (Math.abs(lx) < S.roadHalf + 0.3) return false;      // no se baja a la calzada
    if (!this.walkRects.some(r => lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1)) return false;
    return !this.blocks.some(b => lx > b.x0 - margin && lx < b.x1 + margin && lz > b.z0 - margin && lz < b.z1 + margin);
  }

  randomSidewalkPoint(side, rnd = Math.random) {
    for (let k = 0; k < 30; k++) {
      const x = side * (S.roadHalf + 0.9 + rnd() * (S.walkHalf - S.roadHalf - 1.6));
      const z = (rnd() - 0.5) * 2 * (S.halfLen - 3);
      if (this.pedFree(x, z, 0.5)) return { x, z };
    }
    return { x: side * 10, z: 0 };
  }

  /** Próximo destino: un punto de la vereda, la puerta de un local o el acceso al Metro. */
  pickPedTarget(p) {
    const r = this.pedRnd();
    if (p.side > 0 && r < 0.35) {
      const shop = this.plan.shops[Math.floor(this.pedRnd() * this.plan.shops.length)];
      return { x: shop.door.x - 0.2, z: shop.door.z + (this.pedRnd() - 0.5), wait: 2 + this.pedRnd() * 5 };
    }
    if (p.side > 0 && r < 0.45) return { x: S.access.x, z: S.access.z + S.access.mouthZ + 1.2, wait: 1 + this.pedRnd() * 2 };
    const pt = this.randomSidewalkPoint(p.side, this.pedRnd);
    return { ...pt, wait: this.pedRnd() < 0.4 ? 1 + this.pedRnd() * 4 : 0 };
  }

  updatePedestrians(dt, plx, plz) {
    const list = this.walkers;
    for (const p of list) {
      if (!p.target) p.target = this.pickPedTarget(p);
      let dx = p.target.x - p.x, dz = p.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      let moving = false;

      if (dist < 0.4 || p.stuck > 4) {
        // Llegó (o no puede llegar): espera un poco y elige otro destino
        p.wait -= dt;
        if (p.wait <= 0 || p.stuck > 4) { p.target = this.pickPedTarget(p); p.wait = p.target.wait; p.stuck = 0; }
      } else {
        // Dirección deseada + separación de los demás y del jugador
        let fx = dx / dist, fz = dz / dist;
        const push = (ox, oz, radius, k) => {
          const ax = p.x - ox, az = p.z - oz, d = Math.hypot(ax, az);
          if (d > 0.001 && d < radius) { const f = k * (1 - d / radius) / d; fx += ax * f; fz += az * f; }
        };
        for (const o of list) if (o !== p) push(o.x, o.z, 1.1, 1.6);
        push(plx, plz, 1.5, 3);
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl; fz /= fl;
        // Si el camino recto choca con algo, prueba girando a uno y otro lado
        const step = p.speed * dt;
        let moved = false;
        for (const a of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const c = Math.cos(a), s = Math.sin(a);
          const mx = fx * c - fz * s, mz = fx * s + fz * c;
          const nx = p.x + mx * step, nz = p.z + mz * step;
          if (this.pedFree(nx, nz) && Math.hypot(nx - plx, nz - plz) > 0.55) {
            p.vx += (mx * p.speed - p.vx) * Math.min(1, dt * 6);
            p.vz += (mz * p.speed - p.vz) * Math.min(1, dt * 6);
            moved = true;
            break;
          }
        }
        if (!moved) { p.vx *= 0.8; p.vz *= 0.8; p.stuck += dt; }
        else p.stuck = Math.max(0, p.stuck - dt);
        const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
        if (this.pedFree(nx, nz, 0.2)) { p.x = nx; p.z = nz; }
        moving = Math.hypot(p.vx, p.vz) > 0.2;
      }
      if (!moving) { p.vx *= 0.85; p.vz *= 0.85; }

      // Orientación suave hacia donde camina (o hacia el destino si está quieto)
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.15) {
        const want = Math.atan2(p.vx, p.vz);
        let d = want - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * Math.min(1, dt * 7);
      }

      // Paso: piernas y brazos opuestos, balanceo del cuerpo
      const gait = Math.min(1, sp / 1.1);
      p.phase += dt * (5.5 + sp * 2.5) * (gait > 0.05 ? 1 : 0);
      const swing = Math.sin(p.phase) * 0.55 * gait;
      p.legs[0].rotation.x = swing;
      p.legs[1].rotation.x = -swing;
      p.arms[0].rotation.x = -swing * 0.8;
      p.arms[1].rotation.x = swing * 0.8;
      p.mesh.position.set(p.x, 0.1 + Math.abs(Math.cos(p.phase)) * 0.035 * gait, p.z);
      p.mesh.rotation.y = p.yaw;
    }
  }

  /* ---------------------------------------------------------------------
     Cada fotograma
     --------------------------------------------------------------------- */

  /** @param {THREE.Vector3} playerPos  posición del jugador (mundo) o null */
  update(dt, playerPos, clock) {
    if (!this.group || !this.active) return;
    this.timeT -= dt;
    if (this.timeT <= 0) { this.timeT = 20; this.setTime(clock); }
    const lx = playerPos ? playerPos.x - S.originX : 1e9, lz = playerPos ? playerPos.z - this.station.z : 1e9;

    // Vehículos: frenan ante el jugador y ante el de adelante
    for (const c of this.vehicles) {
      const dir = c.lane.dir;
      let gap = Infinity;
      if (Math.abs(lx - c.lane.x) < 1.7) {
        const d = (lz - c.z) * dir - c.len / 2;
        if (d > -1 && d < gap) gap = d;
      }
      for (const o of this.vehicles) {
        if (o === c || o.lane !== c.lane) continue;
        const d = (o.z - c.z) * dir - (o.len + c.len) / 2;
        if (d > 0 && d < gap) gap = d;
      }
      const target = gap < 3 ? 0 : gap < 14 ? c.vmax * (gap - 3) / 11 : c.vmax;
      c.v += THREE.MathUtils.clamp(target - c.v, -6 * dt, 2.5 * dt);
      c.z += c.v * dir * dt;
      if (c.z * dir > 320) c.z -= 640 * dir;
      c.mesh.position.z = c.z;
      c.mesh.rotation.y = dir > 0 ? 0 : Math.PI;
    }

    // Peatones: caminan a sus destinos esquivando obstáculos, a los demás y al jugador
    this.updatePedestrians(dt, lx, lz);
  }

  /* ---------------------------------------------------------------------
     Consultas del jugador (coordenadas del mundo)
     --------------------------------------------------------------------- */

  local(wx, wz) { return { lx: wx - S.originX, lz: wz - this.station.z }; }

  /** ¿Se puede pisar (wx, wz)? */
  walkable(wx, wz) {
    if (!this.group) return false;
    const { lx, lz } = this.local(wx, wz);
    if (!this.walkRects.some(r => lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1)) return false;
    if (this.walkers?.some(p => Math.hypot(p.x - lx, p.z - lz) < 0.45)) return false;   // no se atraviesa a los peatones
    return !this.blocks.some(b => lx > b.x0 - 0.25 && lx < b.x1 + 0.25 && lz > b.z0 - 0.25 && lz < b.z1 + 0.25);
  }

  /** Altura del suelo (vereda o calzada). */
  floorAt(wx) {
    const { lx } = this.local(wx, this.station.z);
    return Math.abs(lx) > S.roadHalf ? 0.1 : 0;
  }

  /** Punto donde aparece el jugador al salir del Metro (mundo) y hacia dónde mira. */
  spawn() {
    return { x: S.originX + S.spawn.x, y: 0.1, z: this.station.z + S.spawn.z, yaw: Math.PI / 2 };          // mirando hacia la avenida y el hito
  }

  /** Lo que hay al alcance: acceso al Metro, un local o el hito. */
  nearest(wpos) {
    const { lx, lz } = this.local(wpos.x, wpos.z);
    const a = S.access;
    if (Math.hypot(lx - a.x, lz - (a.z + a.mouthZ + 0.8)) < 2.4) return { kind: "access" };
    let best = null, bd = 2.6;
    for (const shop of this.plan.shops) {
      const d = Math.hypot(lx - shop.door.x, lz - shop.door.z);
      if (d < bd) { bd = d; best = shop; }
    }
    if (best) return { kind: "shop", shop: best };
    if (this.landmark && lx < -3 && Math.abs(lz) < this.landmark.halfZ + 6) return { kind: "landmark", landmark: this.landmark };
    return null;
  }

  /** ¿Pisó la boca de la escalera? (bajar caminando) */
  atAccessMouth(wpos) {
    const { lx, lz } = this.local(wpos.x, wpos.z);
    const a = S.access;
    return Math.abs(lx - a.x) < a.halfX - 0.1 && lz < a.z + a.mouthZ + 0.15 && lz > a.z + a.mouthZ - 1.6;
  }

  hint(wpos) {
    const n = this.nearest(wpos);
    if (n?.kind === "access") return `E (o camina hacia la escalera) · bajar a la estación ${this.station.name}`;
    if (n?.kind === "shop") return n.shop.kind === "banco" ? "E · usar el cajero automático (saldo y movimientos)" : `E · entrar a ${n.shop.name} (${n.shop.label.toLowerCase()})`;
    if (n?.kind === "landmark") return `E · sacar una foto de ${n.landmark.name}`;
    return this.landmark
      ? `Calle de ${this.station.name} · enfrente: ${this.landmark.name} · locales en la vereda del Metro · J misiones`
      : `Calle de ${this.station.name} · locales en la vereda del Metro · J misiones`;
  }
}
