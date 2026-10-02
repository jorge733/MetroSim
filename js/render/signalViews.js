/* ==========================================================================
   MetroSim — Render · signalViews.js
   Dibujo 3D de las señales. Lee el aspecto que calcula el motor
   (engine/signals.js) y enciende la lámpara que corresponde. No decide nada.
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "../config.js";
import { std, glow, toTexture, signalPlateCanvas } from "../utils.js";

const ASPECT_COLORS = { red: 0xff2020, yellow: 0xffb000, green: 0x20ff6a };
const LAMP_OFF = 0x151515;

export class SignalViews {
  /**
   * @param {THREE.Scene} scene
   * @param {Iterable<import("../engine/signals.js").SignalSystem>} systems  uno por ruta
   */
  constructor(scene, systems) {
    this.views = [];
    const post = std(0x3c4146, { metal: 0.6, rough: 0.4 });
    const head = std(0x0d0f11, { metal: 0.3, rough: 0.6 });
    const lampGeo = new THREE.CircleGeometry(0.1, 20);
    const visorGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.14, 16, 1, true, 0, Math.PI);
    const poleGeo = new THREE.BoxGeometry(0.1, 2.5, 0.1);
    const boxGeo = new THREE.BoxGeometry(0.34, 0.95, 0.22);
    const plateGeo = new THREE.PlaneGeometry(0.34, 0.17);

    for (const system of systems) {
      const route = system.route;
      for (const s of system.signals) {
        const g = new THREE.Group();
        // A la derecha de la vía, sobre el borde del andén de evacuación, mirando al tren que llega
        g.position.set(route.trackX + route.dir * 1.85, 0, route.toWorldZ(s.z));
        g.rotation.y = route.dir === 1 ? 0 : Math.PI;
        scene.add(g);

        const pole = new THREE.Mesh(poleGeo, post);
        pole.position.y = 1.25;
        const box = new THREE.Mesh(boxGeo, head);
        box.position.y = 2.95;
        g.add(pole, box);

        // Lámparas: rojo arriba, amarillo en medio, verde abajo
        const lamps = {};
        ["red", "yellow", "green"].forEach((aspect, k) => {
          const mat = new THREE.MeshBasicMaterial({ color: LAMP_OFF, fog: false, toneMapped: false });
          const lamp = new THREE.Mesh(lampGeo, mat);
          lamp.position.set(0, 3.25 - k * 0.3, 0.115);
          const visor = new THREE.Mesh(visorGeo, head);
          visor.rotation.x = Math.PI / 2;
          visor.rotation.y = Math.PI;
          visor.position.set(0, 3.27 - k * 0.3, 0.17);
          g.add(lamp, visor);
          lamps[aspect] = mat;
        });

        const plate = new THREE.Mesh(plateGeo, glow(0xffffff, { map: toTexture(signalPlateCanvas(s.id)) }));
        plate.position.set(0, 2.25, 0.06);
        g.add(plate);

        this.views.push({ signal: s, worldZ: route.toWorldZ(s.z), group: g, lamps, shown: null });
      }
    }
    this.update(Infinity);
  }

  /** Enciende las lámparas según el aspecto actual y oculta las señales lejanas. */
  update(cameraZ) {
    const R = CONFIG.renderRadius;
    for (const v of this.views) {
      v.group.visible = Math.abs(v.worldZ - cameraZ) < R;
      const aspect = v.signal.aspect;
      if (v.shown === aspect) continue;
      v.shown = aspect;
      for (const [a, mat] of Object.entries(v.lamps)) mat.color.setHex(a === aspect ? ASPECT_COLORS[a] : LAMP_OFF);
    }
  }
}
