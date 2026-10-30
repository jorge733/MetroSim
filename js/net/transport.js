/* ==========================================================================
   MetroSim — Multijugador · transport.js
   Conexión entre jugadores, con un código de sala de 4 letras.

     · Normal: WebRTC directo entre los navegadores con Trystero (se carga
       del CDN solo al abrir o unirse a una sala). Para encontrarse usa a la
       vez DOS vías (STRATEGIES), cada una con varios servidores públicos:
       Nostr y rastreadores de WebTorrent. Si una falla, sirve la otra; el
       conductor se queda con la primera que le presenta al Centro de
       Control. Los datos del juego van directo entre los jugadores (o por un
       servidor TURN si la red no deja conectar directo).
     · ?red=local: BroadcastChannel, para probar en dos pestañas del mismo
       navegador sin internet.

   Las dos dan la misma conexión: { send(obj), onmessage, onclose, close() }.
   ========================================================================== */

/** Vías para encontrarse: módulo de Trystero, sufijo de la sala y cuántos servidores de cada una a la vez. */
const STRATEGIES = [
  { id: "nostr", url: "https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.25.4/+esm", suffix: "", relays: 6 },
  { id: "torrent", url: "https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent@0.25.4/+esm", suffix: "-t", relays: 4 },
];
/**
 * Servidores TURN públicos: retransmiten cuando la red no deja conectar directo (datos móviles,
 * redes de empresa). El del puerto 443 por TCP pasa la mayoría de los cortafuegos.
 */
const TURN = [
  { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
];
/** Texto cuando los dos se encontraron pero la conexión directa no se logró. */
const NO_DIRECT = "la conexión directa entre los dos equipos no se logró (la red la bloquea). Prueben con los dos en la misma red Wi-Fi, o con el celular en Wi-Fi en vez de datos móviles";
/** Nombre del canal en el modo local (?red=local). */
const PREFIX = "metrosim-sala-";
/** Versión de la red (se muestra para comprobar que los dos jugadores tienen la misma). */
export const NET_LEVEL = 3;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";       // sin I ni O (se confunden con 1 y 0)
/** Tiempo para encontrar al Centro de Control al unirse. */
const JOIN_TIMEOUT = 30000;

/** ¿Probar en el mismo navegador (dos pestañas)? */
export const localNetwork = () => {
  try { return new URLSearchParams(location.search).get("red") === "local"; } catch { return false; }
};

/**
 * Servidores de prueba en la dirección: ?relay=ws://… (Nostr) y ?tracker=ws://… (WebTorrent).
 * Si hay alguno, solo se usan esas vías y esos servidores.
 */
function testServers() {
  try {
    const q = new URLSearchParams(location.search);
    const t = { nostr: q.get("relay"), torrent: q.get("tracker") };
    return t.nostr || t.torrent ? t : null;
  } catch { return null; }
}

/** Configuración de Trystero para una vía. */
function roomConfig(strategy) {
  const test = testServers()?.[strategy.id];
  return { appId: "metrosim.app", turnConfig: TURN, relayConfig: test ? { urls: [test] } : { redundancy: strategy.relays } };
}

/** Vías activas: todas, o las que tienen servidor de prueba. */
function activeStrategies() {
  const test = testServers();
  return STRATEGIES.filter(x => !test || test[x.id]);
}

/** Servidores para encontrarse conectados / en total, de todas las vías cargadas. */
function relayCounts(loaded) {
  let open = 0, total = 0;
  for (const { T } of loaded) {
    for (const ws of Object.values(T.getRelaySockets?.() ?? {})) { total++; if (ws.readyState === 1) open++; }
  }
  return { open, total };
}

/** Código nuevo de sala (4 letras). */
export function newRoomCode() {
  return Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
}

/** Normaliza lo que escribe el jugador ("ab c d" → "ABCD"); null si no sirve. */
export function cleanRoomCode(text) {
  const code = String(text || "").toUpperCase().replace(/[^A-Z]/g, "");
  return code.length === 4 ? code : null;
}

/** Una conexión con el otro jugador. */
class Link {
  constructor(send, close) {
    this.sendRaw = send;
    this.closeRaw = close;
    this.onmessage = () => {};
    this.onclose = () => {};
    this.open = true;
  }
  send(msg) { if (this.open) { try { this.sendRaw(msg); } catch { /* se cerró */ } } }
  receive(msg) { if (this.open) this.onmessage(msg); }
  closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose();
  }
  close() {
    if (!this.open) return;
    try { this.closeRaw(); } catch { /* ya cerrada */ }
    this.closed();
  }
}

