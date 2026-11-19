/* ==========================================================================
   MetroSim — 1.13 · bus/busWorld.js
   MicroSim (beta): la Alameda en 3D. Calzada con pista Solo Bus, bandejón
   central con árboles, veredas, edificios, calles que cruzan con semáforo,
   paraderos con refugio y gente esperando, el bus y los autos.

   Ejes: el recorrido avanza hacia -Z (z = -s). El bus va por el lado
   derecho (x > -3.4); al otro lado del bandejón pasan los autos de vuelta.
   Todo lo que se repite (edificios, árboles, faroles, marcas del piso) va
   en InstancedMesh para que ande bien en el celular.

   1.20 · La calle usa lo mismo que el Metro:
     · el cielo y la luz de render/outdoor.js (skyAt: hora del día y nubes) y
       el clima de engine/weather.js (lluvia que cae, calzada mojada, niebla
       y la cordillera tapada cuando está nublado);
     · la gente de people.js (busPeople.js, desde la 1.19), que además pasa
       por las veredas y, al bajar, a veces se va al Metro por el acceso;
     · el acceso al Metro con su tótem (city/city.js · metroStreetAccess) en
       los paraderos que están junto a una estación, con las insignias de sus
       líneas (engine/network.js · linesAtStation).
   ========================================================================== */

import * as THREE from "three";
import { LANES, CURB_X, MEDIAN_X, lightState } from "./busRoute.js";
import { BUS_LENGTH, BUS_WIDTH, makeRng } from "./busSim.js";
import { MIRROR_X } from "./taxiSim.js";
import { BusPeople } from "./busPeople.js";
import { RoutePath } from "./busPath.js";
import { skyAt } from "../render/outdoor.js";
import { WEATHER } from "../engine/weather.js";
import { metroStreetAccess } from "../city/city.js";
import { linesAtStation } from "../engine/network.js";
import { SkyDome, SunShadow, sunDirection, skyEnvironment, shadows, asphaltTexture, asphaltRoughness, paverTexture, grassTexture, worldUV, facadeUV, facadeSet, crownGeometry, trunkGeometry, leafMaterial, ASPHALT_TILE, PAVER_TILE, GRASS_TILE } from "../render/realism.js";

const ROAD_FAR = -17.6;          // borde de la calzada de vuelta
const MEDIAN_FAR = -7.4;         // fin del bandejón
const ONCOMING = [-9.1, -12.5, -15.9];
/** 1.20 · Acceso al Metro junto al paradero: centro (x desde la vereda, z relativo a la marca) y tamaño. */
const ACCESS = { dx: 3.9, dz: -9, w: 1.9, len: 5.2 };
const SIDEWALK_Y = 0.16;
/** 2.15.2 · Boca del acceso: no pinta nada, solo deja un 1 en el stencil (el terreno no se dibuja ahí). */
const ACCESS_MASK = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
const TZ = new THREE.Matrix4();
/** 2.2 · Taxi: largo, ancho y asientos (conductor adelante a la izquierda, pasajero atrás a la derecha). */
const TAXI_L = 4.6, TAXI_W = 1.85;
const TAXI_SEATS = { driver: { x: -0.4, y: 0.62, z: 2.05 }, rider: { x: 0.42, y: 0.62, z: 3.2 } };
const CAR_COLORS = ["#d9dde2", "#1d1f24", "#8a9099", "#b3242a", "#21457a", "#e8e4d8", "#4c5a4a", "#6b4a2f", "#c9b03a", "#2f6f8f"];

/* ---------- utilidades ---------- */
function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function noise(g, w, h, amount, rng) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
function box(parent, w, h, d, mat, x, y, z) {
  // 2.3 · Las cajas largas llevan cortes cada 3 m para poder doblarse con la calle (busPath.js)
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 1, 1, d > 8 ? Math.ceil(d / 3) : 1), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Letrero de texto (paraderos, letrero del bus). */
export function signTexture(lines, { w = 512, h = 160, bg = "#0f3d7a", fg = "#fff", font = "700 46px Barlow, Arial", led = false } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    const step = h / (lines.length + 1);
    lines.forEach((t, i) => {
      g.font = i === 0 ? font : font.replace(/\d+px/, (m) => `${Math.round(parseInt(m) * 0.62)}px`);
      g.fillText(t, w / 2, step * (i + 1), w - 24);
    });
    if (led) {                         // rejilla de puntos del letrero LED
      g.fillStyle = "rgba(0,0,0,.35)";
      for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
      for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    }
  });
}

export class BusWorld {
  /**
   * @param {{scene:THREE.Scene, route:object, clock?:number, hour?:number, ride?:boolean}} o
   *   clock: hora del día en segundos (o hour, 0..24) para el cielo y las luces · ride: el jugador va sentado adentro
   */
  constructor({ scene, route, clock, hour = 12, ride = false, vehicle = "bus", renderer = null }) {
    this.scene = scene;
    this.renderer = renderer;
    this.clock = clock ?? hour * 3600;
    this.taxi = vehicle === "taxi";
    this.route = route;
    this.ride = ride;
    this.rng = makeRng(20261115);
    // 1.20 · El mismo cielo que ve el Metro al aire libre: hora y nubosidad del clima vigente
    this.sky = skyAt(clock ?? hour * 3600);
    this.rainAmount = WEATHER.rain;
    this.wet = WEATHER.wet;
    this.night = this.sky.day < 0.3;
    this.dusk = !this.night && (this.sky.dusk > 0.25 || this.sky.day < 0.6);
    this.start = -220;
    this.end = route.length + 380;
    this.len = this.end - this.start;
    this.zMid = -(this.start + this.end) / 2;
    this.carMeshes = new Map();
    this.path = new RoutePath(route);            // 2.3 · trazado real (la calle dobla como el recorrido)
    this.buildSky();
    const before = new Set(scene.children);
    this.buildGround();
    this.buildRoadMarks();
    this.buildMedian();
    this.buildBuildings();
    this.buildLamps();
    this.buildCrossStreets();
    this.buildStops();
    this.buildLights();
    const statics = scene.children.filter(o => !before.has(o) && o !== this.ground);
    this.bus = this.taxi ? this.buildTaxi() : this.buildBus();
    this.buildOncoming();
    const before2 = new Set(scene.children);
    this.buildMetroAccesses();
    statics.push(...scene.children.filter(o => !before2.has(o)));
    this.bendStatic(statics);
    // 2.4 · Sombras: todo lo fijo proyecta sombra; el piso, los edificios y los paraderos la reciben
    for (const o of statics) shadows(o, { cast: true, receive: true });
    shadows(this.bus, { cast: true, receive: true });
    for (const o of this.oncoming) shadows(o.mesh);
    this.ground.receiveShadow = true;
    this.buildRain();
    // 1.19 · pasajeros 3D; 1.20: también bajan al Metro por el acceso y pasa gente por las veredas
    this.people = new BusPeople(scene, route, this.body, { ride, accesses: this.accesses, taxi: this.taxi ? TAXI_SEATS : null, bend: this });
    const pr = this.people.renderer;
    if (pr) for (const m of [pr.box, pr.head, pr.hair]) m.castShadow = true;
    if (this.taxi) this.buildFareMarker();
  }

  /* ----------------------------- 2.3 · La calle dobla con el recorrido ----------------------------- */
  /** Matriz que lleva el espacio «recto» (x de lado, z = −s) al mapa en el entorno de `s`. */
  bendMatrix(s, out = new THREE.Matrix4()) {
    const f = this.path.frame(s, this._f ??= {});
    out.makeRotationY(f.phi);
    out.setPosition(f.x, 0, f.z);
    return out.multiply(TZ.makeTranslation(0, 0, s));
  }
  /** Rumbo de la calle en `s` (radianes, giro sobre Y). */
  heading(s) { return this.path.frame(s, this._f ??= {}).phi; }
  /** Punto recto → mapa. */
  toWorld(x, y, z, out = new THREE.Vector3()) { return this.path.toWorld(x, y, z, out); }
  /** Ubica un objeto que en el espacio recto está en (x, 0, −s) con su frente hacia −z y `len` de largo. */
  place(obj, x, s, len = 0, yaw = 0) {
    this.toWorld(x, 0, -s, obj.position);
    obj.rotation.set(0, this.heading(s + (this.path.straight ? 0 : -len / 2)) + yaw, 0);
  }

