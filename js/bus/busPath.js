/* ==========================================================================
   RedMoviSim — 2.3 · bus/busPath.js
   El trazado real de un recorrido (route.path, de tools/recorridos-red.mjs)
   como una curva suave: convierte la distancia del recorrido `s` en un punto
   y una dirección del mapa. Así la calle dobla donde dobla el bus real.

   La simulación (busSim.js, taxiSim.js) sigue en una dimensión: `s` a lo largo
   del recorrido y `x` de lado (pistas). El mundo 3D (busWorld.js) se arma
   «recto», como antes (x de lado, z = −s), y después se dobla con esta curva:

     punto recto (x, y, −s)  →  P(s) + x·Derecha(s) + y·Arriba

   Ejes del mapa: X = este, Z = −norte (como el resto del juego, y = arriba).
   Las esquinas se suavizan promediando el rumbo (SMOOTH m) para que las pistas
   no se crucen; el largo se conserva (1 m de recorrido = 1 m de calle). Sin trazado (A01 de práctica) la calle va recta hacia el este.
   ========================================================================== */

const SMOOTH = 56;             // largo (m) en que se suaviza el rumbo: una esquina de 90° queda como curva de ~35 m de radio
const STEP = 1;                // muestreo de la curva (m)

export class RoutePath {
  /** @param {{path?: number[][]}} route  path: [este, norte, s] por punto */
  constructor(route) {
    const pts = route.path?.length >= 2 ? route.path : null;
    this.straight = !pts;
    if (this.straight) return;
    // Vértices en coordenadas del mundo (X este, Z = −norte) con la distancia del recorrido en cada uno
    const V = [];
    for (const [e, n, c] of pts) {
      const last = V.at(-1);
      if (last && Math.hypot(e - last.x, -n - last.z) < 0.5) continue;
      V.push({ x: e, z: -n, c });
    }
    // 1) Rumbo del trazado real cada STEP metros (constante en cada tramo) y anclas recorrido ↔ curva
    const heads = [];
    const anchorsC = [], anchorsA = [];
    let acc = 0;
    for (let k = 0; k < V.length - 1; k++) {
      const a = V[k], b = V[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      anchorsC.push(a.c); anchorsA.push(acc);
      const phi = Math.atan2(-(b.x - a.x), -(b.z - a.z));          // avance (−sinφ, −cosφ)
      const n = Math.max(1, Math.round((acc + L) / STEP) - Math.round(acc / STEP));
      for (let i = 0; i < n; i++) heads.push(phi);
      acc += L;
    }
    anchorsC.push(V.at(-1).c); anchorsA.push(acc);
    for (let i = 1; i < heads.length; i++) {                          // sin saltos de 2π
      while (heads[i] - heads[i - 1] > Math.PI) heads[i] -= 2 * Math.PI;
      while (heads[i - 1] - heads[i] > Math.PI) heads[i] += 2 * Math.PI;
    }
    // 2) Rumbo suavizado (promedio móvil, dos pasadas): las esquinas quedan como curvas de ~SMOOTH m
    const box = (src) => {
      const h = Math.round(SMOOTH / 2 / STEP), n = src.length, out = new Float64Array(n);
      let sum = 0, cnt = 0;
      for (let i = -h; i < n + h; i++) {
        if (i + h < n) { sum += src[Math.max(0, i + h)]; cnt++; }
        if (i - h - 1 >= 0) { sum -= src[i - h - 1]; cnt--; }
        if (i >= 0 && i < n) out[i] = sum / Math.max(1, cnt);
      }
      return out;
    };
    const PHI = box(box(heads));
    // 3) Posición integrando el rumbo desde el primer punto (el largo se conserva: 1 m de recorrido = 1 m de calle)
    const N = PHI.length + 1;
    this.X = new Float64Array(N); this.Z = new Float64Array(N); this.PHI = new Float64Array(N); this.K = new Float32Array(N);
    this.X[0] = V[0].x; this.Z[0] = V[0].z;
    for (let i = 0; i < N; i++) {
      const phi = PHI[Math.min(PHI.length - 1, i)];
      this.PHI[i] = phi;
      if (i > 0) { this.X[i] = this.X[i - 1] - Math.sin(PHI[i - 1]) * STEP; this.Z[i] = this.Z[i - 1] - Math.cos(PHI[i - 1]) * STEP; }
    }
    for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 2), i1 = Math.min(N - 1, i + 2);
      this.K[i] = (this.PHI[i1] - this.PHI[i0]) / Math.max(1e-6, (i1 - i0) * STEP);   // + = gira a la izquierda
    }
    this.total = (N - 1) * STEP;
    this.anchorsC = anchorsC;
    this.anchorsA = anchorsA.map(a => a * this.total / Math.max(1e-6, acc));
  }

  /** Distancia sobre la curva para una distancia del recorrido (puede quedar fuera de [0, total]). */
  arc(s) {
    const C = this.anchorsC, A = this.anchorsA, n = C.length;
    if (s <= C[0]) return A[0] + (s - C[0]);
    if (s >= C[n - 1]) return A[n - 1] + (s - C[n - 1]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
    const f = (s - C[lo]) / Math.max(1e-9, C[hi] - C[lo]);
    return A[lo] + (A[hi] - A[lo]) * f;
  }

  /** Punto del eje y rumbo en `s`: { x, z, phi } (fuera de la curva sigue derecho). */
  frame(s, out = {}) {
    if (this.straight) { out.x = s; out.z = 0; out.phi = -Math.PI / 2; return out; }
    const a = this.arc(s), N = this.X.length;
    if (a <= 0 || a >= this.total) {
      const i = a <= 0 ? 0 : N - 1, d = a <= 0 ? a : a - this.total, phi = this.PHI[i];
      out.x = this.X[i] - Math.sin(phi) * d; out.z = this.Z[i] - Math.cos(phi) * d; out.phi = phi;
      return out;
    }
    const u = a / STEP, i = Math.min(N - 2, Math.floor(u)), f = u - i;
    out.x = this.X[i] + (this.X[i + 1] - this.X[i]) * f;
    out.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * f;
    out.phi = this.PHI[i] + (this.PHI[i + 1] - this.PHI[i]) * f;
    return out;
  }

  /** Curvatura (1/m) más fuerte en [s − r, s + r]: + izquierda, − derecha (la de mayor valor absoluto). */
  curvature(s, r = 0) {
    if (this.straight) return 0;
    const N = this.X.length;
    const i0 = Math.max(0, Math.floor(this.arc(s - r) / STEP)), i1 = Math.min(N - 1, Math.ceil(this.arc(s + r) / STEP));
    let k = 0;
    for (let i = i0; i <= i1; i++) if (Math.abs(this.K[i]) > Math.abs(k)) k = this.K[i];
    return k;
  }

  /**
   * ¿Un objeto a `x` metros del eje (+ = derecha) quedaría montado sobre la calle en la parte de adentro de una
   * curva cercana? (los edificios y árboles de esa esquina se omiten)
   */
  inside(x, s, r = 10) {
    const k = this.curvature(s, r);
    return x * -k > 0.75;
  }

  /**
   * 2.15.3 · Al revés: para un punto del mapa, a cuántos metros (+ derecha) queda del eje más cercano de la calle,
   * buscando cerca de `s` (±win m). null si el más cercano es un extremo del trazado.
   */
  lateralAt(wx, wz, s, win = 120) {
    if (this.straight) return null;
    const N = this.X.length, c = Math.round(this.arc(s) / STEP);
    let best = Infinity, bi = -1;
    for (let i = Math.max(0, c - win); i <= Math.min(N - 1, c + win); i++) {
      const dx = wx - this.X[i], dz = wz - this.Z[i], d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    if (bi <= 0 || bi >= N - 1) return null;
    const phi = this.PHI[bi];
    return (wx - this.X[bi]) * Math.cos(phi) - (wz - this.Z[bi]) * Math.sin(phi);
  }

  /**
   * Punto recto (x, y, z) → mapa, en `out` (THREE.Vector3 o similar).
   * Recto: x de lado (+ derecha), z = −s.
   */
  toWorld(x, y, z, out) {
    const f = this.frame(-z, TMP);
    const c = Math.cos(f.phi), sn = Math.sin(f.phi);
    out.x = f.x + x * c; out.y = y; out.z = f.z - x * sn;
    return out;
  }
}

const TMP = {};
