/* ==========================================================================
   MetroSim — Centro de Control · controlTutorial.js
   Pasos del tutorial del Puesto Central de Control (los muestra la tarjeta
   de tutorial.js, la misma del Conductor y el Pasajero).

   Cada paso avanza solo cuando el jugador hace lo que se le pide (elegir una
   línea, tocar un tren, retenerlo, acelerar el tiempo, atender una alarma).
   Para practicar con las alarmas, el tutorial PROVOCA una falla de señal y
   una detención en plena vía en una línea supervisada (incidents.force).

   c = { ui, engine, desk, mem }   (ui = ControlCenter)
   ========================================================================== */

/** Provoca un incidente delante de un tren en marcha de una línea supervisada; devuelve su alarma. */
function practice(c, kind) {
  const ids = [c.ui.view !== "all" ? c.ui.view : null, ...c.ui.lines].filter(Boolean);
  for (const id of ids) {
    const ls = c.engine.line(id);
    const trains = ls.trains.filter(u => u.ato?.state === "running" && !u.ato.lineStop && !u.ato.outOfService && u.sim.speed > 8
      && u.ato.targetIndex >= 2 && u.ato.targetIndex <= u.route.stations.length - 3 && u.sim.position - u.ato.target.stopZ > 900);
    // Mejor uno que no tenga ya una alarma
    trains.sort((a, b) => !!c.desk.forTrain(a) - !!c.desk.forTrain(b));
    for (const u of trains) {
      const before = c.desk.alarms.length;
      if (!ls.incidents.force(kind, u)) continue;
      const alarm = c.desk.alarms.slice(before).find(a => a.kind === kind);
      if (!alarm) continue;
      c.ui.setSpeed(1);
      c.ui.setView(id);
      c.ui.select(u.id);
      c.ui.setTab("alarms");
      return alarm;
    }
  }
  return null;
}

export function controlSteps(k) {
  return [
    {
      title: "Bienvenido al PCC",
      text: "Eres jefe de turno del Puesto Central de Control del Metro. No conduces: vigilas la red en tiempo real y das órdenes a los trenes automáticos para que la gente llegue a tiempo.",
      next: true,
    },
    {
      title: "El esquema de la línea",
      text: "Cada franja es una línea con sus dos vías: arriba la ida y abajo la vuelta. Los rectángulos son trenes, con su color según lo que hacen (mira la leyenda). Las estaciones se pintan de amarillo o naranja cuando hay mucha gente esperando.",
      focus: [".pcc-lines", ".pcc-legend"],
      next: true,
    },
    {
      title: "Mira una línea en grande",
      text: `Arriba tienes un botón por cada línea que supervisas. Toca uno para verla en grande, con los nombres de las estaciones${k(" (o pulsa su número: 1, 2, 3…)", "")}.`,
      focus: [".pcc-views"],
      done: (c) => c.ui.view !== "all",
    },
    {
      title: "Selecciona un tren",
      text: `Toca un tren del esquema. ${k("Al pasar el ratón por encima verás qué hace.", "")}`,
      focus: [".pcc-lines"],
      done: (c) => !!(c.ui.selected && c.engine.findTrain(c.ui.selected)),
    },
    {
      title: "La ficha del tren",
      text: "Aquí ves hacia dónde va, dónde está, su retraso, cuánta gente lleva y su próxima parada. Debajo están tus órdenes: cada botón explica qué hace.",
      focus: [".pcc-train"],
      next: true,
    },
    {
      title: "Retén un tren",
      text: "Retener deja al tren con las puertas abiertas en su próxima estación (sigue subiendo gente). Sirve para separar trenes que van muy juntos. Pulsa «Retener 30 s».",
      focus: [".pcc-train"],
      done: (c) => c.ui.did.has("control.hold"),
    },
    {
      title: "Controla el tiempo",
      text: `Puedes pausar${k(" (Espacio)", "")} o acelerar el tiempo ×2, ×5 o ×10 cuando todo está tranquilo. Prueba a acelerar.`,
      focus: [".pcc-time"],
      done: (c) => c.ui.speed > 1,
    },
    {
      title: "¡Una señal averiada!",
      text: "Una señal se averió y quedó en ROJO: los trenes se detienen ante ella. Mira la alarma de la derecha y pulsa «Autorizar paso»: el tren seguirá a 20 km/h (marcha a la vista). Si el cantón está ocupado por otro tren, espera a que lo deje libre.",
      enter: (c) => { c.mem.signal = practice(c, "signalFault"); return !!c.mem.signal; },
      live: (c) => c.mem.signal ? (c.mem.signal.waiting?.length ? `Esperan tu autorización: ${c.mem.signal.waiting.map(t => t.id).join(", ")}` : "") : "Buscando un tren en marcha…",
      focus: [".pcc-alarms"],
      done: (c) => !!c.mem.signal?.actedAt,
    },
    {
      title: "Un tren detenido en la vía",
      text: "Ahora un tren se detuvo entre dos estaciones (un aviso de objeto en la vía o la alarma de un pasajero). Sin tu autorización tardará minutos en seguir. Pulsa «Autorizar que siga».",
      enter: (c) => { c.mem.stop = practice(c, "lineStop"); return !!c.mem.stop; },
      live: (c) => c.mem.stop ? "" : "Buscando un tren en marcha…",
      focus: [".pcc-alarms"],
      done: (c) => !!c.mem.stop?.actedAt,
    },
    {
      title: "Otras alarmas",
      text: "Una falla de puertas atrasa al tren en cada parada: puedes retirarlo del servicio (bajan todos en la próxima estación) o mantenerlo. Un tren muy atrasado puede saltarse su próxima parada para recuperar tiempo. La regulación automática de cada línea separa sola a los trenes; si la apagas, te toca a ti.",
      focus: [".pcc-alarms"],
      next: true,
    },
    {
      title: "Trenes y registro",
      text: "En «Trenes» tienes la lista ordenada por retraso o por carga (tócala para seleccionar uno) y en «Registro», todo lo que pasó en el turno.",
      focus: [".pcc-tabs"],
      next: true,
    },
    {
      title: "Tu nota del turno",
      text: "La nota sube con trenes puntuales y alarmas atendidas rápido, y baja con cada segundo que un tren te espera detenido. «Terminar turno» muestra el informe y cobra tu sueldo. ¡Buen turno!",
      focus: [".pcc-score", ".pcc-end"],
      next: "Terminar",
    },
  ];
}
