/* ==========================================================================
   MetroSim — Roles · driverSafety.js
   Seguridad de la conducción (1.4): lo que vigila a un conductor real.

     · VIGILANCIA (hombre muerto): con el tren en marcha, si el conductor no
       toca ningún mando en VIGIL_ALARM s suena un zumbador; tiene VIGIL_TRIP s
       para confirmar (X o mover el mando). Si no, frenado de emergencia.
     · ATP: tras un frenado de emergencia del ATP (exceso de velocidad o rebase
       de una señal en rojo) la tracción queda bloqueada. Con el tren detenido,
       el PCC (Puesto Central de Control) revisa y autoriza por radio a seguir;
       si se rebasó una señal, en MARCHA A LA VISTA (15 km/h) hasta la próxima.
     · SEÑAL EN FALLA: detenido ante una señal en rojo por falla (y con el
       cantón libre), el PCC autoriza por radio a rebasarla en marcha a la
       vista a 25 km/h, sin falta.
     · PERSONAL EN LA VÍA: durante los "TRABAJOS EN VÍA" (incidents.js) hay
       trabajadores con chaleco reflectante en el andén de evacuación. El
       conductor debe tocar la bocina (B) al acercarse; si no, es una falta.

   Las órdenes de seguridad al tren (emergencia, bloqueo de tracción, marcha
   a la vista) usan la misma simulación que todo lo demás (engine/sim.js).
   ========================================================================== */

import * as THREE from "three";
import { CONFIG } from "../config.js";

/** Segundos sin tocar un mando antes del zumbador, y para responder después. */
const VIGIL_ALARM = 45, VIGIL_TRIP = 7;
/** Segundos detenido antes de que el PCC autorice a seguir tras el ATP. */
const AUTH_DELAY = 9;
/** Segundos detenido ante una señal en falla antes de la autorización. */
const FAULT_WAIT = 10;
/** Límites de la marcha a la vista (km/h). */
const SIGHT_KMH = 15, FAULT_KMH = 25;
/** Metros antes del personal en los que la bocina cuenta, y del aviso previo. */
const HORN_RANGE = 350, WORK_WARN = 600;

/** Número del tren como se dice por radio: "L3-0805" → "cero ocho cero cinco". */
const DIGITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const spokenTrain = (id) => (id.match(/\d+$/)?.[0] || id).split("").map(d => DIGITS[+d] ?? d).join(" ");
const spokenSignal = (id) => String(id).split("").map(d => DIGITS[+d] ?? d).join(" ");

export class DriverSafety {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {import("../audio.js").AudioSystem} opts.audio
   * @param {Map} opts.signals            sistemas de señales por id de ruta
   * @param {(text, level, ms?) => void} opts.notify   mensaje en el HUD
   * @param {(kind) => void} opts.penalty  falta en el puntaje
   */
  constructor({ scene, audio, signals, notify, penalty }) {
    this.scene = scene;
    this.audio = audio;
    this.signals = signals;
    this.notify = notify;
    this.penalty = penalty;
    this.vigil = 0;              // s desde el último mando, con el tren en marcha
    this.alarm = false;
    this.buzzT = 0;
    this.trip = null;            // intervención del ATP pendiente de autorización
    this.faultWait = 0;
    this.zones = [];             // trabajos en la vía: { zone, route, group, arms, honked, warned, passed }
  }

  /* ----- Entradas del conductor ----- */

  /** Cualquier mando (o X) confirma la vigilancia. */
  input() {
    if (this.alarm) this.notify("Vigilancia confirmada", "ok", 1500);
    this.vigil = 0;
    this.alarm = false;
  }

  /** B: bocina. Cuenta para el personal en la vía que está por delante, a menos de HORN_RANGE m. */
  horn(unit) {
    this.audio.horn();
    this.input();
    for (const z of this.zones) {
      const d = unit.sim.position - z.zone.from;
      if (z.route === unit.route && d > 0 && d <= HORN_RANGE) z.honked = true;
    }
  }

  /* ----- Eventos ----- */

  onPlayerEvent(type, data) {
    if (type === "atpTrip") this.trip = { kind: "overspeed", stoppedFor: 0 };
    if (type === "redSignal") this.trip = { kind: "spad", signal: data.signal, stoppedFor: 0 };
    if (type === "restrictionEnd") this.notify(`Fin de la marcha a la vista · señal a la vista · conducción normal`, "ok", 3500);
  }

  /** Incidentes del motor: aparece o se retira el personal en la vía. */
  onIncident(inc) {
    if (inc.kind !== "speedRestriction" || !inc.zone) return;
    if (inc.phase === "start" && inc.zone.label === "TRABAJOS EN VÍA") this.addWorkers(inc.route, inc.zone);
    if (inc.phase === "end") {
      for (const z of this.zones.filter(w => w.zone === inc.zone)) this.scene.remove(z.group);
      this.zones = this.zones.filter(w => w.zone !== inc.zone);
    }
  }

