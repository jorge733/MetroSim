# MetroSim

Simulador ferroviario 3D del **Metro de Santiago**: líneas 1, 2, 3, 4, 4A, 5 y 6 para navegador, hecho con HTML, CSS, JavaScript y [Three.js](https://threejs.org/).

Conductor y pasajero comparten el mismo mundo: los mismos trenes, señales, horarios y viajeros.

## Cómo ejecutarlo

Los módulos ES necesitan un servidor local (no funciona abriendo `index.html` con doble clic).

- **VS Code:** extensión *Live Server* → clic derecho en `index.html` → *Open with Live Server*.
- **Node:** `npx serve .` y abrir la dirección que indique.

Three.js se carga desde CDN, así que la primera vez hace falta conexión a internet.

## App para Android (APK)

`dist/MetroSim.apk` instala el juego como app de Android (funciona sin internet). Se reconstruye con
`python3 android/build/build.py`; detalles en [android/LEEME.md](android/LEEME.md).

## Instalar como app (PWA)

MetroSim es instalable: en la pantalla inicial aparece **📲 Instalar MetroSim** (Chrome, Edge, Android). En iPhone/iPad:
Compartir → *Agregar a inicio*. Se abre a pantalla completa y, tras la primera partida con internet, **funciona sin conexión**
(el service worker `sw.js` guarda el juego, Three.js y las voces). La instalación necesita `https` o `localhost`.
Los íconos están en `icons/` (los PNG se generan desde `icons/icon.svg`).

## Mejoras del modo Pasajero

- **Mapa de la misión**: bajo la misión activa hay una brújula que apunta al lugar del paso actual, con la distancia,
  qué es y cómo llegar (boletería o tótem, acceso al Metro, torniquetes, escalera al andén del sentido correcto,
  salida a la calle, el local o el hito), y una línea con tu posición y el destino. El destino también se marca en
  el esquema de línea de arriba. A bordo te dice cuántas estaciones faltan o si vas en sentido contrario.
- **Sin dinero**: si no te alcanza para el pasaje ni para cargar la bip!, aparece el botón «Sin dinero · ir a
  Conductor» que te lleva a conducir (en la línea actual si tienes su licencia; si no, en la Línea 3) para ganar tu sueldo.
- **Volver al menú** desde el modo Pasajero (botón Menú o gesto/botón «atrás» del celular) pide confirmación
  (Esc, «Seguir jugando» u otro «atrás» cancela; Enter confirma).
- **Salir por los torniquetes es gratis**: solo se cobra el pasaje al pasar hacia la zona pagada (antes, al terminar
  de cruzar el torniquete de salida se cobraba un pasaje).

## Versión 1.5 · Realismo de la red

- **El tren real de cada línea** (`js/engine/fleet.js`): las líneas 1, 2 y 5 usan trenes de **neumáticos** de Alstom
  (NS-74, NS-93, NS-2007, NS-2016) y las 3, 4, 4A y 6, de **rueda de acero** (AS-2002 de Alstom, AS-2014 de CAF).
  Cada línea tiene su mezcla de modelos y a cada servicio le toca uno (la L5 conserva casi la mitad de su flota de
  NS-74, de 1975). Cambia la física: el neumático agarra mucho más (arranca y frena fuerte) pero rueda con más
  resistencia; los trenes antiguos aceleran menos, el NS-74 frena con resistencias (sin freno regenerativo) y
  ninguno de neumáticos tiene pantógrafo: toman 750 V de las **barras guía** que se ven a los costados de la vía,
  junto a las pistas de rodadura. Al empezar a conducir te dice qué tren te tocó y la DMI lo muestra.
- **Viaductos y trincheras** (`js/engine/sections.js`, `js/render/outdoor.js`): la L4 corre en viaducto sobre
  Vicuña Mackenna y en trinchera por Américo Vespucio, la L4A en trinchera por Vespucio Sur, la L5 en los viaductos
  de Pudahuel-Maipú y de Vicuña Mackenna y la L2 en trinchera junto a la autopista Central (tramos aproximados).
  Al aire libre se ve el cielo según la hora, la avenida con autos, veredas, árboles, faroles y edificios (con
  ventanas encendidas de noche), pilas con capitel bajo el viaducto, muros y puntales en la trinchera, pórticos de
  catenaria y portales de túnel. Las estaciones al aire libre tienen el andén abierto con mamparas de vidrio y
  cubierta liviana. El perfil cambia: en viaducto la vía va ~9 m sobre la calle y en trinchera ~7 m bajo ella.
- **Clima de Santiago** (`js/engine/weather.js`): por defecto, el **tiempo real** (se consulta a Open-Meteo, un
  servicio público sin clave; sin conexión, uno típico de la temporada: en Santiago llueve casi solo de mayo a
  agosto). También se puede elegir en la portada: despejado, nublado, lluvia o temporal. Con lluvia, en los tramos
  al aire libre el riel mojado agarra mucho menos: el tren **patina** al arrancar y **desliza** al frenar (la DMI
  avisa y el antipatinaje recorta el esfuerzo), así que hay que frenar antes. Además viaja más gente (y con frío,
  algo más). Se ve la lluvia (también en la calle del pasajero), el cielo gris y se oye.
- **Ruta Expresa** (`js/engine/express.js`): en la L2, la L4 y la L5, los días laborales de 06:00 a 09:00 y de
  18:00 a 21:00 los trenes alternan **ruta roja** y **ruta verde** y se saltan las estaciones del otro color
  (las comunes las sirven todos). Colores de 2023. El horario de cada servicio se calcula con la marcha sin
  parar por las saltadas, en las estaciones de un color pasa un tren cada dos y los letreros de las estaciones
  muestran su color. El conductor ve "PRÓXIMA PARADA · RUTA VERDE" y qué estaciones pasa sin detenerse (abrir
  puertas en una que no le toca es falta); las pantallas del andén marcan el color de cada tren y el pasajero
  recibe el aviso al llegar. Mientras funciona, la regulación no retiene a los trenes expresos (sus intervalos
  son desiguales por diseño): se rigen por su horario.
- **Sonido**: los trenes de neumáticos no hacen el golpeteo de las juntas (solo un golpe sordo y un rodar más
  grave), el NS-74 no tiene el canto VVVF y el NS-93 suena con el zumbido de su chopper; al aire libre no hay
  retumbe de túnel y se oye la lluvia.
- El letrero frontal de los trenes muestra el número de su línea (antes decía 3 en todas).
- `node tools/simular.mjs 10:00 15 "VICENTE VALDÉS" con-regulacion laboral lluvia` simula también con lluvia.

Siguen siendo simplificaciones: todos los trenes se dibujan con la composición de 5 coches y ~120 m del AS-2014
(para que andenes, puertas y viajeros funcionen igual) y la calle del modo pasajero queda sobre su estación aunque
esta vaya en viaducto.

## Versión 1.4 · Conductor más realista

- **ATP (protección automática del tren)**: si pasas el límite por más de 5 km/h, el ATP frena de emergencia. Lo
  mismo al rebasar una señal en rojo. Después la tracción queda bloqueada: detente y espera unos segundos a que el PCC
  (Puesto Central de Control) revise y te autorice por radio. Si rebasaste una señal, sigues en **marcha a la vista**
  a 15 km/h hasta la próxima señal. La DMI muestra el aviso bajo el velocímetro.
- **Vigilancia (hombre muerto)**: con el tren en marcha, si en 45 s no tocas ningún mando suena un zumbador. Tienes
  7 s para confirmar con **X** (mover el mando también cuenta); si no, frenado de emergencia y falta.
- **Señal en falla**: detenido ante una señal en rojo por falla con el cantón libre, a los ~10 s el PCC te autoriza
  por radio a rebasarla en marcha a la vista (25 km/h), sin falta.
- **Personal en la vía**: durante los "TRABAJOS EN VÍA" hay trabajadores con chaleco reflectante y casco en el
  andén de evacuación, con una baliza ámbar antes de ellos. Debes tocar la **bocina (B)** al acercarte (en los
  últimos 350 m); si pasas sin tocarla es una falta. El personal levanta el brazo al verte.
- **Radio del PCC**: los avisos de incidentes y las autorizaciones llegan por radio, con el chasquido del canal y la
  voz del operador (voz sintetizada); el texto queda en el HUD con 📻.
- **Cerrar con gente subiendo**: si cierras las puertas mientras aún suben pasajeros, es muy probable que alguien
  obstruya una puerta (se reabre y tienes que volver a cerrar). Espera a que termine el embarque.
- **Tren de adelante en la DMI**: hasta 3 km, la DMI muestra el tren que va delante en tu vía, la distancia hasta su
  cola (verde sobre 800 m, ámbar bajo 800 m, rojo bajo 300 m), una barra que se llena al acercarte y qué está haciendo
  (circulando a tal velocidad, aproximándose, en estación, detenido en vía, sin pasajeros). En los últimos metros antes
  de una estación ese espacio lo ocupa la marca de parada.
- Botones táctiles **📯 Bocina** y **✋ Vigilancia** (la columna del conductor pasa a dos columnas).
- Código: `js/roles/driverSafety.js` (vigilancia, ATP y PCC, personal en la vía); el bloqueo de tracción y la marcha
  a la vista viven en la simulación del tren (`js/engine/sim.js`).

## Versión 1.3 · Pasajero aún más realista

- **Agárrate (G)**: de pie y sin agarrarte, los cambios bruscos del tren te empujan a lo largo del coche (el tirón
  del arranque, el golpe final al detenerse, una frenada fuerte). Puedes trastabillar y chocar con otro viajero
  («¡Perdón!»). Agarrado de una barra o del pasamanos casi no te mueves; caminar te suelta. Ante una aceleración
  pareja el cuerpo se afirma solo. Botón **🤚 Agarrarse** en pantallas táctiles.
- **Pantallas sobre las puertas** (`js/render/carInfoPanel.js`): próxima estación y combinaciones, estación actual,
  "CIERRE DE PUERTAS" parpadeando, la hora y la dirección. Las del lado del andén avisan "SE ABRIRÁN LAS PUERTAS DE
  ESTE LADO". Avisan también si el tren está detenido o si se retira del servicio. El plano luminoso de la línea sigue
  marcando la próxima estación.
- **Ventanas en el túnel**: la luminaria del túnel más cercana ilumina el coche al pasar (la luz barre asientos y piso)
  y los vidrios se oscurecen y brillan como un espejo; al entrar a la estación vuelven a ser transparentes.
- **Sonido**: el estruendo del túnel sube con la velocidad y baja al entrar a la estación, aire al soltar los frenos al
  arrancar, el golpe de presión y el estruendo del tren que se cruza en la otra vía, y el roce de zapatos al trastabillar.
- **"Permite bajar antes de subir"**: al abrirse las puertas, quienes van a subir se ponen a los costados de la puerta
  y esperan a que bajen los que salen por ella. Cuando se acerca el tren, la gente que espera de pie se arrima al borde.
  En un coche lleno caminas más lento y, si alguien te tapa el paso, te abres paso de a poco («con permiso»).
- **Cada coche con su carga** (`carShares` / `carLoads` en `js/engine/passengers.js`): van más llenos los coches que
  quedan junto a la escalera del andén y más vacíos los del otro extremo. Los asientos y el "no cabes" se cuentan por
  coche: si el de tu puerta va repleto, prueba otra puerta. El HUD muestra cuántas personas van en tu coche
  (holgado, cómodo, lleno, apretado, repleto).
- **Detenciones entre estaciones** (`js/engine/incidents.js`): un tren puede detenerse en plena vía por regulación de
  frecuencia, por un tren detenido más adelante o por inspección de vía. A los pocos segundos lo anuncia la megafonía
  ("Estimados pasajeros, nuestro tren se encuentra detenido…") y al seguir: "Reanudamos la marcha". Si un tren queda
  detenido sin motivo informado (una señal en rojo), también hay aviso. El HUD muestra el retraso respecto del horario.
- **Tren que se retira del servicio**: en su próxima estación bajan todos ("Este tren se retira del servicio…") y
  quien no llegaba ahí espera el siguiente en el andén. Después sigue vacío hasta la terminal, se detiene unos segundos
  en cada estación sin abrir puertas y no admite pasajeros: el andén lo anuncia ("El próximo tren no admite
  pasajeros") y las pantallas de andén muestran "NO SUBIR". Los incidentes le tocan a menudo al tren del pasajero.

## Versión 1.2 · Pendientes en 3D y pasajero realista

- **La vía en 3D sigue las pendientes reales** (`js/render/trackLift.js`): el túnel baja y sube entre
  estaciones, cada estación queda a su altura y los trenes se doblan siguiendo la vía coche a coche. La lógica
  del juego sigue en un mundo plano; lo que se dobla es el dibujo, en la tarjeta gráfica, con una textura de
  cotas de la línea (una muestra cada 2 m), así que casi no cuesta rendimiento. En la cabina y a bordo la cámara
  cabecea con el tren al entrar en una rampa. La calle no se dobla: queda horizontal a la altura de su estación.
- **Tren lleno**: a 6 personas/m² (1.299 viajeros) no cabes; te quedas en el andén y esperas el siguiente.
- **Asientos según la carga real**: si viajan más personas que asientos tiene el tren, no hay dónde sentarse.
- **Inercia a bordo**: al acelerar el cuerpo se va hacia atrás y al frenar hacia adelante; de pie, un arranque o
  una frenada fuerte te hace dar un paso. El coche vibra más cuanto más rápido va.
- **Puertas que se reabren**: si te quedas en el vano mientras se cierran, el sensor invierte el cierre (y vuelve
  a pasar mientras sigas ahí).
- **Más gente visible**: andenes y trenes muestran ~30 % de los viajeros reales del motor (antes ~12 %), así que la
  punta se ve llena. Los viajeros dibujados nunca retienen al tren más de 6 s tras terminar el intercambio real.
- Fuera del horario comercial el pasajero ve un aviso (el Metro real está cerrado; el juego mantiene un servicio
  especial cada 15 min).

## Versión 1.1 · Realismo

- **El tren real de la L3**: AS-2014 de CAF, 5 coches de ~23,4 m (120 m en total), 4 puertas dobles por costado
  en cada coche (20 por lado), capacidad de 1.299 personas a 6 p/m² y velocidad máxima de 80 km/h. Bogies,
  climatizadores y equipos bajo bastidor a escala, y pilotos naranjos sobre las puertas mientras están abiertas.
- **Andenes de 125 m**: el andén y el vestíbulo se alargan para el tren de 120 m. Cada sentido tiene su propia
  marca de parada (la cabeza del tren queda a 2 m del final del andén por el que sale).
- **Física por fuerzas**: masa = tara (178 t) + viajeros (70 kg c/u); curva esfuerzo-velocidad (285 kN hasta la
  velocidad base, luego potencia constante de 3,2 MW); adherencia rueda-carril; resistencia al avance en túnel;
  limitación de sacudida (jerk). El mando pide una aceleración y el tren consigue lo que puede: **lleno, cuesta
  arriba o rápido acelera menos**. El freno está compensado por carga y combina **freno eléctrico regenerativo**
  y freno de fricción (bajo ~6 km/h y en emergencia, solo fricción). Freno de mantenimiento automático al
  detenerse (el tren no retrocede en pendiente).
- **Pendientes**: perfil longitudinal de cada línea (`js/engine/profile.js`) con el terreno de Santiago subiendo
  hacia la cordillera, estaciones a nivel, trazado en "diente de sierra" entre estaciones (máx. 35 ‰) y túnel más
  hondo bajo el río Mapocho. La pendiente se siente en la física y se ve en la DMI.
- **DMI más completa**: escala hasta 90 km/h, barra de esfuerzo real (tracción / freno regenerativo / fricción),
  pendiente en ‰, tensión y corriente de catenaria; la pantalla de estado muestra ocupación (%), masa del tren y
  energía consumida y regenerada.
- **Conducción automática (ATO) realista**: marcha económica con deriva (corta la tracción al llegar al crucero y
  vuelve a traccionar tras perder ~4 km/h), compensa la pendiente al frenar, anticipa la rampa del freno y, si
  rebasa la marca, retrocede a paso de hombre.
- **Horario calculado con la misma física**: los tiempos entre estaciones salen de simular cada interestación con
  el tren, la pendiente y el ATO (+4 % de margen). La L3 completa tarda ~37 min (≈ 40 km/h comerciales).
- **Calendario real**: día laboral, sábado o domingo/festivo (incluye festivos de Chile y Semana Santa) según la
  fecha de tu computador. Horario comercial: L–V 06:00–23:00, sábado 06:30–23:00, domingo y festivos 07:30–22:30
  (fuera de él queda un servicio simbólico cada 15 min para poder jugar siempre).
- **Demanda horaria de un día real**: punta mañana 07:00–09:00, valle con repunte al almuerzo, punta tarde
  17:30–20:00; el fin de semana, menor y repartida.
- **Intervalos por línea**: cada línea tiene su intervalo de punta (L1 2 min, L2/L5 2:45, L4 3 min, L3 3:20,
  L6 4:30, L4A 5 min) que se alarga cuando baja la demanda.
- **Pasajeros origen-destino**: en la mañana se viaja de los barrios hacia el centro y en la tarde al revés; en
  cada andén espera más gente en el sentido de los viajes y en cada estación baja la parte que tiene ahí su
  destino. Subir y bajar va a un ritmo por puerta; sobre 4 p/m² cuesta más subir y a 6 p/m² ya no cabe nadie
  (la gente espera el siguiente tren). Las líneas más cargadas (L1, L4, L5) se llenan en punta.
- **Túnel**: canaleta de drenaje, señalética de evacuación cada 100 m, balizas del CBTC entre los carriles y
  salidas de emergencia (piques de evacuación) en las interestaciones largas.
- **L3 a escala**: distancias ajustadas a los ~25 km reales (extensión a Quilicura de 3,8 km; Hospitales → Puente
  Cal y Canto ~2 km bajo el Mapocho).
- `node tools/simular.mjs 09:00 15 "ÑUÑOA" "" sabado` simula también sábados y domingos.

Los datos oficiales usados son los del AS-2014 (5 coches, 120 m, 1.299 personas, 80 km/h), la longitud de la L3
y el horario de funcionamiento; masas, esfuerzos, potencias, demanda e intervalos son valores aproximados
coherentes con un metro moderno de este tamaño.

## Qué incluía la versión 1.0 · estable

- **Tutorial interactivo** para el jugador nuevo, en Conductor y en Pasajero: una tarjeta explica un paso a la vez
  y avanza sola cuando haces lo que pide (abrir puertas, acelerar, frenar en la marca; bajar al Metro, cargar la
  bip!, pasar el torniquete, viajar y salir a la calle). Resalta la parte del HUD de la que habla y muestra datos en
  vivo (distancia, hora de salida, mando). Empieza solo la primera vez en cada modo; se repite con **🎓 Tutorial**
  en la portada, se salta con "Saltar tutorial" y en pantallas táctiles nombra los botones en vez de las teclas.
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
- Doble vía con trenes automáticos en ambos sentidos según horario.
- Trenes AS-2014 de 5 coches con intercirculación, pantógrafos y catenaria rígida.
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

## Modo Creador

Acceso completo y gratis para el creador del juego: toda la Tienda Metro desbloqueada (licencias, libreas, contratos,
depto con muebles y recuerdos) y compras, pasajes y cargas sin costo. Tu saldo y lo que compraste de verdad no se tocan.

1. Define la clave (una sola vez; en el código queda solo su huella SHA-256):
   `node tools/clave-creador.mjs "una frase larga y secreta"`
2. Abre el juego con `?creador` al final de la dirección y escribe la clave. Queda activo en ese navegador.
3. Para apagarlo: botón **🛠️ Modo Creador activo** en la pantalla inicial, o abre con `?creador=off`.

## Modos

- **Conductor:** eliges servicio de ida o de vuelta (sale ~15–20 s después de la hora actual; en cada estación, si cierras las puertas con el embarque completo, sales de inmediato y tu horario se adelanta) y conduces respetando señales, límites y horario. Cada estación te paga en tu cuenta. Al final recibes un resumen con tu sueldo y el bono, y puedes hacer la maniobra de retorno para seguir con el servicio contrario. Si quieres terminar antes, el botón **🏁 Finalizar turno** muestra el resumen hasta donde llegaste.
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
| B | Bocina (obligatoria al pasar junto al personal en la vía) |
| X | Confirmar la vigilancia (hombre muerto; mover el mando también cuenta) |
| V · C | Vista exterior · centrar vista |
| T | Cambio de cabina (en el cartel FIN DE MANIOBRA) |
| R | Reiniciar servicio |
| F | Finalizar turno antes de la terminal (pulsa dos veces; muestra el resumen) |

**Pasajero a pie**

| Tecla | Acción |
|---|---|
| W / ↑ · S / ↓ | Caminar hacia adelante · retroceder despacio (Shift: correr) |
| A / ← · D / → | Girar |
| Re Pág · Av Pág | Mirar arriba / abajo (al caminar la vista vuelve sola al frente) |
| F | Sentarse / levantarse (en el tren o en un banco del andén) |
| G | Agarrarse de una barra / soltarse (a bordo, de pie) |
| E | Boletería, tótem, salida a la calle · en la calle: entrar a un local, bajar al Metro o sacar una foto del hito |
| J | Misiones |

**Ambos:** M sonido · H ayuda.

**Celular o tablet:** aparecen controles táctiles (mejor con el teléfono en horizontal; en Android el juego pasa a
pantalla completa y horizontal al empezar). Los controles son mínimos: lo que sirve en un momento puntual aparece solo
entonces y lo poco usado va en el menú ☰ (arriba a la derecha). Conductor: indicador de mando e inversor (tocar la letra
F / N / R cambia el inversor), ▲ / ▼ mando y EMERGENCIA abajo a la izquierda; 🚪 Puertas abajo a la derecha; ✋ Vigilancia
solo cuando suena la alarma de hombre muerto y ⇄ Cambiar cabina solo detenido en FIN DE MANIOBRA; en ☰ Bocina, Vista,
Tienda y Finalizar turno; arrastra la pantalla para mirar. Pasajero: joystick abajo a la izquierda para caminar (al
borde corre), arrastra a la derecha para mirar, 🎯 Misiones siempre y ✋ Usar, 🪑 Sentarse y 🤚 Agarrarse solo donde se
puede; en ☰ Tienda y Menú principal. El HUD se compacta en pantallas chicas y respeta la muesca del teléfono; en el
Centro de Control los esquemas se desplazan de lado y la ficha del tren aparece como hoja inferior.
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
manifest.webmanifest  manifiesto de la app instalable (PWA)
sw.js                 service worker: instalación y juego sin conexión
icons/                íconos de la app (icon.svg y PNG generados)
js/engine/            MOTOR (sin Three.js)
  engine.js           MetroEngine: red de líneas con un reloj común; informe de estado
  network.js          las 7 líneas de la red (estaciones reales) y combinaciones
  clock.js            reloj de paso fijo
  route.js            los dos sentidos de circulación
  schedule.js         horarios
  signals.js          lógica de señalización de bloqueo automático
  sim.js              física del tren y conducción automática
  traffic.js          todos los trenes de la línea, maniobras y retrasos
  consist.js          composición del AS-2014 (5 coches, 20 puertas por lado) y sus datos físicos
  fleet.js            flota real de cada línea: modelos de neumáticos y de acero y su física
  sections.js         tramos en túnel, trinchera o viaducto
  weather.js          clima: lluvia (adherencia al aire libre) y demanda
  express.js          Ruta Expresa (rutas roja y verde) de las líneas 2, 4 y 5
  profile.js          perfil longitudinal: cotas y pendientes de cada línea
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
  carInfoPanel.js     pantallas de información sobre las puertas de los coches
  trackLift.js        pendientes en 3D: dobla el dibujo de la vía según el perfil de la línea
  outdoor.js          al aire libre: viaductos, trincheras, la avenida y los edificios, cielo y lluvia
js/control/           Centro de Control
  controlCenter.js    esquema de la red, ficha de tren, incidencias y órdenes
js/touch.js           controles táctiles (celular y tablet)
js/roles/             roles del jugador
  driverRole.js       Conductor: teclado → órdenes
  driverSafety.js     Conductor: vigilancia (hombre muerto), ATP y PCC por radio, personal en la vía
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
js/tutorial.js        tutorial interactivo del jugador nuevo (conductor y pasajero)
js/city/              la calle de cada estación
  plan.js             locales de cada estación y lo que venden (sin Three.js)
  catalog.js          hitos de las estaciones (sin Three.js)
  landmarks.js        modelos procedurales de los hitos
  kit.js              piezas de ciudad: fachadas, árboles, faroles, letreros
  city.js             la calle 3D: avenida, autos, peatones, locales, cielo
js/intro.js           introducción de bienvenida
js/pwa.js             registro del service worker y botón "Instalar MetroSim"
js/creator.js         Modo Creador (todo desbloqueado y gratis, con clave)
js/utils.js           utilidades y texturas procedurales
tools/simular.mjs     ejecuta el motor sin navegador
```

Las distancias entre estaciones son aproximadas; los nombres, el orden y las combinaciones son los reales.
