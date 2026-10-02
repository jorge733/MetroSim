# MetroSim

Simulador ferroviario 3D de la **Línea 3 del Metro de Santiago** para navegador, hecho con HTML, CSS, JavaScript y [Three.js](https://threejs.org/).

Conductor y pasajero comparten el mismo mundo: los mismos trenes, señales, horarios y viajeros.

## Cómo ejecutarlo

Los módulos ES necesitan un servidor local (no funciona abriendo `index.html` con doble clic).

- **VS Code:** extensión *Live Server* → clic derecho en `index.html` → *Open with Live Server*.
- **Node:** `npx serve .` y abrir la dirección que indique.

Three.js se carga desde CDN, así que hace falta conexión a internet.

## Modos

- **Conductor:** conduces el servicio L3-0801 desde la cabina respetando señales, límites y horario.
- **Pasajero a pie:** eliges estación, esperas el tren, subes, viajas y bajas donde quieras.

## Controles

| Tecla | Conductor | Pasajero a pie |
|---|---|---|
| W / ↑ · S / ↓ | Subir / bajar mando (P4 … EM) | Caminar |
| A · D | — · Puertas | Caminar |
| Q · E | Inversor adelante / atrás | — · Salir por un acceso |
| Espacio | Freno de emergencia | — |
| F | — | Sentarse / levantarse |
| V · C | Vista exterior · centrar vista | — |
| M · H | Sonido · ayuda | Sonido · ayuda |

## Estructura

```
index.html      pantallas y HUD
styles.css      estilos
js/main.js      punto de entrada: une todos los sistemas
js/config.js    línea, estaciones, mando, demanda
js/schedule.js  horarios
js/signals.js   señalización de bloqueo automático
js/sim.js       física del tren y conducción automática
js/traffic.js   todos los trenes de la línea
js/world.js     túnel, vía, catenaria y estaciones
js/train.js     modelo 3D del tren y cabina
js/dmi.js       pantalla de cabina
js/people.js    viajeros (NPC)
js/walker.js    pasajero a pie
js/audio.js     sonido procedural y megafonía
js/camera.js    vistas del conductor
js/hud.js       interfaz
js/utils.js     utilidades y texturas procedurales
```

Las distancias entre estaciones son aproximadas; los nombres, el orden y las combinaciones son los reales.
