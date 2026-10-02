/* ==========================================================================
   MetroSim — scoring.js
   Puntaje del Conductor: convierte la conducción en un desafío.

   Cada estación da puntos por:
     · precisión de parada (marca de parada)
     · puntualidad de la llegada
     · confort del tramo (sin tirones ni paradas bruscas)
   Las estaciones "perfectas" seguidas forman una RACHA que multiplica
   los puntos (hasta ×2). Las faltas (exceso de velocidad, señal en rojo,
   emergencia, alcance, salida anticipada...) restan y rompen la racha.

   Al final del servicio se calcula una nota (S, A, B, C, D) y se guarda
   el récord por línea y sentido en localStorage.

   Módulo sin Three.js: solo lee la física del tren (sim) que ya existe.
   ========================================================================== */

import { CONFIG } from "./config.js";

/** Puntos por estación. */
const POINTS = {
  stop: [[0.5, 300], [1.5, 200], [CONFIG.station.stopTolerance, 100]],   // [error máx. (m), puntos]
  punctual: [[CONFIG.schedule.punctualWindow, 200], [60, 100], [120, 40]],  // [desfase máx. (s), puntos]
  comfort: 150,                     // tramo sin tirones
};

/** Penalizaciones (puntos que se restan). */
export const PENALTIES = {
  overspeed: 150,
  redSignal: 500,
  emergency: 100,
  collision: 1000,
  bumper: 400,
  earlyDeparture: 100,
  offPosition: 50,
  jerk: 20,                         // cada tirón
};

/** Tirón: el mando pide un cambio de esfuerzo mayor que esto (m/s²) respecto
 *  a lo pedido en el último segundo (p. ej. de TRACCIÓN 4 a FRENO de golpe). */
const JERK_LIMIT = 0.9;
/** Constante de tiempo (s) de la media del esfuerzo pedido. */
const JERK_TAU = 0.8;
/** Parada brusca: el tren se detiene con más deceleración que esto (m/s²). */
const HARSH_STOP = 0.9;
/** Racha: multiplicador por estación perfecta seguida, y tope. */
const STREAK_STEP = 0.2, STREAK_MAX = 2;

const pick = (table, value) => (table.find(([lim]) => value <= lim) || [0, 0])[1];

export class DriverScore {
  /**
   * @param {string} key  clave del récord (línea y sentido)
   * @param {(ev: object) => void} onChange  avisa cada vez que cambia el puntaje
   */
  constructor(key, onChange = () => {}) {
    this.key = `metrosim.best.${key}`;
    this.onChange = onChange;
    this.total = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.maxPossible = 0;            // puntos máximos de las estaciones servidas (para la nota)
    this.jerks = 0;                  // tirones del tramo actual
    this.totalJerks = 0;
    this.harshStops = 0;
    this.perfects = 0;
    this.avgDemand = 0;
    this.jerkCooldown = 0;
    this.best = loadBest(this.key);
  }

  get multiplier() { return Math.min(STREAK_MAX, 1 + this.streak * STREAK_STEP); }

  /** Cada fotograma: vigila el confort del viaje. */
  update(dt, sim) {
    if (dt <= 0) return;
    const demand = sim.emergency ? this.avgDemand : sim.notchData.accel;   // la emergencia se cuenta aparte
    this.jerkCooldown -= dt;
    if (!sim.isStopped && sim.speed > 1 && this.jerkCooldown <= 0 && Math.abs(demand - this.avgDemand) > JERK_LIMIT) {
      this.jerks++;
      this.totalJerks++;
      this.jerkCooldown = 2;
      this.add(-PENALTIES.jerk, "Tirón · cambia el mando de a un punto", false);
    }
    this.avgDemand += (demand - this.avgDemand) * Math.min(1, dt / JERK_TAU);
  }

  /** El tren se detuvo: ¿fue una parada brusca? (deceleración justo antes de parar) */
  stopped(decelBefore) {
    if (decelBefore > HARSH_STOP) {
      this.harshStops++;
      this.jerks++;
      this.add(-PENALTIES.jerk * 2, "Parada brusca · suelta freno al final", false);
    }
  }

  /** Llegada a una estación: puntos por parada, puntualidad y confort. */
  arrival(stopError, delay) {
    const stop = pick(POINTS.stop, Math.abs(stopError));
    const punct = pick(POINTS.punctual, Math.abs(delay));
    const comfort = this.jerks === 0 ? POINTS.comfort : this.jerks === 1 ? POINTS.comfort / 2 : 0;
    const perfect = Math.abs(stopError) <= 1.5 && Math.abs(delay) <= CONFIG.schedule.punctualWindow && this.jerks === 0;

    const base = stop + punct + comfort;
    const mult = this.multiplier;
    const gained = Math.round(base * mult);
    this.maxPossible += POINTS.stop[0][1] + POINTS.punctual[0][1] + POINTS.comfort;
    this.jerks = 0;

    if (perfect) {
      this.perfects++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else this.streak = 0;

    const parts = [`parada +${stop}`, `horario +${punct}`, `confort +${comfort}`];
    this.add(gained, `${parts.join(" · ")}${mult > 1 ? ` · racha ×${mult.toFixed(1)}` : ""}`, true, { perfect });
    return { gained, perfect, streak: this.streak };
  }

  /** Falta: resta puntos y rompe la racha. */
  penalty(kind) {
    const pts = PENALTIES[kind] ?? 0;
    this.streak = 0;
    this.add(-pts, null, true);
  }

  add(points, detail, important, extra = {}) {
    this.total = Math.max(0, this.total + points);
    this.onChange({ points, detail, important, total: this.total, streak: this.streak, multiplier: this.multiplier, ...extra });
  }

  /** Nota final (0..1 sobre el máximo de las estaciones servidas). */
  grade() {
    const ratio = this.maxPossible ? this.total / this.maxPossible : 0;
    if (ratio >= 1.15) return "S";
    if (ratio >= 0.85) return "A";
    if (ratio >= 0.65) return "B";
    if (ratio >= 0.45) return "C";
    return "D";
  }

  /** Cierra el servicio: guarda el récord. Devuelve true si es un récord nuevo. */
  finish() {
    const isRecord = this.total > (this.best?.total ?? 0);
    if (isRecord) {
      this.best = { total: this.total, grade: this.grade(), date: new Date().toISOString().slice(0, 10) };
      try { localStorage.setItem(this.key, JSON.stringify(this.best)); } catch { /* sin almacenamiento */ }
    }
    return isRecord;
  }
}

function loadBest(key) {
  try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
}
