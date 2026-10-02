/* ==========================================================================
   MetroSim — Alpha 0.5 · camera.js
   Cámara: puntos de vista (cabina, salón, exterior) y mirada con el ratón.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { clamp } from "./utils.js";

// Puntos de vista en coordenadas locales del tren.
export const VIEWS = {
  cab:      { pos: new THREE.Vector3(-0.3, 2.5, 1.7),  yaw: 0,    pitch: -0.07, yawLimit: 1.4,     pitchLimit: 0.7 },
  saloon:   { pos: new THREE.Vector3(0.45, 2.85, 10.6), yaw: 0.85, pitch: -0.08, yawLimit: Math.PI, pitchLimit: 0.8 },
  exterior: { pos: new THREE.Vector3(3.0, 3.1, -11),   target: new THREE.Vector3(0, 1.8, 5) },
};

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
    train.add(camera);
  }

  setView(view) { this.view = view; this.recenter(); }
  recenter() { this.lookYaw = 0; this.lookPitch = 0; }

  /** Arrastre del ratón para mirar alrededor. */
  attach(dom) {
    this.dom = dom;
    this.onDown = (ev) => { this.dragging = true; this.lastX = ev.clientX; this.lastY = ev.clientY; dom.setPointerCapture?.(ev.pointerId); };
    this.onMove = (ev) => {
      if (!this.dragging) return;
      const v = VIEWS[this.view];
      if (!v.yawLimit) return;
      this.lookYaw = clamp(this.lookYaw - (ev.clientX - this.lastX) * 0.004, -v.yawLimit, v.yawLimit);
      this.lookPitch = clamp(this.lookPitch - (ev.clientY - this.lastY) * 0.004, -v.pitchLimit, v.pitchLimit);
      this.lastX = ev.clientX; this.lastY = ev.clientY;
    };
    this.onUp = () => { this.dragging = false; };
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onUp);
  }

  update(sim, time) {
    const v = VIEWS[this.view];
    this.camera.position.copy(v.pos);
    if (this.view === "exterior") {
      this.train.updateMatrixWorld();
      this.camera.lookAt(this.train.localToWorld(this.tmp.copy(v.target)));
      return;
    }
    // Pequeño balanceo proporcional a la velocidad (sensación de rodadura)
    const sway = Math.min(sim.speed / CONFIG.train.maxSpeed, 1);
    this.camera.position.y += Math.sin(time * 7.3) * 0.004 * sway;
    this.camera.position.x += Math.sin(time * 2.1) * 0.006 * sway;
    this.camera.rotation.set(v.pitch + this.lookPitch, v.yaw + this.lookYaw, Math.sin(time * 1.7) * 0.0025 * sway);
  }
}

