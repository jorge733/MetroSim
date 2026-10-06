/* ==========================================================================
   MetroSim — Alpha 0.9 · camera.js
   Cámara del conductor: puntos de vista (cabina, salón, exterior).

   Cabina y salón: arrastrar el ratón para mirar alrededor.
   Exterior: cámara ORBITAL alrededor del tren, que lo sigue en marcha:
     · arrastrar            girar alrededor del tren (y subir / bajar)
     · Shift + arrastrar    desplazarse a lo largo del tren (o clic derecho)
     · rueda                acercar / alejar
     · C                    volver al encuadre inicial (3/4 delantero)
   La cámara nunca atraviesa el túnel ni los muros de la estación: si el
   punto pedido queda fuera, se acerca al tren.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG, STATIONS } from "./config.js";
import { clamp } from "./utils.js";

// Puntos de vista en coordenadas locales del tren (la cabeza está en z = 0 y el tren crece hacia +z).
export const VIEWS = {
  cab:      { pos: new THREE.Vector3(0, 2.52, 1.95),   yaw: 0,    pitch: -0.12, yawLimit: 1.4,     pitchLimit: 0.7 },   // puesto central
  saloon:   { pos: new THREE.Vector3(0.45, 2.85, 10.6), yaw: 0.85, pitch: -0.08, yawLimit: Math.PI, pitchLimit: 0.8 },
  exterior: { orbit: true },
};

/** Encuadre inicial de la vista exterior: 3/4 delantero, a la altura de la cabina. */
const ORBIT_HOME = { az: 0.62, el: 0.16, dist: 15, along: 9 };
const ORBIT = { minDist: 4.5, maxDist: 60, minEl: -0.05, maxEl: 1.35 };
const TUNNEL = CONFIG.tunnel, ST = CONFIG.station;

export class CameraRig {
  constructor(camera, train) {
    this.camera = camera;
    this.train = train;
    this.camera.rotation.order = "YXZ";
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.view = "cab";
    this.dragging = false;
    this.tmp = new THREE.Vector3();
    this.world = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.orbit = { ...ORBIT_HOME };          // deseado
    this.orbitNow = { ...ORBIT_HOME };       // actual (suavizado)
    train.add(camera);
  }

  /** Engancha la cámara a otro tren (tras la maniobra de retorno). */
  setTrain(train) {
    this.train = train;
    train.add(this.camera);
  }

  setView(view) {
    this.view = view;
    this.recenter();
    if (view === "exterior") Object.assign(this.orbitNow, this.orbit);
  }

  recenter() {
    this.lookYaw = 0;
    this.lookPitch = 0;
    Object.assign(this.orbit, ORBIT_HOME);
  }

  /** Ratón: arrastrar para mirar (cabina, salón) o girar / desplazar (exterior); rueda para el zoom. */
  attach(dom) {
    this.dom = dom;
    this.onDown = (ev) => {
      this.dragging = true;
      this.panning = ev.shiftKey || ev.button === 2;
      this.lastX = ev.clientX; this.lastY = ev.clientY;
      dom.setPointerCapture?.(ev.pointerId);
    };
    this.onMove = (ev) => {
      if (!this.dragging) return;
      const dx = ev.clientX - this.lastX, dy = ev.clientY - this.lastY;
      this.lastX = ev.clientX; this.lastY = ev.clientY;
      if (this.view === "exterior") {
        const o = this.orbit;
        if (this.panning || ev.shiftKey) {
          o.along = clamp(o.along + dx * 0.06 * (o.dist / 15), -8, CONFIG.train.length + 8);
        } else {
          o.az -= dx * 0.006;
          o.el = clamp(o.el + dy * 0.004, ORBIT.minEl, ORBIT.maxEl);
        }
        return;
      }
      const v = VIEWS[this.view];
      this.lookYaw = clamp(this.lookYaw - dx * 0.004, -v.yawLimit, v.yawLimit);
      this.lookPitch = clamp(this.lookPitch - dy * 0.004, -v.pitchLimit, v.pitchLimit);
    };
    this.onUp = () => { this.dragging = false; };
    this.onWheel = (ev) => {
      if (this.view !== "exterior") return;
      ev.preventDefault();
      this.orbit.dist = clamp(this.orbit.dist * Math.pow(1.12, Math.sign(ev.deltaY)), ORBIT.minDist, ORBIT.maxDist);
    };
    this.onMenu = (ev) => { if (this.view === "exterior") ev.preventDefault(); };
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    dom.addEventListener("contextmenu", this.onMenu);
  }

