# MetroSim · notas para Claude

## Versión del juego
**Cada cambio que se suba debe actualizar la numeración de la versión.** Esquema `X.Y` para funciones nuevas
y `X.Y.Z` para arreglos o cambios chicos (1.6 → 1.6.1 → 1.6.2 → 1.7…). Hay que cambiarla en todos estos sitios:

- `js/config.js` → `export const VERSION = "X.Y[.Z]"` (sello de la intro)
- `index.html` → `<span class="start-ver">vX.Y[.Z]</span>` (portada)
- `sw.js` → `const CACHE = "metrosim-vX.Y[.Z]"` (renueva la caché de la PWA; de aquí saca el APK su
  `versionName`/`versionCode`, ver `android/build/build.py`)
- `README.md` → sección «Versión X.Y · …» con lo nuevo (los arreglos `X.Y.Z` se agregan a la sección de su versión)

La versión de red del multijugador (`NET_LEVEL`) es otra cosa: solo cambia si cambia el protocolo de la sala.
