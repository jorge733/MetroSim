/* ==========================================================================
   MetroSim — Multijugador · transport.js
   Conexión entre jugadores, con un código de sala de 4 letras.

     · Normal: WebRTC entre los navegadores con PeerJS (se carga del CDN solo
       al abrir o unirse a una sala). El servidor público de PeerJS solo
       presenta a los jugadores; después los datos van directo entre ellos.
     · ?red=local: BroadcastChannel, para probar en dos pestañas del mismo
       navegador sin internet.

   Las dos dan la misma conexión: { send(obj), onmessage, onclose, close() }.
   ========================================================================== */

const PEER_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const PREFIX = "metrosim-sala-";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";       // sin I ni O (se confunden con 1 y 0)
const TIMEOUT = 12000;
/** Para unirse: intentos si el servidor no encuentra la sala (el anfitrión puede estar reconectándose) y espera total. */
const JOIN_TRIES = 4, JOIN_RETRY = 2500, JOIN_TIMEOUT = 25000;

/** ¿Probar en el mismo navegador (dos pestañas)? */
export const localNetwork = () => {
  try { return new URLSearchParams(location.search).get("red") === "local"; } catch { return false; }
};

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
 * Abre una sala. Si el código ya está en uso, prueba con otro.
 * Mientras esté abierta, se mantiene anunciada en el servidor de salas: si
 * se corta (red, pantalla apagada, pestaña en segundo plano), un vigilante
 * la vuelve a anunciar; mientras tanto, quien intente unirse recibe «no se
 * encontró la sala». Los conductores ya conectados siguen (van directo).
 * @param {(link: Link) => void} onJoin  llega un jugador
 * @param {(online: boolean, changed: boolean) => void} [onStatus]  la sala se ve (o no) en el servidor de salas
 * @returns {Promise<{ code, online, detail, retry(), close() }>}
 */
export async function hostRoom(onJoin, onStatus = () => {}) {
  if (localNetwork()) return hostLocal(onJoin);
  const Peer = await loadPeer();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newRoomCode();
    const peer = new Peer(PREFIX + code);
    const ok = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sin respuesta del servidor de salas")), TIMEOUT);
      peer.on("open", () => { clearTimeout(timer); resolve(true); });
      peer.on("error", (err) => {
        clearTimeout(timer);
        if (err.type === "unavailable-id") resolve(false);
        else reject(new Error(peerError(err)));
      });
    }).catch((err) => { peer.destroy(); throw err; });
    if (!ok) { peer.destroy(); continue; }
    return keepAnnounced(Peer, peer, code, onJoin, onStatus);
  }
  throw new Error("No se pudo crear la sala: inténtalo otra vez");
}

