/* ==========================================================================
   MetroSim — Multijugador · transport.js
   Conexión entre jugadores, con un código de sala de 4 letras.

     · Normal: WebRTC directo entre los navegadores con Trystero (se carga
       del CDN solo al abrir o unirse a una sala). Para encontrarse usa a la
       vez varios servidores públicos de Nostr (RELAYS): si uno falla, sirven
       los otros. Los datos del juego van directo entre los jugadores (o por
       un servidor TURN si la red no deja conectar directo).
     · ?red=local: BroadcastChannel, para probar en dos pestañas del mismo
       navegador sin internet.

   Las dos dan la misma conexión: { send(obj), onmessage, onclose, close() }.
   ========================================================================== */

const TRYSTERO_URL = "https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.25.4/+esm";
/** Servidores para encontrarse usados a la vez (si alguno falla, bastan los demás). */
const RELAYS = 6;
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
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";       // sin I ni O (se confunden con 1 y 0)
/** Tiempo para encontrar al Centro de Control al unirse. */
const JOIN_TIMEOUT = 30000;

/** ¿Probar en el mismo navegador (dos pestañas)? */
export const localNetwork = () => {
  try { return new URLSearchParams(location.search).get("red") === "local"; } catch { return false; }
};

/** Configuración de Trystero (?relay=wss://… usa solo ese servidor, para pruebas). */
function roomConfig() {
  let relay = null;
  try { relay = new URLSearchParams(location.search).get("relay"); } catch { /* sin dirección */ }
  return { appId: "metrosim.app", turnConfig: TURN, relayConfig: relay ? { urls: [relay] } : { redundancy: RELAYS } };
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
 * Abre una sala con un código nuevo.
 * @param {(link: Link) => void} onJoin  llega un jugador
 * @param {(online: boolean, changed: boolean) => void} [onStatus]  la sala se ve (o no) en los servidores para encontrarse
 * @returns {Promise<{ code, online, detail, retry(), close() }>}
 */
export async function hostRoom(onJoin, onStatus = () => {}) {
  if (localNetwork()) return hostLocal(onJoin);
  const T = await loadTrystero();
  const code = newRoomCode();
  const info = { code, online: true, detail: null, failed: null };
  // Alguien encontró la sala pero no se pudo conectar con él
  const room = T.joinRoom(roomConfig(), code, {
    onJoinError: (e) => { console.warn("[MetroSim sala]", e.error); info.failed = `Alguien intentó unirse, pero ${NO_DIRECT}`; onStatus(info.online, false); },
  });
  const msg = room.makeAction("m");
  const links = new Map();                 // conductor (id de Trystero) → conexión
  room.onPeerJoin = (id) => {
    // Se presenta como el Centro de Control (los conductores también se ven entre ellos, pero solo hablan con él)
    msg.send({ type: "__host" }, { target: id });
  };
  room.onPeerLeave = (id) => { links.get(id)?.closed(); links.delete(id); };
  msg.onMessage = (m, { peerId }) => {
    if (m?.type === "__driver") {
      if (links.has(peerId)) return;
      const link = new Link((x) => msg.send(x, { target: peerId }), () => { links.delete(peerId); msg.send({ type: "__bye" }, { target: peerId }); });
      links.set(peerId, link);
      info.failed = null;
      return onJoin(link);
    }
    if (m?.type === "__bye") { links.get(peerId)?.closed(); links.delete(peerId); return; }
    links.get(peerId)?.receive(m);
  };
  // Estado: ¿hay algún servidor para encontrarse conectado?
  const check = () => {
    const sockets = Object.values(T.getRelaySockets?.() ?? {});
    const open = sockets.filter(ws => ws.readyState === 1).length;
    const online = open > 0;
    info.detail = `${open} de ${sockets.length} servidores para encontrarse conectados`;
    if (online !== info.online) { info.online = online; onStatus(online, true); }
  };
  const timer = setInterval(check, 3000);
  setTimeout(check, 1500);
  return Object.assign(info, {
    retry: () => { try { T.resumeRelayReconnection?.(); } catch { /* sin reconexión manual */ } check(); },
    close: () => { clearInterval(timer); links.forEach(l => l.close()); room.leave(); },
  });
}

/**
 * Se une a una sala: busca al Centro de Control que la abrió.
 * @returns {Promise<Link>}
 */
export async function joinRoom(code) {
  if (localNetwork()) return joinLocal(code);
  const T = await loadTrystero();
  let failed = null;                       // se encontró a alguien en la sala, pero no se pudo conectar
  const room = T.joinRoom(roomConfig(), code, { onJoinError: (e) => { console.warn("[MetroSim sala]", e.error); failed = e.error; } });
  const msg = room.makeAction("m");
  return new Promise((resolve, reject) => {
    let host = null, link = null;
    const timer = setTimeout(() => {
      room.leave();
      const sockets = Object.values(T.getRelaySockets?.() ?? {});
      reject(new Error(failed ? `La sala ${code} existe, pero ${NO_DIRECT}`
        : sockets.some(ws => ws.readyState === 1)
        ? `No se encontró la sala ${code}. Revisa el código y que el Centro de Control siga con la sala abierta (👥 Sala en verde) y su pantalla encendida`
        : "Sin conexión con los servidores para encontrarse: revisa tu internet"));
    }, JOIN_TIMEOUT);
    msg.onMessage = (m, { peerId }) => {
      if (m?.type === "__host" && !host) {
        host = peerId;
        clearTimeout(timer);
        link = new Link((x) => msg.send(x, { target: host }), () => { msg.send({ type: "__bye" }, { target: host }); setTimeout(() => room.leave(), 300); });
        msg.send({ type: "__driver" }, { target: host });
        addEventListener("pagehide", () => link.close());      // al cerrar la página, el PCC se entera al tiro
        return resolve(link);
      }
      if (peerId !== host) return;                     // otros conductores de la sala
      if (m?.type === "__bye") { link.closed(); room.leave(); return; }
      link.receive(m);
    };
    room.onPeerLeave = (id) => { if (id === host && link) { link.closed(); room.leave(); } };
  });
}

/** Carga Trystero del CDN una sola vez. */
let trysteroLoading = null;
function loadTrystero() {
  trysteroLoading ??= import(TRYSTERO_URL).catch(() => {
    trysteroLoading = null;
    throw new Error("Sin internet: el multijugador necesita conexión");
  });
  return trysteroLoading;
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
