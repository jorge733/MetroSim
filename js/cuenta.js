/* ==========================================================================
   RedMoviSim — 2.11 · cuenta.js
   Cuenta opcional con el correo y un código de 6 dígitos (Supabase Auth, sin
   contraseña) y la partida guardada en la nube para seguir en otro dispositivo.

     · Sin sesión el juego funciona igual que siempre: todo queda en el
       navegador (localStorage).
     · La partida en la nube es UNA fila de la tabla «partidas» por jugador con
       las claves de avance (cuenta, bip!, tienda, misiones, récords, civismo,
       tutoriales, perfil). Las preferencias del dispositivo (sonido, línea
       elegida, clima, modo creador…) no se suben.
     · Al arrancar (boot.js, durante la intro y ANTES de cargar el juego) se
       compara con la nube: si solo cambió la nube se baja; si solo cambió el
       dispositivo se sube; si cambiaron las dos, el jugador elige.
     · Mientras se juega se sube solo cada 20 s si hubo cambios, y al salir.
       La subida es condicional (solo si la nube no cambió desde la última vez
       que este dispositivo la vio), así dos dispositivos no se pisan.

   Sin librerías: habla directo con la API REST de Supabase. La clave
   «publishable» es pública; la seguridad la ponen las reglas (RLS) de la tabla.
   ========================================================================== */

const SUPABASE_URL = "https://yffipcfwgznqtozyyasy.supabase.co";
const SUPABASE_KEY = "sb_publishable_9ymgzUNbV134CztxvXrxeA_iYqIa4hv";
const CODE_LEN = 6;

const K_SESION = "redmovisim.sesion";   // tokens de la sesión
const K_NUBE = "redmovisim.nube";       // {uid, at, h}: lo último que este dispositivo vio/subió
const SYNC_PREFIX = ["metrosim.bank", "metrosim.bip", "metrosim.owned", "metrosim.rider", "metrosim.civismo",
  "metrosim.missions.", "metrosim.best.", "metrosim.tutorial.", "metrosim.net.name"];

/* ---------- almacenamiento local ---------- */
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  json(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
};
const syncs = (k) => SYNC_PREFIX.some(p => p.endsWith(".") ? k.startsWith(p) : k === p);

/** El avance de este dispositivo: {clave: texto guardado}. */
function snapshot() {
  const out = {};
  for (const k of ls.keys().filter(syncs).sort()) out[k] = ls.get(k);
  return out;
}
/** Huella corta del avance para saber si cambió (cyrb53). */
function hash(data) {
  const str = JSON.stringify(Object.keys(data).sort().map(k => [k, data[k]]));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** Reemplaza el avance local por el de la nube (no toca las preferencias del dispositivo). */
function applyLocal(data) {
  for (const k of ls.keys().filter(syncs)) if (!(k in data)) ls.del(k);
  for (const [k, v] of Object.entries(data || {})) if (syncs(k) && typeof v === "string") ls.set(k, v);
}
const isEmpty = (data) => Object.keys(data).length === 0;

/* ---------- API de Supabase ---------- */
let session = ls.json(K_SESION);           // {access_token, refresh_token, expires_at, user:{id,email}}
const listeners = new Set();
const emit = () => listeners.forEach(fn => { try { fn(state()); } catch { /* nada */ } });

export async function api(path, { method = "GET", body, auth = false, headers = {}, keepalive = false, timeout = 12000 } = {}) {
  const h = { apikey: SUPABASE_KEY, ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (auth) {
    const tok = await accessToken();
    if (!tok) throw Object.assign(new Error("sin sesión"), { code: "no_session" });
    h.Authorization = `Bearer ${tok}`;
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), keepalive, signal: ctl.signal });
  } catch (err) {
    throw Object.assign(new Error("sin conexión"), { code: "offline", cause: err });
  } finally { clearTimeout(t); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const code = data?.error_code || data?.code || data?.error || String(res.status);
    throw Object.assign(new Error(data?.msg || data?.message || data?.error_description || `HTTP ${res.status}`), { status: res.status, code, data });
  }
  return data;
}

function saveSession(s) {
  session = s ? {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  } : null;
  if (session) ls.set(K_SESION, JSON.stringify(session)); else ls.del(K_SESION);
  emit();
}

