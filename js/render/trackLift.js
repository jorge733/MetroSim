/* ==========================================================================
   MetroSim — 1.2 · render/trackLift.js
   La vía en 3D con sus PENDIENTES reales (las de engine/profile.js).

   Toda la lógica del juego (física, estaciones, viajeros, pasajero) sigue
   trabajando en un mundo "plano": el andén siempre está a 1,2 m, la vía a 0…
   Lo que se dobla es solo el DIBUJO: en la tarjeta gráfica, cada vértice de
   la escena se sube o se baja según la cota del trazado en su coordenada z:

       y_dibujo = y + (cota(z) − cota(z de la cámara))

   Así el túnel baja y sube entre estaciones, las estaciones quedan cada una
   a su altura (son horizontales) y los trenes SE DOBLAN siguiendo la vía,
   coche a coche y rueda a rueda, sin tocar su geometría. Restar la cota de
   la cámara mantiene todo lo cercano en su sitio (luces, cámara, pasajero)
   y evita números grandes.

   Cómo se hace: se extiende el shader de TODOS los materiales de Three.js
   (Material.prototype.onBeforeCompile) para que, tras aplicar la matriz del
   objeto, sume la elevación leída de una textura (una muestra cada 2 m de
   la línea). Una sola textura y unas pocas uniformes compartidas: el coste
   es mínimo, incluso en gráficos integrados.

   La CALLE (city/) no se dobla: es horizontal y va a la altura de su
   estación (sus materiales llevan userData.trackLift = "city").

   La cámara de cabina e interior, además, se inclina con la pendiente: el
   tren cabecea al entrar en una rampa, como en la realidad.
   ========================================================================== */

import * as THREE from "three";
import { WORLD } from "../config.js";
import { ROUTE_A } from "../engine/route.js";

/** Separación (m) entre muestras de cota. */
const STEP = 2;
/** Ancho de la textura de cotas. */
const TEX_W = 1024;

const U = {
  uTrackLift: { value: null },
  uTrackLiftInfo: { value: new THREE.Vector4(0, STEP, TEX_W, 1) },   // z inicial, paso, ancho, n.º de muestras
  uCamLift: { value: 0 },
  uCityLift: { value: 0 },
};

let profile = null, ref = 0;

/** Uniformes compartidas por todos los materiales (útil para depurar desde la consola). */
export const trackLiftUniforms = U;

const GLSL = /* glsl */ `
uniform sampler2D uTrackLift;
uniform vec4 uTrackLiftInfo;
uniform float uCamLift;
uniform float uCityLift;
float trackLiftAt(float z) {
  float f = clamp((uTrackLiftInfo.x - z) / uTrackLiftInfo.y, 0.0, uTrackLiftInfo.w - 1.001);
  int i = int(floor(f));
  int w = int(uTrackLiftInfo.z);
  float a = texelFetch(uTrackLift, ivec2(i % w, i / w), 0).r;
  float b = texelFetch(uTrackLift, ivec2((i + 1) % w, (i + 1) / w), 0).r;
  return mix(a, b, f - float(i));
}
`;

const PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 tlWorld = modelMatrix * mvPosition;
#ifdef TRACK_LIFT_CITY
  tlWorld.y += uCityLift - uCamLift;
#else
  tlWorld.y += trackLiftAt( tlWorld.z ) - uCamLift;
#endif
mvPosition = viewMatrix * tlWorld;
gl_Position = projectionMatrix * mvPosition;
`;

let installed = false;

/** Engancha el doblado en todos los materiales (una vez, antes de compilar ninguno). */
export function installTrackLift() {
  if (installed) return;
  installed = true;
  THREE.Material.prototype.onBeforeCompile = function (shader) {
    if (!shader.vertexShader.includes("#include <project_vertex>") || !U.uTrackLift.value) return;
    Object.assign(shader.uniforms, U);
    const city = this.userData?.trackLift === "city";
    shader.vertexShader = (city ? "#define TRACK_LIFT_CITY\n" : "") + shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + GLSL)
      .replace("#include <project_vertex>", PROJECT);
  };
  THREE.Material.prototype.customProgramCacheKey = function () {
    return this.userData?.trackLift === "city" ? "trackLift-city" : "trackLift";
  };
}

/** Cota relativa (m) del trazado de la línea activa en una z del mundo. */
export function liftAt(z) { return profile ? profile.elevationAt(z) - ref : 0; }

/** Prepara la textura de cotas de la línea activa (al empezar cada partida). */
export function setTrackLiftLine() {
  profile = ROUTE_A.line.profile;
  ref = profile.elevationAt(ROUTE_A.line.stations[0].z);
  const z0 = WORLD.start, z1 = WORLD.end;
  const n = Math.ceil((z0 - z1) / STEP) + 2;
  const h = Math.ceil(n / TEX_W);
  const data = new Float32Array(TEX_W * h);
  for (let i = 0; i < n; i++) data[i] = liftAt(z0 - i * STEP);
  U.uTrackLift.value?.dispose();
  const tex = new THREE.DataTexture(data, TEX_W, h, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  U.uTrackLift.value = tex;
  U.uTrackLiftInfo.value.set(z0, STEP, TEX_W, n);
}

/** Marca los materiales de un grupo (la calle) para que no se doblen. */
export function markCity(group) {
  group.traverse(o => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (m.userData.trackLift !== "city") { m.userData.trackLift = "city"; m.needsUpdate = true; }
  });
}

/**
 * Fija la referencia de la cámara antes de dibujar.
 * @param {number} cameraZ    z del mundo de la cámara
 * @param {object} opts
 * @param {number|null} opts.cityZ   z de la estación cuya calle está cargada (o null)
 * @param {boolean} opts.inStreet    la cámara está en la calle (usa la cota de su estación)
 */
export function updateTrackLift(cameraZ, { cityZ = null, inStreet = false } = {}) {
  const city = cityZ === null ? 0 : liftAt(cityZ);
  U.uCityLift.value = city;
  U.uCamLift.value = inStreet && cityZ !== null ? city : liftAt(cameraZ);
}

const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _axis = new THREE.Vector3(1, 0, 0);

/**
 * Inclina la cámara con la pendiente del tren (cabina e interior). Devuelve
 * una función que deshace la inclinación (llamarla después de dibujar).
 */
export function pitchCamera(camera, worldZ) {
  const slope = (liftAt(worldZ - 2) - liftAt(worldZ + 2)) / 4;     // subida hacia −Z
  if (Math.abs(slope) < 1e-5) return () => {};
  const saved = camera.quaternion.clone();
  _q.setFromAxisAngle(_axis, Math.atan(slope));                     // giro en ejes del MUNDO
  if (camera.parent) {
    camera.parent.getWorldQuaternion(_p);
    _q.premultiply(_p.clone().invert()).multiply(_p);               // pasado a ejes del padre
  }
  camera.quaternion.premultiply(_q);
  camera.updateMatrixWorld(true);
  return () => { camera.quaternion.copy(saved); camera.updateMatrixWorld(true); };
}

