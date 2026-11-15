# Kit de difusión · RedMoviSim

Enlace del juego: **https://www.redmovisim.cl/**
Código: https://github.com/jorge733/MetroSim

---

## 0. Antes de difundir (imprescindible)

1. ✅ **Juego publicado** en Vercel (`https`: la PWA instalable y el modo sin conexión funcionan).
2. **Capturas y video**: 4–6 capturas (cabina con la DMI, andén lleno, calle con un hito,
   Centro de Control) y un clip vertical de 20–40 s. ✅ Imagen para compartir lista: `icons/og.jpg` (1200×630). Al cambiarla, guardar como
   `icons/og.jpg` con el mismo tamaño.
3. **Probar el enlace en el celular** antes de publicarlo en ningún lado.

---

## 1. Frase corta (bio, descripción, pie de foto)

> RedMoviSim: simulador 3D del transporte público de Santiago, gratis en el navegador. Conduce el Metro, maneja buses o dirige la red. 🚇🚌

## 2. Descripción larga (itch.io, GitHub, Game Jolt)

**RedMoviSim** es un simulador 3D (no oficial) del **transporte público de Santiago de Chile**, Metro y buses, que se juega en el navegador,
sin instalar nada (y se puede instalar como app en el celular).

- 🚆 **Conductor**: maneja el AS-2014 real de la Línea 3 —5 coches, 120 m, física por fuerzas,
  freno regenerativo, señales, pendientes y horarios reales—. Gana puntos por puntualidad y suavidad.
- 🧍 **Pasajero**: parte en la calle de cualquier estación, baja al andén, espera el tren y viaja
  entre la gente. Si el tren va lleno, te toca esperar el siguiente.
- 🚌 **Conductor de bus** (beta): maneja por la Alameda con pista Solo Bus, semáforos, autos y paraderos.
- 🖥️ **Centro de Control**: vigila la red en un esquema, retiene trenes, activa la regulación
  y responde a incidentes (puertas obstruidas, fallas de señal, restricciones de velocidad).
- 🗺️ Las 7 líneas: 1, 2, 3, 4, 4A, 5 y 6, con combinaciones, demanda por hora del día y hora real local.
- 📲 Funciona en PC y celular (controles táctiles) y sin conexión después de la primera vez.

Hecho por una persona, con HTML, JavaScript y Three.js. Código abierto en GitHub.

## 3. Publicaciones por plataforma

### Reddit — r/chile, r/Santiago (español)
**Título:** Hice un simulador 3D del Metro de Santiago que se juega en el navegador (gratis)
> Llevo un tiempo armando RedMoviSim: puedes manejar un tren de la L3 con física real, viajar como
> pasajero desde la calle hasta el andén, o dirigir la red desde un Centro de Control. Están las
> 7 líneas y usa la hora real (si es hora punta, los andenes se llenan).
> Juégalo aquí: https://www.redmovisim.cl/
> Es un proyecto personal y abierto; cualquier comentario o error que encuentren me sirve mucho. 🚇

*Revisar las reglas de cada subreddit (algunos piden flair "OC" o solo permiten autopromoción ciertos días).*

### Reddit — r/WebGames, r/trainsim, r/indiegames, r/threejs (inglés)
**Título:** I made a browser-based 3D simulator of the Santiago (Chile) Metro — drive, ride or dispatch
> RedMoviSim runs in any browser (and on phones). Drive a real-spec AS-2014 train with force-based
> physics, regenerative braking and real gradients; ride as a passenger from street to platform;
> or run the network from a control center. All 7 lines, real local time, offline PWA.
> Play: https://www.redmovisim.cl/ · Source: https://github.com/jorge733/MetroSim
> (UI is in Spanish for now.)

*En r/threejs funciona mejor contar el truco técnico: las pendientes se doblan en el shader con una
textura de cotas, casi sin costo en GPU integrada.*

### TikTok / Instagram Reels / YouTube Shorts
Ideas de clip (vertical, 15–40 s, texto grande en pantalla):
1. "¿Y si pudieras manejar la Línea 3?" → salida de estación en cabina, llegada perfecta a la marca.
2. "Hora punta en Los Héroes… pero en mi juego" → andén lleno, tren lleno, "no cabes".
3. "Hice el Metro de Santiago en 3D, solo" → montaje rápido de los 3 modos.
4. "El tren frena distinto lleno que vacío" → comparación en la DMI.
Hashtags: `#MetroDeSantiago #Santiago #Chile #Simulador #IndieDev #GameDev #Trenes`

### X / Bluesky / Mastodon
> Hice RedMoviSim 🚇 un simulador 3D del Metro de Santiago que se juega en el navegador:
> conduce, viaja como pasajero o dirige la red. Gratis y en el celular.
> 👉 https://www.redmovisim.cl/ #gamedev #indiedev #MetroDeSantiago

### WhatsApp / Discord (amigos, grupos de trenes)
> Oigan, hice un juego del Metro de Santiago 🚇 se juega en el navegador o el celu, sin instalar:
> https://www.redmovisim.cl/ — díganme qué les parece o si algo falla 🙏

## 4. Dónde más publicarlo

| Lugar | Por qué | Nota |
|---|---|---|
| **itch.io** | Catálogo de juegos indie, juego HTML jugable en la página | Subir un ZIP con el proyecto (tipo "HTML"), etiquetas `simulation`, `train`, `3D`, `browser` |
| **Game Jolt** | Comunidad hispana grande | Igual que itch.io |
| **Grupos de Facebook** de trenes/metro de Chile | Público exacto | Leer reglas del grupo |
| **Comunidades ferroviarias** (foros de aficionados, Discords de trenes, SkyscraperCity) | Les encanta el realismo | Destacar AS-2014, regenerativo, pendientes |
| **Medios de tecnología/cultura chilenos** | Nota tipo "chileno crea simulador del Metro" | Mandar correo corto con el enlace, 3 capturas y 2 líneas sobre ti |
| **Hacker News "Show HN"** / dev.to | Público técnico | Contar cómo se hizo (motor sin Three.js, simulación en Node) |

## 5. Consejos

- **Uso de la marca**: "Metro de Santiago" y su logo son de Metro S.A. Decir en la descripción que es un
  *proyecto de aficionado, no oficial ni afiliado a Metro de Santiago* evita problemas.
- Publica **en días distintos** en cada lugar, no todo el mismo día, y responde los comentarios: las
  primeras horas deciden el alcance.
- Pide a quien juegue que deje una ⭐ en GitHub y reporte errores en *Issues*.
- Una versión en inglés (aunque sea solo el menú) multiplica el público internacional.
