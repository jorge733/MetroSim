// RedMoviSim 2.13 · aviso-sugerencia
// Edge Function de Supabase: cuando llega una fila nueva a «sugerencias» (Database Webhook
// INSERT), manda un correo con el mensaje al equipo usando Resend. Si el jugador dejó su
// correo, queda como «Responder a», así basta con contestar el correo.
//
// Secretos (Supabase → Edge Functions → Secrets), nunca en el repositorio:
//   RESEND_API_KEY   la clave de Resend (la misma cuenta que manda los códigos de la cuenta)
//   AVISO_DESTINO    el correo que recibe las sugerencias (se pueden poner varios separados por coma)
//   AVISO_REMITENTE  opcional · por defecto «RedMoviSim <no-reply@redmovisim.cl>»
//   AVISO_TOKEN      una clave inventada; el webhook la manda en la cabecera «x-aviso-token»

const TIPO: Record<string, string> = {
  sugerencia: "💡 Sugerencia", error: "🐞 Algo falla", comentario: "💬 Comentario", felicitacion: "🎉 Felicitación",
};
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const validEmail = (e: unknown) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("solo POST", { status: 405 });
  const token = Deno.env.get("AVISO_TOKEN");
  if (!token || req.headers.get("x-aviso-token") !== token) return new Response("no autorizado", { status: 401 });

  const body = await req.json().catch(() => null);
  const s = body?.record;
  if (body?.type !== "INSERT" || body?.table !== "sugerencias" || !s) return new Response("ignorado", { status: 200 });

  const destino = (Deno.env.get("AVISO_DESTINO") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!destino.length) return new Response("falta AVISO_DESTINO", { status: 500 });

  const tipo = TIPO[s.tipo] || s.tipo;
  const estrellas = s.nota ? "★".repeat(s.nota) + "☆".repeat(5 - s.nota) : "sin nota";
  const resumen = String(s.mensaje).replace(/\s+/g, " ").slice(0, 60);
  const fila = (k: string, v: unknown) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#667;white-space:nowrap">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>` : "";
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;color:#1b2430">
      <p style="margin:0 0 4px;color:#667;font-size:13px">RedMoviSim te escucha · mensaje #${esc(s.id)}</p>
      <h2 style="margin:0 0 16px">${esc(tipo)} · ${esc(s.tema)}</h2>
      <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #e4002b;background:#f5f6f8;white-space:pre-wrap;font-size:15px;line-height:1.5">${esc(s.mensaje)}</blockquote>
      <table style="font-size:13px;border-collapse:collapse">
        ${fila("Nota", estrellas)}${fila("Responder a", s.contacto || "no dejó correo")}${fila("Dónde estaba", s.contexto)}
        ${fila("Versión", s.version && "v" + s.version)}${fila("Dispositivo", s.dispositivo)}${fila("Con cuenta", s.user_id ? "sí" : "no")}
        ${fila("Fecha", new Date(s.creado).toLocaleString("es-CL", { timeZone: "America/Santiago" }))}
      </table>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("AVISO_REMITENTE") || "RedMoviSim <no-reply@redmovisim.cl>",
      to: destino,
      ...(validEmail(s.contacto) ? { reply_to: s.contacto } : {}),
      subject: `[RedMoviSim] ${tipo}: ${resumen}${String(s.mensaje).length > 60 ? "…" : ""}`,
      html,
    }),
  });
  if (!res.ok) return new Response(`Resend: ${res.status} ${await res.text()}`, { status: 502 });
  return new Response("enviado", { status: 200 });
});