/** Vigilante de la sala: la mantiene anunciada en el servidor de salas. */
function keepAnnounced(Peer, first, code, onJoin, onStatus) {
  const WATCH = 3000, RESET_AFTER = 10000;
  let peer = null, closing = false, offlineSince = null, lastReset = Date.now();
  const room = {
    code, online: true, detail: null, retry: () => reset(),
    close: () => {
      closing = true;
      clearInterval(timer);
      removeEventListener("visibilitychange", onVisible);
      for (const p of peers) p.destroy();
    },
  };
  const peers = new Set();                 // el actual y los anteriores que aún llevan conductores conectados
  const status = (online) => { if (room.online !== online) { room.online = online; onStatus(online, true); } };

  const wire = (p) => {
    p.links = 0;
    peers.add(p);
    p.on("connection", (c) => {
      const link = new Link((m) => c.send(m), () => c.close());
      c.on("open", () => { p.links++; onJoin(link); });
      c.on("data", (m) => link.receive(m));
      c.on("close", () => { p.links = Math.max(0, p.links - 1); link.closed(); retire(p); });
      c.on("error", () => link.closed());
    });
    p.on("open", () => { if (p === peer) { offlineSince = null; room.detail = null; status(true); } });
    p.on("disconnected", () => { if (p === peer && !closing) check(); });
    p.on("error", (err) => {
      if (p !== peer) return;
      room.detail = `${err.type || "error"}: ${err.message || ""}`.slice(0, 160);
      console.warn("[MetroSim sala]", room.detail);
      onStatus(room.online, false);                // solo para mostrar el detalle
    });
  };
  /** Un enlace anterior sin conductores ya no sirve. */
  const retire = (p) => { if (p !== peer && !p.links && !closing) { p.destroy(); peers.delete(p); } };

  /** Conexión nueva con el mismo código (los conductores conectados siguen por el enlace anterior). */
  const reset = () => {
    if (closing) return;
    const old = peer;
    lastReset = Date.now();
    try { if (!old.destroyed && !old.disconnected) old.disconnect(); } catch { /* ya estaba fuera */ }
    peer = new Peer(PREFIX + code);
    wire(peer);
    retire(old);
  };

  const check = () => {
    if (closing) return;
    if (peer.open) { offlineSince = null; status(true); return; }
    status(false);
    offlineSince ??= Date.now();
    // Primero lo simple: volver con la misma conexión; si no resulta en unos segundos, una nueva
    if (peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch { /* se intenta de nuevo */ } }
    if (Date.now() - offlineSince > RESET_AFTER && Date.now() - lastReset > RESET_AFTER) reset();
  };
  const onVisible = () => { if (!document.hidden) check(); };

  peer = first;
  wire(first);
  const timer = setInterval(check, WATCH);
  addEventListener("visibilitychange", onVisible);
  return room;
}

/**
 * Se une a una sala.
 * @returns {Promise<Link>}
 */
export async function joinRoom(code) {
  if (localNetwork()) return joinLocal(code);
  const Peer = await loadPeer();
  const peer = new Peer();
  return new Promise((resolve, reject) => {
    let done = false, tries = 0, found = false;
    const fail = (text) => { if (done) return; done = true; clearTimeout(timer); peer.destroy(); reject(new Error(text)); };
    // Sin respuesta: si el servidor no dijo que la sala no existe, la sala está, pero la conexión directa no se logró
    const timer = setTimeout(() => fail(found || tries > 0
      ? `La sala ${code} existe, pero no se pudo conectar directo con ella: algunas redes lo bloquean. Prueben con los dos equipos en la misma red Wi-Fi`
      : "Sin respuesta del servidor de salas: revisa tu internet"), JOIN_TIMEOUT);
    const attempt = () => {
      if (done) return;
      tries++;
      const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
      c.on("open", () => {
        if (done) return c.close();
        done = true;
        clearTimeout(timer);
        const link = new Link((m) => c.send(m), () => { c.close(); peer.destroy(); });
        c.on("data", (m) => link.receive(m));
        c.on("close", () => { link.closed(); peer.destroy(); });
        c.on("error", () => link.closed());
        resolve(link);
      });
    };
    peer.on("error", (err) => {
      if (err.type !== "peer-unavailable") return fail(peerError(err));
      // El servidor no ve la sala: puede que el anfitrión se esté reconectando; se reintenta unas veces
      if (tries < JOIN_TRIES) return setTimeout(attempt, JOIN_RETRY);
      fail(`No se encontró la sala ${code}. Revisa el código y que el Centro de Control siga con la sala abierta y su pantalla encendida y a la vista (si cambia de app o de pestaña, la sala deja de verse)`);
    });
    peer.on("open", attempt);
  });
}

function peerError(err) {
  if (err.type === "browser-incompatible") return "Este navegador no permite el multijugador (WebRTC)";
  if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") return "Sin conexión con el servidor de salas: revisa tu internet";
  return `Error de conexión (${err.type || err.message})`;
}

/** Carga PeerJS del CDN una sola vez. */
let peerLoading = null;
function loadPeer() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  peerLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PEER_URL;
    s.onload = () => (globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error("No se pudo cargar PeerJS")));
    s.onerror = () => { peerLoading = null; reject(new Error("Sin internet: el multijugador necesita conexión")); };
    document.head.append(s);
  });
  return peerLoading;
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