/**
 * Abre una sala con un código nuevo (en todas las vías para encontrarse).
 * @param {(link: Link) => void} onJoin  llega un jugador
 * @param {(online: boolean, changed: boolean) => void} [onStatus]  la sala se ve (o no) en los servidores para encontrarse
 * @returns {Promise<{ code, online, detail, failed, retry(), close() }>}
 */
export async function hostRoom(onJoin, onStatus = () => {}) {
  if (localNetwork()) return hostLocal(onJoin);
  const loaded = await loadStrategies();
  const code = newRoomCode();
  const info = { code, online: true, detail: null, failed: null };
  const links = new Map();                 // "vía:id del conductor" → conexión
  const rooms = loaded.map(({ strategy, T }) => {
    // Alguien encontró la sala pero no se pudo conectar con él
    const room = T.joinRoom(roomConfig(strategy), code + strategy.suffix, {
      onJoinError: (e) => { console.warn("[MetroSim sala]", strategy.id, e.error); info.failed = `Alguien intentó unirse, pero ${NO_DIRECT}`; onStatus(info.online, false); },
    });
    const msg = room.makeAction("m");
    const key = (id) => `${strategy.id}:${id}`;
    // Se presenta como el Centro de Control (los conductores también se ven entre ellos, pero solo hablan con él)
    room.onPeerJoin = (id) => msg.send({ type: "__host" }, { target: id });
    room.onPeerLeave = (id) => { links.get(key(id))?.closed(); links.delete(key(id)); };
    msg.onMessage = (m, { peerId }) => {
      const k = key(peerId);
      if (m?.type === "__driver") {
        if (links.has(k)) return;
        const link = new Link((x) => msg.send(x, { target: peerId }), () => { links.delete(k); msg.send({ type: "__bye" }, { target: peerId }); });
        links.set(k, link);
        info.failed = null;
        return onJoin(link);
      }
      if (m?.type === "__bye") { links.get(k)?.closed(); links.delete(k); return; }
      links.get(k)?.receive(m);
    };
    return room;
  });
  // Estado: ¿hay algún servidor para encontrarse conectado?
  const check = () => {
    const { open, total } = relayCounts(loaded);
    info.detail = `${open} de ${total} servidores para encontrarse conectados (${loaded.map(x => x.strategy.id).join(" + ")})`;
    const online = open > 0;
    if (online !== info.online) { info.online = online; onStatus(online, true); }
  };
  const timer = setInterval(check, 3000);
  setTimeout(check, 1500);
  return Object.assign(info, {
    retry: () => { for (const { T } of loaded) { try { T.resumeRelayReconnection?.(); } catch { /* sin reconexión manual */ } } check(); },
    close: () => { clearInterval(timer); links.forEach(l => l.close()); rooms.forEach(r => r.leave()); },
  });
}

/**
 * Se une a una sala: busca al Centro de Control que la abrió, por todas las
 * vías a la vez, y se queda con la primera que lo encuentra.
 * @returns {Promise<Link>}
 */
