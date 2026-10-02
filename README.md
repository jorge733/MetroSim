# MetroSim

Simulador ferroviario 3D de la **Línea 3 del Metro de Santiago** para navegador, hecho con HTML, CSS, JavaScript y [Three.js](https://threejs.org/).

Conductor y pasajero comparten el mismo mundo: los mismos trenes, señales, horarios y viajeros.

## Cómo ejecutarlo

Los módulos ES necesitan un servidor local (no funciona abriendo `index.html` con doble clic).

- **VS Code:** extensión *Live Server* → clic derecho en `index.html` → *Open with Live Server*.
- **Node:** `npx serve .` y abrir la dirección que indique.

Three.js se carga desde CDN, así que hace falta conexión a internet.

## Qué incluye (Alpha 0.6)

- Las 21 estaciones reales de la L3 (Plaza Quilicura ⇄ Fernando Castillo Velasco) con sus combinaciones.
- Doble vía con trenes automáticos en ambos sentidos según horario (cada 4 min en punta).
- Trenes de 5 coches con intercirculación, pantógrafos y catenaria rígida.
- Señalización de bloqueo automático de 3 aspectos y protección por rebase de señal en rojo.
- Estaciones con andenes laterales, escaleras, mezanina con torniquetes (tarjeta bip!), boletería y salida a la calle.
- Viajeros que entran desde la calle, validan, esperan en su andén, suben, viajan y bajan.
- Escaleras mecánicas de subida junto a las escaleras fijas.
- Tarjeta bip! con saldo persistente: el torniquete cobra según el tramo horario (punta, valle, baja); carga en la boletería (con cajero y fila) o en los tótems de autoservicio.
- Maniobra de retorno en las terminales: cola de maniobras, cambio de cabina y cambio de vía (jugador y trenes automáticos).
- Sonido procedural, anuncios de estación con voz y megafonía de andén.

> Las tarifas son valores de referencia configurables en `js/config.js` (`FARES`); revísalos si quieres que coincidan con las vigentes.

## Modos

- **Conductor:** eliges servicio de ida (L3-0801) o de vuelta (L3V-0803) y conduces respetando señales, límites y horario. Al final recibes un resumen y puedes hacer la maniobra de retorno para seguir con el servicio contrario.
- **Pasajero a pie:** entras desde la calle a la estación que elijas, cargas tu tarjeta bip! si hace falta, validas en el torniquete, bajas al andén del sentido que quieras, viajas y sales donde quieras.

## Controles

**Conductor**

| Tecla | Acción |
|---|---|
| W / ↑ · S / ↓ | Subir / bajar mando (P4 … B3, EM) |
| Espacio | Freno de emergencia |
| Q · E | Inversor adelante / atrás |
| D | Abrir / cerrar puertas |
| V · C | Vista exterior · centrar vista |
| T | Cambio de cabina (en el cartel FIN DE MANIOBRA) |
| R | Reiniciar servicio |

**Pasajero a pie**

| Tecla | Acción |
|---|---|
| W A S D / flechas | Caminar (Shift: correr) |
| Clic · Esc | Capturar / soltar el ratón |
| F | Sentarse / levantarse |
| E | Boletería, tótem de carga o salida a la calle |

**Ambos:** M sonido · H ayuda.

## Arquitectura

MetroSim separa el **motor** (el "cerebro" del Metro) del **render** (lo que se ve):

```
ENTRADA DEL JUGADOR → MOTOR METROSIM → ESTADO DE LA RED → RENDER 3D / INTERFAZ / AUDIO
```

El motor (`js/engine/`) no usa Three.js ni el navegador: los trenes circulan con su propio reloj de paso fijo,
los mire el jugador o no. Se puede ejecutar sin gráficos:

```
node tools/simular.mjs            # 08:00 → 10:00, informe cada 15 min
node tools/simular.mjs 09:30 5    # hasta las 09:30, informe cada 5 min
```

(Requiere Node 22 o superior.)

## Estructura

```
index.html            pantallas y HUD
styles.css            estilos
js/engine/            MOTOR (sin Three.js)
  engine.js           MetroEngine: reloj, horarios, señales y trenes; informe de estado
  clock.js            reloj de paso fijo
  route.js            los dos sentidos de circulación
  schedule.js         horarios
  signals.js          lógica de señalización de bloqueo automático
  sim.js              física del tren y conducción automática
  traffic.js          todos los trenes de la línea, maniobras y retrasos
  consist.js          composición lógica del tren de 5 coches
  events.js           bus de eventos del motor
  format.js           utilidades puras
js/render/            dibujo del estado del motor
  trainViews.js       trenes
  signalViews.js      señales
js/main.js            punto de entrada: une motor, render, roles, interfaz y audio
js/config.js          línea, estaciones, geometría, mando, tarifas, demanda
js/world.js           túnel, vías, catenaria y estaciones con mezanina
js/train.js           modelo 3D del tren de 5 coches y cabina
js/dmi.js             pantalla de cabina
js/people.js          viajeros (NPC) instanciados
js/walker.js          pasajero a pie
js/audio.js           sonido procedural y megafonía
js/announcements.js   frases reales de megafonía del Metro de Santiago
js/camera.js          vistas del conductor
js/hud.js             interfaz (incluye boletería y tótem)
js/card.js            tarjeta bip! del jugador
js/intro.js           introducción de bienvenida
js/utils.js           utilidades y texturas procedurales
tools/simular.mjs     ejecuta el motor sin navegador
```

Las distancias entre estaciones son aproximadas; los nombres, el orden y las combinaciones son los reales.
