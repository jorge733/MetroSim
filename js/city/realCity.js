/* ==========================================================================
   RedMoviSim — 2.6 · city/realCity.js
   CALLE REAL de una estación, con los datos de OpenStreetMap que deja
   tools/calles-osm.mjs en city/realStreets.js (© colaboradores de
   OpenStreetMap, ODbL).

   Lo dibuja y lo consulta la calle del juego (city/city.js) cuando la
   estación tiene datos: edificios con su planta y altura reales, calzadas
   con su ancho, soleras, líneas de pista, pasos de cebra, semáforos que
   cambian, árboles, faroles y autos y buses que siguen las calles reales en
   su sentido y paran en rojo. El acceso al Metro, los locales, el paradero y
   el hito los sigue poniendo city.js, en los puntos que calculó el script.

   Todo lo que se repite va junto (una malla por material o InstancedMesh)
   para que ande en el celular. Las consultas (¿hay un edificio, una calzada
   o un árbol aquí?) usan una grilla de 10 m.
   ========================================================================== */

import * as THREE from "three";
import { std, glow, addBox } from "../utils.js";
import { facadeTexture } from "./kit.js";
import { crownGeometry, trunkGeometry, lampPool } from "../render/realism.js";

const CELL = 10;
/** 2.21 · Bocas de los otros accesos: no pintan nada, solo dejan un 1 en el stencil (ahí no se dibuja el piso y se ve la escalera). */
export const HOLE_MASK = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
/** El piso que respeta esas bocas (no escribe el stencil, solo lo consulta; en las bocas no hay nada más de ese material). */
export const holed = (mat) => Object.assign(mat, { stencilWrite: true, stencilWriteMask: 0, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc });
const PALETTE = ["#a29a8f", "#8d939a", "#b8ad9c", "#c9bfae", "#c2b6a3", "#9b8e84", "#7f8a92", "#d0c7b8", "#b49a82"];
const FLOOR_H = 3.3;
const SIGNAL_CYCLE = 64;               // s · eje 0 (la avenida) verde 0–28, amarillo 28–31; eje 1 verde 32–60, amarillo 60–63

const pairs = (a, from = 0) => { const out = []; for (let i = from; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]); return out; };

function inPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
/** Bordes de una polilínea desplazada ±w/2 (derecha de quien avanza = (−dz, dx)). */
function ribbon(pts, w, y, pos, idx) {
  const base = pos.length / 3;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let k = 1;
    if (i > 0 && i < pts.length - 1) {
      const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
      k = 1 / Math.max(0.5, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l1);   // inglete en los quiebres
    }
    const rx = -dz * w / 2 * k, rz = dx * w / 2 * k;
    pos.push(p[0] - rx, y, p[1] - rz, p[0] + rx, y, p[1] + rz);
  });
  for (let i = 0; i + 1 < pts.length; i++) {
    const v = base + i * 2;
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
}
/** Da vuelta los triángulos que quedaron mirando hacia abajo (así la luz los ilumina por arriba). */
function faceUp(pos, idx) {
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vz = pos[c + 2] - pos[a + 2];
    if (uz * vx - ux * vz < 0) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  }
  return idx;
}
function flatMesh(pos, idx, mat) {
  faceUp(pos, idx);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Todas las caras deben mirar hacia arriba (las cintas se arman en cualquier sentido)
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const m = new THREE.Mesh(geo, mat);
  m.material.side = THREE.DoubleSide;
  return m;
}

/* 2.15.2 · Lo que tiene que quedar libre en la calle real.
   Los edificios de OSM a veces quedan encima de la boca del acceso o justo delante (donde aparece el pasajero):
   se recortan con el corte recto que les quita menos, o se sacan si casi no queda nada. */
