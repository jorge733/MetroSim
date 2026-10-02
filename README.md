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
- **Hora local real:** la partida empieza a la hora de tu computador y el reloj se mantiene sincronizado.
- Pantallas de próximo tren en tres puntos de cada andén y plano de línea dinámico en los coches (luz parpadeante en la estación actual o la próxima).
- Bancos en los andenes para esperar sentado; nadie atraviesa columnas, bancos ni a otros viajeros.
- En las terminales, el andén de llegada es solo de salida.

> Las tarifas son valores de referencia configurables en `js/config.js` (`FARES`); revísalos si quieres que coincidan con las vigentes.

## Modos

- **Conductor:** eliges servicio de ida o de vuelta (sale ~1,5 min después de la hora actual) y conduces respetando señales, límites y horario. Al final recibes un resumen y puedes hacer la maniobra de retorno para seguir con el servicio contrario.
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
| F | Sentarse / levantarse (en el tren o en un banco del andén) |
| E | Boletería, tótem de carga o salida a la calle |

**Ambos:** M sonido · H ayuda.

## Arquitectura

MetroSim separa el **motor** (el "cerebro" del Metro) del **render** (lo que se ve).

El motor simula una **red de varias líneas** con un único reloj: la **L3** (la que se dibuja y se juega) y la
**L6** (Cerrillos ⇄ Los Leones, simulada sin dibujo). Se conectan en **Ñuñoa**: parte de la gente que baja de una
línea sigue viaje por la otra, así que un problema en una se nota en la otra. En Ñuñoa, el HUD del pasajero muestra
los próximos trenes de la L6.


```
ENTRADA DEL JUGADOR → MOTOR METROSIM → ESTADO DE LA RED → RENDER 3D / INTERFAZ / AUDIO
```

El motor (`js/engine/`) no usa Three.js ni el navegador: los trenes circulan con su propio reloj de paso fijo,
los mire el jugador o no. Cada tren tiene un **estado explícito** (arrancando, circulando, aproximándose,
puertas abiertas, listo para salir, detenido ante señal...) y las pantallas de "próximo tren" se calculan desde
la **posición real** de cada tren, no solo desde el horario. El juego escucha al motor por su bus de eventos
(`train:created`, `train:removed`, `train:event`, `train:state`...).

Los **roles** no tocan la simulación: mandan **órdenes** al buzón del motor y este decide si se pueden cumplir.
El Conductor convierte sus teclas en órdenes (`driver.notchUp`, `driver.doors`...). Desde la consola del
navegador se puede probar el futuro Centro de Control:

```
MetroSim.game.engine.command("control.hold",    { trainId: "L3-1405" })   // retener un tren en su próxima estación
MetroSim.game.engine.command("control.release", { trainId: "L3-1405" })   // liberarlo
```

Al retener un tren, el siguiente se queda detenido ante la señal en rojo: causa y efecto.

Los **pasajeros** también son cifras reales del motor: llega gente a cada andén según la hora y la estación
(las de combinación mueven más), en cada parada primero bajan y luego suben a un ritmo limitado por las puertas,
y el tren no cierra mientras haya intercambio. Un tren atrasado encuentra más gente, tarda más y se atrasa más;
el de atrás va más vacío (trenes en racimo). Los viajeros dibujados son solo una muestra de esas cifras.

La **regulación de intervalos** lo corrige como un Puesto de Mando: retiene unos segundos en la estación al tren
que va demasiado pegado al de delante (respetando la proporción del horario) y acorta la parada del que va con
mucho hueco. Tras retener un tren 5 min en punta, el intervalo mínimo en Universidad de Chile pasa de 86 s sin
regulación a 170 s con ella. Se puede apagar desde la consola (`engine.command("control.regulation", { on: false })`)
o en la simulación sin gráficos con `node tools/simular.mjs 10:00 15 "UNIVERSIDAD DE CHILE" sin-regulacion`.

Se puede ejecutar sin gráficos:

```
node tools/simular.mjs            # 08:00 → 10:00, informe cada 15 min
node tools/simular.mjs 09:30 5    # hasta las 09:30, informe cada 5 min
node tools/simular.mjs 09:00 10 "ÑUÑOA"         # pantallas de andén de otra estación (L3 y L6)
```

(Requiere Node 22 o superior.)

## Estructura

```
index.html            pantallas y HUD
styles.css            estilos
js/engine/            MOTOR (sin Three.js)
  engine.js           MetroEngine: red de líneas con un reloj común; informe de estado
  network.js          líneas de la red (L3, L6) y combinaciones
  clock.js            reloj de paso fijo
  route.js            los dos sentidos de circulación
  schedule.js         horarios
  signals.js          lógica de señalización de bloqueo automático
  sim.js              física del tren y conducción automática
  traffic.js          todos los trenes de la línea, maniobras y retrasos
  consist.js          composición lógica del tren de 5 coches
  state.js            estado explícito de cada tren
  eta.js              llegadas estimadas desde la posición real
  commands.js         buzón de órdenes (roles → motor)
  passengers.js       pasajeros lógicos: demanda, subidas y bajadas
  regulation.js       regulación de intervalos (retener / apurar trenes)
  events.js           bus de eventos del motor
  format.js           utilidades puras
js/render/            dibujo del estado del motor
  trainViews.js       trenes
  signalViews.js      señales
  lineMapPanel.js     plano de línea dinámico de los coches
js/roles/             roles del jugador
  driverRole.js       Conductor: teclado → órdenes
js/stationLayout.js   columnas, bancos y pantallas de los andenes (compartido)
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
