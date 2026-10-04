# MetroSim

Simulador ferroviario 3D del **Metro de Santiago**: líneas 1, 2, 3, 4, 4A, 5 y 6 para navegador, hecho con HTML, CSS, JavaScript y [Three.js](https://threejs.org/).

Conductor y pasajero comparten el mismo mundo: los mismos trenes, señales, horarios y viajeros.

## Cómo ejecutarlo

Los módulos ES necesitan un servidor local (no funciona abriendo `index.html` con doble clic).

- **VS Code:** extensión *Live Server* → clic derecho en `index.html` → *Open with Live Server*.
- **Node:** `npx serve .` y abrir la dirección que indique.

Three.js se carga desde CDN, así que hace falta conexión a internet.

## Qué incluye (Alpha 0.9)

- **Economía compartida**: tienes una cuenta bancaria con tarjeta de débito (Banco Andino, ficticio) que vale
  para los dos modos. Empiezas con $3.000 y sin tarjeta bip!.
- **Sueldo del conductor en tiempo real**: cada estación bien servida te deposita al instante un sueldo
  (base + puntos de la estación + bono por estación perfecta). Las faltas del tramo se descuentan de ese pago.
  Al completar el servicio (habiendo servido al menos media línea) recibes un bono según la nota (S…D).
- **La ciudad**: el modo Pasajero empieza en la **calle** de la estación elegida. Avenida con autos y micros
  que frenan si te cruzas, veredas con peatones, faroles, paradero y locales (panadería, almacén, farmacia,
  kiosko, cajero automático y otros según la estación). Cielo, sol y faroles según la hora real.
- **Hitos por estación**: enfrente del acceso está lo icónico de cada estación: Mall Plaza Egaña, Costanera
  Center (Tobalaba), La Moneda, Casa Central de la U. de Chile, Plaza Baquedano, Cerro Santa Lucía, Estación
  Central, Catedral (Plaza de Armas), Mercado Central (Puente Cal y Canto), Bellas Artes, Quinta Normal,
  Estadio Nacional, Templo Votivo de Maipú, Los Dominicos y más (20 en total). Las demás estaciones tienen
  calle genérica; para sumar una basta una entrada en `js/city/catalog.js`.
- **Compras**: en cada local eliges productos con su precio y pagas con débito. La bip! se compra y se carga en
  la boletería o en los tótems, también con débito. El cajero automático muestra saldo y movimientos.
- **Misiones** (tecla J): compras con tema (pan para la once, almuerzo, remedios, flores…), turismo (sacar una
  foto del hito), encargos (retirar un paquete en un kiosko y entregarlo en otra estación), contrarreloj,
  viaje económico (sin tarifa punta) y turno de conductor. La primera misión de cada línea es un tutorial:
  comprar la bip!, cargarla, viajar y comprar pan. Las misiones dan recompensas pequeñas: el dinero de verdad
  se gana conduciendo.

### Alpha 0.8

- **Puntaje del conductor**: cada estación suma puntos por precisión de parada, puntualidad y confort (sin tirones
  ni paradas bruscas). Las estaciones perfectas seguidas forman una racha (hasta ×2). Las faltas restan. Al final
  del servicio, nota S/A/B/C/D y récord guardado por línea y sentido.
- **Incidentes aleatorios**: puertas obstruidas (se reabren y hay que volver a cerrar), limitaciones temporales de
  velocidad por trabajos o inspección de vía y fallas de señal (queda en rojo un tiempo). Afectan a todos los
  trenes, avisan al conductor y al viajero, y quedan en el registro del Centro de Control.

- **Elige tu línea** en la pantalla principal (conductor y pasajero): L1, L2, L3, L4, L4A, L5 o L6, cada una con su
  mundo 3D, sus estaciones reales en orden, sus combinaciones, su color y sus carteles. El resto de la red sigue
  funcionando a la vez (sin dibujo) y se conecta por las combinaciones. Las distancias son aproximadas y, por
  simplicidad, todas las líneas se representan subterráneas.

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

- **Conductor:** eliges servicio de ida o de vuelta (sale ~1,5 min después de la hora actual) y conduces respetando señales, límites y horario. Cada estación te paga en tu cuenta. Al final recibes un resumen con tu sueldo y el bono, y puedes hacer la maniobra de retorno para seguir con el servicio contrario.
- **Centro de Control:** supervisas toda la red (L3 y L6) en un esquema en tiempo real: trenes coloreados según su estado, ficha de cada tren, indicadores por línea (puntualidad, retraso máximo, gente esperando), registro de incidencias, botones para retener o liberar trenes y para activar o apagar la regulación de intervalos.
- **Pasajero a pie:** apareces en la calle de la estación que elijas, frente a su hito. Bajas por el acceso, compras y cargas tu bip! con débito, validas en el torniquete, viajas y sales a la calle de otra estación para cumplir tus misiones.

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
| E | Boletería, tótem, salida a la calle · en la calle: entrar a un local, bajar al Metro o sacar una foto del hito |
| J | Misiones |

**Ambos:** M sonido · H ayuda.

**Celular o tablet:** aparecen controles táctiles (mejor con el teléfono en horizontal). Conductor: ▲ / ▼ mando,
EMERGENCIA, Puertas, Inversor, Vista y Cabina; arrastra la pantalla para mirar. Pasajero: joystick a la izquierda
para caminar (al borde corre), arrastra a la derecha para mirar, botones E (usar), F (sentarse), Misiones y Correr.
Para probarlos en el computador, abre la página con `?touch=1` al final de la dirección.

## Arquitectura

MetroSim separa el **motor** (el "cerebro" del Metro) del **render** (lo que se ve).

El motor simula **toda la red (7 líneas)** con un único reloj. La línea que eliges se construye en 3D; las demás
se simulan sin dibujo. Se conectan en sus combinaciones (Universidad de Chile, Baquedano, Los Héroes, Tobalaba,
Ñuñoa…): parte de la gente que baja de una línea sigue viaje por otra, así que un problema en una se nota en las
demás. En una estación de combinación, el HUD del pasajero muestra los próximos trenes de las otras líneas.


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
  network.js          las 7 líneas de la red (estaciones reales) y combinaciones
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
js/control/           Centro de Control
  controlCenter.js    esquema de la red, ficha de tren, incidencias y órdenes
js/touch.js           controles táctiles (celular y tablet)
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
js/economy.js         cuenta bancaria (débito), sueldo del conductor y bono de servicio
js/missions.js        misiones del pasajero (sin Three.js)
js/city/              la calle de cada estación
  plan.js             locales de cada estación y lo que venden (sin Three.js)
  catalog.js          hitos de las estaciones (sin Three.js)
  landmarks.js        modelos procedurales de los hitos
  kit.js              piezas de ciudad: fachadas, árboles, faroles, letreros
  city.js             la calle 3D: avenida, autos, peatones, locales, cielo
js/intro.js           introducción de bienvenida
js/utils.js           utilidades y texturas procedurales
tools/simular.mjs     ejecuta el motor sin navegador
```

Las distancias entre estaciones son aproximadas; los nombres, el orden y las combinaciones son los reales.