  /** Mensaje del PCC por radio (voz) y en el HUD. */
  pcc(speech, text, level = "info") {
    this.audio.radio(speech);
    this.notify(`📻 PCC: ${text}`, level, 7000);
  }

  /* ----- Paso por fotograma ----- */
  update(dt, unit) {
    const sim = unit.sim;
    this.updateTrip(dt, unit);
    this.updateFault(dt, unit);
    this.updateVigilance(dt, sim);
    this.updateWorkers(dt, unit);
  }

  updateTrip(dt, unit) {
    const sim = unit.sim, trip = this.trip;
    if (!trip) return;
    sim.tractionLock = "intervención del ATP · espera la autorización del PCC";
    if (!sim.isStopped) return;
    trip.stoppedFor += dt;
    if (trip.stoppedFor < AUTH_DELAY) return;
    const train = spokenTrain(unit.id);
    if (trip.kind === "spad") {
      const next = this.signals.get(unit.route.id)?.nextAhead(sim.position);
      if (next) sim.restriction = { kmh: SIGHT_KMH, untilZ: next.z, label: "MARCHA A LA VISTA" };
      this.pcc(`Tren ${train}, PCC. Rebasó la señal ${spokenSignal(trip.signal.id)} en rojo. Autorizado a continuar en marcha a la vista, máximo quince kilómetros por hora, hasta la próxima señal. Atento a un tren adelante.`,
        `rebase de S${trip.signal.id} registrado · autorizado en marcha a la vista (máx. ${SIGHT_KMH} km/h) hasta la próxima señal · rearma la emergencia (▲)`, "warn");
    } else {
      this.pcc(`Tren ${train}, PCC. Intervención del ATP registrada. Autorizado a reanudar la marcha. Respete los límites de velocidad.`,
        "intervención del ATP registrada · autorizado a reanudar · rearma la emergencia (▲)", "warn");
    }
    sim.tractionLock = null;
    this.trip = null;
  }

  /** Detenido ante una señal en rojo por falla con el cantón libre: el PCC autoriza a rebasarla. */
  updateFault(dt, unit) {
    const sim = unit.sim;
    const s = this.signals.get(unit.route.id)?.nextAhead(sim.position);
    const waiting = s && s.fault && s.aspect === "red" && !s.occupied && !s.permit && !this.trip
      && sim.isStopped && sim.position - s.z < 120;
    if (!waiting) { this.faultWait = 0; return; }
    this.faultWait += dt;
    if (this.faultWait < FAULT_WAIT) return;
    this.faultWait = 0;
    s.permit = unit;                                     // el tráfico no lo cuenta como rebase
    sim.restriction = { kmh: FAULT_KMH, untilZ: s.endZ, label: "MARCHA A LA VISTA" };
    this.pcc(`Tren ${spokenTrain(unit.id)}, PCC. La señal ${spokenSignal(s.id)} está en falla. Autorizado a rebasarla en rojo, en marcha a la vista, máximo veinticinco kilómetros por hora, hasta la próxima señal.`,
      `señal S${s.id} en falla · autorizado a rebasarla en rojo en marcha a la vista (máx. ${FAULT_KMH} km/h)`, "warn");
  }

  updateVigilance(dt, sim) {
    if (sim.speedKmh < 3 || sim.emergency) { this.vigil = 0; this.alarm = false; return; }
    this.vigil += dt;
    if (this.vigil > VIGIL_ALARM && !this.alarm) {
      this.alarm = true;
      this.buzzT = 0;
      this.notify("VIGILANCIA · pulsa X (o mueve el mando) para confirmar que estás atento", "alert", VIGIL_TRIP * 1000);
    }
    if (!this.alarm) return;
    this.buzzT -= dt;
    if (this.buzzT <= 0) { this.buzzT = 0.5; this.audio.vigilanceBuzz(); }
    if (this.vigil > VIGIL_ALARM + VIGIL_TRIP) {
      this.vigil = 0;
      this.alarm = false;
      sim.emergencyBrake("Hombre muerto");
      this.penalty("vigilance");
      this.notify("HOMBRE MUERTO · no respondiste a la vigilancia · frenado de emergencia", "alert", 5000);
    }
  }

  /* ----- Personal en la vía ----- */

