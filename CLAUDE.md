# RedMoviSim (antes MetroSim) · notas para Claude

## Versión del juego
**Cada cambio que se suba debe actualizar la numeración de la versión.** Esquema `X.Y` para funciones nuevas
y `X.Y.Z` para arreglos o cambios chicos (1.6 → 1.6.1 → 1.6.2 → 1.7…). Hay que cambiarla en todos estos sitios:

- `js/config.js` → `export const VERSION = "X.Y[.Z]"` (sello de la intro)
- `index.html` → `<span class="start-ver">vX.Y[.Z]</span>` (portada)
- `sw.js` → `const CACHE = "metrosim-vX.Y[.Z]"` (renueva la caché de la PWA; el prefijo sigue siendo `metrosim-` porque de aquí saca el APK su
  `versionName`/`versionCode`, ver `android/build/build.py`)
- `README.md` → sección «Versión X.Y · …» con lo nuevo (los arreglos `X.Y.Z` se agregan a la sección de su versión)

La versión de red del multijugador (`NET_LEVEL`) es otra cosa: solo cambia si cambia el protocolo de la sala.

## Dónde subir los cambios
**Siempre se suben directo a `main`** (`git push origin HEAD:main`), aunque la sesión indique otra rama de trabajo.
Antes de subir: `git fetch origin main` y, si `main` avanzó, rebasar encima (nunca forzar el push).

## Imágenes para redes sociales (`post-*/`)
**Cuando una imagen muestra un celular, siempre va en horizontal** (captura a 844×390 y marco acostado,
`aspect-ratio: 844/390`), nunca en vertical. Antes de subir, revisar las tres medidas (cuadrado, historia y horizontal)
para que nada se corte ni quede una palabra sola en una línea.

**Los posts se publican solo en Instagram.** En el texto (`texto.txt`) los enlaces no se pueden tocar: se manda al
«link en la bio» y la dirección va escrita solo como referencia. Se puede etiquetar con `@usuario` de Instagram.
