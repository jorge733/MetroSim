# MetroSim para Android (APK)

`dist/MetroSim.apk` es el juego completo como app de Android: un WebView a pantalla completa
(horizontal) con todos los archivos del juego dentro del APK, incluido Three.js. Funciona sin
internet; solo el clima real se consulta en línea (sin conexión usa el típico de la temporada).

## Instalar en el teléfono

1. Copia `MetroSim.apk` al teléfono (o descárgalo desde GitHub en el teléfono).
2. Ábrelo y acepta instalar «apps de origen desconocido» para el navegador o el gestor de archivos.
3. Android puede advertir que la app no viene de Play Store: es normal en apps instaladas a mano.

Requiere Android 7.0 o superior con WebView actualizado (Chrome 89+).

## Construir el APK

```
python3 android/build/build.py            # deja dist/MetroSim.apk
```

Solo usa Python 3, `npm` (para descargar Three.js) y `keytool`/`jarsigner` del JDK: no necesita
el SDK de Android ni Gradle. El script:

- copia el juego a `assets/www` con Three.js local (sin CDN) y sin service worker;
- arma `classes.dex` desde `build/app.py` (el bytecode Dalvik de `src/.../MainActivity.java`,
  ensamblado por `build/dex.py`), y el `AndroidManifest.xml` binario y `resources.arsc` con `build/axml.py`;
- firma con `metrosim.keystore` (esquema v1) y alinea los archivos sin comprimir.

La app sirve los archivos desde `https://appassets.androidplatform.net/` (interceptando las
peticiones del WebView), así que módulos, `fetch` y `localStorage` funcionan como en el navegador.
El botón «atrás» del teléfono va al historial del juego (cierra ventanas o pide confirmación) y en
la portada sale de la app.

## Clave de firma

Las actualizaciones deben firmarse con la **misma clave**; si cambia, Android obliga a desinstalar
la app y se pierde el avance guardado. La clave (`android/metrosim.keystore`) **no se sube al
repositorio** (está en `.gitignore`): guárdala en un lugar seguro y ponla en `android/` antes de
construir. Si no está, el script crea una nueva, y esa versión no podrá instalarse encima de la
anterior (hay que desinstalar primero).

Cada versión nueva sube `versionCode` solo (sale de la versión de `sw.js`: 1.5 → 105).
