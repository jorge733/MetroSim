# RedMoviSim

Simulador 3D del **transporte público de Santiago**: el **Metro** (líneas 1, 2, 3, 4, 4A, 5 y 6), los trenes de EFE (**Tren Nos** y **Tren Rancagua**) y los **buses**,
para navegador, hecho con HTML, CSS, JavaScript y [Three.js](https://threejs.org/). Se juega en
**https://www.redmovisim.cl/** (también **redmovisim.cl**). Antes se llamaba **MetroSim**.

Conductor y pasajero comparten el mismo mundo: los mismos trenes, señales, horarios y viajeros.

> RedMoviSim es un proyecto independiente y gratuito, **sin relación** con Red Metropolitana de Movilidad, Metro de
> Santiago ni el Ministerio de Transportes y Telecomunicaciones. El logo es propio; los nombres de líneas, estaciones y
> lugares se usan solo como referencia.

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

## Multijugador: Centro de Control + conductores

Un jugador hace de **Centro de Control** y hasta **4 amigos conducen** trenes de verdad en su red, cada uno desde su
computador o celular.

1. **El PCC abre la sala:** empieza un turno del Centro de Control y pulsa **👥 Sala → Abrir sala**. Aparece un código
   de 4 letras.
2. **Cada conductor se une:** en la portada elige una de las líneas que supervisa el PCC y su servicio (ida o vuelta), y
   en la tarjeta Conductor pulsa **Unirse a una sala**, escribe su nombre y el código. El PCC le asigna el próximo tren
   que sale de la terminal (si el andén está ocupado, sale de la cochera).
3. **Se juega en la misma red:** el conductor ve los mismos trenes, señales averiadas, limitaciones y horarios que el
   PCC. En el esquema del PCC su tren lleva su nombre y un borde amarillo, y su puntualidad cuenta en la nota del turno.
4. **Órdenes por radio:** desde la ficha del tren el PCC puede **retenerlo** 30 s, 60 s o sin límite (el conductor
   escucha la orden y no puede traccionar en ese andén hasta que se cumpla o el PCC pulse **Puede salir**). Las
   **señales averiadas** ya no se autorizan solas: el conductor espera ante la señal hasta que el PCC lo autorice desde
   la alarma.
5. Con la sala abierta el tiempo corre a ×1 y no se pausa. Si un conductor se va, su tren sigue como tren automático;
   si el conductor pierde la conexión, sigue jugando solo.

**Mientras se unen, el Centro de Control debe quedar con la pantalla encendida y a la vista**: si cambia de app o de
pestaña (sobre todo en el celular), el navegador lo pausa y quien se una no lo encuentra («No se encontró la sala»).
👥 Sala muestra si la sala se puede encontrar. Para jugar en un solo computador, usa dos ventanas lado a lado, no dos
pestañas.

Necesita internet: los navegadores se conectan directo entre ellos (WebRTC con [Trystero](https://github.com/dmotz/trystero), que se
carga solo al abrir o unirse a una sala). Para encontrarse usa a la vez dos vías con varios servidores públicos cada
una (Nostr y rastreadores de WebTorrent), así que no depende de uno solo; después los datos van directo entre los
jugadores. 👥 Sala muestra cuántos servidores están conectados y la versión de red, que debe ser la misma que ve el
conductor bajo «Unirse a una sala» (si no, recarguen la página). Para probar en un solo computador, abre dos pestañas con `?red=local` al final
de la dirección: una como Centro de Control y otra como conductor (sin internet).

**Cómo funciona** (`js/net/`): el motor del PCC es el que vale. Cada conductor corre su propio motor completo, pero como
**réplica**: cinco veces por segundo recibe el estado de los trenes de su línea y lo corrige, y los incidentes llegan del
PCC. Su propio tren lo simula su computador (el mando responde sin retardo) y manda su estado diez veces por segundo.
`node tools/probar-red.mjs` prueba esto sin navegador: un PCC y un conductor en dos hilos, con 150 ms de retardo; los
trenes de los dos motores quedan a ~1 m (mediana).

## Centro de Control renovado

- **Elige qué supervisar** al empezar el turno: la Línea 3 (aprendiz), las líneas 1, 2 y 3 (operador) o toda la red
  (jefe de turno). Solo en esas líneas hay incidentes, y **esperan tu decisión**:
  - **Señal averiada:** queda en rojo varios minutos (la cuadrilla la repara). Autoriza a cada tren a rebasarla en
    **marcha a la vista** (20 km/h hasta el final del cantón); si el cantón está ocupado, hay que esperar.
  - **Tren detenido en la vía** (objeto en la vía, alarma de pasajero, inspección): sin tu autorización tarda minutos
    en seguir.
  - **Falla de puertas:** cada parada tarda ~25 s más. Retíralo del servicio (bajan todos en la próxima estación) o
    mantenlo y asume el retraso.
  - **Tren muy atrasado** (más de 5 min): puedes hacer que se salte su próxima parada.
- **Órdenes nuevas** en la ficha del tren: retener 30 s, 60 s o sin límite (se libera solo; en marcha cuenta desde
  que llega a la estación), liberar, saltar la próxima parada y retirar del servicio.
- **Interfaz más fácil:** botones para ver toda la red o una línea en grande (con nombres de estaciones), indicadores
  arriba, alarmas con sus botones a la derecha (con sonido), anillo en los trenes con alarma, X en las señales
  averiadas, franja en las limitaciones de velocidad, ayuda al pasar el ratón, pestañas Trenes (ordenable por retraso o
  carga) y Registro (filtrable), avisos de cada orden y atajos de teclado (Espacio, + −, 0–9, R, L, S, A, Esc).
- **El tiempo:** pausa y ×1, ×2, ×5, ×10.
- **Nota del turno** (S a D): puntualidad (45 %), rapidez con que atiendes las alarmas (40 %) y tiempo que los trenes
  te esperan detenidos (15 %). **Terminar turno** muestra el informe y cobra el sueldo en tu cuenta: $700 por alarma
  atendida más el bono por nota (en turnos de 20 min o más).
- **Tutorial interactivo** la primera vez (o con «¿Primera vez? Con tutorial» y desde Ayuda): enseña el esquema, a
  seleccionar y retener un tren, el control del tiempo y provoca una señal averiada y un tren detenido para practicar.

## Mejoras del modo Pasajero

- **Encuentros con otros viajeros** (`js/encounters.js`): cada uno o dos minutos pasa algo que pide una decisión.
  Quien lo protagoniza es uno de los viajeros dibujados, marcado con un ícono flotante; acércate y pulsa **E**
  (o **F** para ceder el asiento):
  - **Ceder el asiento:** vas sentado, el coche va lleno y sube una persona mayor (de pelo canoso). Levántate y
    se sienta en tu lugar.
  - **Turista perdido** (`js/routeQuiz.js`): pregunta cómo llegar a otra estación. Elige la indicación correcta
    (línea, dirección y, si hace falta, dónde combinar), calculada con la red real. Si aciertas te deja una propina;
    si te equivocas, se va por el camino equivocado.
  - **Objeto olvidado** (mochila, celular, billetera, paraguas…) en un asiento del coche: recógelo y entrégalo en
    cualquier boletería. El dueño te deja una recompensa. Lo llevas aunque cambies de línea o cierres el juego.
  - **Vendedor ambulante:** entra desde el coche vecino y recorre el pasillo con su caja: chocolates «tres por mil»,
    calugas, pañuelos… lo que compras queda en tu bolsa.
  - **Músico** que entra con su guitarra, acordeón o charango y toca en el coche (se oye): puedes darle una moneda.
  - **Pasajero que se siente mal:** avisa por el citófono de emergencia. El conductor responde por radio y el tren
    espera en la próxima estación a que suba personal de Metro.
- **Civismo** (`js/civics.js`): ayudar suma puntos (equivocarte con el turista resta) y subes de nivel: Buen
  vecino, Pasajero ejemplar y Orgullo del Metro, cada uno con un premio en tu cuenta. Se ve en la libreta de
  misiones (J).

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

## Versión 2.15 · Volante en el bus y el taxi (deshecho)

La 2.15 probó manejar el bus y el taxi con volante (girar en las curvas y para cambiar de pista).

**2.15.1** · Se vuelve a la conducción de antes: la calle dobla sola y A/D cambian de pista.

**2.15.2** · Paraderos y accesos al Metro en su lugar:
- En la calle del bus, el pasto ya no tapa la escalera del acceso al Metro (pasaba en todas las estaciones).
- En la calle real de las estaciones, el paradero que caía en medio de un cruce o dentro de un edificio (33 de 133
  calles, entre ellas Cristóbal Colón) se corre a la vereda más cercana, junto a la solera.
- Los edificios de OpenStreetMap que tapaban la boca del acceso o la vereda de enfrente (16 calles, entre ellas
  Cristóbal Colón, Pajaritos y Estadio Nacional) se recortan para dejar el paso libre.

**2.15.3** · En la calle del bus, los edificios que en una curva cerrada quedaban montados sobre la calzada o la vereda
ya no se dibujan.

## Versión 2.14 · Recorrido 110

- **Nuevo recorrido 110 de Red** (25 en total, más el A01 de práctica): un tramo real por **Av. Teniente Cruz**, de
  Los Placeres a Laguna Sur (13 paraderos, 4,2 km), pasando por las estaciones **Pudahuel**, **Barrancas** y
  **Laguna Sur** de la Línea 5. El servicio va de Renca a Maipú y lo opera Voy Santiago. Sale, como los demás, de la API
  pública de red.cl con `node tools/recorridos-red.mjs`; se puede manejar y también tomar de pasajero desde esas
  estaciones, y el taxi suma la calle Av. Teniente Cruz.

**2.14.1** · Post «Pediste el 110, ¡aquí lo tienes!» para anunciar el recorrido que pidió un jugador (`post-recorrido-110/`:
cuadrado, vertical e historia, con capturas del 110 en PC y en el celular acostado, y el texto listo en `texto.txt`).

**2.14.2** · El post del 110 agradece a **@tomygrx**, el jugador que pidió el recorrido (en la imagen y en el texto).

**2.14.3** · El texto del post del 110 manda al «link en la bio» (los posts se publican solo en Instagram, donde los enlaces del texto no se pueden tocar).

**2.14.4** · Los posts dejan la medida horizontal: se hacen solo las de Instagram (cuadrado, vertical 4:5 e historia). El del 110 queda sin `portada-horizontal.png`.

## Versión 2.13 · RedMoviSim te escucha: sugerencias y comentarios

Nuevo `js/sugerencias.js`: un formulario para que los jugadores nos cuenten ideas, errores y lo que les gusta.

- **Dónde está:** botón **Opinar** en la barra de la portada, el enlace *«RedMoviSim escucha a sus jugadores»* en el pie
  y **Sugerencias y comentarios** en el menú de la partida (Esc). Desde la partida el tema se elige solo (Metro, tren,
  viajar o multijugador) y se adjunta dónde estabas (p. ej. *Conduciendo · Línea 1*).
- **El formulario:** qué nos quieres contar (*Sugerencia*, *Algo falla*, *Comentario* o *Felicitar*), sobre qué parte
  del juego, el mensaje (10 a 2.000 caracteres), una nota opcional de 1 a 5 estrellas y un correo opcional si quieres
  respuesta (con la sesión iniciada aparece el tuyo).
- **No hace falta cuenta.** Se envían también la versión del juego y el tipo de dispositivo, para poder revisar los errores.
- **Sin internet** el mensaje queda guardado en el dispositivo y se envía solo cuando vuelve la conexión; si cierras la
  ventana a medio escribir, el borrador se conserva.
- Los mensajes van a la tabla `sugerencias` de Supabase (`supabase/sugerencias.sql`), con reglas que **solo dejan
  enviar**: nadie puede leerlos desde el juego; se revisan en el panel de Supabase.
- **Aviso por correo:** cada mensaje nuevo llega por correo al equipo (Edge Function `supabase/functions/aviso-sugerencia`,
  que lo manda con Resend). Si el jugador dejó su correo, basta con **Responder** para contestarle. El correo de destino
  no está en el código: es el secreto `AVISO_DESTINO` de Supabase. Para activarlo:
  1. Ejecutar `supabase/sugerencias.sql` en el SQL Editor.
  2. Publicar la función: `supabase functions deploy aviso-sugerencia --no-verify-jwt`.
  3. En *Edge Functions → Secrets*: `RESEND_API_KEY`, `AVISO_DESTINO` (tu correo) y `AVISO_TOKEN` (una clave inventada).
  4. En *Database → Webhooks*, uno nuevo para la tabla `sugerencias`, evento **Insert**, tipo *Supabase Edge Function*
     `aviso-sugerencia`, con la cabecera `x-aviso-token` igual a `AVISO_TOKEN`.

**2.13.1** · Post para Instagram «RedMoviSim te escucha» (`post-sugerencias/`: cuadrado, historia y horizontal, con
capturas del formulario en PC y en el celular acostado, y el texto listo en `texto.txt`).

**2.13.2** · El post suma la medida vertical de Instagram (`post-vertical.png`, 1080×1350), la que más ocupa en el feed.

**2.13.3** · El post pasa a una versión clara (fondo cálido, títulos oscuros y rojos) y las capturas muestran la portada detrás de la ventana, sin el velo oscuro.

## Versión 2.12 · Tienda renovada

La **Tienda RedMovi** (`js/shopUI.js`) ahora ayuda a decidir en qué gastar y a juntar para lo que falta:

- **Progreso:** cada pestaña muestra cuánto tienes (p. ej. *Conductor 3/14*) y arriba se ve el total de la tienda completada.
- **Tu próxima meta:** al comienzo de Conductor y de Mi depto aparece lo más barato que aún no tienes, cuánto te falta y
  unas cuántas estaciones bien servidas equivale; si ya te alcanza para algo, lo dice.
- **Ahorro por artículo:** lo que todavía no puedes pagar muestra una barra con lo que llevas juntado.
- **Compras caras con confirmación:** desde $20.000 el botón pide un segundo toque («¿Confirmar?») y avisa con cuánto
  quedarías, para no gastar por error en el celular.
- **Contratos con números:** cada contrato muestra cuánto pasa a pagar una estación perfecta y el bono de nota S.
- **Ocultar lo que ya tengo** (se recuerda en el dispositivo), muebles ordenados por precio con lo que cuesta amoblar el
  depto entero, y en la Colección cuánto falta para completar cada línea.
- La compra recién hecha se ilumina, el saldo destella y el aviso cuenta qué puedes hacer ahora (licencia lista para
  conducir, librea para el próximo servicio…). Con teclado, **1 · 2 · 3** cambian de pestaña.

## Versión 2.11 · Tu cuenta: inicia sesión con tu correo y sigue en cualquier dispositivo

Nuevo `js/cuenta.js`: cuenta **opcional**, sin contraseña. En la portada (botón **Entrar**) o en el menú de la partida
(**Guardar en la nube**) escribes tu correo, te llega un **código de 6 dígitos** y con eso entras.

- **La partida en la nube:** tu cuenta, la tarjeta bip!, las compras de la tienda, las misiones, los récords, el civismo,
  los tutoriales y tu perfil se guardan solos mientras juegas (cada 20 s si hubo cambios y al cerrar el juego). Las
  preferencias del dispositivo (sonido, línea elegida, clima, modo creador) no se suben.
- **Otro dispositivo:** entras con el mismo correo y se baja tu partida. Si el dispositivo y la nube tienen avances
  distintos, el juego te pregunta con cuál quedarte (en la portada, nunca en medio de un viaje).
- **Sin internet** se juega igual y lo pendiente se sube cuando vuelve la conexión. Sin cuenta, todo sigue como antes.
- **Tu cuenta:** cerrar sesión (el avance queda en el dispositivo) y **borrar la cuenta** con su partida de la nube.
- Usa Supabase (correo con código y una tabla `partidas` con reglas que solo dejan a cada jugador leer y cambiar la suya);
  los correos salen desde `no-reply@redmovisim.cl` con Resend.

**2.11.1** · En la ventana de la cuenta el correo ya no se corta en medio de la palabra. Post «Tu partida te sigue»
(`post-cuenta/`) para presentar la cuenta en redes sociales.

**2.11.2** · Voces grabadas en el Tren Nos y el Tren Rancagua (sus 21 estaciones y las combinaciones «a Tren Nos» y
«a Tren Rancagua», que ahora completan también los anuncios de Estación Central, Lo Valledor y Pedro Aguirre Cerda) y en
cuatro avisos de la operación: detención momentánea, reanudación, retiro del servicio y tren que no admite pasajeros. Las
detenciones con motivo siguen con la voz sintetizada.

**2.11.3** · La portada muestra la cuenta de Instagram **@redmovisim**: un botón en la barra superior (en el celular
queda solo el ícono) y un enlace en el pie, junto al aviso de proyecto independiente.

**2.11.4** · En la portada, la tarjeta **Conducir** suma la etiqueta **Taxi** junto a Metro, Tren y Bus.

**2.11.5** · El texto de la tarjeta **Conducir** también nombra el taxi y sus carreras.

## Versión 2.10 · Un tablero de verdad en el bus y el taxi

- **Velocímetro de aguja**: el panel de abajo a la izquierda ahora es el tablero del vehículo, con un velocímetro de
  0 a 80 km/h, la zona roja desde la velocidad máxima de la calle y los km/h en número al centro, junto al letrero de
  velocidad máxima (que se marca en verde con el limitador).
- **Luces testigo** como las de un tablero real: puertas abiertas (amarilla), freno (roja) y limitador (verde).
- **Consola del conductor**: el próximo paradero se ve en una pantalla con el número del recorrido y los datos en
  casillas (distancia, gente esperando, si vas a la hora, pasajeros a bordo y puertas).
- **Taxímetro**: en el taxi, la carrera lleva el aparato del taxímetro, con «LIBRE» en verde y el monto en números rojos
  durante el viaje.
- En el celular el tablero se achica para caber bajo la fila de botones.
- **2.10.1** · Interfaz del bus y el taxi optimizada para el celular: se ve mucha más calle. La barra de arriba es de una
  línea (sin los títulos «Cuenta» y «Hora»), los botones de acción quedan solo con su ícono, las flechas y los pedales son
  más chicos, el tablero y la consola van juntos en la franja de abajo, y la guía para detenerse en el paradero o el
  semáforo aparece arriba, bajo el esquema del recorrido, en vez de en medio de la calle.
- **2.10.2** · Guion de locución pendiente (`docs/guion-locucion-pendiente.pdf`): todas las frases que todavía dice la voz
  sintetizada y se pueden grabar (bienvenida, estaciones de los trenes Nos y Rancagua, combinaciones y avisos), con el
  nombre de archivo de cada una.
- **2.10.3** · Post de presentación del juego para Facebook (`post-presentacion/`): imágenes en las tres medidas y el texto
  del post (`texto.txt`).
- **2.10.4** · Torniquetes más realistas: de trípode, como los del Metro de Santiago. Gabinetes de acero inoxidable
  cepillado con puntas redondeadas, zócalo, tapa oscura y juntas de servicio; tres brazos de acero en cono que giran un
  tercio de vuelta por persona, en el sentido en que camina; validador bip! en atril inclinado con pantallita, y
  pictogramas de paso (flecha verde que se vuelve aspa roja si la tarjeta se rechaza).

## Versión 2.9 · Más recorridos de bus

- **16 recorridos nuevos de Red** (24 en total, más el A01 de práctica), por calles nuevas de la ciudad: 104 (Los Leones),
  113 (Lord Cochrane), 201 (Gran Avenida), 203 (Recoleta), 302 (Manuel Rodríguez), 303, 412 (Alameda poniente, desde
  Pajaritos), 430 (Apoquindo), 503 (Nueva Providencia), 505 (Compañía), 507 (Av. Matta), 517 (Providencia), 518 (Bilbao),
  712 (Vespucio sur), C02 (Apoquindo a Los Dominicos) y F01 (Concha y Toro en Puente Alto). Como los anteriores, salen de la
  API pública de red.cl con `node tools/recorridos-red.mjs` y también se pueden tomar de pasajero desde sus estaciones.
- **El recorrido se elige como la línea del Metro**: en vez de una lista desplegable, cada recorrido es un botón con su
  número y su color, y al lado aparece su ficha (de dónde a dónde va, el esquema de sus paraderos con los que están junto
  al Metro, cuántos paraderos tiene, su largo y hacia dónde va el servicio).
- **2.9.1** · El taxi ya no muestra los recorridos del bus: se elige la **calle** (Alameda, Apoquindo, Providencia, Gran
  Avenida…), una vez cada una, con botones amarillos y su ficha (largo, semáforos y estaciones de Metro por las que pasa).
- **2.9.2** · Las calles del taxi con dos tramos lejos uno del otro se eligen por separado, con el sector: Américo Vespucio
  (La Granja y Macul), Av. Apoquindo (El Golf y Los Dominicos) y Av. Matta (Estación Central y Ñuñoa).
- **2.9.3** · Arreglos en la calle del bus y el taxi: **se ven las luces de los semáforos** (en los recorridos reales, al
  doblar la calle según el trazado, las luces quedaban fuera de su lugar); los letreros con el nombre de la calle y los
  paneles de los paraderos miran a la calzada y **ya no se leen al revés**; el «SOLO BUS» de la pista está al derecho; y el
  letrero de arriba del taxi muestra el sector de la calle (p. ej. «Av. Matta · Ñuñoa»).
- **2.9.4** · Los semáforos también tienen luces hacia el otro sentido (al otro lado del bandejón, con su línea de
  detención): después de una vuelta en U con el taxi se ven igual que en la ida, y cambian al mismo tiempo.

## Versión 2.8 · La radio del taxi

- **El taxi tiene radio**: 14 emisoras de Santiago **en vivo** (Imagina, Concierto, Futuro, Pudahuel, ADN, Cooperativa,
  Rock & Pop, Beethoven, FM Dos, Bío-Bío, Play FM, Corazón, Los 40 y Sonar), ordenadas como en el dial.
- **Cómo se usa**: el botón **Radio** arriba a la derecha abre el panel con el dial, el botón para encender y apagar,
  el volumen y la lista de emisoras. En el PC, **R** enciende y apaga, y **,** y **.** cambian de emisora. En el celular el
  panel queda al lado de los pedales, así que puedes seguir manejando con la radio abierta.
- Cada radio suena desde su propia transmisión pública por internet, directo desde su servidor: el juego no guarda
  ni retransmite nada. **Necesita conexión**; sin internet, la radio muestra «sin señal». Al cambiar de emisora se oye
  el ruido de la sintonía.
- El botón de sonido del juego (o **M**) también silencia la radio. El juego recuerda en este dispositivo si la dejaste
  encendida, en qué emisora y con qué volumen.
- Las emisoras están en `js/bus/taxiRadio.js`: si una radio cambia su transmisión, basta corregir su dirección ahí.
- **2.8.1** · La radio también está al **conducir el bus** (el mismo botón Radio, las mismas teclas y la misma emisora
  que dejaste en el taxi). Al viajar de pasajero no está: la radio es del conductor.
- **2.8.2** · Post «Pon la radio mientras manejas» para anunciar la radio (`post-radio/`: el taxi en Cooperativa y el
  bus en Futuro, cada uno en un celular en horizontal con el panel de la radio abierto; cuadrado, historia y horizontal,
  con `node generar.js plantilla.html`).

## Versión 2.7 · Todas las calles son reales

Después de la prueba en Universidad de Chile, **las 133 estaciones del extracto de OpenStreetMap de Santiago tienen su
calle real**: Metro L1 a L6, el Tren Nos y el Tren Rancagua hasta Nos (© colaboradores de OpenStreetMap, ODbL). Las 8 del
Tren Rancagua al sur de Nos (Buin Zoo a Rancagua) quedan fuera del extracto y siguen con su calle de siempre.

- **Se sale por un acceso real** de la estación (el más cercano donde cabe la escalera en la vereda; si el punto de OSM
  queda pegado a la calzada o dentro de un edificio, se corre unos metros). En las estaciones de EFE, que no tienen
  accesos del Metro, se sale a la vereda junto a la estación.
- **La avenida de cada estación** es la calle más importante junto al acceso (la Alameda, Providencia, Vicuña Mackenna,
  Gran Avenida, Pajaritos…), y la calle gira con ella (el sol también).
- **Los hitos** se buscan por su nombre en OSM: edificios (La Moneda, la Catedral, Costanera Center, el Estadio Nacional,
  Mall Plaza Egaña…) con su placa, o plazas, parques y monumentos (Plaza Baquedano, el Cerro Santa Lucía, la Quinta
  Normal, la Plaza de Puente Alto…), donde se saca la foto. Si el hito queda lejos del acceso, la foto se saca en la vereda de enfrente.
- **Alturas más creíbles donde OSM no las tiene**: las casas tienen 1 o 2 pisos y los demás edificios copian los pisos
  de los vecinos que sí los tienen en OSM (en el centro, torres; en los barrios, edificios bajos). Si no hay vecinos con
  pisos, se decide por el tamaño de la planta.
- **Cada calle se carga cuando hace falta** (`js/city/streetData.js`): son archivos de 15 a 70 KB (4,5 MB en total) en
  `js/city/calles/`. La partida baja la de su estación antes de empezar, las de su línea en segundo plano y la de cada
  estación a la que entras; si alguna no alcanzó a llegar, se ve la calle de siempre y se cambia sola mientras sigues
  bajo tierra. La PWA las guarda para jugar sin conexión.
- **Cómo se generan**: `tools/zonas-osm.py` recorta del extracto de BBBike (un solo archivo, sin cargar la API de OSM)
  una zona por estación, y `tools/calles-osm.mjs --zonas` arma las calles (los pasos están en el encabezado del script).
- **2.7.1** · Post «Las calles son reales» para redes sociales (`post-calles/`: antes y ahora en Universidad de Chile, con
  el celular en horizontal y el crédito de OpenStreetMap; cuadrado, historia y horizontal, con `node generar.js plantilla.html`).
- **2.7.2** · Post «Juega con tus amigos» para presentar el modo multijugador (`post-multijugador/`: el Centro de Control
  en el PC con el tren de una conductora seleccionado y su cabina en un celular en horizontal recibiendo la orden por radio;
  cuadrado, historia y horizontal, con `node generar.js plantilla.html`).
- **2.7.3** · Post «Queremos escucharte» para pedirle a la comunidad sugerencias y comentarios (`post-comunidad/`:
  burbujas de chat con ideas de ejemplo y el letrero «Próxima estación: tu idea»; cuadrado, historia y horizontal, con
  `node generar.js plantilla.html`).
- **2.7.4** · El bus y el taxi dejan de ser beta: se quita la etiqueta «beta» de la portada (Conducir › Bus Red y Taxi)
  y del letrero mientras se maneja.

## Versión 2.6 · La calle real de Universidad de Chile (OpenStreetMap)

Primera estación con la **calle tal como es**: al salir del Metro en **Universidad de Chile** (L1 y L3) se está en la
Alameda de verdad, sacada de **OpenStreetMap** (© colaboradores de OpenStreetMap, licencia ODbL). Es la prueba antes de
pasar el resto de la red.

- **Se sale por el acceso real** (E · Arturo Prat, en la vereda sur), frente a la **Casa Central de la Universidad de
  Chile**, con la placa en su fachada; la foto del hito se saca en la vereda, delante del edificio.
- **Los edificios con su planta y su altura**: unos 200 alrededor (La Moneda, la Iglesia de San Francisco, la Bolsa de
  Comercio, el Club de La Unión…). La altura sale de OSM (`height` o `building:levels`) o, para los conocidos que no la
  tienen, de una tabla; los demás llevan una estimación que siempre es la misma. Los antiguos tienen pisos más altos.
- **Las calles con su ancho real**: la Alameda con sus dos calzadas de 4 a 5 pistas y el bandejón, y las que la
  cruzan, con soleras, líneas de pista, eje amarillo en las de doble sentido, **pasos de cebra donde están** y
  **semáforos donde están**, que cambian de luz (la Alameda y las transversales se turnan).
- **Árboles, faroles y el paradero** en sus lugares reales; **autos y buses Red** recorren las calles reales en su
  sentido y **paran en rojo** (y ante el jugador).
- **Los locales del juego** van sobre fachadas reales de la vereda del Metro y, donde no hay (la cuadra de la Casa
  Central), como **puestos en la vereda ancha**, como en la Alameda. Las misiones y la brújula los encuentran igual.
- **El sol** sale por donde corresponde: la calle real gira con la avenida y el cielo se gira con ella.
- **Cómo se hace** (`tools/calles-osm.mjs`): descarga la zona de la API oficial de OSM, la pasa a metros en las
  coordenadas de la calle del juego (la avenida a lo largo de Z y el acceso real justo sobre la escalera de salida de la
  estación) y deja `js/city/realStreets.js` (~140 KB). `js/city/realCity.js` la dibuja (una malla por material e
  instancias, para el celular) y responde dónde hay edificios, calzadas u obstáculos. Las demás estaciones siguen con
  su calle de siempre. Para agregar otra estación basta sumarla a la lista del script (su acceso, la avenida y el hito)
  y volver a correrlo.
- Lo que todavía no es real: las fachadas (las ventanas son genéricas; OSM no tiene fotos) y los locales (nombres del
  juego, no los de la cuadra).

## Versión 2.5 · Tarifa integrada como en Santiago y pago con tarjeta bancaria

Revisión de todo el sistema contra el transporte público real (noviembre de 2026). La red (Metro L1 a L6 con las
extensiones de la L2 a Hospital El Pino y de la L3 a Plaza Quilicura, Tren Nos y Tren Rancagua), las tarifas por tramo
($895 punta, $815 valle, $735 baja, vigentes desde el 22-02-2026) y el horario (lun a vie 06:00–23:00, sábado
06:30–23:00, domingo y festivos 07:30–23:00) ya coincidían. La Línea 7 (fines de 2028) y el tren Santiago–Batuco
(2029–2031) siguen en obras, así que todavía no se agregan. Lo que faltaba era cómo se cobra:

- **Bus Red a $795 a toda hora** (antes cobraba la tarifa del Metro según la hora). La TNE paga $260 en el bus; la
  TAM es solo de Metro, así que en el bus se paga la tarifa adulto.
- **Tarifa integrada de verdad** (`js/trip.js`): un viaje tiene hasta **3 etapas (2 transbordos) en 120 minutos**
  desde el primer bip! y en cada transbordo **se paga solo la diferencia** (bus $795 → Metro en punta: $100;
  Metro → bus: $0). Una sola etapa en Metro y una en Tren Nos por viaje (si sales del Metro y vuelves a entrar, es un
  pasaje nuevo) y **no se puede repetir un recorrido de bus**. El Tren Rancagua no está integrado. El viaje se guarda,
  así que sigue vigente aunque cambies de modo de juego o recargues. El paradero y el torniquete dicen cuánto pagas y,
  si no es transbordo, por qué.
- **Pago con tarjeta bancaria (Pago Ágil)**, como desde el 13-02-2026: en Tarifas › *Pagar en el torniquete del Metro
  con* se elige **Tarjeta bip!** o **Tarjeta bancaria**. Con la bancaria se acerca el débito del Banco Andino al
  torniquete del Metro y se cobra de la cuenta la tarifa adulto del tramo (sin TNE ni TAM y sin
  transbordo); en el bus se sigue pagando con bip!.
- **2.5.1** · La tarjeta bancaria sirve **solo en el Metro** (en Tren Nos y Tren Rancagua se paga con bip!) y post
  «Paga con tu débito del Banco Andino» para redes sociales (`post-debito/`: cuadrado, historia y horizontal).
- El panel de **Tarifas** muestra el bus, las reglas del transbordo y cuántos minutos le quedan a tu viaje integrado.
- `node tools/probar-tarifa.mjs` prueba las reglas sin navegador.

## Versión 2.4 · La calle se ve más real

Nuevo `js/render/realism.js`, que usan la calle del bus y del taxi, la calle de la estación (modo Viajar) y el Metro
al aire libre:

- **Cielo de verdad:** degradado del cenit azul profundo a la bruma clara del horizonte, el disco y el halo del sol y
  nubes que se mueven (más con el tiempo nublado). La niebla toma el color del horizonte, así lo lejano se funde con él.
- **El sol se mueve con la hora:** sale por la cordillera, al mediodía está hacia el norte y se pone por el poniente.
  En la calle del bus/taxi y en la calle de la estación **proyecta sombras** suaves (edificios, árboles, faroles,
  paraderos, autos, el bus y la gente) en un área que acompaña a la cámara. En celulares el mapa de sombras es más chico.
- **Texturas del tamaño real:** asfalto con grano, bacheos, manchas de aceite y grietas; veredas de baldosas con
  juntas; pasto en el bandejón. Se pegan según la posición en el mundo, así no se estiran en las piezas largas.
- **Fachadas:** las ventanas se reparten por pisos según el alto real de cada edificio (ya no se estiran), con marco,
  vidrio que refleja el cielo, cortinas, alféizar con mancha de lluvia y aire acondicionado; el color de cada edificio
  tiñe solo el muro y la azotea es de hormigón. También hay edificios de muro cortina.
- **Árboles** con copa de varios bultos, más oscura abajo (sombra propia), y tronco con ramas.
- **Reflejos:** los autos, los vidrios y la calzada mojada reflejan el cielo de la hora.
- **De noche,** los faroles dejan un círculo de luz cálida en el piso.
- **2.4.1** · Post «La calle se ve más real» para redes sociales (`post-realista/`: antes y ahora del bus, con el
  celular en horizontal; cuadrado, historia y horizontal).

## Versión 2.3 · La calle dobla como el recorrido real · taxi en los dos sentidos

- **Recorridos con sus giros** (`js/bus/busPath.js`): la calle del bus y del taxi sigue el **trazado real** de cada
  recorrido de Red (de red.cl): dobla donde dobla el bus de verdad (p. ej. el 403 hacia Plaza Italia, el 109 por
  J. Walker Martínez) y la cordillera queda al oriente. Las esquinas se suavizan (radio de unos 30 m o más) para que las
  pistas no se crucen; los edificios que quedarían montados en la parte de adentro de una curva se omiten. El A01 de
  práctica sigue siendo recto.
  - `tools/recorridos-red.mjs` guarda ahora el trazado de cada tramo (`path`: puntos [este, norte, s]) y
    `js/bus/redRoutes.js` se regeneró (paraderos y semáforos iguales).
  - La simulación no cambia (sigue midiendo la distancia `s` a lo largo del recorrido): el mundo 3D se arma recto y se
    dobla una vez al empezar (`busWorld.js · bendStatic`); el vehículo, los autos y la gente se ubican sobre el trazado
    en cada cuadro.
- **Taxi en los dos sentidos** (`js/bus/taxiSim.js`): el destino del pasajero puede quedar **adelante o atrás**. Para
  ir hacia atrás se da la **vuelta en U** (tecla **U** o botón **Vuelta**): despacio, desde la pista de la izquierda
  (junto al bandejón) y en un cruce con semáforo, o al final de la calle. El taxi pasa a la calzada de enfrente y sigue
  por la misma calle en el otro sentido. Quien hace señas espera en la vereda del sentido en que ibas: si das la vuelta
  antes de recogerlo, queda en la vereda de enfrente. El HUD avisa «atrás · da la vuelta» y guía paso a paso. Para dejar
  al pasajero basta detenerse a menos de 18 m del destino; el turno sigue mientras quieras (se termina desde el menú).

## Versión 2.2 · Taxi

- **Conducir un taxi** (beta): en la portada, Conducir › **Taxi**, por la calle de cualquier recorrido de bus
  (Alameda u otro de Red). Es un taxi básico de Santiago, negro con el techo amarillo y el letrero TAXI.
  - **Carreras:** alguien hace señas en la vereda (marcador amarillo en la pista de la derecha y en el esquema de
    arriba). Pásate a la pista de la vereda, detente a su lado y abre la puerta (**Espacio**): sube, cierra la puerta y
    te dice adónde va, una esquina más adelante (marcador verde). Al llegar te detienes junto a la vereda y abres la
    puerta: paga lo que marca el **taxímetro** y, si el viaje fue suave (sin frenadas bruscas ni faltas), deja
    **propina**. Si te pasas de largo de quien hace señas, toma otro taxi.
  - **Taxímetro aproximado** (no oficial): $450 la bajada de bandera y $210 cada 200 m o cada minuto detenido.
  - Lo ganado va a tu cuenta, como el sueldo del bus o del Metro. El turno termina al acabarse la calle (o desde el
    menú), con su resumen y nota.
  - Usa lo mismo que el bus: tráfico, semáforos, clima (con lluvia frena menos), cambio de pista, limitador, cámaras
    (detrás y desde el asiento) y faltas (luz roja, exceso de velocidad, choques).
- `js/bus/taxiSim.js` (la simulación, se puede probar en Node) hereda de `busSim.js`, que ahora recibe el tamaño y la
  potencia del vehículo (`vehicle: { len, wid, spec }`). El modelo 3D, el marcador y las personas del taxi están en
  `busWorld.js` y `busPeople.js`; el HUD, en `busGame.js` y `css/bus.css`.
- **2.2.1 · Imágenes del post «¡Ya estamos verificados!»** (`post-verificado/`): post cuadrado, historia y portada
  horizontal que anuncian que la cuenta de RedMoviSim tiene la insignia de verificación de Meta. Se generan con
  `node generar.js plantilla.html`.

## Versión 2.1 · Centro de Control y bus con la interfaz nueva

- **Centro de Control** (`js/control/controlCenter.js`): rehecho con el sistema de diseño 2.0 y su color propio
  (azul). Barra superior de vidrio con ícono, selector de vista y control del tiempo como selectores segmentados,
  indicadores más grandes, esquemas de línea en tarjetas, ficha del tren destacada al seleccionarlo, pestañas
  Alarmas/Trenes/Registro segmentadas, órdenes con botones más grandes (retener en rojo suave, la principal en azul) y
  diálogos (nuevo turno, sala, ayuda, informe) con la misma forma que los paneles del juego. «Terminar turno» se
  distingue en rojo y el botón para salir dice **Salir**. En el celular horizontal la barra cabe en una fila.
- **Bus** (`js/bus/busGame.js`, `css/bus.css`): el HUD usa los mismos paneles que la partida de Metro; arriba dice
  **Bus Red · Conduciendo** o **Viajando**, y el botón **Menú** tiene texto. La pausa (Esc) es ahora el **menú** de la
  partida: Seguir manejando, **Controles** (muestra u oculta la lista de teclas, que se ve al empezar y se oculta sola a
  los 12 s), Sonido y Volver a la portada. Paraderos, timbre e informe del recorrido con el rojo de la marca.

## Versión 2.0 · Interfaz nueva

RedMoviSim estrena una interfaz hecha desde cero: identidad propia (ya no la del Metro) y más fácil de usar.

- **Portada en dos pasos** (`css/home.css`): primero **¿Qué quieres hacer hoy?** con tres tarjetas grandes
  (**Conducir**, **Viajar** y **Centro de Control**); después se prepara la partida y se juega con un botón grande.
  En Conducir, **Metro, Tren Nos, Tren Rancagua y Bus Red** están al mismo nivel; la línea solo se pide para el Metro.
  **Seguir donde quedaste** repite lo último que jugaste con un toque. La hora, la tarifa vigente y la Tienda (con tu
  saldo) quedan en una barra arriba, y el clima se cambia desde un apartado plegable.
- **Sistema de diseño** (`css/ui.css`): paleta grafito con el rojo de la marca RedMoviSim, un color por modo (rojo
  conducir, verde viajar, azul Centro de Control), botones, campos y selectores nuevos. El color de cada línea solo
  marca lo que es de esa línea.
- **Menú de la partida** (`css/game.css`): **Esc** o el botón **Menú** reúne Seguir jugando, Controles, Sonido,
  Tarifas, Tienda, Misiones, Reiniciar el servicio, **Finalizar turno y cobrar** (en un toque) y **Volver a la
  portada**. Reemplaza los botones sueltos de antes. Arriba se lee el medio y la línea («Metro · Línea 3»,
  «Tren Nos · EFE») y si estás conduciendo o viajando.
- **Paneles unificados**: boletería, locales, misiones, tarifas y confirmaciones con la misma forma.
- Fin de la mantención (`js/mantencion.js`, `ACTIVA = false`). Lo hecho mientras tanto quedó en las 1.20.5 a 1.20.8.
- **2.0.1 · Imágenes del post «¡Ya volvimos! · RedMoviSim 2.0»** (`post-volvimos/`): post cuadrado, historia y
  portada horizontal con capturas reales de la portada nueva en PC y celular. Se generan con `node generar.js plantilla.html`.
- **2.0.2 · Post «¡Ya volvimos!» con el celular en horizontal** (`post-volvimos/`).

## Versión 1.20 · La calle del bus usa todo lo del Metro

El modo bus tenía su propio cielo fijo y no conocía el clima, los accesos ni la locución del Metro. Ahora usa las mismas
piezas que el resto del juego, así la calle se ve y se comporta como el Metro al aire libre:

- **Cielo y clima del Metro** (`render/outdoor.js` · `skyAt`, `engine/weather.js`): la luz sigue la hora y la nubosidad
  igual que en los tramos al aire libre del Metro, y el tiempo elegido en la portada (o el real de Santiago) también vale
  en la calle: **lluvia que cae** (no dentro del bus), **calzada y veredas mojadas** con brillo, neblina más cerrada y la
  cordillera tapada cuando está nublado. En la barra de arriba se ve el clima (en el computador).
- **Manejo con lluvia** (`js/bus/busSim.js`), como el patinaje del tren: con el piso mojado el **ABS** no deja frenar tan
  fuerte (desde 50 km/h el bus necesita ~36 m en vez de ~28 m), se oye su tableteo y avisa «frena antes»; al partir
  patina un poco. Los autos van más lento y dejan más distancia. La flecha de predicción de frenada ya lo considera.
- **Más gente cuando llueve o hace frío**: los paraderos usan la misma demanda del Metro con su factor de clima.
- **Accesos al Metro en los paraderos** (`js/city/city.js` · `metroStreetAccess`, `metroTotem`): junto a cada paradero que
  está en una estación hay una boca del Metro con escalera, baranda de vidrio, franja podotáctil y el **tótem con el
  logotipo, el nombre de la estación y las insignias de sus líneas** (`linesAtStation` en `js/engine/network.js`), el
  mismo diseño de la calle del modo pasajero. Parte de los que bajan del bus **se van a combinar por esa escalera**.
- **Peatones** (`js/bus/busPeople.js`): la gente del Metro también pasa caminando por las dos veredas.
- **El bus ya viene con gente** cuando subes como pasajero a mitad del recorrido (antes llegaba vacío).
- **Locución a bordo con la voz del Metro** (`js/bus/busAudio.js`, `bestSpanishVoice` de `js/audio.js`): al salir de
  cada paradero dos notas y «Próxima parada: Los Héroes. Combinación con Metro Línea 1 y Línea 2.» (también Tren Nos y
  Tren Rancagua), y «Fin del recorrido» antes del último. Con lluvia suena el agua.
- **Arreglo: el bus a veces no se veía.** Si un cuadro duraba 0 s (pasa seguido con el primero), la aceleración del bus
  quedaba en «no es un número» y el bus desaparecía de la pantalla el resto del recorrido. Ahora ese cuadro se salta.
- **1.20.1 · Imágenes del post «Ya está en marcha»** (`post-mejoras/`): post cuadrado, historia y portada horizontal
  para redes sociales, generadas con `node generar.js plantilla.html` desde esa carpeta.
- **1.20.2 · Imágenes del post «Juega en PC y celular»** (`post-pc-celular/`): post cuadrado, historia y portada
  horizontal que anuncian que se juega escribiendo redmovisim.cl en el navegador, con capturas reales de la portada.
- **1.20.3 · Imágenes del post «Instálalo en tu celular»** (`post-instalar/`): post cuadrado, historia y portada
  horizontal con los pasos para instalar la app en Android (Chrome) y iPhone (Safari).
- **1.20.4 · Post «Instálalo en tu celular» con el celular en horizontal** (`post-instalar/`).
- **1.20.5 · Juego en mantención** (`js/mantencion.js`): mientras se rehace la interfaz para la 2.0, el sitio muestra
  la pantalla «Estamos renovando RedMoviSim · Volvemos pronto» y no carga el juego. Para entrar igual a revisarlo se
  agrega **`?probar`** a la dirección (`redmovisim.cl/?probar`); se recuerda mientras la pestaña siga abierta. Se apaga
  con `ACTIVA = false` en `js/mantencion.js`. La cuenta, la bip! y las misiones siguen guardadas en cada dispositivo.
- **1.20.6 · Imágenes del post «Volvemos en unas pocas horas»** (`post-volvemos/`): post cuadrado, historia y portada
  horizontal que avisan que el juego vuelve en unas horas con la interfaz renovada y que el dinero, la bip!, las
  compras y las misiones quedan guardados en el celular o computador. Se generan con `node generar.js plantilla.html`.
- **1.20.7 · Portada nueva (avance de la 2.0, detrás de la mantención):** sistema de diseño propio de RedMoviSim
  (`css/ui.css`: paleta grafito con el rojo de la marca, botones, campos y selectores) y portada en dos pasos
  (`css/home.css`): primero **¿Qué quieres hacer hoy?** (Conducir, Viajar o Centro de Control) y después se prepara
  la partida (Metro, Tren Nos, Tren Rancagua o Bus Red al mismo nivel, línea o recorrido, sentido y clima plegable)
  con un botón grande para jugar. **Seguir donde quedaste** repite lo último que se jugó. La hora, la tarifa y la
  Tienda quedan en una barra arriba. Se ve con `?probar`.
- **1.20.8 · Menú de la partida (avance de la 2.0):** **Esc** o el botón **Menú** (arriba a la derecha) abre un menú
  con Seguir jugando, Controles, Sonido, Tarifas, Tienda, Misiones (a pie), Reiniciar el servicio y **Finalizar turno
  y cobrar** (en un solo toque, ya no hay que pulsar dos veces) o **Volver a la portada**. Reemplaza los botones
  sueltos de antes (Volver, Finalizar turno y Controles); en el celular se abre desde el menú táctil. Arriba a la
  izquierda dice el medio y la línea («Metro · Línea 3», «Tren Nos · EFE») y si estás conduciendo o viajando. Todos
  los paneles (boletería, locales, misiones, tarifas, confirmaciones) tienen la misma forma, sin la franja naranja.

## Versión 1.19 · Pasajeros realistas en el bus

- **Personas en 3D en vez de cápsulas** (`js/bus/busPeople.js`): las mismas figuras articuladas del Metro, con ropa,
  piel y pelo distintos. Hay adultos, **estudiantes con mochila**, **adultos mayores** (pelo cano, algo encorvados,
  caminan y suben despacio), **niños** y gente **con bolsas**.
- **En el paradero** unos esperan sentados en la banca y otros de pie, mirando la calle, si viene el bus o el celular.
  Cuando el bus se acerca a detenerse se arriman a la solera y **hacen fila junto a la puerta delantera**.
- **Suben de a uno por adelante** y validan la bip! (a veces el validador rechaza una tarjeta sin saldo y la persona
  se baja). **Al mismo tiempo bajan por las puertas central y trasera** y se van caminando por la vereda.
- **Dentro del bus** buscan asiento (los adultos mayores y quien va con bolsas primero) o van de pie tomados del
  pasamanos, y **se van para adelante y para atrás cuando frenas o aceleras**. La carrocería ahora tiene ventanas
  translúcidas, así que se ve a la gente desde afuera. **El bus tiene conductor** (con camisa del uniforme y las
  manos en el volante; en la vista de cabina no se dibuja porque la cámara está en su cabeza).
- **Alguien llega corriendo** a veces justo cuando terminaron de subir (más en hora punta): si esperas con las
  puertas abiertas alcanza a subir; si cierras, se queda mirando cómo se va el bus. El bus automático del modo
  pasajero lo espera.
- **Cada persona tarda lo suyo**: subir toma de 0,7 a 3 s según quién sea (antes todos 0,85 s) y la bajada va en
  paralelo. **Más gente se baja en las estaciones de Metro** (para combinar) y en la terminal.
- En el modo pasajero tu asiento y el pasillo de adelante quedan libres, para que se vea la calle.
- **1.19.1 · Fila ordenada en el paradero:** la gente forma **una sola fila** junto a la solera, detrás de la señal
  del paradero, con espacio entre una persona y otra y mirando hacia la puerta. El orden se decide cuando se forma
  (primero los que estaban más cerca) y los que llegan después se ponen al final: nadie se cuela ni se reordena.
  Para entrar a la fila se acercan por el lado de la vereda y, cada vez que alguien sube, el resto avanza un puesto.

## Versión 1.18 · Recorridos reales de Red y mejor manejo del bus

- **8 recorridos reales de buses Red** además del A01 de práctica: **210, 385, 401 y 403** por la Alameda,
  **109** (Quinta Normal · Estación Central), **107** (Av. Dorsal), **211** (Américo Vespucio · La Cisterna) y
  **506** (Av. Matta · Estadio Nacional). Salen de la **API pública de red.cl** («Conoce tu recorrido»): paraderos con
  su código real y distancias medidas sobre el trazado del bus. De cada servicio se juega un tramo de 10 a 13
  paraderos (4 a 6 km) que pasa por estaciones de Metro. El juego no consulta la API en vivo (red.cl no lo permite
  desde otra página y el juego tiene que andar sin conexión): `node tools/recorridos-red.mjs` toma una foto y la deja
  en `js/bus/redRoutes.js`; volver a correrlo actualiza los datos.
- **Conductor → Bus Red** tiene un selector **Recorrido** con todos los servicios (largo y estaciones de Metro).
- **Pasajero**: en la calle de cada estación por la que pasa uno de estos recorridos, el letrero del paradero muestra
  sus números y con <kbd>E</kbd> se elige servicio y sentido. Solo se puede bajar en paraderos junto al Metro (el
  juego te deja en la calle de esa estación); los demás se avisan como «sin Metro».
- **Manejo del bus**:
  - **Freno suave** con <kbd>Shift</kbd> (35 %) para clavar la parada; en el celular los **pedales son analógicos**:
    cuanto más arriba apoyas el dedo, más fuerte (se puede deslizar sin soltar), y el pedal se va llenando.
  - **Predicción de frenada**: en la guía del paradero, una flecha amarilla marca dónde quedarías detenido si sigues
    frenando igual («así te pasas 1,6 m: frena más»). Lo mismo frente a un semáforo en rojo o amarillo.
  - **Limitador de velocidad** (<kbd>L</kbd> o el botón del celular): el motor no pasa de 50 km/h.
  - **Retardador**: al soltar el acelerador sobre 15 km/h el bus frena un poco solo, como uno real; y arranca con más
    fuerza desde detenido.
  - **Cambio de pista con curva suave** (el bus acelera y endereza de lado en vez de moverse a velocidad fija).
  - **Aviso de distancia**: si vas por una pista de autos, un indicador muestra los metros al auto de adelante y
    avisa («¡Distancia!») antes de chocarlo.
  - El bus automático del modo pasajero frena dosificado (más suave para la gente de pie).
- **1.18.1 · Pantalla de inicio y portada al día:** la intro habla del Metro, los trenes de EFE y los buses (texto,
  tarjetas y mapa «Metro y trenes · en vivo»; el Centro de Control menciona la sala multijugador). En el celular en
  vertical, «Comenzar» aparece arriba, justo bajo el texto (antes quedaba bajo el mapa), y los datos van en 2×2; en
  horizontal, texto y mapa van lado a lado (antes el mapa tapaba todo). El texto que se escribe solo ya reserva su
  espacio y no empuja los botones. En la portada, el titular es «Conduce trenes y buses, y viaja por Santiago en 3D»
  y las tarjetas Pasajero y Centro de Control nombran el tren, el bus y la sala multijugador.
- **1.18.2 · Arreglos del conductor de bus:**
  - **La nota ya no baja al pasar de largo un paradero vacío** (sin gente esperando ni timbre): antes contaba
    200 puntos posibles que no se podían ganar, y un recorrido bien hecho de noche terminaba en D.
  - **Llegar adelantado se corrige esperando**: si llegas antes de la hora, la puntualidad se mide al cerrar las
    puertas (al salir), como hacen los conductores para no adelantarse. El aviso y el consejo dicen desde qué hora
    puedes salir. Antes se medía al abrir las puertas, así que esperar no servía.
  - Los **pedales táctiles** ya no quedan pisados al pausar, al cambiar de app o al terminar el recorrido.
  - Después de **rozar un auto al cambiar de pista** el bus ya no sigue deslizándose de lado hacia él.
  - En el celular, la etiqueta «LIM» del límite de velocidad ya no queda cortada en el borde de la pantalla.

## Versión 1.17 · Interfaz más clara en todas las pantallas

- **Tienda:** si no te alcanza, el precio se ve apagado (borde punteado) y dice cuánto te falta («faltan $37.000»);
  antes parecía un botón para comprar. En el celular horizontal la cabecera es más baja y caben más artículos.
- **Controles de la cabina (H):** la ayuda pasa de una lista larga de una columna a dos columnas por grupos
  (Conducir · Cámara y turno · A pie), cada acción en su línea con su tecla y una nota corta cuando hace falta.
- **Centro de Control en el celular horizontal:** la barra de arriba cabe en una fila (botones de solo ícono) y los
  indicadores son más bajos, así el esquema de la línea se ve sin bajar. El diálogo *Nuevo turno* ya no se corta
  arriba. «Toda la red» aclara que incluye los trenes de EFE.
- **Esquema del PCC:** los nombres de las últimas estaciones se empinan en vez de cortarse en el borde derecho
  («F. CASTILLO V.»).
- **Bus:** la lista de teclas de abajo a la derecha va sobre un panel y se lee bien sobre la calle.

**1.17.1 · Dominio propio:** el juego ahora está en **https://www.redmovisim.cl/** (`redmovisim.cl` redirige ahí).
El enlace canónico, los datos estructurados, `robots.txt`, `sitemap.xml`, la plantilla del anuncio de mantenimiento y
los textos de `docs/DIFUSION.md` usan la dirección nueva. `redmovisim.benedettowebs.cl` sigue funcionando.

## Versión 1.16 · Tren Rancagua (EFE) y Tienda RedMovi

- **Tren Rancagua** (`js/engine/network.js`, botón **RCG**): el tren regional de EFE de Estación Central (estación
  Alameda) a Rancagua, ~82 km y 11 estaciones: Alameda, San Bernardo, Nos, Buin Zoo, Buin, Linderos, Paine, Hospital,
  San Francisco, Graneros y Rancagua (distancias aproximadas). Corre por la misma vía que el Tren Nos hasta Nos, con
  trenes X'Trapolis, más o menos cada 20 minutos en hora punta. **Combina con la L1 y el Tren Nos en Estación Central
  y con el Tren Nos en San Bernardo y Nos**; como pasajero se puede tomar y combinar a pie, y el Centro de Control lo
  supervisa. Licencia en la tienda: $18.000 el Tren Nos y $25.000 el Tren Rancagua.
- **Conductor**: *¿Qué quieres conducir?* ahora tiene cuatro opciones: Tren del Metro, Tren Nos, **Tren Rancagua** y
  Bus Red.
- **La tienda se llama Tienda RedMovi** (portada, panel, movimientos de la cuenta y textos).
- Los textos de los trenes de EFE usan su nombre («Tren Nos», «Tren Rancagua», «el Tren Rancagua») y los botones y
  letreros su sigla (NOS, RCG) en vez de «L…» (`lineTag`, `lineLabel` y `lineSign` en `js/config.js`).
- Mismas simplificaciones que el Tren Nos: 5 coches, 80 km/h y vía dibujada en trinchera. Como el recorrido es largo,
  la escena 3D del Tren Rancagua pesa unas 3 veces la del Tren Nos (~650 mil triángulos por cuadro): bien en un
  computador, puede andar más lento en celulares modestos.
- **1.16.1 · Portada más cómoda:** en el celular y la tableta en vertical, los modos de juego (Conducir, Pasajero,
  Centro de Control) aparecen justo después de la línea elegida; la hora, la tarifa y el clima quedan más abajo. Los
  botones del clima muestran ícono y nombre («Ahora» lleva el ícono del tiempo real), y el recorrido de Ida/Vuelta y
  de cada vehículo se lee entero en pantallas angostas en vez de cortarse con «…».

## Versión 1.15 · Todo conectado: Tren Nos y bus para el pasajero

- **Conductor: elige qué conducir.** La tarjeta Conductor de la portada pregunta primero *¿Qué quieres conducir?*:
  **🚇 Tren del Metro** (líneas 1 a 6), **🚆 Tren Nos** o **🚌 Bus Red** (el modo bus de la 1.13, que ya no tiene
  tarjeta aparte). El botón de línea **NOS** también elige el Tren Nos.
- **Tren Nos** (`js/engine/network.js`): una línea más de la red, de Estación Central (estación Alameda) a Nos
  pasando por Lo Valledor, Pedro Aguirre Cerda, Lo Espejo, Lo Blanco, Freire, San Bernardo, Maestranza y Cinco Pinos
  (~20 km, distancias aproximadas). Va al aire libre, con trenes X'Trapolis (`js/engine/fleet.js`). **Combina con la L1
  en Estación Central y con la L6 en Lo Valledor y Pedro Aguirre Cerda**: los viajeros se cambian de un tren al otro,
  el pasajero puede combinar a pie y el Centro de Control lo supervisa junto a las demás líneas. Para conducirlo se
  compra su licencia en la Tienda ($18.000).
  Simplificaciones: usa la composición de 5 coches del juego (el real tiene 2 o 4) y la velocidad máxima de la red
  (80 km/h; el real llega a 120), y se dibuja en trinchera (el motor todavía no tiene vía a nivel de calle).
- **Pasajero: tomar el bus.** En la calle de las estaciones de la Alameda (L1 entre Estación Central y Baquedano;
  también Los Héroes de la L2, Universidad de Chile de la L3 y Baquedano de la L5) el paradero tiene el letrero del
  recorrido **A01**. Con <kbd>E</kbd> se elige el sentido (hacia Plaza Baquedano o hacia Estación Central), se paga con
  la bip! y se sube. **Viajas sentado** mientras el bus maneja solo (`js/bus/busAutopilot.js`): para en los paraderos
  con gente o donde alguien tocó el timbre y respeta los semáforos. Toca el **timbre** (<kbd>Espacio</kbd>) antes de tu
  parada y, con las puertas abiertas, **bájate** (<kbd>E</kbd>): apareces en la calle de esa estación, junto al
  acceso al Metro. <kbd>C</kbd> cambia entre la vista desde tu asiento y desde atrás del bus.
- **Transbordo como en Santiago**: después de pagar un pasaje, en las 2 horas siguientes hay hasta 2 transbordos entre
  bus y Metro sin volver a pagar (se paga la diferencia, que en el juego es $0).
- **Multijugador**: el Centro de Control también supervisa el Tren Nos, y un conductor puede unirse a la sala con el
  Tren Nos (los dos con la 1.15). El protocolo de la sala no cambió (`NET_LEVEL` igual).
- Los textos dicen «Tren Nos» donde antes iría «L…» (combinaciones, pantallas, preguntas de ruta, letreros).
- El bus por dentro tiene asientos, pasamanos y luces. El recorrido también corre en sentido contrario
  (Plaza Baquedano → Estación Central).
- Corregido: el primer cuadro del modo bus a veces avanzaba la simulación hacia atrás y el bus quedaba fuera de la calle.

## Versión 1.14 · RedMoviSim

**MetroSim pasa a llamarse RedMoviSim, simulador del transporte público de Santiago**: Metro y buses en un mismo juego.

- **Nombre y logo propio** (`logo.svg`, `favicon.svg`, `icons/icon.svg` y sus PNG): una placa roja con dos recorridos
  que se cruzan en un nodo de combinación. No usa el logo ni la tipografía de Red ni de Metro.
- **Dominio nuevo**: **https://redmovisim.benedettowebs.cl/** en el enlace canónico, los datos estructurados,
  `robots.txt` y `sitemap.xml`. Nueva `icons/og.jpg` para compartir el enlace.
- **Portada por medio de transporte**: los modos se agrupan en **Metro** (Conductor, Pasajero a pie, Centro de Control)
  y **Buses** (Conductor de bus, antes «MicroSim»). Abajo, una nota aclara que es un proyecto independiente.
- La intro, la app instalable (PWA), el título de la página, la descripción para buscadores y el nombre del APK
  (al reconstruirlo) dicen RedMoviSim.
- **Nada se pierde**: el saldo, las licencias, la tienda y el progreso siguen guardados igual en el navegador. El APK
  mantiene su paquete (`cl.metrosim.app`), así que se actualiza encima del anterior. La sala multijugador no cambió
  (`NET_LEVEL` igual): se puede jugar entre RedMoviSim y MetroSim 1.13.
- **1.14.1**: imágenes para anunciar el mantenimiento en redes sociales en `post-mantenimiento/` (post cuadrado,
  historia vertical y versión horizontal). Se regeneran con `node generar.js plantilla.html` desde esa carpeta.

## Versión 1.13 · MicroSim: conductor de bus (beta)

Un modo nuevo en la portada, **MicroSim · Bus**, el primer paso para simular también los buses de Santiago
(código en `js/bus/`, aparte del metro):

- **Recorrido de prueba A01 por la Alameda**, de Estación Central a Plaza Baquedano (~4 km, 9 paraderos con el nombre
  del lugar real; el número de recorrido es ficticio y las distancias son aproximadas).
- **Manejo**: <kbd>W</kbd>/<kbd>S</kbd> acelerar y frenar (el pedal sube y baja de a poco), <kbd>A</kbd>/<kbd>D</kbd>
  cambiar de pista (con intermitente; no deja si el auto de al lado está ahí), <kbd>Espacio</kbd> puertas,
  <kbd>B</kbd> bocina, <kbd>C</kbd> cámara (desde atrás o desde el asiento del conductor), <kbd>Esc</kbd> pausa.
  En el celular hay botones táctiles: pedales de freno y acelerador, pistas, puertas, bocina y cámara.
- **Calle con tráfico**: pista Solo Bus junto a la vereda, dos pistas para autos, bandejón central con árboles y
  autos de vuelta al otro lado. Los autos siguen al de adelante (modelo IDM), frenan ante el bus, se cambian de pista
  si quedan atrapados y respetan los **8 semáforos** de las calles que cruzan.
- **Paraderos**: hay que detenerse en la pista Solo Bus con la puerta delantera junto al letrero azul «BUS» (una guía
  muestra la distancia a la marca), abrir las puertas y esperar que bajen y suban todos (cada uno valida su bip!).
  Con las puertas abiertas el bus no acelera (enclavamiento). La gente que espera aumenta con el tiempo y depende de la
  hora (la misma curva de demanda del metro). El **timbre de parada solicitada** se enciende cuando alguien a bordo
  quiere bajar en el próximo paradero; si nadie espera ni pidió parada, se puede seguir de largo.
- **Puntaje y sueldo**: cada paradero paga según la precisión de la parada, el horario (velocidad comercial de
  21 km/h) y los pasajeros atendidos, menos las faltas: luz roja, exceso de velocidad, frenadas bruscas con gente a
  bordo, choques, abrir fuera del paradero, saltarse un paradero o dejar gente abajo. Al final hay nota (S a D) y bono.
  **El sueldo va a la misma cuenta del Banco Andino** que el del metro.
- De día, al atardecer o de noche según la hora real, con la cordillera al fondo. Sonidos procedurales: motor diésel,
  puertas neumáticas, validador, timbre, intermitente y bocina.

## Versión 1.12 · Consola realista en el celular

Solo en pantallas de celular (en la tablet y el computador todo sigue igual):

- **Pupitre de conducción realista** (`js/touch.js`): los botones ▲ / ▼ se reemplazan por el **manipulador**, una
  palanca combinada de tracción y freno con su empuñadura en T que **se desliza por la ranura** y encaja en cada muesca
  (P4 arriba, N, B1–B3 y, tras un tope, EMERGENCIA abajo). También se puede tocar directamente una muesca de la escala.
  La palanca sigue el estado real del tren (si el sistema aplica la emergencia, baja sola a EM).
- En una placa metálica a la derecha: la **llave del inversor** (conmutador rotativo R · N · F: tocar el lado R o F la
  gira un paso), el **hongo de emergencia** rojo sobre aro amarillo (queda hundido e iluminado mientras la emergencia
  está enclavada), la **bocina** y el **pulsador iluminado de puertas** (verde «Abrir puertas»; ámbar «Cerrar puertas»
  con las puertas abiertas). La **vigilancia (hombre muerto)** y el **cambio de cabina** aparecen como pulsadores
  iluminados encima de la placa solo cuando hacen falta.
- La pantalla de conducción lleva un marco de pupitre, como el DMI de una cabina.
- **Pasajero**: botones redondos con pictograma y rótulo (Usar, Misiones, Sentarse, Agarrarse) y una palanca analógica
  con base hundida y capuchón de goma.

## Versión 1.11 · Comerciantes ambulantes y músicos

- **Músicos en los andenes** (`js/performers.js`): en muchas estaciones hay un músico junto al muro del andén, entre
  una columna y un banco, con su **guitarra, acordeón o charango**, el estuche abierto con monedas, un parlante y el
  cartel «¡Gracias por su aporte!». **Toca de verdad**: cueca, bolero, cumbia, vals peruano o música andina, con
  melodía, bajo y rasgueo (el acordeón abre y cierra el fuelle, la guitarra se rasguea). Se oye más fuerte al acercarse,
  bajito desde la mezanina, y también desde la cabina del conductor al detenerse cerca. Descansa entre canciones y
  cambia de tema. Con **E** le das una moneda (suma civismo y la moneda aparece en el estuche) y después puedes
  **pedirle otra canción**.
- **Comerciantes ambulantes en la mezanina**: en la zona no pagada, junto al muro de los tótems, uno extiende su paño
  de colores con la mercadería en filas y un cartel de cartón (maní confitado, chocolates tres por mil, audífonos,
  cargadores, calcetines, paraguas). **Pregona** con su voz cuando pasas cerca y con **E** le compras (queda en tu
  bolsa). De vez en cuando **llegan los guardias**: entra un guardia de chaleco reflectante, el comerciante enrolla el
  paño y se va a la calle con el bulto a la espalda; unos minutos después vuelve a instalarse.
- **El vendedor y el músico del coche ahora son personajes de verdad** (`js/encounters.js`): ya no es un pasajero
  cualquiera con un ícono. El **vendedor** entra desde el coche vecino con su caja de mercadería colgada al frente,
  recorre el pasillo parando cada pocos metros a pregonar y, al llegar al otro extremo, **pasa al coche siguiente** (o
  se baja en la estación si ese extremo es la cabina). El **músico** entra con su instrumento, se planta en el pasillo y
  toca el mismo repertorio que los de los andenes; en la próxima estación se baja por la puerta y se va a la calle.
- La música se arma con Web Audio (sin archivos nuevos) y los pregones usan la voz del navegador, sin cortar los
  anuncios del tren.

## Versión 1.10 · Tarifas de estudiante y adulto mayor

- **Tu fecha de nacimiento, la primera vez** (`js/rider.js`, `js/riderPanel.js`, `index.html`): antes de la primera
  partida sale la ventana «¿Cuándo naciste?» con la fecha de nacimiento y la casilla «Soy estudiante y tengo TNE». Abajo
  se ve al momento cuánto pagarás. Con «Ahora no» se juega con la tarifa general y no se vuelve a preguntar. Se guarda
  solo en el dispositivo y se cambia cuando quieras con **Cambiar** en el panel de tarifas (tocando la hora).
- **Tarifas rebajadas** (`js/config.js` → `FARES.special`), como en el tarifario de Metro, iguales a cualquier hora y día:
  - **Adulto mayor (TAM): $260**, para personas pensionadas: mujeres desde los 60 años y hombres desde los 65. Desde
    los 60 aparece la casilla «Tengo tarjeta Adulto Mayor (TAM)» (a los 65 viene marcada). La bip! Adulto Mayor ($390,
    con buses) aparece como referencia; en el juego conviene la TAM.
  - **Estudiante (TNE): $260**, todo el año.
- **Se cobra en todo el juego**: torniquetes, el aviso de saldo bajo, la boletería (tu tarifa arriba, resaltada), la
  calle, las misiones y el tutorial. La portada muestra tu precio junto al tramo («$260 TNE»). Con tarifa rebajada no
  sale la misión «Viaje económico» (ya pagas lo mínimo).
- **Arreglo del tarifario** (`js/config.js`): la hora baja de la mañana es de 06:00 a 06:59, como en la tabla oficial
  (antes, de 06:30 a 07:00 se cobraba valle).

**1.10.1 · La TAM es para todos** (`js/rider.js`, `js/riderPanel.js`): la casilla «Soy mujer: tengo TAM desde los 60»
daba a entender que la tarjeta era solo para mujeres. Ahora es «Tengo tarjeta Adulto Mayor (TAM)», aparece desde los 60
años para cualquiera, explica el requisito (mujeres desde 60, hombres desde 65, pensionados) y viene marcada a los 65.

**1.10.2 · La pantalla de carga avanza de verdad** (`js/main.js`, `index.html`, `styles.css`): la barra ya no es una
animación que va y viene: se llena con lo que lleva armado la partida (dibujo 3D, túneles y estaciones, viaductos, los
45 minutos de servicio que el motor simula para que la línea ya tenga trenes, la calle o la cabina y los materiales), con
el porcentaje y el paso actual. Lo mismo al entrar al Centro de Control y en las combinaciones entre líneas.

## Versión 1.9 · Tarifas según el horario

- **Toca la hora para ver las tarifas** (`js/fareInfo.js`, `index.html`, `js/main.js`): en la portada (el bloque
  «Hora y tarifa») y en la partida (la **HORA** del HUD, que ahora lleva un punto con el color del tramo vigente) se
  abre un panel con:
  - la hora y el tramo que se cobra ahora, cuándo cambia y cuánto más o menos costará el pasaje;
  - el precio de cada tramo (🔴 punta, 🟡 valle, 🟢 baja) y cuánto se ahorra frente a la punta;
  - una franja del día pintada por tramo, con la marca de «ahora», y la lista de horarios con su precio, para
    lunes a viernes, sábado y domingo o festivo (pestañas; parte en el tipo de día de hoy);
  - el horario de servicio de ese día y que las combinaciones no se vuelven a cobrar.
  Durante la partida la hora del panel sigue corriendo. Se cierra con ✕, **Entendido**, **Esc** o tocando fuera.

**1.9.1 · Tarifas reales 2026** (`js/config.js`): los pasajes quedan como los de Metro desde el 22 de febrero de 2026
(tarjeta bip! adulto): punta **$895**, valle **$815** y baja **$735**. Además, como en el Metro real, los sábados,
domingos y festivos se cobra **hora valle todo el día** (antes la hora baja también regía esos días). Lo siguen los
torniquetes, la boletería, el tablero de la estación, la portada y el panel de tarifas.

## Versión 1.8 · Hora y tarifa en la portada

- **Reloj en la portada** (`index.html`, `js/main.js`): junto al clima se ve la hora (la del dispositivo, la misma
  con la que arranca el juego) y el tramo tarifario vigente con su color y precio: 🔴 hora punta, 🟡 hora valle o
  🟢 hora baja. Debajo, el tipo de día y cuándo cambia el tramo («pasa a hora valle a las 20:00» o «cierra a las
  23:00»). Fuera de horario dice «Metro cerrado», a qué hora abre y que, si juegas igual, se cobra tarifa baja.
  Se actualiza solo y el chip late cuando cambia de tramo.
- **Sin hora punta los fines de semana** (`js/config.js` → `fareBandAt`): como en el Metro real, los sábados,
  domingos y festivos las horas de punta se cobran como valle. Vale para los torniquetes, la boletería y el
  tablero de tarifas de la estación, que ahora dice «lun a vie» junto a la punta.

**1.8.1 · Domingos y festivos hasta las 23:00** (`js/config.js`): el Metro cierra a las 23:00 también los domingos
y festivos (antes, 22:30), como en el horario real. La demanda de la última media hora baja de a poco hasta el cierre.

**1.8.2 · Arreglo: el juego no arrancaba** (`index.html`): al unir la 1.7.2 con la 1.8 se perdió el panel de las
pantallas de cabina ampliadas (y su tecla **P** en la portada); sin él, la partida quedaba en negro al empezar.

**1.8.3 · La intro sale al instante** (`js/boot.js`, `js/intro.js`): antes se veía la portada un momento y después
empezaba la intro, porque la arrancaba `main.js` cuando ya había bajado Three.js y armado el juego. Ahora la página
abre con la portada oculta y un arranque liviano (`boot.js`) lanza la intro de inmediato mientras el juego carga
detrás; la portada aparece al terminar la intro (si la conexión es lenta, la intro espera a que el juego esté listo).

## Versión 1.7 · Maniobra de retorno real

Al final de la línea el tren ya no salta de vía: hace la maniobra como en el Metro de verdad.

- **Por pasos, con un panel que guía** (`js/main.js`):
  1. *Asegurar el tren* en el cartel FIN DE MANIOBRA: detenido, puertas cerradas, freno aplicado e inversor en N.
     **T** retira la llave.
  2. *Ir a la otra cabina* por dentro del tren vacío: caminando (**W** caminar · **S** detenerse · **Shift** correr,
     con pasos y vaivén) o con el recorrido automático (**T** otra vez).
  3. *Activar la cabina nueva*: inversor ADELANTE y prueba de frenos (soltar a FRENO 1 y volver a FRENO 3). Hasta
     entonces no hay tracción.
  4. *Maniobrar*: esperar la señal de maniobra (verde o amarillo), cruzar el cambio de vía (máx. 30 km/h) y parar en la marca
     del andén de salida.
- **El tren cruza las agujas de verdad**: mientras cruza se dibuja articulado y cada coche sigue el cambio de vía de
  una vía a la otra (`js/train.js`, `js/render/trainViews.js`, `trackXAt` en `js/engine/traffic.js`). Los trenes
  automáticos hacen lo mismo.
- **Señal de maniobra** (S…00, una señal baja entre las vías antes del cambio de vía) y **enclavamientos**: autoriza a
  avanzar hasta la señal de entrada de la terminal (amarillo si el andén aún está ocupado); no abre mientras otro tren
  entre a la cola de la vía contraria; mientras un tren cruzando ocupe la cola de llegada, la señal de salida de esa
  terminal queda en rojo y el tren siguiente espera en el andén (`js/engine/signals.js`, `js/engine/traffic.js`).
- Los trenes automáticos salen de la cola apenas el andén de salida queda libre y esperan su hora en el andén. Para
  que la terminal dé abasto con trenes cada 2 minutos (L1), cambian de cabina con un **conductor de relevo** que espera
  en la cola (20 s), el tren se detiene en la cola lo justo para dejar libres las agujas (195 m tras la terminal) y
  la cola y el cambio de vía se recorren a 30 km/h. El tren que vuelve toma el primer servicio pendiente del andén
  de salida y no se saca otro de cocheras mientras viene uno de vuelta; fuera de punta, si el próximo servicio sale en
  más de 4 minutos, el tren se retira a cocheras.
- En el multijugador, el estado de cruce se replica a los demás jugadores.
- Tu librea se conserva tras el cambio de cabina.

**1.7.1 · Voz de bienvenida mejorada** (`js/intro.js`, `js/audio.js`)

- La bienvenida espera a que el navegador cargue sus voces (antes, en Chrome, la primera vez salía la voz por defecto,
  más robótica) y elige mejor: suma las voces *Premium/Mejoradas* de Apple y descarta las de baja calidad (eSpeak).
- Habla en frases cortas con pausas y ritmo de locutora: saludo según la hora («Buenos días / Buenas tardes / Buenas
  noches»), «Te damos la bienvenida a MetroSim, el simulador del Metro de Santiago».
- El gong de entrada tiene armónicos suaves (suena a campana) y la voz entra cuando se apaga.
- Grabación propia opcional: si `audio/voz/manifest.json` incluye `bienvenida`, suena `audio/voz/bienvenida.mp3`
  con un filtro de altavoz en vez de la voz sintetizada.

**1.7.2 · Pantallas de cabina legibles** (`js/dmi.js`, `js/main.js`, `js/train.js`)

- Las dos pantallas del pupitre (DMI y estado del tren) ya no quedan en negro: muestran una pantalla de arranque
  antes del primer dibujo y, si el navegador descarta el canvas (Chrome en Android, al volver de segundo plano o con
  poca memoria), conservan el último cuadro en vez de subir uno vacío.
- Más contraste: fondo un poco más claro, rótulos grises más luminosos y la letra más chica sube de 12 a 13 px;
  textura con filtrado anisótropo al máximo de la GPU (más nítida vista en ángulo).
- **Toca una pantalla** (o **P**) para verlas en grande: se dibujan directo a la resolución del dispositivo, con el
  texto nítido, y se siguen actualizando en vivo. Toca de nuevo (o **P** / **Esc**) para cerrar.

## Versión 1.6 · Asistente de parada

Ayudas para no pasarse de la estación (`js/engine/stopAssist.js`; se activan o desactivan con **N**):

- **Parada prevista**: la barra de precisión (HUD y DMI) muestra con un **anillo** dónde se detendría el tren con
  el freno actual, calculado con la misma física del simulador (jerk, carga, pendiente y riel mojado). Escala
  amplia (±50 m) al acercarse y fina (±10 m) en los últimos 60 m.
- **Avisos de frenado**: «Prepárate para frenar», «¡FRENA YA! · FRENO 2», «Te pasarías X m · sube el freno»,
  «Te quedarías X m antes · afloja» (solo si el punto más suave también alcanza) y «¡TE PASAS!» si ni con FRENO 3
  se alcanza. Con su sonido en cabina.
- **Pitidos** cada vez más seguidos en los últimos 15 m (más agudos dentro de la tolerancia) y una campanilla al
  quedar en la marca.
- **Letreros de aproximación** amarillos a 300, 200, 100 y 50 m de cada marca de parada, en ambos sentidos.
- Al detenerse fuera de posición, el mensaje dice si te pasaste o te quedaste antes, cuántos metros y cómo
  corregirlo; la estación rebasada sigue siendo el objetivo hasta 60 m.

### 1.6.1 · Visibilidad en Google

- Título y descripción de la página pensados para búsquedas («simulador del Metro de Santiago»), con las 7 líneas.
- Enlace canónico, `robots` y datos estructurados schema.org (`VideoGame`/`WebApplication`, gratis, multijugador).
- `robots.txt` y `sitemap.xml` en la raíz para que Google descubra y rastree el sitio.
- Texto `<noscript>` que describe el juego para buscadores sin JavaScript; etiquetas de X/Twitter completas.

### 1.6.2 · Dominio propio e imagen para compartir

- Enlace canónico, datos estructurados, `robots.txt` y `sitemap.xml` apuntan al dominio **https://metrosim.app/**.
- Nueva `icons/og.jpg` (1200×630, vista previa al compartir el enlace) con la intro de la versión actual.

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
  fecha de tu computador. Horario comercial: L–V 06:00–23:00, sábado 06:30–23:00, domingo y festivos 07:30–23:00
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
- **Centro de Control:** eres jefe de turno del PCC. Supervisas una línea, tres o toda la red en un esquema en tiempo real, atiendes las alarmas (señales averiadas, trenes detenidos en la vía, fallas de puertas, trenes atrasados) y das órdenes a los trenes: retener, liberar, saltar una parada o retirar del servicio. Controlas la regulación de intervalos de cada línea y la velocidad del tiempo; al terminar el turno recibes una nota y tu sueldo.
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
navegador se pueden dar las mismas órdenes que el Centro de Control:

```
MetroSim.game.engine.command("control.hold",      { trainId: "L3-1405" })              // retener en su próxima estación
MetroSim.game.engine.command("control.hold",      { trainId: "L3-1405", seconds: 60 }) // …durante 60 s
MetroSim.game.engine.command("control.release",   { trainId: "L3-1405" })              // liberarlo
MetroSim.game.engine.command("control.skip",      { trainId: "L3-1405" })              // pasar sin parar por la próxima parada
MetroSim.game.engine.command("control.withdraw",  { trainId: "L3-1405" })              // retirarlo del servicio
MetroSim.game.engine.command("control.authorize", { trainId: "L3-1405" })              // rebasar en marcha a la vista una señal averiada
MetroSim.game.engine.command("control.resume",    { trainId: "L3-1405" })              // seguir tras una detención en la vía
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

Y el multijugador, también sin gráficos (un PCC y un conductor en dos hilos):

```
node tools/probar-red.mjs           # 20 min en la Línea 3
node tools/probar-red.mjs 30 1      # 30 min en la Línea 1
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
  controlCenter.js    esquema de la red, ficha de tren, alarmas, órdenes, tiempo, informe del turno
  alarms.js           mesa de alarmas (incidentes que piden una decisión) y nota del turno
  controlTutorial.js  pasos del tutorial del Centro de Control
js/net/               multijugador (sala del Centro de Control con conductores)
  transport.js        conexión entre navegadores con código de sala (Trystero; ?red=local para dos pestañas)
  replica.js          estado de los trenes de una línea y cómo se aplica en el motor de otro jugador
  netHost.js          sala del PCC: reserva servicios, manda el estado, radio a los conductores
  netClient.js        conductor en una sala: motor réplica, radio del PCC, sin conexión sigue solo
js/encounters.js      encuentros del Pasajero con otros viajeros (asiento, turista, objeto, vendedor, músico, citófono)
js/performers.js      músicos de los andenes y comerciantes de la mezanina; instrumentos, música y guardias
js/routeQuiz.js       preguntas de ruta del turista (con la red real)
js/civics.js          civismo del Pasajero: puntos, niveles y objeto olvidado que llevas
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
tools/probar-red.mjs  prueba el multijugador sin navegador (PCC y conductor en dos hilos)
```

Las distancias entre estaciones son aproximadas; los nombres, el orden y las combinaciones son los reales.