export async function joinRoom(code) {
  if (localNetwork()) return joinLocal(code);
  const loaded = await loadStrategies();
  let failed = null;                       // se encontró a alguien en la sala, pero no se pudo conectar
  return new Promise((resolve, reject) => {
    let done = false;
    const rooms = [];
    const timer = setTimeout(() => {
      done = true;
      rooms.forEach(r => r.leave());
      const { open } = relayCounts(loaded);
      reject(new Error(failed ? `La sala ${code} existe, pero ${NO_DIRECT}`
        : open ? `No se encontró la sala ${code}. Revisa el código y que el Centro de Control siga con la sala abierta (👥 Sala en verde) y su pantalla encendida. Recarguen los dos la página para tener la misma versión (red v${NET_LEVEL})`
        : "Sin conexión con los servidores para encontrarse: revisa tu internet"));
    }, JOIN_TIMEOUT);
    for (const { strategy, T } of loaded) {
      const room = T.joinRoom(roomConfig(strategy), code + strategy.suffix, {
        onJoinError: (e) => { console.warn("[MetroSim sala]", strategy.id, e.error); failed = e.error; },
      });
      rooms.push(room);
      const msg = room.makeAction("m");
      let host = null, link = null;
      msg.onMessage = (m, { peerId }) => {
        if (m?.type === "__host" && !host) {
          if (done) return;
          done = true;
          host = peerId;
          clearTimeout(timer);
          for (const r of rooms) if (r !== room) r.leave();    // las otras vías ya no hacen falta
          link = new Link((x) => msg.send(x, { target: host }), () => { msg.send({ type: "__bye" }, { target: host }); setTimeout(() => room.leave(), 300); });
          msg.send({ type: "__driver" }, { target: host });
          addEventListener("pagehide", () => link.close());      // al cerrar la página, el PCC se entera al tiro
          return resolve(link);
        }
        if (!link || peerId !== host) return;                 // otros conductores de la sala
        if (m?.type === "__bye") { link.closed(); room.leave(); return; }
        link.receive(m);
      };
      room.onPeerLeave = (id) => { if (link && id === host) { link.closed(); room.leave(); } };
    }
  });
}

/** Carga las vías de Trystero del CDN (una sola vez); sirven las que carguen. */
let strategiesLoading = null;
function loadStrategies() {
  strategiesLoading ??= Promise.allSettled(activeStrategies().map(strategy => import(strategy.url).then(T => ({ strategy, T }))))
    .then(results => {
      const loaded = results.filter(r => r.status === "fulfilled").map(r => r.value);
      results.filter(r => r.status === "rejected").forEach(r => console.warn("[MetroSim sala] no cargó una vía:", r.reason));
      if (!loaded.length) { strategiesLoading = null; throw new Error("Sin internet: el multijugador necesita conexión"); }
      return loaded;
    });
  return strategiesLoading;
}

/* ----- Modo local (dos pestañas del mismo navegador) ----- */

function hostLocal(onJoin) {
  const code = newRoomCode();
  const ch = new BroadcastChannel(PREFIX + code);
  const links = new Map();
  ch.onmessage = ({ data: d }) => {
    if (d.to !== "host") return;
    if (d.kind === "hello") {
      const link = new Link((m) => ch.postMessage({ to: d.from, kind: "msg", m }), () => ch.postMessage({ to: d.from, kind: "bye" }));
      links.set(d.from, link);
      ch.postMessage({ to: d.from, kind: "welcome" });
      onJoin(link);
    } else if (d.kind === "msg") links.get(d.from)?.receive(d.m);
    else if (d.kind === "bye") { links.get(d.from)?.closed(); links.delete(d.from); }
  };
  addEventListener("pagehide", () => links.forEach(l => l.close()));
  return { code, close: () => { links.forEach(l => l.close()); ch.close(); } };
}

function joinLocal(code) {
  const ch = new BroadcastChannel(PREFIX + code);
  const me = Math.random().toString(36).slice(2);
  const link = new Link((m) => ch.postMessage({ to: "host", from: me, kind: "msg", m }), () => { ch.postMessage({ to: "host", from: me, kind: "bye" }); ch.close(); });
  addEventListener("pagehide", () => link.close());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ch.close(); reject(new Error(`No existe la sala ${code} (¿está abierta en otra pestaña?)`)); }, 3000);
    ch.onmessage = ({ data: d }) => {
      if (d.to !== me) return;
      if (d.kind === "welcome") { clearTimeout(timer); resolve(link); }
      else if (d.kind === "msg") link.receive(d.m);
      else if (d.kind === "bye") { link.closed(); ch.close(); }
    };
    ch.postMessage({ to: "host", from: me, kind: "hello" });
  });
}