  /** Tres trabajadores con chaleco y casco sobre el andén de evacuación, al inicio de la zona. */
  addWorkers(route, zone) {
    const group = new THREE.Group();
    const M = (this.mats ??= workerMaterials());
    const arms = [];
    const x = route.side * 4.35, y = 0.9;
    [0, 2.2, 5.5].forEach((dz, i) => {
      const w = new THREE.Group();
      const box = (wd, h, d, mat, px, py, pz, parent = w) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), mat);
        m.position.set(px, py, pz);
        parent.add(m);
        return m;
      };
      box(0.36, 0.84, 0.22, M.pants, 0, 0.42, 0);
      box(0.42, 0.6, 0.26, M.vest, 0, 1.13, 0);
      [1.0, 1.25].forEach(h => box(0.43, 0.05, 0.27, M.stripe, 0, h, 0));
      box(0.2, 0.22, 0.2, M.skin, 0, 1.56, 0);
      box(0.25, 0.1, 0.25, M.helmet, 0, 1.7, 0);
      box(0.06, 0.05, 0.03, M.lamp, 0, 1.68, 0.13);
      const arm = new THREE.Group();
      arm.position.set(-route.side * 0.25, 1.4, 0);
      box(0.1, 0.6, 0.1, M.vest, 0, -0.28, 0, arm);
      w.add(arm);
      arms.push(arm);
      // Mirando hacia la vía, algo girados hacia el tren que llega
      w.rotation.y = (route.side > 0 ? -Math.PI / 2 : Math.PI / 2) + (i - 1) * 0.3;
      w.position.set(x + (i % 2 ? 0.25 : -0.1), y, route.toWorldZ(zone.from - 4 - dz));
      group.add(w);
    });
    // Baliza de trabajos: luz ámbar intermitente en el hastial, antes del personal (se ve de lejos)
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.34), M.beacon);
    beacon.position.set(route.side * 4.95, 2.3, route.toWorldZ(zone.from + 6));
    group.add(beacon);
    this.scene.add(group);
    this.zones.push({ zone, route, group, arms, beacon, honked: false, warned: false, passed: false, t: 0 });
  }

  updateWorkers(dt, unit) {
    const sim = unit.sim;
    for (const z of this.zones) {
      z.t += dt;
      z.beacon.visible = Math.floor(z.t * 2.5) % 2 === 0;
      if (z.route !== unit.route) continue;
      const d = sim.position - z.zone.from;
      // Al tocar la bocina (o con el tren muy cerca) el personal levanta el brazo
      const raise = z.honked || (d > 0 && d < 90) ? -2.6 : 0;
      for (const a of z.arms) a.rotation.x += (raise - a.rotation.x) * Math.min(1, dt * 4);
      if (!z.warned && d > 0 && d < WORK_WARN) {
        z.warned = true;
        this.notify(`Personal trabajando en la vía a ${Math.round(d)} m · reduce a ${z.zone.kmh} km/h y toca la bocina (B)`, "warn", 6000);
      }
      if (!z.passed && d <= 0 && d > -CONFIG.train.length) {
        z.passed = true;
        if (!z.warned) continue;                       // apareció con el tren ya encima: no hubo tiempo de avisar
        if (z.honked) this.notify("El personal en la vía te saluda: tocaste la bocina", "ok", 3000);
        else { this.penalty("horn"); this.notify("No tocaste la bocina al pasar junto al personal en la vía", "warn", 5000); }
      }
    }
  }

  /** Aviso para la DMI (o null). */
  alert(unit) {
    const sim = unit.sim;
    if (this.alarm) return { text: "VIGILANCIA · PULSA X", level: "alert" };
    if (this.trip) return { text: sim.isStopped ? "ATP · ESPERA AUTORIZACIÓN PCC" : "ATP · FRENO DE EMERGENCIA", level: "alert" };
    if (sim.restriction) return { text: `${sim.restriction.label} · MÁX ${sim.restriction.kmh} KM/H`, level: "warn" };
    const z = this.zones.find(w => w.route === unit.route && !w.passed && sim.position - w.zone.from > 0 && sim.position - w.zone.from < WORK_WARN);
    if (z) return { text: z.honked ? "PERSONAL EN LA VÍA" : "PERSONAL EN LA VÍA · BOCINA (B)", level: "warn" };
    return null;
  }

  /** Quita del dibujo al personal (al terminar la partida o cambiar de vía). */
  dispose() {
    for (const z of this.zones) this.scene.remove(z.group);
    this.zones = [];
  }
}

/** Materiales del personal (los comparten las zonas de una partida; la escena los libera al salir). */
function workerMaterials() {
  const std = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: e ? c : 0x000000, emissiveIntensity: e });
  return {
    pants: std(0x1d2a44),
    vest: std(0xff7a1a, 0.35),                         // chaleco reflectante: se ve en la penumbra del túnel
    stripe: new THREE.MeshBasicMaterial({ color: 0xf2f2e6 }),
    skin: std(0xc68d65),
    helmet: std(0xf4f4f0, 0.15),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xffa000 }),
  };
}
