/* ==========================================================================
   MetroSim — Render · trainViews.js
   Dibujo 3D de los trenes que simula el motor.

   Escucha el bus de eventos del motor:
     · "train:created" → construye su modelo 3D
     · "train:rebuilt" → lo rehace (maniobra de retorno: otra vía, otra cabina)
     · "train:removed" → lo quita de la escena
   y en cada fotograma copia la posición y las puertas del estado lógico al
   modelo. El motor nunca toca Three.js.

   Solo se dibujan los trenes de la línea activa (la que tiene mundo 3D); las
   demás líneas de la red se simulan sin dibujo.

   Por compatibilidad con el resto del juego, la vista se cuelga del propio
   tren lógico: unit.model, unit.group (modelo 3D) y unit.slots (asientos y
   sitios de pie para los viajeros dibujados).
   ========================================================================== */

import { CONFIG } from "../config.js";
import { buildTrain, buildTrainSlots } from "../train.js";
import { ROUTE_A } from "../engine/route.js";

const L = CONFIG.train.length;

export class TrainViews {
  /**
   * @param {THREE.Scene} scene
   * @param {import("../engine/events.js").EventBus} bus
   */
  constructor(scene, bus) {
    this.scene = scene;
    const drawn = (u) => u.route.line === ROUTE_A.line;      // solo la línea activa tiene mundo 3D
    bus.on("train:created", (u) => drawn(u) && this.create(u));
    bus.on("train:rebuilt", (u) => { if (!drawn(u)) return; this.scene.remove(u.group); this.create(u); });
    bus.on("train:removed", (u) => drawn(u) && this.scene.remove(u.group));
  }

  create(u) {
    u.model = buildTrain({ routeId: u.route.dir === 1 ? "A" : "B", cab: u.isPlayer });
    u.group = u.model.group;
    u.group.rotation.y = u.route.dir === 1 ? 0 : Math.PI;   // la vía 2 circula hacia +Z
    u.slots = buildTrainSlots();
    this.place(u);
    this.scene.add(u.group);
  }

  place(u) {
    u.group.position.set(u.route.trackX, 0, u.route.toWorldZ(u.sim.position));
  }

  /** Posición, puertas y visibilidad de todos los modelos. */
  sync(units, cameraZ) {
    for (const u of units) {
      this.place(u);
      u.model.setDoors(u.sim.doorProgress);
      const center = u.route.toWorldZ(u.sim.position + L / 2);
      u.group.visible = u.isPlayer || Math.abs(center - cameraZ) < CONFIG.renderRadius + L / 2;
      u.group.updateMatrixWorld(true);
    }
  }
}