/** Boca del acceso, baranda, tótem y la vereda donde aparece el pasajero (coordenadas locales). */
export const ACCESS_CLEAR = { x0: 7.6, x1: 12.4, z0: -4, z1: 9.5 };
const ringArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a / 2; };
function ringHitsRect(ring, r) {
  if (ring.some(([x, z]) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) return true;
  for (let x = r.x0; x <= r.x1 + 1e-6; x += 0.4) for (let z = r.z0; z <= r.z1 + 1e-6; z += 0.4) if (inPoly(x, z, ring)) return true;
  return false;
}
/** Sutherland–Hodgman con un semiplano: se queda con los puntos donde f(p) ≥ 0 (f lineal). */
function clipRing(ring, f) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
function clearRect(buildings, r) {
  const out = [];
  for (const b of buildings) {
    if (!ringHitsRect(b.ring, r)) { out.push(b); continue; }
    const A = Math.abs(ringArea(b.ring));
    const cuts = [p => p[1] - r.z1, p => r.z0 - p[1], p => p[0] - r.x1, p => r.x0 - p[0]];
    let best = null;
    for (const f of cuts) {
      const ring = clipRing(b.ring, f), a = ring.length >= 3 ? Math.abs(ringArea(ring)) : 0;
      if (!best || a > best.a) best = { ring, a };
    }
    if (best.a > Math.max(15, A * 0.25)) out.push({ ...b, ring: best.ring });
  }
  return out;
}

export class RealStreet {
  constructor(data) {
    this.d = data;
    this.buildings = clearRect(data.buildings.map(b => ({ h: b[0], c: b[1], s: b[2], lm: !!b[3], ring: pairs(b, 4) })), ACCESS_CLEAR);
    this.roads = data.roads.map(r => ({ w: r[0], service: !!r[1], pts: pairs(r, 2) }));
    this.rot = data.rot;
    this.grid = new Map();
    const put = (x0, z0, x1, z1, item) => {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const k = cx * 4096 + cz;
          let c = this.grid.get(k);
          if (!c) this.grid.set(k, c = { b: [], r: [], o: [] });
          item.kind === "b" ? c.b.push(item) : item.kind === "r" ? c.r.push(item) : c.o.push(item);
        }
    };
    for (const b of this.buildings) {
      const xs = b.ring.map(p => p[0]), zs = b.ring.map(p => p[1]);
      b.kind = "b";
      put(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), b);
    }
    for (const r of this.roads) for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]], h = r.w / 2;
      put(Math.min(a[0], b[0]) - h, Math.min(a[1], b[1]) - h, Math.max(a[0], b[0]) + h, Math.max(a[1], b[1]) + h, { kind: "r", a, b, h });
    }
    // Obstáculos chicos: árboles, faroles, semáforos (radio en m)
    const ob = (x, z, r) => put(x - r, z - r, x + r, z + r, { kind: "o", x, z, r });
    pairs(data.trees).forEach(([x, z]) => ob(x, z, 0.45));
    data.lamps.forEach(([x, z]) => ob(x, z, 0.2));
    data.signals.forEach(([x, z]) => ob(x, z, 0.2));
  }

  cell(x, z) { return this.grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)); }
  inBuilding(x, z) { const c = this.cell(x, z); return !!c && c.b.some(b => inPoly(x, z, b.ring)); }
  onRoad(x, z, margin = 0) { const c = this.cell(x, z); return !!c && c.r.some(s => segDist(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) < s.h - margin); }
  obstacle(x, z, m = 0) { const c = this.cell(x, z); return !!c && c.o.some(o => Math.hypot(x - o.x, z - o.z) < o.r + m); }
  /** ¿Se puede pisar? (sin edificios ni obstáculos; con un margen para no meter la cámara en los muros) */
  free(x, z, m = 0.3) {
    if (this.obstacle(x, z, m)) return false;
    return !(this.inBuilding(x, z) || this.inBuilding(x + m, z) || this.inBuilding(x - m, z) || this.inBuilding(x, z + m) || this.inBuilding(x, z - m));
  }
  /**
   * 2.15.2 · Dónde va el paradero (refugio de 1,6 × 5 m con la calzada a su izquierda, −x). El punto que dejó el script
   * a veces cae en un cruce o en un edificio: entonces se busca el más cercano en la vereda, junto a la solera.
   * `avoid`: [x, z, radio] que no se pueden tapar (boca del acceso, kiosko, puertas de los locales).
   */
  placeBusStop(b, avoid = []) {
    const c = ACCESS_CLEAR;
    const fits = (x, z, curb = true) => {
      const over = (x0, x1, z0, z1) => x + 0.9 > x0 && x - 0.9 < x1 && z + 2.6 > z0 && z - 3.4 < z1;
      if (over(c.x0, c.x1, c.z0, c.z1) || avoid.some(([ax, az, r]) => over(ax - r, ax + r, az - r, az + r))) return false;
      for (let xx = x - 0.9; xx <= x + 0.91; xx += 0.3) for (let zz = z - 3.4; zz <= z + 2.61; zz += 0.5)
        if (this.onRoad(xx, zz, -0.2) || this.inBuilding(xx, zz) || this.obstacle(xx, zz, 0.1)) return false;
      // La solera a la izquierda, a lo largo de todo el refugio (si no hay dónde, basta con una vereda libre)
      return !curb || [z - 2, z, z + 2].every(zz => [1.3, 1.7, 2.1, 2.5].some(d => this.onRoad(x - d, zz)));
    };
    if (fits(b.x, b.z)) return { x: b.x, z: b.z, moved: false };
    for (const curb of [true, false]) for (let dz = 0; dz <= 70; dz += 1) for (const sz of dz ? [1, -1] : [1]) {
      const z = b.z + sz * dz;
      for (let dx = 0; dx <= 12; dx += 0.3) for (const sx of dx ? [1, -1] : [1]) {
        const x = b.x + sx * dx;
        if (fits(x, z, curb)) return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, moved: true };
      }
    }
    return { x: b.x, z: b.z, moved: false };
  }

  /** Gira un vector del mundo (x este, −z norte) a la calle local (la del juego sigue la avenida). */
  toLocal(v) {
    const [dn, de] = this.rot, x = v.x, z = v.z;
    return v.set(x * dn + z * de, v.y, -x * de + z * dn);
  }

  /* ---------------------------------------------------------------------
     Dibujo
     --------------------------------------------------------------------- */

  build(g, M, { night = 0, access, landmarkColor = "#e7d7b4" }) {
    this.night = night;
    this.buildGround(g, M, access);
    this.buildRoads(g, M);
    this.buildBuildings(g, M, landmarkColor);
    this.buildTrees(g, M);
    this.buildLamps(g, M);
    this.buildSignals(g);
    this.buildGrass(g, M);
  }

  /** Piso de baldosas (vereda) en toda la zona, con el hueco de la escalera del Metro. */
  buildGround(g, M, a) {
    const R = this.d.radius + 60, cx = 9.6, cz = 3.2;
    const hx0 = a.x - a.halfX, hx1 = a.x + a.halfX, hz0 = a.z - a.halfZ, hz1 = a.z + a.halfZ;
    const floor = holed(M.sidewalk);
    const span = (xa, xb, za, zb) => addBox(g, xb - xa, 0.2, zb - za, floor, (xa + xb) / 2, 0, (za + zb) / 2);
    span(cx - R, hx0, cz - R, cz + R);
    span(hx1, cx + R, cz - R, cz + R);
    span(hx0, hx1, cz - R, hz0);
    span(hx0, hx1, hz1, cz + R);
    // Más allá: suelo apagado hasta el horizonte
    addBox(g, 1400, 0.1, 1400, holed(std(0x5b5a55, { rough: 1 })), cx, -0.25, cz);
  }

  buildRoads(g, M) {
    const pos = [], idx = [];
    for (const r of this.roads) ribbon(r.pts, r.w, 0.104, pos, idx);
    const road = flatMesh(pos, idx, M.asphalt);
    road.material.polygonOffset = true; road.material.polygonOffsetFactor = -1; road.material.polygonOffsetUnits = -2;
    g.add(road);
    // Soleras: una franja clara y algo más alta en cada borde
    const cp = [], ci = [];
    for (const c of this.d.curbs) ribbon(pairs(c), 0.3, 0.135, cp, ci);
    const curb = std(0xc4beb4, { rough: 0.8 });
    Object.assign(curb, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    g.add(flatMesh(cp, ci, curb));
    // Pintura: líneas de pista, eje central (amarillo) y pasos de cebra
    const paint = new THREE.Object3D(), pp = [];
    const dash = this.d.dashes;
    for (let i = 0; i + 3 < dash.length; i += 4) pp.push([dash[i], dash[i + 1], dash[i + 2], dash[i + 3], 0.14]);
    for (const [x, z, a, w] of this.d.crossings) {
      const dx = Math.sin(a), dz = Math.cos(a), rx = -dz, rz = dx;
      for (let o = -w / 2 + 0.55; o <= w / 2 - 0.4; o += 1.1) {
        const px = x + rx * o, pz = z + rz * o;
        pp.push([px - dx * 1.6, pz - dz * 1.6, px + dx * 1.6, pz + dz * 1.6, 0.55]);
      }
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const paintMat = M.paint.clone();
    Object.assign(paintMat, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const white = new THREE.InstancedMesh(plane, paintMat, pp.length);
    pp.forEach(([x0, z0, x1, z1, w], i) => {
      paint.position.set((x0 + x1) / 2, 0.112, (z0 + z1) / 2);
      paint.rotation.set(0, Math.atan2(x1 - x0, z1 - z0), 0);
      paint.scale.set(w, 1, Math.hypot(x1 - x0, z1 - z0));
      paint.updateMatrix();
      white.setMatrixAt(i, paint.matrix);
    });
    g.add(white);
    const yp = [], yi = [];
    for (const c of this.d.center) ribbon(pairs(c), 0.13, 0.112, yp, yi);
    if (yp.length) {
      const ym = glow(this.night > 0.5 ? 0xa8902c : 0xe0b52a);
      Object.assign(ym, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      g.add(flatMesh(yp, yi, ym));
    }
  }

  /** Edificios: muros con ventanas por piso (UV en metros) y azotea de hormigón; una malla por material. */
  buildBuildings(g, M, landmarkColor) {
    const groups = new Map();                   // clave → { pos, uv, idx }
    const roof = { pos: [], idx: [] };
    const lit = this.night > 0.5 ? 0.45 : 0;
    for (const b of this.buildings) {
      const key = b.lm ? "lm" : `${b.c % PALETTE.length}-${b.s}`;
      let G = groups.get(key);
      if (!G) groups.set(key, G = { pos: [], uv: [], idx: [], s: b.lm ? 1 : b.s, color: b.lm ? landmarkColor : PALETTE[b.c % PALETTE.length] });
      const ring = b.ring, n = ring.length;
      // Ancho del módulo de la textura (4 ventanas) y alto (8 pisos)
      const modW = G.s === 2 ? 10 : b.lm ? 22 : 14, modH = 8 * (b.lm ? 6.5 : G.s === 1 ? 4.2 : FLOOR_H);   // pisos más altos en los edificios antiguos
      let u = 0;
      for (let i = 0; i < n; i++) {
        const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.05) continue;
        const v = G.pos.length / 3, u0 = u / modW, u1 = (u + L) / modW, vt = b.h / modH;
        G.pos.push(x0, 0, z0, x1, 0, z1, x1, b.h, z1, x0, b.h, z0);
        G.uv.push(u0, 0, u1, 0, u1, vt, u0, vt);
        G.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);     // normal hacia afuera (el anillo viene antihorario)
        u += L;
      }
      // Azotea
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const v0 = roof.pos.length / 3;
      ring.forEach(([x, z]) => roof.pos.push(x, b.h, z));
      tris.forEach(([a, c, d]) => roof.idx.push(v0 + a, v0 + c, v0 + d));
    }
    let k = 0;
    for (const [, G] of groups) {
      const st = ["grid", "classic", "glass"][G.s];
      const tex = facadeTexture({ base: G.color, glass: st === "glass" ? "#41566b" : "#33414f", lit, cols: 4, rows: 8, style: st, seed: mulberry(++k * 977) });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const mat = std(0xffffff, { map: tex, rough: st === "glass" ? 0.35 : 0.85, metal: st === "glass" ? 0.3 : 0.05 });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(G.pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(G.uv, 2));
      geo.setIndex(G.idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.material.side = THREE.DoubleSide;          // por si algún polígono de OSM viene al revés
      g.add(mesh);
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute("position", new THREE.Float32BufferAttribute(roof.pos, 3));
    rgeo.setIndex(faceUp(roof.pos, roof.idx));
    rgeo.computeVertexNormals();
    const rn = rgeo.attributes.normal;
    for (let i = 0; i < rn.count; i++) rn.setXYZ(i, 0, 1, 0);
    const rm = new THREE.Mesh(rgeo, std(0x8c8780, { rough: 0.95 }));
    rm.material.side = THREE.DoubleSide;
    g.add(rm);
    // Marquesinas y techos sueltos (building=roof): losa delgada a su altura
    const cp = [], ci = [];
    for (const r of this.d.roofs) {
      const ring = pairs(r, 1), y = r[0];
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      const v0 = cp.length / 3;
      ring.forEach(([x, z]) => cp.push(x, y, z));
      tris.forEach(([a, c, d]) => ci.push(v0 + a, v0 + c, v0 + d));
    }
    if (cp.length) g.add(flatMesh(cp, ci, std(0x6e7276, { metal: 0.4, rough: 0.5 })));
  }

  buildTrees(g, M) {
    const t = pairs(this.d.trees), dummy = new THREE.Object3D();
    const trunks = new THREE.InstancedMesh(trunkGeometry(), M.trunk, t.length);
    const crowns = [1, 2, 3].map(f => ({ geo: crownGeometry(f), list: [] }));
    t.forEach(([x, z], i) => {
      const s = 0.8 + (Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 43758.5453 % 1) * 0.4;
      dummy.position.set(x, 0.1, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1.3 * s, 3.6 * s, 1.3 * s); dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crowns[Math.abs(Math.round(x * 7 + z * 3)) % 3].list.push([x, z, s]);
    });
    g.add(trunks);
    for (const c of crowns) {
      if (!c.list.length) continue;
      const im = new THREE.InstancedMesh(c.geo, M.leaves, c.list.length);
      c.list.forEach(([x, z, s], i) => {
        dummy.position.set(x, 0.1 + 4.7 * s, z); dummy.rotation.set(0, x + z, 0); dummy.scale.set(2.1 * s, 1.8 * s, 2.1 * s); dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      g.add(im);
    }
  }

  /** Faroles: poste, brazo hacia la calzada y luminaria (instanciados). */
  buildLamps(g, M) {
    const L = this.d.lamps, dummy = new THREE.Object3D();
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 8, 6), M.metal, L.length);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.8), M.metal, L.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.16, 0.75), M.lampOn, L.length);
    L.forEach(([x, z, a], i) => {
      const dx = Math.sin(a), dz = Math.cos(a);
      dummy.rotation.set(0, a, 0);
      dummy.position.set(x, 4.1, z); dummy.updateMatrix(); pole.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x + dx * 0.9, 7.95, z + dz * 0.9); dummy.updateMatrix(); arm.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x + dx * 1.7, 7.85, z + dz * 1.7); dummy.updateMatrix(); head.setMatrixAt(i, dummy.matrix);
      if (this.night > 0.5) lampPool(g, x + dx * 1.7, z + dz * 1.7);
    });
    g.add(pole, arm, head);
  }

  /** Semáforos: poste y cabezal de tres luces mirando al tránsito; las luces cambian por eje. */
  buildSignals(g) {
    const dark = std(0x23272b, { metal: 0.4, rough: 0.5 });
    const off = (c) => std(c, { rough: 0.4 });
    this.lights = [0, 1].map(() => ({
      r: off(0x3a1010), y: off(0x3a2e10), g: off(0x103a1c),
    }));
    const geo = new THREE.SphereGeometry(0.11, 10, 8);
    for (const [x, z, a, axis] of this.d.signals) {
      const s = new THREE.Group();
      s.position.set(x, 0.1, z);
      s.rotation.y = a;
      addBox(s, 0.12, 3.2, 0.12, dark, 0, 1.6, 0);
      addBox(s, 0.34, 0.95, 0.26, dark, 0, 3.0, 0.05);
      const L = this.lights[axis];
      [[L.r, 3.3], [L.y, 3.0], [L.g, 2.7]].forEach(([m, y]) => {
        const b = new THREE.Mesh(geo, m);
        b.position.set(0, y, 0.19);
        s.add(b);
      });
      g.add(s);
    }
  }

  buildGrass(g, M) {
    const pos = [], idx = [];
    for (const r of this.d.grass) {
      const ring = pairs(r);
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      const v0 = pos.length / 3;
      ring.forEach(([x, z]) => pos.push(x, 0.108, z));
      tris.forEach(([a, c, d]) => idx.push(v0 + a, v0 + c, v0 + d));
    }
    if (pos.length) g.add(flatMesh(pos, idx, holed(M.grass)));
  }

  /* ---------------------------------------------------------------------
     Semáforos y tránsito
     --------------------------------------------------------------------- */

  /** Estado del eje (0 = la avenida, 1 = las calles que la cruzan) a la hora t (s): "g" | "y" | "r". */
  signalState(axis, t) {
    const c = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
    const k = axis === 0 ? c : (c + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
    return k < 28 ? "g" : k < 31 ? "y" : "r";
  }

  updateSignals(t) {
    if (!this.lights) return;
    this.lights.forEach((L, axis) => {
      const st = this.signalState(axis, t);
      L.r.emissive.setHex(st === "r" ? 0xff2a1a : 0x000000);
      L.y.emissive.setHex(st === "y" ? 0xffb000 : 0x000000);
      L.g.emissive.setHex(st === "g" ? 0x22ff66 : 0x000000);
      L.r.emissiveIntensity = L.y.emissiveIntensity = L.g.emissiveIntensity = 2.2;
    });
  }

  /** Pistas para los autos: polilíneas con su largo acumulado y los semáforos (s y eje). */
  lanePaths() {
    return this.d.lanes.map(l => {
      const pts = pairs(l.p), cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const path = { pts, cum, len: cum.at(-1), bus: !!l.bus, kind: l.kind };
      path.sig = l.sig.map(s => {
        const p = sampleLane(path, s);
        return { s, axis: Math.abs(p.dz) > 0.7 ? 0 : 1 };
      });
      return path;
    });
  }
}

/** Punto, dirección y ángulo de una pista a la distancia s. */
export function sampleLane(path, s) {
  const { pts, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  const dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz, yaw: Math.atan2(dx, dz) };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
