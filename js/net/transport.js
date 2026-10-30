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
 * @param {(link: Link) => void} onJoin  llega un jugador
 * @returns {Promise<{ code: string, close: () => void }>}
 */
export async function hostRoom(onJoin) {
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
    peer.on("connection", (c) => {
      const link = new Link((m) => c.send(m), () => c.close());
      c.on("open", () => onJoin(link));
      c.on("data", (m) => link.receive(m));
      c.on("close", () => link.closed());
      c.on("error", () => link.closed());
    });
    // Si se corta el enlace con el servidor de salas, las conexiones ya hechas siguen; se intenta volver
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
    return { code, close: () => peer.destroy() };
  }
  throw new Error("No se pudo crear la sala: inténtalo otra vez");
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
    const fail = (text) => { clearTimeout(timer); peer.destroy(); reject(new Error(text)); };
    const timer = setTimeout(() => fail(`No se encontró la sala ${code}`), TIMEOUT);
    peer.on("error", (err) => fail(err.type === "peer-unavailable" ? `No existe la sala ${code} (¿el código está bien?)` : peerError(err)));
    peer.on("open", () => {
      const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
      const link = new Link((m) => c.send(m), () => { c.close(); peer.destroy(); });
      c.on("open", () => { clearTimeout(timer); resolve(link); });
      c.on("data", (m) => link.receive(m));
      c.on("close", () => { link.closed(); peer.destroy(); });
      c.on("error", () => link.closed());
    });
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