  update(sim, time, dt = 1 / 60) {
    if (this.view === "exterior") return this.updateOrbit(dt);
    const v = VIEWS[this.view];
    this.camera.position.copy(v.pos);
    // Pequeño balanceo proporcional a la velocidad (sensación de rodadura)
    const sway = Math.min(sim.speed / CONFIG.train.maxSpeed, 1);
    this.camera.position.y += Math.sin(time * 7.3) * 0.004 * sway;
    this.camera.position.x += Math.sin(time * 2.1) * 0.006 * sway;
    this.camera.rotation.set(v.pitch + this.lookPitch, v.yaw + this.lookYaw, Math.sin(time * 1.7) * 0.0025 * sway);
  }

  /** Cámara orbital: suaviza, calcula la posición alrededor del tren y la mantiene dentro del túnel / estación. */
  updateOrbit(dt) {
    const o = this.orbit, n = this.orbitNow, k = Math.min(1, dt * 8);
    let daz = o.az - n.az;
    daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    n.az += daz * k; n.el += (o.el - n.el) * k; n.dist += (o.dist - n.dist) * k; n.along += (o.along - n.along) * k;

    const train = this.train;
    train.updateMatrixWorld();
    // Punto al que se mira: sobre el eje del tren, a la altura de las ventanas
    this.tmp.set(0, 2.0, n.along);
    train.localToWorld(this.target.copy(this.tmp));
    // Posición deseada (local): adelante del tren es −z
    const ce = Math.cos(n.el);
    this.tmp.set(n.dist * ce * Math.sin(n.az), 2.0 + n.dist * Math.sin(n.el), n.along - n.dist * ce * Math.cos(n.az));
    train.localToWorld(this.world.copy(this.tmp));
    this.constrain(this.world, this.target);

    this.camera.position.copy(train.worldToLocal(this.tmp.copy(this.world)));
    // Orientación: mirar al objetivo (en coordenadas del mundo)
    this.camera.up.set(0, 1, 0);
    const parentQ = train.getWorldQuaternion(new THREE.Quaternion());
    const m = new THREE.Matrix4().lookAt(this.world, this.target, this.camera.up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.camera.quaternion.copy(parentQ.invert().multiply(q));
  }

  /** Mantiene la cámara dentro del túnel (círculo) o del vestíbulo de la estación (caja). */
  constrain(p, target) {
    const inStation = STATIONS.some(s => p.z - s.z > ST.hallZ0 + 2 && p.z - s.z < ST.hallZ1 - 2);
    if (inStation) {
      p.x = clamp(p.x, -ST.wallX + 0.5, ST.wallX - 0.5);
      p.y = clamp(p.y, 0.6, ST.ceilingY - 0.6);
      // Sobre los andenes la cámara no se mete dentro de la losa
      if (Math.abs(p.x) > ST.platformEdgeX - 0.2) p.y = Math.max(p.y, ST.platformTop + 1.0);
      return;
    }
    const cy = TUNNEL.centerY, R = TUNNEL.radius - 0.5;
    p.y = Math.max(p.y, 0.6);
    const dx = p.x, dy = p.y - cy, d = Math.hypot(dx, dy);
    if (d > R) {
      // Fuera del túnel: se acerca al tren a lo largo de la línea de mira hasta quedar dentro
      for (let i = 0; i < 12; i++) {
        p.lerp(target, 0.18);
        if (Math.hypot(p.x, p.y - cy) <= R) break;
      }
      const d2 = Math.hypot(p.x, p.y - cy);
      if (d2 > R) { p.x *= R / d2; p.y = cy + (p.y - cy) * R / d2; }
    }
  }
}