  /** Dobla lo que no se mueve (calle, veredas, edificios, paraderos…) siguiendo el trazado, una sola vez. */
  bendStatic(objs) {
    if (this.path.straight) return this.straightToEast(objs);
    const seenGeo = new Set(), M = new THREE.Matrix4(), W = new THREE.Matrix4(), B = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const lights = [];
    // 2.9.3 · Una geometría compartida por varias mallas (p. ej. las luces del semáforo) se dobla una vez por malla:
    // cada una parte de una copia SIN doblar (antes se clonaba la ya doblada y las luces quedaban lejos, sin verse)
    const pristine = new Map();
    const uses = new Map();
    for (const root of objs) root.traverse(o => { if (o.isMesh && !o.isInstancedMesh) uses.set(o.geometry, (uses.get(o.geometry) ?? 0) + 1); });
    for (const [geo, n] of uses) if (n > 1) pristine.set(geo, geo.clone());
    for (const root of objs) {
      root.updateMatrixWorld(true);
      root.traverse(o => {
        if (o.isInstancedMesh) {
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, M);
            W.multiplyMatrices(o.matrixWorld, M);
            W.decompose(v, q, sc);
            const sPos = -v.z;
            // Edificios, árboles y faroles que quedarían sobre la calle en la parte de adentro de una curva: no van
            if (Math.abs(v.x) > 7.5 && this.path.inside(v.x > 0 ? v.x - 2 : v.x + 2, sPos, 14)) { o.setMatrixAt(i, ZERO); continue; }
            this.bendMatrix(sPos, B).multiply(W);
            // 2.15.3 · Lo que está más allá de las veredas (edificios) se dobla entero, sin deformarse: en una curva
            // cerrada un edificio grande puede quedar montado sobre la calle (de este tramo o del de al lado). Se mira su
            // planta ya doblada y, si algún punto cae en la calle o las veredas, no va.
            if ((v.x > CURB_X + 6.2 || v.x < ROAD_FAR - 6.2) && this.overStreet(o.geometry, B, sPos)) { o.setMatrixAt(i, ZERO); continue; }
            o.setMatrixAt(i, B);
          }
          o.instanceMatrix.needsUpdate = true;
          o.frustumCulled = false;
        } else if (o.isMesh) {
          if (seenGeo.has(o.geometry)) o.geometry = pristine.get(o.geometry).clone();
          seenGeo.add(o.geometry);
          const geo = o.geometry;
          geo.applyMatrix4(o.matrixWorld);
          const pos = geo.attributes.position, nor = geo.attributes.normal;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            this.path.toWorld(x, y, z, v);
            pos.setXYZ(i, v.x, v.y, v.z);
            if (nor) {
              const phi = this.heading(-z), c = Math.cos(phi), sn = Math.sin(phi);
              const nx = nor.getX(i), nz = nor.getZ(i);
              nor.setXYZ(i, nx * c + nz * sn, nor.getY(i), -nx * sn + nz * c);
            }
          }
          pos.needsUpdate = true;
          if (nor) nor.needsUpdate = true;
          geo.computeBoundingSphere();
          geo.computeBoundingBox();
        } else if (o.isLight) {
          o.getWorldPosition(v);
          lights.push([o, this.toWorld(v.x, v.y, v.z)]);
        }
      });
      // Todo quedó en coordenadas del mapa: las transformaciones del grupo vuelven a cero
      root.traverse(o => { if (!o.isLight) { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); } });
    }
    for (const [l, p] of lights) { l.parent?.worldToLocal(p); l.position.copy(p); }
  }
  /** 2.15.3 · ¿La planta de `geo` (con la matriz ya doblada `B`) pisa la calzada o las veredas en algún punto? */
  overStreet(geo, B, sPos) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox, p = (this._osP ??= new THREE.Vector3());
    const lo = ROAD_FAR - 6.2 + 0.3, hi = CURB_X + 6.2 - 0.3;
    for (const fx of [0, 0.25, 0.5, 0.75, 1]) for (const fz of [0, 0.25, 0.5, 0.75, 1]) {
      p.set(bb.min.x + (bb.max.x - bb.min.x) * fx, 0, bb.min.z + (bb.max.z - bb.min.z) * fz).applyMatrix4(B);
      const lat = this.path.lateralAt(p.x, p.z, sPos);
      if (lat != null && lat > lo && lat < hi) return true;
    }
    return false;
  }
  /** A01 de práctica (sin trazado): la calle recta va hacia el oriente. */
  straightToEast(objs) {
    const g = new THREE.Group();
    g.rotation.y = -Math.PI / 2;
    this.scene.add(g);
    for (const o of objs) g.add(o);
  }

  /* ----------------------------- Cielo y luz ----------------------------- */
  buildSky() {
    const s = this.scene;
    const K = this.sky, rain = this.rainAmount;
    // 2.4 · Cielo con degradado, sol y nubes; la niebla toma el color del horizonte
    this.sunDir = sunDirection(this.clock);
    this.dome = new SkyDome();
    const sky = this.dome.set(K, this.sunDir).clone();
    s.add(this.dome);
    s.background = sky;
    // Neblina: más corta con lluvia y de noche (la misma idea que la vía al aire libre del Metro)
    s.fog = new THREE.Fog(sky, 90 - 40 * rain, (this.night ? 420 : 700) * (1 - 0.45 * rain) - 80 * K.cloud);
    const hemi = new THREE.HemisphereLight(this.night ? "#3a4c78" : "#dfeaff", this.night ? "#2a2620" : "#5d5446", 0.75 + 0.45 * K.light);
    s.add(hemi);
    const sunColor = new THREE.Color(this.night ? "#8fa6d8" : "#fff4e0").lerp(new THREE.Color("#ffc58f"), Math.min(1, K.dusk));
    const sun = new THREE.DirectionalLight(sunColor, this.night ? 0.45 : 0.35 + 2.4 * K.light);
    sun.position.set(-60, 120, 40);
    s.add(sun, sun.target);
    this.sun = sun;
    if (this.renderer) {
      this.shadow = new SunShadow(this.renderer, sun);
      // Autos, vidrios y la calzada mojada reflejan este mismo cielo
      s.environment = skyEnvironment(this.renderer, this.dome);
      s.environmentIntensity = this.night ? 0.25 : 0.55;
      hemi.intensity *= this.night ? 0.9 : 0.62;
    }
    // La cordillera al fondo (hacia el oriente, adonde va el bus)
    const mtn = canvasTexture(1024, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = this.night ? "#1a2336" : "#8b97a8";
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, h * (0.45 + 0.25 * Math.sin(x * 0.011) + 0.12 * Math.sin(x * 0.037 + 1)));
      g.lineTo(w, h); g.fill();
      if (!this.night) {                    // nieve en las cumbres
        g.globalCompositeOperation = "source-atop";
        g.fillStyle = "#eef2f6"; g.fillRect(0, 0, w, h * 0.42);
      }
    });
    // Con nubes la cordillera casi no se ve (como en Santiago los días grises)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2600, 420), new THREE.MeshBasicMaterial({ map: mtn, transparent: true, opacity: this.night ? 0.8 : Math.max(0.12, 1 - 0.85 * K.cloud), fog: false, depthWrite: false }));
    m.rotation.y = -Math.PI / 2;            // mira al poniente: la cordillera queda al oriente (como en Santiago)
    m.renderOrder = -1;
    s.add(m);
    this.mountains = m;
  }

  /* ----------------------------- Suelo, calzada y veredas ----------------------------- */
  buildGround() {
    const s = this.scene, rng = this.rng;
    const asphalt = asphaltTexture();
    const roadW = CURB_X - ROAD_FAR;
    // 1.20 · Con lluvia la calzada se ve mojada: más oscura y con brillo (reflejos de faroles y focos)
    const wetK = Math.min(1, this.wet);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(roadW, this.len, 1, Math.ceil(this.len / 3)), worldUV(std(new THREE.Color("#ffffff").lerp(new THREE.Color("#8d9196"), wetK), { map: asphalt, roughnessMap: asphaltRoughness(), roughness: 0.95 - 0.65 * wetK, metalness: 0.2 * wetK }), ASPHALT_TILE));
    road.rotation.x = -Math.PI / 2;
    road.position.set((CURB_X + ROAD_FAR) / 2, 0, this.zMid);
    s.add(road);

    // Pista Solo Bus: un poco más rojiza
    const busLane = new THREE.Mesh(new THREE.PlaneGeometry(3.3, this.len, 1, Math.ceil(this.len / 3)), std("#6a3b37", { roughness: 0.95, transparent: true, opacity: 0.55 }));
    busLane.rotation.x = -Math.PI / 2;
    busLane.position.set(LANES[0], 0.004, this.zMid);
    s.add(busLane);

    const walkMat = worldUV(std(new THREE.Color("#ffffff").lerp(new THREE.Color("#9a9a9a"), 0.6 * Math.min(1, this.wet)), { map: paverTexture(), roughness: 0.9 - 0.4 * Math.min(1, this.wet) }), PAVER_TILE);
    // Vereda del lado del bus en tres franjas: la del medio deja el hueco de la escalera del Metro
    const ax0 = ACCESS.dx - ACCESS.w / 2 - 0.05, ax1 = ACCESS.dx + ACCESS.w / 2 + 0.05;
    box(s, ax0, 0.16, this.len, walkMat, CURB_X + ax0 / 2, 0.08, this.zMid);
    box(s, 6.2 - ax1, 0.16, this.len, walkMat, CURB_X + (ax1 + 6.2) / 2, 0.08, this.zMid);
    const holes = this.accessStops().map(st => -st.s + ACCESS.dz).sort((a, b) => b - a);
    let zTop = -this.start;
    for (const zc of [...holes, -Infinity]) {
      const zEnd = zc === -Infinity ? -this.end : zc + ACCESS.len / 2;
      if (zTop - zEnd > 0.05) box(s, ax1 - ax0, 0.16, zTop - zEnd, walkMat, CURB_X + (ax0 + ax1) / 2, 0.08, (zTop + zEnd) / 2);
      zTop = zc - ACCESS.len / 2;
    }
    box(s, 6.2, 0.16, this.len, walkMat, ROAD_FAR - 3.1, 0.08, this.zMid);
    const curbMat = std("#c9c6bf");
    box(s, 0.25, 0.18, this.len, curbMat, CURB_X + 0.12, 0.09, this.zMid);
    box(s, 0.25, 0.18, this.len, curbMat, ROAD_FAR - 0.12, 0.09, this.zMid);

    // Terreno: un plano grande que acompaña al vehículo (la calle dobla encima)
    // 2.15.2 · No se dibuja donde las bocas del Metro marcaron el stencil (ACCESS_MASK): ahí se ve la escalera
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200, 64, 64), worldUV(std(this.night ? "#3a3c3a" : "#b9b7a4", { map: grassTexture(),
      stencilWrite: true, stencilWriteMask: 0, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc }), GRASS_TILE));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;            // 2.15.4 · más abajo y en cuadros: con triángulos de 3 km tapaba la calzada en algunas GPU
    s.add(ground);
    this.ground = ground;
  }

  buildRoadMarks() {
    const s = this.scene;
    const white = std("#e9e9e4", { roughness: 0.7 });
    const line = (x, w = 0.15) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, this.len, 1, Math.ceil(this.len / 3)), white);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.012, this.zMid);
      s.add(m);
    };
    line((LANES[0] + LANES[1]) / 2, 0.22);          // separa la pista Solo Bus (continua)
    line(MEDIAN_X - 0.25);
    line(CURB_X - 0.3);
    line(MEDIAN_FAR - 0.25 - 0.1);
    line(ROAD_FAR + 0.3);
    // Líneas segmentadas
    const xs = [(LANES[1] + LANES[2]) / 2, (ONCOMING[0] + ONCOMING[1]) / 2, (ONCOMING[1] + ONCOMING[2]) / 2];
    const per = Math.floor(this.len / 10);
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 3.2), white, per * xs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (const x of xs) for (let i = 0; i < per; i++) dash.setMatrixAt(k++, m4.compose(new THREE.Vector3(x, 0.012, -(this.start + i * 10)), q, one));
    s.add(dash);

    // «SOLO BUS» pintado en la pista
    const txt = canvasTexture(256, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#f0efe8"; g.font = "800 120px Barlow Condensed, Arial Narrow, Arial"; g.textAlign = "center";
      // 2.9.3 · Al derecho para quien se acerca: «SOLO» más cerca y «BUS» más adelante (antes se veía de cabeza)
      g.fillText("BUS", w / 2, h * 0.38); g.fillText("SOLO", w / 2, h * 0.78);
    });
    const decalMat = new THREE.MeshStandardMaterial({ map: txt, transparent: true, roughness: 0.7, depthWrite: false });
    const marks = [];
    for (let sPos = 20; sPos < this.route.length; sPos += 70) {
      if (this.route.stops.some(st => Math.abs(st.s - sPos) < 26) || this.route.lights.some(l => Math.abs(l.s - sPos) < 20)) continue;
      marks.push(sPos);
    }
    const decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 4.4), decalMat, marks.length);
    marks.forEach((sPos, i) => decals.setMatrixAt(i, m4.compose(new THREE.Vector3(LANES[0], 0.015, -sPos), q, one)));
    s.add(decals);
  }

  /* ----------------------------- Bandejón central ----------------------------- */
  buildMedian() {
    const s = this.scene, rng = this.rng;
    const w = MEDIAN_X - MEDIAN_FAR;
    box(s, w, 0.2, this.len, worldUV(std(this.night ? "#4a5a48" : "#ffffff", { map: grassTexture(), roughness: 1 }), GRASS_TILE), (MEDIAN_X + MEDIAN_FAR) / 2, 0.1, this.zMid);
    const curb = std("#c9c6bf");
    box(s, 0.2, 0.22, this.len, curb, MEDIAN_X - 0.1, 0.11, this.zMid);
    box(s, 0.2, 0.22, this.len, curb, MEDIAN_FAR + 0.1, 0.11, this.zMid);
    // Árboles del bandejón y de las veredas
    const spots = [];
    for (let z = this.start; z < this.end; z += 13) {
      if (this.route.lights.some(l => Math.abs(l.s + 8 - z) < 10)) continue;
      spots.push([(MEDIAN_X + MEDIAN_FAR) / 2 + (rng() - 0.5) * 1.2, z + rng() * 4]);
      const ts = z + 6 + rng() * 3;
      if (!this.route.stops.some(st => ts > st.s - 10 && ts < st.s + (st.metro ? 15 : 6))) spots.push([CURB_X + 4.4, ts]);
      spots.push([ROAD_FAR - 4.4, z + 3 + rng() * 3]);
    }
    // 2.4 · Copas de varios bultos (con sombra propia) y troncos con ramas, en tres formas distintas
    const trunks = new THREE.InstancedMesh(trunkGeometry(), std("#5b4a3a", { roughness: 1 }), spots.length);
    const leaf = leafMaterial(this.night ? "#55705a" : "#ffffff");
    const crownSets = [1, 2, 3].map(k => new THREE.InstancedMesh(crownGeometry(k), leaf, spots.length));
    const crownN = [0, 0, 0];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    spots.forEach(([x, sPos], i) => {
      const k = 0.75 + rng() * 0.4;
      trunks.setMatrixAt(i, m4.compose(v.set(x, 0, -sPos), q, sc.set(1.3 * k, 4.6 + k * 0.6, 1.3 * k)));
      const set = Math.floor(rng() * 3), crowns = crownSets[set], j = crownN[set]++;
      crowns.setMatrixAt(j, m4.compose(v.set(x, 5.2 + k * 0.8, -sPos), q.setFromEuler(new THREE.Euler(0, rng() * 6, 0)), sc.set(2.2 * k, 1.9 * k * (0.85 + rng() * 0.3), 2.2 * k)));
      crowns.setColorAt(j, col.setHSL(0.24 + rng() * 0.07, 0.42 + rng() * 0.1, (this.night ? 0.16 : 0.3) + rng() * 0.08));
      q.identity();
    });
    crownSets.forEach((c, i) => { c.count = crownN[i]; });
    s.add(trunks, ...crownSets);
  }

  /* ----------------------------- Edificios ----------------------------- */
  buildBuildings() {
    const s = this.scene, rng = this.rng;
    const crossings = this.route.lights.map(l => l.s + 8);
    const lots = [];
    for (const side of [1, -1]) {
      let sPos = this.start;
      while (sPos < this.end) {
        const w = 14 + rng() * 26;
        const mid = sPos + w / 2;
        if (crossings.some(c => Math.abs(c - mid) < w / 2 + 7)) { sPos += 9; continue; }
        const tall = rng();
        const h = tall < 0.55 ? 9 + rng() * 14 : tall < 0.9 ? 22 + rng() * 20 : 45 + rng() * 40;
        const d = 12 + rng() * 14;
        const x0 = side > 0 ? CURB_X + 6.4 : ROAD_FAR - 6.4;
        lots.push({ x: x0 + side * d / 2, z: -mid, w: w - 1.2, h, d });
        sPos += w;
      }
    }
    // 2.4 · Fachadas con ventanas por piso (según el alto real de cada edificio), vidrio que refleja el cielo,
    // cortinas y manchas; edificios de oficinas o de muro cortina
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const tones = ["#d8cfc0", "#b9b2a6", "#c7c9c8", "#e2d6bf", "#9fa7ad", "#cdb89a", "#a8988a", "#e6e1d8", "#c98f72", "#8f9a8c"];
    const glassTones = ["#9fb4c6", "#8ea3a6", "#a9b3bd", "#7f95ab"];
    for (const kind of ["office", "glass"]) {
      const mine = lots.filter(b => (b.kind ??= b.h > 30 && rng() < 0.55 ? "glass" : "office") === kind);
      if (!mine.length) continue;
      const fs = facadeSet(kind);
      const lit = this.night || this.dusk;
      const mat = facadeUV(std("#ffffff", { map: fs.map, roughnessMap: fs.roughnessMap, roughness: 0.9, metalness: kind === "glass" ? 0.35 : 0.08,
        ...(lit ? { emissiveMap: fs.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: this.night ? 0.75 : 0.25 } : {}) }));
      const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
      mine.forEach((b, i) => {
        mesh.setMatrixAt(i, m4.compose(v.set(b.x, b.h / 2, b.z), q, sc.set(b.d, b.h, b.w)));
        const pal = kind === "glass" ? glassTones : tones;
        mesh.setColorAt(i, col.set(pal[Math.floor(rng() * pal.length)]));
      });
      s.add(mesh);
    }
    // Primer piso con locales (franja oscura con toldos de colores)
    const shop = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std("#ffffff", { roughness: 0.6 }), lots.length);
    lots.forEach((b, i) => {
      const side = b.x > 0 ? 1 : -1;
      shop.setMatrixAt(i, m4.compose(v.set(b.x - side * (b.d / 2 - 0.05), 3.4, b.z), q, sc.set(0.5, 0.5, b.w * 0.9)));
      shop.setColorAt(i, col.setHSL(rng(), 0.55, 0.45));
    });
    s.add(shop);
  }

  buildLamps() {
    const s = this.scene;
    const spots = [];
    for (let sPos = this.start + 5; sPos < this.end; sPos += 32) {
      spots.push([CURB_X + 0.6, sPos, -1], [(MEDIAN_X + MEDIAN_FAR) / 2, sPos + 16, 0], [ROAD_FAR - 0.6, sPos + 8, 1]);
    }
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 8.5, 6), std("#4d5359", { metalness: 0.4, roughness: 0.5 }), spots.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 1.1),
      new THREE.MeshStandardMaterial({ color: "#222", emissive: new THREE.Color(this.night ? "#ffd9a0" : "#000"), emissiveIntensity: this.night ? 1.6 : 0 }), spots.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    spots.forEach(([x, sPos, dir], i) => {
      poles.setMatrixAt(i, m4.compose(v.set(x, 4.25, -sPos), q, one));
      const arms = dir === 0 ? [-1.4, 1.4] : [dir * 1.6];
      for (const a of arms) heads.setMatrixAt(k++, m4.compose(v.set(x + a, 8.4, -sPos), q, one));
    });
    heads.count = k;
    s.add(poles, heads);
    // 2.4 · De noche, cada farol deja un círculo de luz cálida en el piso (sin luces reales: es un dibujo sumado)
    if (this.night || this.dusk) {
      const pool = canvasTexture(128, 128, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grd.addColorStop(0, "rgba(255,214,150,1)"); grd.addColorStop(0.45, "rgba(255,190,120,.45)"); grd.addColorStop(1, "rgba(255,170,100,0)");
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
      });
      const poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, opacity: this.night ? 0.55 : 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
      const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11), poolMat, k);
      const qf = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      let n = 0;
      spots.forEach(([x, sPos, dir]) => {
        const arms = dir === 0 ? [-1.4, 1.4] : [dir * 1.6];
        for (const a of arms) pools.setMatrixAt(n++, m4.compose(v.set(x + a * 1.6, 0.2, -sPos), qf, one));
      });
      pools.count = n;
      pools.renderOrder = 2;
      s.add(pools);
    }
  }

  /* ----------------------------- Calles que cruzan ----------------------------- */
  buildCrossStreets() {
    const s = this.scene;
    const asphalt = std("#3a3d41", { roughness: 0.95 });
    const white = std("#ecebe5", { roughness: 0.7 });
    const zebra = [];
    for (const L of this.route.lights) {
      const zc = -(L.s + 8);
      const cross = new THREE.Mesh(new THREE.PlaneGeometry(240, 11), asphalt);
      cross.rotation.x = -Math.PI / 2;
      cross.position.set(-5, 0.006, zc);
      s.add(cross);
      // Corta veredas y bandejón con calzada
      for (const [x, w] of [[CURB_X + 3.1, 6.3], [ROAD_FAR - 3.1, 6.3], [(MEDIAN_X + MEDIAN_FAR) / 2, MEDIAN_X - MEDIAN_FAR + 0.5]]) box(s, w, 0.02, 11, asphalt, x, 0.235, zc);
      // Línea de detención y paso de cebra
      const stop = new THREE.Mesh(new THREE.PlaneGeometry(CURB_X - MEDIAN_X, 0.5), white);
      stop.rotation.x = -Math.PI / 2;
      stop.position.set((CURB_X + MEDIAN_X) / 2, 0.016, -L.s);
      s.add(stop);
      // 2.9.4 · y la de la vuelta, al otro lado del cruce (junto a su semáforo)
      const stopBack = new THREE.Mesh(new THREE.PlaneGeometry(MEDIAN_FAR - ROAD_FAR, 0.5), white);
      stopBack.rotation.x = -Math.PI / 2;
      stopBack.position.set((ROAD_FAR + MEDIAN_FAR) / 2, 0.016, -(L.s + 16));
      s.add(stopBack);
      for (let x = ROAD_FAR + 0.6; x < CURB_X - 0.3; x += 1.1) {
        if (x > MEDIAN_FAR && x < MEDIAN_X) continue;
        zebra.push([x, -(L.s + 2.6)]);
      }
      // Nombre de la calle en un letrero verde
      const tex = signTexture([L.street], { w: 512, h: 112, bg: "#1f6b3a", font: "700 60px Barlow, Arial" });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.57), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 }));
      plate.position.set(CURB_X + 0.7, 3.4, -(L.s + 2.0));
      plate.rotation.y = -Math.PI / 2;                   // 2.9.3 · de cara a la calzada (antes se leía al revés)
      s.add(plate);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const zm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 3.4), white, zebra.length);
    zebra.forEach(([x, z], i) => zm.setMatrixAt(i, m4.compose(v.set(x, 0.016, z), q, one)));
    s.add(zm);
  }

  /* ----------------------------- Paraderos ----------------------------- */
  buildStops() {
    const s = this.scene, rng = this.rng;
    const roof = std("#2c3a48", { metalness: 0.3, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: "#9cc3d9", transparent: true, opacity: 0.35, roughness: 0.1 });
    const post = std("#5d656c", { metalness: 0.5, roughness: 0.4 });
    const yellow = std("#f2c230", { roughness: 0.7 });
    this.route.stops.forEach((st, i) => {
      const z = -st.s;
      const g = new THREE.Group();
      g.position.set(0, 0, z);
      s.add(g);
      // Refugio detrás de la marca de la puerta delantera
      const zc = 6;
      box(g, 2.2, 0.12, 5.2, roof, CURB_X + 2.6, 2.75, zc);
      box(g, 0.08, 2.6, 0.08, post, CURB_X + 1.6, 1.45, zc - 2.4);
      box(g, 0.08, 2.6, 0.08, post, CURB_X + 1.6, 1.45, zc + 2.4);
      box(g, 0.05, 2.0, 5.0, glass, CURB_X + 3.6, 1.35, zc);
      box(g, 0.5, 0.08, 3.4, std("#7b5b3d"), CURB_X + 3.2, 0.6, zc);
      // Panel con el nombre
      const tex = signTexture(["PARADERO", st.name], { w: 512, h: 220, bg: "#0f3d7a", font: "800 50px Barlow Condensed, Arial Narrow, Arial" });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.86), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.5, emissive: new THREE.Color("#ffffff"), emissiveMap: tex, emissiveIntensity: this.night ? 0.7 : 0.12 }));
      panel.position.set(CURB_X + 2.6, 3.3, zc);
      panel.rotation.y = -Math.PI / 2;
      g.add(panel);
      // Señal de parada en la marca (aquí debe quedar la puerta delantera)
      box(g, 0.08, 2.8, 0.08, post, CURB_X + 0.5, 1.4, 0);
      const plate = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshStandardMaterial({ map: signTexture(["BUS"], { w: 128, h: 128, bg: "#0f3d7a", font: "800 54px Barlow Condensed, Arial Narrow, Arial" }), side: THREE.DoubleSide }));
      plate.position.set(CURB_X + 0.5, 2.85, 0);
      plate.rotation.y = -Math.PI / 2;
      g.add(plate);
      // Cajón amarillo pintado en la pista: zona del paradero
      const zone = [[0, 0.3, 0.25, 0], [0, 0.3, 0.25, BUS_LENGTH + 2], [-1.55, 0.25, BUS_LENGTH + 2, (BUS_LENGTH + 2) / 2], [1.55, 0.25, BUS_LENGTH + 2, (BUS_LENGTH + 2) / 2]];
      for (const [dx, w, d, dz] of zone) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(dx === 0 ? 3.3 : w, d), yellow);
        m.rotation.x = -Math.PI / 2;
        m.position.set(LANES[0] + dx, 0.018, dz);
        g.add(m);
      }
    });
  }

  /* ----------------------------- Semáforos ----------------------------- */
  buildLights() {
    const s = this.scene;
    const pole = std("#3b4147", { metalness: 0.5, roughness: 0.45 });
    const housing = std("#1a1c1e", { roughness: 0.6 });
    const lampGeo = new THREE.CircleGeometry(0.15, 16);
    this.signals = this.route.lights.map(L => {
      const mats = {};
      /* 2.9.4 · El mismo semáforo también para el otro sentido (taxi tras una vuelta en U, autos de la vuelta): espejado al
         otro lado del bandejón (x → MIRROR_X − x, como en taxiSim), con su línea de detención al otro lado del cruce
         (L.s + 16, donde la pone el recorrido al revés) y mirando hacia la vuelta. Mismas luces: cambian juntas. */
      for (const back of [false, true]) {
        const g = new THREE.Group();
        g.position.set(back ? MIRROR_X : 0, 0, -(back ? L.s + 16 : L.s));
        if (back) g.rotation.y = Math.PI;               // el espacio del grupo queda como el de la ida, girado
        s.add(g);
        box(g, 0.18, 6.2, 0.18, pole, CURB_X + 0.5, 3.1, 0);
        box(g, CURB_X + 0.5 - LANES[1] + 0.6, 0.14, 0.14, pole, (CURB_X + 0.5 + LANES[1] - 0.6) / 2, 6.0, 0);
        const head = (x, y) => {
          box(g, 0.42, 1.15, 0.3, housing, x, y, 0);
          [["red", "#ff2d22", 0.36], ["amber", "#ffb21e", 0], ["green", "#2cff7a", -0.36]].forEach(([k, c, dy]) => {
            mats[k] ??= new THREE.MeshStandardMaterial({ color: "#222", emissive: new THREE.Color(c), emissiveIntensity: 0.05 });
            const lamp = new THREE.Mesh(lampGeo, mats[k]);
            lamp.position.set(x, y + dy, 0.16);
            g.add(lamp);
          });
        };
        head(LANES[1], 5.3);
        head(LANES[0] - 0.6, 5.3);
        head(CURB_X + 0.5, 2.9);
      }
      return { light: L, mats, state: null };
    });
  }

  /* ----------------------------- El bus ----------------------------- */
  buildBus() {
    const g = new THREE.Group();
    const L = BUS_LENGTH, W = BUS_WIDTH;
    const white = std("#eef0f2", { roughness: 0.45, metalness: 0.1 });
    const red = std(this.route.color, { roughness: 0.5 });
    const dark = std("#1d2024", { roughness: 0.7 });
    const body = new THREE.Group();
    g.add(body);
    // Carrocería (origen = centro del frente, al nivel del suelo; el bus se extiende hacia +z).
    // 1.19: con paneles y ventanas translúcidas (ya no una caja maciza) para que se vea a la gente adentro.
    const BOT = 0.475, WIN0 = 1.655, WIN1 = 2.705, TOP = 3.025;
    const glassT = new THREE.MeshStandardMaterial({ color: "#22323f", roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.38, depthWrite: false });
    const DOOR_GAPS = [[0.65, 1.85], [5.0, 6.2], [9.35, 10.55]];          // vanos de las puertas (lado derecho)
    const spans = (a, b, gaps) => {                                      // tramos de [a, b] fuera de los vanos
      const out = []; let x = a;
      for (const [g0, g1] of gaps) { if (g0 > x) out.push([x, Math.min(g0, b)]); x = Math.max(x, g1); }
      if (x < b) out.push([x, b]);
      return out.filter(([p, q]) => q - p > 0.02);
    };
    for (const side of [-1, 1]) {
      const x = side * (W / 2 - 0.02), gaps = side > 0 ? DOOR_GAPS : [];
      for (const [a, b] of spans(0, L, gaps)) box(body, 0.04, WIN0 - BOT, b - a, white, x, (BOT + WIN0) / 2, (a + b) / 2);   // bajo las ventanas
      box(body, 0.04, TOP - WIN1, L, white, x, (WIN1 + TOP) / 2, L / 2);                                                  // sobre las ventanas
      // 2.17.2 · Al lado del conductor (izquierda) la ventana empieza a 0,25 m del frente: antes un panel blanco de 1,3 m
      // tapaba un tercio de la vista desde la cabina
      const w0 = side > 0 ? 0.65 : 0.25;
      for (const [a, b] of spans(0, L, [[w0, 11.3]])) box(body, 0.04, WIN1 - WIN0, b - a, white, x, (WIN0 + WIN1) / 2, (a + b) / 2);   // pilares de los extremos
      for (const z of [3.3, 4.45, 7.0, 8.2, 11.25]) if (!gaps.some(([g0, g1]) => z > g0 - 0.1 && z < g1 + 0.1)) box(body, 0.05, WIN1 - WIN0, 0.09, white, side * (W / 2 - 0.01), (WIN0 + WIN1) / 2, z);
      for (const [a, b] of spans(side > 0 ? 1.3 : w0, 11.3, gaps)) box(body, 0.02, WIN1 - WIN0, b - a, glassT, side * (W / 2 + 0.005), (WIN0 + WIN1) / 2, (a + b) / 2);   // ventanas
    }
    box(body, W, 1.225 - BOT, 0.04, white, 0, (BOT + 1.225) / 2, 0.0);   // frente bajo el parabrisas
    box(body, W, 1.75 - BOT, 0.04, white, 0, (BOT + 1.75) / 2, L);       // atrás: bajo la luneta
    box(body, W, TOP - 2.65, 0.04, white, 0, (2.65 + TOP) / 2, L);       // sobre la luneta
    for (const x of [-1, 1]) box(body, 0.16, 0.9, 0.04, white, x * (W / 2 - 0.08), 2.2, L);
    for (const side of [-1, 1]) {                                        // franjas rojas
      box(body, 0.02, 0.5, L - 0.2, red, side * (W / 2 + 0.01), 0.72, L / 2);
      box(body, 0.02, 0.12, L - 0.4, red, side * (W / 2 + 0.015), 1.42, L / 2);
    }
    box(body, W - 0.2, 0.5, 0.02, red, 0, 0.72, -0.01);                  // franja del frente
    box(body, W - 0.2, 0.5, 0.02, red, 0, 0.72, L + 0.01);               // y de atrás
    const windshield = new THREE.MeshStandardMaterial({ color: "#1b2733", roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.55, depthWrite: false });
    this.windshield = box(body, W - 0.2, 1.45, 0.02, windshield, 0, 1.95, -0.01);   // parabrisas (se ve a través desde la cabina)
    box(body, W - 0.3, 0.9, 0.02, glassT, 0, 2.2, L + 0.01);              // luneta
    box(body, W - 0.1, 0.12, 0.08, dark, 0, 0.45, -0.02);                 // parachoques
    box(body, W, 0.1, L, std("#d4d7da"), 0, 3.06, L / 2);                // techo
    box(body, 1.6, 0.35, 3.2, std("#c8ccd0"), 0, 3.25, L * 0.62);        // equipo de aire acondicionado
    // Letrero LED con el recorrido
    const ledTex = signTexture([`${this.route.id}  ${this.route.to.toUpperCase()}`], { w: 512, h: 80, bg: "#100c05", fg: "#ffb000", font: "700 52px JetBrains Mono, monospace", led: true });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.33), new THREE.MeshBasicMaterial({ map: ledTex }));
    led.position.set(0, 2.82, -0.05);
    led.rotation.y = Math.PI;
    body.add(led);
    const sideLed = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.25), new THREE.MeshBasicMaterial({ map: ledTex }));
    sideLed.position.set(W / 2 + 0.03, 2.55, 2.6);
    sideLed.rotation.y = Math.PI / 2;
    body.add(sideLed);
    // Luces
    this.headMat = new THREE.MeshStandardMaterial({ color: "#fff", emissive: new THREE.Color("#fff6dd"), emissiveIntensity: this.night ? 2 : 0.3 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: "#400", emissive: new THREE.Color("#ff1a10"), emissiveIntensity: 0.4 });
    for (const x of [-0.95, 0.95]) {
      box(body, 0.42, 0.2, 0.05, this.headMat, x, 0.82, -0.03);
      box(body, 0.25, 0.5, 0.05, this.tailMat, x, 1.0, L + 0.03);
    }
    this.blinkMat = new THREE.MeshStandardMaterial({ color: "#552e00", emissive: new THREE.Color("#ffa000"), emissiveIntensity: 0 });
    for (const [x, z] of [[-W / 2, 0.15], [W / 2, 0.15], [-W / 2, L - 0.15], [W / 2, L - 0.15]]) box(body, 0.06, 0.16, 0.22, this.blinkMat, x, 1.1, z);
    this.blinkDir = 0;
    // Espejos
    for (const x of [-1, 1]) box(body, 0.08, 0.38, 0.16, dark, x * (W / 2 + 0.25), 2.25, 0.25);
    // Ruedas
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const tire = std("#16181a", { roughness: 0.9 });
    for (const z of [2.6, 8.9]) for (const x of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, tire);
      w.position.set(x * (W / 2 - 0.12), 0.5, z);
      body.add(w);
      this.wheels.push(w);
    }
    // Puertas del lado derecho (delantera, central y trasera): dos hojas que se abren hacia los lados
    this.doorLeaves = [];
    const doorMat = new THREE.MeshStandardMaterial({ color: "#2a3640", roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.6 });
    for (const zc of [1.25, 5.6, 9.95]) {
      for (const side of [-1, 1]) {
        const leaf = box(body, 0.06, 2.35, 0.6, doorMat, W / 2 + 0.02, 1.48, zc + side * 0.3);
        leaf.userData = { z0: zc + side * 0.3, side };
        this.doorLeaves.push(leaf);
      }
    }
    // Cabina (se ve desde la vista del conductor): tablero, volante, pilares y techo
    const dash = std("#22262b", { roughness: 0.8 });
    box(body, W - 0.15, 0.55, 0.5, dash, 0, 1.05, 0.35);
    box(body, 0.6, 0.2, 0.32, std("#0d1a24", { emissive: new THREE.Color("#2a6f98"), emissiveIntensity: 0.6 }), -0.75, 1.42, 0.45);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 24), dash);
    wheel.position.set(-0.75, 1.5, 0.72);
    wheel.rotation.x = -1.0;
    body.add(wheel);
    this.steering = wheel;
    for (const x of [-1, 1]) box(body, 0.07, 1.45, 0.07, white, x * (W / 2 - 0.05), 1.95, 0.0);
    box(body, W, 0.3, 0.1, white, 0, 2.83, 0.0);
    box(body, W - 0.06, 0.04, L - 0.3, std("#3d4146", { roughness: 0.9 }), 0, 1.0, L / 2);   // piso del salón
    // 1.15 · Salón (se ve desde el asiento del pasajero): asientos, pasamanos y luces del techo
    const seat = std("#7a1d22", { roughness: 0.8 }), pole = std("#e2b021", { metalness: 0.5, roughness: 0.35 });
    for (let z = 2.6; z < L - 0.8; z += 1.05) {
      if (Math.abs(z - 5.6) < 1.1) continue;                         // espacio de la puerta central
      for (const x of [-0.78, 0.78]) {
        if (x > 0 && Math.abs(z - 9.95) < 0.8) continue;               // puerta trasera
        box(body, 0.85, 0.12, 0.45, seat, x, 1.48, z);
        box(body, 0.85, 0.55, 0.1, seat, x, 1.8, z + 0.22);
      }
    }
    for (const z of [3.2, 5.6, 7.6, 9.9]) for (const x of [-0.35, 0.35]) box(body, 0.04, 1.95, 0.04, pole, x, 2.0, z);
    box(body, 0.05, 0.05, L - 2, pole, -0.35, 2.92, L / 2 + 0.5);
    box(body, 0.05, 0.05, L - 2, pole, 0.35, 2.92, L / 2 + 0.5);
    box(body, 0.3, 0.03, L - 1.5, new THREE.MeshBasicMaterial({ color: "#f3f1e6" }), 0, 2.99, L / 2 + 0.3);
    this.body = body;
    this.scene.add(g);
    if (this.night) {
      const spot = new THREE.SpotLight("#fff3d6", 60, 70, 0.5, 0.6, 1.4);
      spot.position.set(0, 1.2, -0.2);
      spot.target.position.set(0, 0, -30);
      g.add(spot, spot.target);
    }
    return g;
  }

  /* ----------------------------- 2.2 · Taxi ----------------------------- */
  /** Taxi básico de Santiago: negro con el techo amarillo y el letrero TAXI. Mismo origen que el bus (centro del frente). */
  buildTaxi() {
    const g = new THREE.Group();
    const L = TAXI_L, W = TAXI_W;
    const black = std("#121417", { roughness: 0.32, metalness: 0.55 });
    const yellow = std("#f2c200", { roughness: 0.45, metalness: 0.2 });
    const dark = std("#1d2024", { roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: "#1d2a35", roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.42, depthWrite: false });
    const body = new THREE.Group();
    g.add(body);
    box(body, W, 0.5, L, black, 0, 0.5, L / 2);                         // carrocería
    box(body, W - 0.04, 0.12, 1.15, black, 0, 0.8, 0.65);                  // capó
    box(body, W - 0.04, 0.12, 0.9, black, 0, 0.8, L - 0.5);                // maleta
    // Cabina de vidrio (se ve a la gente adentro) con pilares
    for (const x of [-1, 1]) {
      box(body, 0.02, 0.48, 2.25, glass, x * (W / 2 - 0.08), 1.1, 2.55);
      for (const z of [1.45, 2.6, 3.65]) box(body, 0.06, 0.5, 0.08, black, x * (W / 2 - 0.08), 1.1, z);
    }
    this.windshield = box(body, W - 0.2, 0.5, 0.02, glass, 0, 1.1, 1.42);
    box(body, W - 0.2, 0.46, 0.02, glass, 0, 1.08, 3.68);
    box(body, W - 0.14, 0.06, 2.3, yellow, 0, 1.38, 2.55);               // techo amarillo
    // Letrero TAXI en el techo (se ilumina de noche)
    const tex = signTexture(["TAXI"], { w: 256, h: 80, bg: "#f2c200", fg: "#111", font: "800 56px Barlow, Arial" });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color("#ffd23a"), emissiveIntensity: this.night ? 0.8 : 0.1, emissiveMap: tex });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.2), signMat);
    sign.position.set(0, 1.5, 2.4);
    body.add(sign);
    box(body, W - 0.1, 0.12, 0.1, dark, 0, 0.3, -0.03);                  // parachoques
    box(body, W - 0.1, 0.12, 0.1, dark, 0, 0.3, L + 0.03);
    // Luces
    this.headMat = new THREE.MeshStandardMaterial({ color: "#fff", emissive: new THREE.Color("#fff6dd"), emissiveIntensity: this.night ? 2 : 0.3 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: "#400", emissive: new THREE.Color("#ff1a10"), emissiveIntensity: 0.4 });
    for (const x of [-0.68, 0.68]) {
      box(body, 0.34, 0.12, 0.04, this.headMat, x, 0.62, -0.01);
      box(body, 0.3, 0.14, 0.04, this.tailMat, x, 0.66, L + 0.01);
    }
    this.blinkMat = new THREE.MeshStandardMaterial({ color: "#552e00", emissive: new THREE.Color("#ffa000"), emissiveIntensity: 0 });
    for (const [x, z] of [[-W / 2, 0.2], [W / 2, 0.2], [-W / 2, L - 0.2], [W / 2, L - 0.2]]) box(body, 0.04, 0.08, 0.16, this.blinkMat, x, 0.64, z);
    for (const x of [-1, 1]) box(body, 0.16, 0.1, 0.08, black, x * (W / 2 + 0.08), 1.0, 1.55);   // espejos
    // Ruedas
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const tire = std("#16181a", { roughness: 0.9 });
    for (const z of [0.85, L - 0.85]) for (const x of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, tire);
      w.position.set(x * (W / 2 - 0.1), 0.32, z);
      body.add(w);
      this.wheels.push(w);
    }
    // Interior: tablero con el taxímetro, volante y asientos
    box(body, W - 0.2, 0.22, 0.3, dark, 0, 0.82, 1.6);
    box(body, 0.22, 0.08, 0.12, std("#0b0b0b", { emissive: new THREE.Color("#ff3b30"), emissiveIntensity: 0.9 }), 0.25, 0.97, 1.62);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 20), dark);
    wheel.position.set(-0.4, 0.92, 1.78);
    wheel.rotation.x = -1.1;
    body.add(wheel);
    this.steering = wheel;
    const seat = std("#2a2d33", { roughness: 0.9 });
    for (const x of [-0.4, 0.4]) { box(body, 0.6, 0.12, 0.5, seat, x, 0.52, 2.15); box(body, 0.6, 0.5, 0.1, seat, x, 0.82, 2.42); }
    box(body, W - 0.3, 0.12, 0.55, seat, 0, 0.52, 3.25); box(body, W - 0.3, 0.5, 0.1, seat, 0, 0.82, 3.55);
    // Puerta trasera derecha (por ahí sube y baja el pasajero, que la abre y la cierra): gira desde su borde delantero
    this.doorLeaves = [];
    this.taxiDoor = new THREE.Group();
    this.taxiDoor.position.set(W / 2 + 0.01, 0, 2.62);
    box(this.taxiDoor, 0.05, 0.5, 1.0, black, 0, 0.5, 0.5);
    box(this.taxiDoor, 0.03, 0.42, 0.9, glass, 0, 1.08, 0.5);
    body.add(this.taxiDoor);
    this.body = body;
    this.scene.add(g);
    if (this.night) {
      const spot = new THREE.SpotLight("#fff3d6", 40, 55, 0.5, 0.6, 1.4);
      spot.position.set(0, 0.7, -0.2);
      spot.target.position.set(0, 0, -25);
      g.add(spot, spot.target);
    }
    return g;
  }

  /** Marcador del lugar donde detenerse (amarillo: recoger · verde: destino) y un haz de luz para verlo de lejos. */
  buildFareMarker() {
    const m = new THREE.Group();
    this.markMat = new THREE.MeshBasicMaterial({ color: "#ffd23a", transparent: true, opacity: 0.5, depthWrite: false });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, TAXI_L + 0.8), this.markMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.03, TAXI_L / 2);
    this.beamMat = new THREE.MeshBasicMaterial({ color: "#ffd23a", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 12, 1, true), this.beamMat);
    beam.position.set(0, 4.5, TAXI_L / 2);
    m.add(pad, beam);
    m.visible = false;
    this.fareMarker = m;
    this.scene.add(m);
  }

  /** Personas y marcador de la carrera en curso (lee sim.fare de taxiSim.js). */
  updateTaxi(sim, dt) {
    const f = sim.fare;
    // 2.20 · Cada paso de la subida y la bajada (caminar a la puerta, abrirla, entrar, cerrarla…) lo dibuja busPeople.js
    const key = f ? `${f.n ?? ""}:${f.phase}:${f.step ?? ""}` : "none";
    if (key !== this.fareKey) {
      this.fareKey = key;
      this.people.taxiScene(sim, f);
    }
    const t = sim.target;
    this.fareMarker.visible = !!t;
    if (t) {
      const col = t.kind === "pickup" ? "#ffd23a" : "#3ad37f";
      this.markMat.color.set(col);
      this.beamMat.color.set(col);
      this.place(this.fareMarker, t.dir > 0 ? LANES[0] : MIRROR_X - LANES[0], t.ws, 0, t.dir > 0 ? 0 : Math.PI);
      this.beamMat.opacity = 0.28 + 0.12 * Math.sin(performance.now() / 300);
    }
    // Puerta trasera: se abre hacia afuera
    const b = sim.bus;
    const open = b.doors === "open" ? 1 : b.doors === "opening" ? b.doorT / 1.1 : b.doors === "closing" ? 1 - b.doorT / 1.1 : 0;
    this.taxiDoor.rotation.y = open * 1.0;
  }

  /* ----------------------------- Autos ----------------------------- */
  /** 2.15.4 · Libera un auto que salió de la calle (antes quedaban en la memoria de la GPU: +170 mallas por vuelta en U). */
  disposeCar(g) {
    g.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material !== this.headMat) o.material.dispose();
    });
  }

  carMesh(car) {
    const g = new THREE.Group();
    const color = CAR_COLORS[car.tint % CAR_COLORS.length];
    const paint = std(color, { roughness: 0.35, metalness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: "#1c252e", roughness: 0.15, metalness: 0.4 });
    const van = car.kind === "van";
    box(g, 1.8, van ? 1.5 : 0.72, car.len, paint, 0, van ? 1.05 : 0.62, car.len / 2);
    if (!van) box(g, 1.62, 0.55, 2.2, glass, 0, 1.25, car.len / 2 + 0.2);
    else box(g, 1.82, 0.5, car.len - 1.2, glass, 0, 1.45, car.len / 2 + 0.3);
    const tire = std("#141414");
    for (const z of [0.85, car.len - 0.85]) for (const x of [-0.85, 0.85]) box(g, 0.24, 0.56, 0.56, tire, x, 0.28, z);
    const tails = new THREE.MeshStandardMaterial({ color: "#400", emissive: new THREE.Color("#ff1a10"), emissiveIntensity: this.night ? 0.9 : 0.3 });
    for (const x of [-0.65, 0.65]) box(g, 0.35, 0.14, 0.04, tails, x, van ? 1.0 : 0.78, car.len + 0.02);
    if (this.night) for (const x of [-0.6, 0.6]) box(g, 0.3, 0.12, 0.04, this.headMat, x, 0.7, -0.02);
    g.userData.tails = tails;
    shadows(g);
    this.scene.add(g);
    return g;
  }

  buildOncoming() {
    this.oncoming = [];
    for (let i = 0; i < 18; i++) {
      const car = { tint: Math.floor(this.rng() * 1e6), kind: this.rng() < 0.2 ? "van" : "car", len: 4.4 };
      const mesh = this.carMesh(car);
      this.oncoming.push({ mesh, v: 11 + this.rng() * 4, x: ONCOMING[i % 3], z: -40 * i + this.rng() * 20, len: car.len });
    }
  }

  /* ----------------------------- 1.20 · Accesos al Metro ----------------------------- */
  /** Paraderos junto a una estación de Metro (los que llevan acceso con tótem). */
  accessStops() {
    return this.route.stops.filter(st => st.metro && linesAtStation(st.metro).length);
  }

  buildMetroAccesses() {
    this.accesses = this.accessStops().map(st => {
      const g = metroStreetAccess(this.scene, { name: st.metro, lines: linesAtStation(st.metro), night: this.night ? 1 : 0, w: ACCESS.w, len: ACCESS.len });
      g.position.set(CURB_X + ACCESS.dx, SIDEWALK_Y, -st.s + ACCESS.dz);
      // 2.15.2 · Máscara invisible en la boca: marca el stencil para que el terreno (que pasa por debajo, a ras de suelo)
      // no tape la escalera; antes se veía pasto en vez de los peldaños
      const mask = new THREE.Mesh(new THREE.PlaneGeometry(ACCESS.w, ACCESS.len, 1, 2), ACCESS_MASK);
      mask.rotation.x = -Math.PI / 2;
      mask.position.y = 0.005;
      mask.renderOrder = -2;
      g.add(mask);
      const z = -st.s + ACCESS.dz;
      return { stop: st, x: CURB_X + ACCESS.dx, z, mouthZ: z + ACCESS.len / 2 + 0.6, bottomZ: z - ACCESS.len / 2 + 0.7 };
    });
  }

  /* ----------------------------- 1.20 · Lluvia (como la del Metro al aire libre) ----------------------------- */
  buildRain() {
    const N = this.rainN = 2600;
    this.rainDrops = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 50, y: Math.random() * 20 - 3, z: (Math.random() - 0.5) * 50, s: 0.8 + Math.random() * 0.4 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaebccb, transparent: true, opacity: 0.25 + 0.3 * Math.min(1, this.rainAmount), depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = this.rainAmount > 0.02;
    this.scene.add(this.rain);
  }

  updateRain(dt, cam, sim) {
    if (!this.rain.visible || !cam) return;
    const pos = this.rain.geometry.attributes.position.array;
    const n = Math.floor(this.rainN * Math.min(1, this.rainAmount));
    const fall = 11, len = 0.55;
    // Dentro del vehículo no llueve (se mira en coordenadas de la carrocería: la calle puede ir doblada)
    const W = (sim.wid ?? BUS_WIDTH) / 2, L = sim.len ?? BUS_LENGTH;
    this.bus.updateMatrixWorld();
    const inv = (this._inv ??= new THREE.Matrix4()).copy(this.bus.matrixWorld).invert().elements;
    const dryAt = (x, y, z) => {
      if (y > 3.2) return false;
      const lx = inv[0] * x + inv[4] * y + inv[8] * z + inv[12], lz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
      return lx > -W && lx < W && lz > -0.2 && lz < L + 0.2;
    };
    for (let i = 0; i < this.rainN; i++) {
      const d = this.rainDrops[i];
      d.y -= fall * d.s * dt;
      if (d.y < -4) { d.y += 22; d.x = (Math.random() - 0.5) * 50; d.z = (Math.random() - 0.5) * 50; }
      const k = i * 6;
      const x = cam.x + d.x, y = cam.y + d.y, z = cam.z + d.z;
      if (i >= n || y < 0 || dryAt(x, y, z)) { pos.fill(0, k, k + 6); pos[k + 1] = pos[k + 4] = -1e4; continue; }
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      pos[k + 3] = x + 0.04; pos[k + 4] = y - len * d.s; pos[k + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  /* ----------------------------- Cada fotograma ----------------------------- */
  update(sim, dt, now, cam = null) {
    const b = sim.bus;
    // Bus: posición, leve giro al cambiar de pista y ruedas
    const g = this.bus;
    const latV = this.prevX == null ? 0 : (b.x - this.prevX) / Math.max(dt, 1e-3);
    this.prevX = b.x;
    const yaw = b.v > 0.3 ? -Math.atan2(latV, b.v) : 0;
    this.busYaw = (this.busYaw ?? 0) + (yaw - (this.busYaw ?? 0)) * Math.min(1, dt * 8);
    // 2.3 · El taxi puede ir en el otro sentido: se dibuja en la calzada de enfrente, dado vuelta
    const flip = sim.dir < 0 ? Math.PI : 0;
    if (this.lastDir !== sim.dir) { this.lastDir = sim.dir; this.prevX = b.x; this.busYaw = 0; }
    this.place(g, sim.toIdaX(b.x), sim.idaS, (sim.len ?? BUS_LENGTH) * sim.dir, this.busYaw + flip);
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, THREE.MathUtils.clamp(-b.accel * 0.006, -0.02, 0.02), Math.min(1, dt * 4));
    for (const w of this.wheels) w.rotation.x -= (b.v * dt) / (this.taxi ? 0.32 : 0.5);     // 2.15.4 · radio de la rueda del taxi
    this.steering.rotation.z = THREE.MathUtils.lerp(this.steering.rotation.z, -yaw * 6 + this.path.curvature(sim.idaS ?? b.s) * (sim.dir ?? 1) * 25, Math.min(1, dt * 6));
    // Puertas
    const open = b.doors === "open" ? 1 : b.doors === "opening" ? b.doorT / 1.1 : b.doors === "closing" ? 1 - b.doorT / 1.1 : 0;
    for (const leaf of this.doorLeaves) {
      leaf.position.z = leaf.userData.z0 + leaf.userData.side * open * 0.55;
      leaf.position.x = BUS_WIDTH / 2 + 0.02 + open * 0.08;
    }
    this.tailMat.emissiveIntensity = b.brake > 0.1 || b.doors !== "closed" ? 2.2 : this.night ? 0.8 : 0.35;
    // Intermitente mientras cambia de pista
    const changing = Math.abs(sim.bus.x - LANES[b.targetLane]) > 0.15;
    const on = changing && Math.floor(now * 2.6) % 2 === 0;
    this.blinkMat.emissiveIntensity = on ? 2.5 : 0;

    // Autos del motor
    const seen = new Set();
    for (const car of sim.cars) {
      let m = this.carMeshes.get(car.id);
      if (!m) { m = this.carMesh(car); this.carMeshes.set(car.id, m); }
      this.place(m, sim.toIdaX(car.x), sim.toIdaS(car.s), car.len * sim.dir, flip);
      m.userData.tails.emissiveIntensity = car.braking || car.v < 0.3 ? 2.2 : this.night ? 0.9 : 0.3;
      seen.add(car.id);
    }
    for (const [id, m] of this.carMeshes) if (!seen.has(id)) { this.scene.remove(m); this.disposeCar(m); this.carMeshes.delete(id); }
    // Autos de vuelta (decorado)
    const zBus = -b.s;
    for (const o of this.oncoming) {
      o.z += o.v * dt;
      if (o.z > zBus + 160) o.z -= 720;
      if (o.z < zBus - 560) o.z += 720;
      this.place(o.mesh, sim.toIdaX(o.x), sim.toIdaS(-o.z), -o.len * sim.dir, Math.PI + flip);
    }
    // Semáforos
    for (const sg of this.signals) {
      const st = lightState(sg.light, sim.time);
      if (st === sg.state) continue;
      sg.state = st;
      for (const k of ["red", "amber", "green"]) sg.mats[k].emissiveIntensity = k === st ? 1.3 : 0.05;     // 2.9.3 · menos brillo: con más, el rojo se veía salmón
    }
    // Pasajeros: en los paraderos, subiendo, a bordo y bajando (busPeople.js)
    g.updateMatrixWorld();
    if (this.taxi) this.updateTaxi(sim, dt);
    this.people.update(sim, dt);
    this.updateRain(dt, cam, sim);                       // 1.20 · lluvia
    // Cordillera fija respecto del bus (está «en el infinito»)
    this.mountains.position.set(g.position.x + 1500, 120, g.position.z);
    this.ground.position.x = g.position.x; this.ground.position.z = g.position.z;
    // 2.4 · El área con sombras acompaña a la cámara (un poco hacia adelante, donde se mira)
    if (this.shadow) {
      const f = this._sf ??= new THREE.Vector3();
      f.copy(cam || g.position);
      if (cam) { const h = this.heading(sim.idaS) + (sim.dir < 0 ? Math.PI : 0); f.x -= Math.sin(h) * 25; f.z -= Math.cos(h) * 25; }
      this.shadow.follow(f, this.sunDir);
    }
  }

  dispose() {
    this.scene.environment?.dispose();
    this.sun?.shadow?.dispose();                    // 2.15.4 · el mapa de sombras del sol (quedaba vivo en cada «Otro turno»)
    this.scene.background?.dispose?.();
    for (const m of this.carMeshes.values()) this.disposeCar(m);
    this.scene.traverse(obj => {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach(m => { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); });
    });
  }
}