let refreshing = null;
async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ||= (async () => {
    try {
      const s = await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } });
      saveSession({ ...s, user: s.user || session.user });
    } catch (err) {
      if (err.status === 400 || err.status === 401 || err.status === 403) { saveSession(null); status.expired = true; }
      throw err;
    } finally { refreshing = null; }
  })();
  await refreshing;
  return session?.access_token || null;
}

/* ---------- partida en la nube ---------- */
const status = { syncing: false, lastSync: 0, error: "", expired: false, conflict: null };
const meta = () => ls.json(K_NUBE);
const setMeta = (m) => ls.set(K_NUBE, JSON.stringify(m));

async function fetchCloud() {
  const uid = session?.user?.id;
  const rows = await api(`/rest/v1/partidas?user_id=eq.${uid}&select=datos,actualizado`, { auth: true });
  return rows?.[0] || null;
}

/** Sube el avance. Si la nube cambió desde la última vez, no pisa: marca conflicto. */
async function push({ keepalive = false } = {}) {
  if (!session) return;
  const uid = session.user.id, data = snapshot(), h = hash(data), m = meta();
  if (m?.uid === uid && m.h === h) return;                      // nada nuevo
  const now = new Date().toISOString();
  status.syncing = true; emit();
  try {
    let row = null;
    if (m?.uid === uid && m.at) {
      const rows = await api(`/rest/v1/partidas?user_id=eq.${uid}&actualizado=eq.${encodeURIComponent(m.at)}`, {
        method: "PATCH", auth: true, keepalive, headers: { Prefer: "return=representation" }, body: { datos: data, actualizado: now },
      });
      row = rows?.[0] || null;
    }
    if (!row) {
      const cloud = await fetchCloud();
      if (cloud && !(m?.uid === uid && m.at === cloud.actualizado)) {
        if (hash(cloud.datos || {}) === h) { setMeta({ uid, at: cloud.actualizado, h }); return; }   // ya eran iguales
        status.conflict = cloud; emit(); return;
      }
      const rows = await api("/rest/v1/partidas?on_conflict=user_id", {
        method: "POST", auth: true, keepalive, headers: { Prefer: "return=representation,resolution=merge-duplicates" },
        body: { user_id: uid, datos: data, actualizado: now },
      });
      row = rows?.[0];
    }
    if (row) setMeta({ uid, at: row.actualizado, h });
    status.lastSync = Date.now(); status.error = "";
  } catch (err) {
    status.error = err.code === "offline" ? "Sin conexión: se guardará cuando vuelva internet." : "No se pudo guardar en la nube.";
  } finally { status.syncing = false; emit(); }
}

/**
 * Compara con la nube y decide. Devuelve "pull" (se bajó la nube), "push", "same" o "conflict".
 */
async function reconcile() {
  const uid = session.user.id, local = snapshot(), h = hash(local), m = meta();
  const cloud = await fetchCloud();
  if (!cloud) { await push(); return "push"; }
  const cloudData = cloud.datos || {}, ch = hash(cloudData);
  const known = m?.uid === uid;
  if (ch === h) { setMeta({ uid, at: cloud.actualizado, h }); return "same"; }
  const localChanged = !known || m.h !== h;
  const cloudChanged = !known || m.at !== cloud.actualizado;
  if (isEmpty(local) || (!localChanged && cloudChanged)) {
    applyLocal(cloudData); setMeta({ uid, at: cloud.actualizado, h: ch }); return "pull";
  }
  if (localChanged && !cloudChanged) { await push(); return "push"; }
  status.conflict = cloud; emit();
  return "conflict";
}

/* ---------- arranque y guardado automático ---------- */
let started = false;
function autoSave() {
  if (started) return;
  started = true;
  setInterval(() => { if (session && !status.conflict && !document.hidden) push(); }, 20000);
  const flush = () => { if (session && !status.conflict) push({ keepalive: true }); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
  window.addEventListener("pagehide", flush);
}

/** boot.js: antes de cargar el juego. Nunca tarda más de unos segundos ni falla. */
export async function syncAtBoot() {
  autoSave();
  if (!session) return;
  try {
    await Promise.race([reconcile(), new Promise((_, rej) => setTimeout(() => rej(new Error("lento")), 4000))]);
  } catch { /* sin conexión o lento: se juega con lo del dispositivo y se sube después */ }
}

/* ---------- acciones de la cuenta ---------- */
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

export async function sendCode(email) {
  await api("/auth/v1/otp", { method: "POST", body: { email, create_user: true } });
}
export async function verifyCode(email, token) {
  const s = await api("/auth/v1/verify", { method: "POST", body: { type: "email", email, token } });
  saveSession(s);
  status.expired = false;
  return reconcile();
}
export async function signOut() {
  if (!session) return;
  try { await push(); } catch { /* nada */ }
  try { await api("/auth/v1/logout?scope=local", { method: "POST", auth: true }); } catch { /* igual se cierra aquí */ }
  ls.del(K_NUBE);
  status.conflict = null;
  saveSession(null);
}
export async function deleteAccount() {
  await api("/rest/v1/rpc/borrar_mi_cuenta", { method: "POST", auth: true, body: {} });
  ls.del(K_NUBE);
  status.conflict = null;
  saveSession(null);
}
/** Resuelve un conflicto: "cloud" baja la nube y recarga; "local" sube lo de este dispositivo. */
export async function resolveConflict(choice) {
  const cloud = status.conflict;
  if (!cloud || !session) return;
  const uid = session.user.id;
  status.conflict = null;
  if (choice === "cloud") {
    applyLocal(cloud.datos || {});
    setMeta({ uid, at: cloud.actualizado, h: hash(cloud.datos || {}) });
    location.reload();
  } else {
    setMeta({ uid, at: cloud.actualizado, h: "" });               // la nube ya vista: la subida no choca
    await push();
  }
}

export function state() {
  return { signedIn: !!session, email: session?.user?.email || "", ...status };
}
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/* ==========================================================================
   Interfaz: ventana «Tu cuenta» (portada y menú de la partida)
   ========================================================================== */

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
function summary(data) {
  const parse = (k) => { try { return JSON.parse(data?.[k] || "null"); } catch { return null; } };
  const bank = parse("metrosim.bank"), bip = parse("metrosim.bip");
  let missions = 0;
  for (const k of Object.keys(data || {})) if (k.startsWith("metrosim.missions.")) missions += Number(parse(k)?.completed) || 0;
  return [`Cuenta ${money(bank?.balance)}`, bip?.hasCard ? `bip! ${money(bip.balance)}` : "sin bip!", `${missions} misiones`].join(" · ");
}
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

const ICON_USER = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const ICON_CLOSE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let panel, view = "email", pendingEmail = "", busy = false, msg = { text: "", kind: "" };

function build() {
  panel = document.createElement("div");
  panel.id = "accountPanel";
  panel.className = "ticket-panel account-panel hidden";
  panel.innerHTML = `
    <div class="ticket-card account-card" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
      <header class="ticket-head">
        <span class="account-avatar">${ICON_USER}</span>
        <div class="ticket-head-text">
          <span class="small-label" id="accountKicker">TU CUENTA</span>
          <strong id="accountTitle">Iniciar sesión</strong>
        </div>
        <button class="ticket-close" data-acc="close" aria-label="Cerrar">${ICON_CLOSE}</button>
      </header>
      <div class="account-body"></div>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener("click", (ev) => {
    if (ev.target === panel) return closeAccount();
    const act = ev.target.closest("[data-acc]")?.dataset.acc;
    if (act) action(act);
  });
  panel.addEventListener("submit", (ev) => { ev.preventDefault(); action(ev.target.dataset.acc); });
  // Las teclas no llegan al juego mientras se escribe (M, H, flechas…)
  panel.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape") closeAccount(); });
  panel.addEventListener("keyup", (ev) => ev.stopPropagation());
  panel.addEventListener("input", (ev) => {
    if (ev.target.id !== "accountCode") return;
    ev.target.value = ev.target.value.replace(/\D/g, "").slice(0, CODE_LEN);
    if (ev.target.value.length === CODE_LEN) action("verify");
  });
}

function render() {
  if (!panel) return;
  const st = state();
  const body = panel.querySelector(".account-body");
  const title = panel.querySelector("#accountTitle");
  const note = msg.text ? `<p class="ticket-status ${msg.kind}" role="status">${msg.text}</p>` : "";
  if (st.conflict) view = "conflict";
  else if (st.signedIn && !["delete"].includes(view)) view = "account";
  else if (!st.signedIn && !["email", "code"].includes(view)) view = "email";

  panel.classList.toggle("busy", busy);
  panel.dataset.view = view;
  if (view === "email") {
    title.textContent = "Iniciar sesión";
    body.innerHTML = `
      <p class="account-lead">Guarda tu partida en la nube y sigue en cualquier dispositivo: celular, PC o la app. Sin contraseña: te mandamos un código al correo.</p>
      <form data-acc="send" class="account-form">
        <label class="field"><span class="small-label">Tu correo</span>
          <input id="accountEmail" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="nombre@correo.cl" value="${esc(pendingEmail)}" required></label>
        ${note || (st.expired ? '<p class="ticket-status">Tu sesión venció. Vuelve a entrar con tu correo.</p>' : "")}
        <button class="go-button account-main" type="submit">Enviarme el código</button>
      </form>
      <p class="account-fine">Es opcional: sin cuenta todo sigue guardado en este dispositivo. Solo usamos tu correo para que entres.</p>`;
  } else if (view === "code") {
    title.textContent = "Revisa tu correo";
    body.innerHTML = `
      <p class="account-lead">Te mandamos un código de ${CODE_LEN} dígitos a <b>${esc(pendingEmail)}</b>. Si no llega en un minuto, revisa Spam o Promociones.</p>
      <form data-acc="verify" class="account-form">
        <label class="field"><span class="small-label">Código</span>
          <input id="accountCode" class="account-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${CODE_LEN}" placeholder="${"•".repeat(CODE_LEN)}" required></label>
        ${note}
        <button class="go-button account-main" type="submit">Entrar</button>
      </form>
      <div class="account-links"><button class="link-button" data-acc="resend" type="button">Reenviar el código</button><button class="link-button" data-acc="back" type="button">Cambiar el correo</button></div>`;
  } else if (view === "account") {
    title.textContent = "Tu cuenta";
    const sync = st.syncing ? "Guardando…" : st.error ? st.error : st.lastSync || meta()?.at ? `Guardada en la nube ${ago(st.lastSync ? new Date(st.lastSync).toISOString() : meta().at)}` : "Lista para guardar";
    body.innerHTML = `
      <div class="account-who"><small class="small-label">SESIÓN INICIADA</small><b>${esc(st.email)}</b></div>
      <div class="account-sync ${st.error ? "warn" : "ok"}"><span class="account-dot"></span><span>${sync}</span></div>
      <p class="account-fine">Tu cuenta, tu bip!, tus compras y tus misiones se guardan solas mientras juegas. Para seguir en otro dispositivo, entra ahí con este mismo correo.</p>
      ${note}
      <div class="ticket-actions"><button class="ghost-button" data-acc="sync" type="button">Guardar ahora</button><button class="ghost-button" data-acc="logout" type="button">Cerrar sesión</button></div>
      <button class="link-button danger" data-acc="askdelete" type="button">Borrar mi cuenta</button>`;
  } else if (view === "delete") {
    title.textContent = "¿Borrar tu cuenta?";
    body.innerHTML = `
      <p class="account-lead">Se borran tu cuenta y tu partida guardada en la nube, para siempre. Lo que está en este dispositivo no se toca.</p>
      ${note}
      <div class="ticket-actions"><button class="ghost-button" data-acc="canceldelete" type="button">Cancelar</button><button class="go-button danger" data-acc="delete" type="button">Sí, borrar</button></div>`;
  } else if (view === "conflict") {
    title.textContent = "¿Con qué partida sigues?";
    const local = snapshot();
    body.innerHTML = `
      <p class="account-lead">Tu partida en la nube y la de este dispositivo son distintas. Elige con cuál quedarte; la otra se reemplaza.</p>
      <button class="account-choice" data-acc="usecloud" type="button"><small class="small-label">EN LA NUBE · ${ago(st.conflict.actualizado).toUpperCase()}</small><b>${summary(st.conflict.datos)}</b></button>
      <button class="account-choice" data-acc="uselocal" type="button"><small class="small-label">EN ESTE DISPOSITIVO</small><b>${summary(local)}</b></button>
      ${note}`;
  }
  const focus = body.querySelector("#accountCode, #accountEmail");
  if (focus && !panel.classList.contains("hidden")) setTimeout(() => focus.focus(), 30);
}

async function run(fn) {
  if (busy) return;
  busy = true; msg = { text: "", kind: "" }; render();
  try { await fn(); } catch (err) { msg = { text: errorText(err), kind: "error" }; }
  busy = false; render();
}
function errorText(err) {
  if (err.code === "offline") return "Sin conexión a internet. Inténtalo de nuevo.";
  if (err.status === 429 || /rate|limit/i.test(err.code)) return "Pediste muchos códigos seguidos. Espera un minuto y vuelve a intentar.";
  if (/otp_expired|expired/i.test(err.code) || /expired|invalid/i.test(err.message)) return "El código no es correcto o ya venció. Revísalo o pide otro.";
  if (/email_address_invalid|validation/i.test(err.code)) return "Ese correo no parece válido.";
  if (err.status === 404 && /borrar_mi_cuenta/.test(err.message)) return "Todavía no se puede borrar la cuenta desde el juego.";
  return "Algo falló. Inténtalo de nuevo en un rato.";
}

function action(act) {
  if (act === "close") return closeAccount();
  if (act === "send" || act === "resend") {
    const input = panel.querySelector("#accountEmail");
    if (input) pendingEmail = input.value.trim().toLowerCase();
    if (!validEmail(pendingEmail)) { msg = { text: "Escribe un correo válido.", kind: "error" }; return render(); }
    return run(async () => {
      await sendCode(pendingEmail);
      view = "code";
      msg = act === "resend" ? { text: "Te mandamos un código nuevo.", kind: "ok" } : { text: "", kind: "" };
    });
  }
  if (act === "back") { view = "email"; msg = { text: "", kind: "" }; return render(); }
  if (act === "verify") {
    const code = panel.querySelector("#accountCode")?.value || "";
    if (code.length !== CODE_LEN) { msg = { text: `El código tiene ${CODE_LEN} dígitos.`, kind: "error" }; return render(); }
    return run(async () => {
      const r = await verifyCode(pendingEmail, code);
      if (r === "pull") { location.reload(); return; }          // se bajó la partida: el juego la vuelve a leer
      view = "account";
      msg = { text: r === "push" ? "¡Listo! Tu partida quedó guardada en la nube." : "¡Listo! Sesión iniciada.", kind: "ok" };
    });
  }
  if (act === "sync") return run(async () => { await push(); if (!status.error) msg = { text: "Partida guardada.", kind: "ok" }; });
  if (act === "logout") return run(async () => { await signOut(); view = "email"; msg = { text: "Cerraste sesión. Tu avance sigue en este dispositivo.", kind: "ok" }; });
  if (act === "askdelete") { view = "delete"; msg = { text: "", kind: "" }; return render(); }
  if (act === "canceldelete") { view = "account"; return render(); }
  if (act === "delete") return run(async () => { await deleteAccount(); view = "email"; msg = { text: "Tu cuenta fue borrada.", kind: "ok" }; });
  if (act === "usecloud") return run(() => resolveConflict("cloud"));
  if (act === "uselocal") return run(async () => { await resolveConflict("local"); view = "account"; msg = { text: "Quedó la partida de este dispositivo.", kind: "ok" }; });
}

let lastFocus = null;
export function openAccount() {
  if (!panel) build();
  lastFocus = document.activeElement;
  if (!session && view !== "code") view = "email";
  msg = { text: "", kind: "" };
  panel.classList.remove("hidden");
  render();
  if (!panel.querySelector("input")) panel.querySelector(".ticket-close").focus();
}
export function closeAccount() {
  if (!panel || panel.classList.contains("hidden")) return;
  if (status.conflict) return;                                   // hay que elegir primero
  panel.classList.add("hidden");
  lastFocus?.focus?.();
}
export const accountOpen = () => !!panel && !panel.classList.contains("hidden");

/** Botón de la portada: «Entrar» o el correo con la sesión iniciada. */
export function setupAccountButton(button) {
  if (!button) return;
  const paint = () => {
    const st = state();
    button.classList.toggle("signed", st.signedIn);
    button.querySelector("span").textContent = st.signedIn ? "Mi cuenta" : "Entrar";
    button.title = st.signedIn ? `Sesión iniciada: ${st.email}` : "Inicia sesión para guardar tu partida en la nube";
  };
  button.addEventListener("click", openAccount);
  onChange(() => { paint(); if (accountOpen() && !busy) render(); });
  // Un conflicto se pregunta en la portada, nunca en medio de una partida
  const start = document.getElementById("startScreen");
  const onHome = () => !start || !start.classList.contains("hidden");
  const ask = () => { if (status.conflict && !accountOpen() && onHome()) openAccount(); };
  onChange(ask);
  if (start) new MutationObserver(ask).observe(start, { attributes: true, attributeFilter: ["class"] });
  paint();
  ask();
}
