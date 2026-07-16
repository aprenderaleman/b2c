import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyEmailActionToken } from "@/lib/email-action-token";
import { sendWhatsappText } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email-action/absent-interest-yes?t={token}
 *
 * El lead que quedó absent y recibió el email "¿sigues teniendo
 * interés?" pulsó SÍ. Le mandamos por WhatsApp (si tiene) el link
 * a /agendar/cuando + registramos el intent en timeline.
 * Muestra página HTML "¡Genial! Revisa tu WhatsApp".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return htmlError("Enlace inválido.");
  const payload = verifyEmailActionToken(token);
  if (!payload || payload.action !== "absent-interest-yes") {
    return htmlError("Este enlace ha caducado o no es válido.");
  }

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, language")
    .eq("id", payload.lead_id)
    .maybeSingle();
  if (!lead) return htmlError("Lead no encontrado.");
  const l = lead as { id: string; name: string | null; whatsapp_normalized: string | null; language: "es"|"de"|null };
  const firstName = (l.name || "").split(/\s+/)[0] || l.name || "";
  const platformUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const rescheduleUrl = `${platformUrl}/agendar/cuando?lead=${l.id}&from=absent_interest_yes`;

  // Timeline: lead confirmó interés
  await sb.from("lead_timeline").insert({
    lead_id: l.id,
    type:    "agent_note",
    author:  "lead",
    content: "✅ Lead confirmó interés (clic email absent-interest-yes)",
    metadata: { kind: "absent_interest_yes", channel: "email_button" },
  });

  // WhatsApp con el link — reusable con el kind ya en la whitelist
  if (l.whatsapp_normalized) {
    const waText = l.language === "de"
      ? `¡Genial ${firstName}! 👋\n\nAquí tienes el enlace para reagendar en 3 minutos:\n\n👉 ${rescheduleUrl}\n\nAvísame cuando lo hayas hecho. 😊\n\n— Stiv · Aprender-Aleman.de`
      : `¡Genial ${firstName}! 👋\n\nAquí tienes el enlace para reagendar en 3 minutos:\n\n👉 ${rescheduleUrl}\n\nAvísame cuando lo hayas hecho. 😊\n\n— Stiv · Aprender-Aleman.de`;
    const waRes = await sendWhatsappText(l.whatsapp_normalized, waText, { kind: "trial_absent_interest_yes" });
    await sb.from("lead_timeline").insert({
      lead_id: l.id,
      type:    waRes.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: waRes.ok
        ? `💬 Link reagendar enviado a ${l.whatsapp_normalized} tras confirmar interés`
        : `💬 Falló WA absent-interest-yes: ${waRes.reason ?? "unknown"}`,
      metadata: { kind: "trial_absent_interest_yes", channel: "whatsapp" },
    });
  }

  return htmlOk(firstName, !!l.whatsapp_normalized, rescheduleUrl);
}

function htmlOk(name: string, hasWa: boolean, rescheduleUrl: string) {
  const waLine = hasWa
    ? `<p>Te acabo de mandar el enlace por WhatsApp — reagenda en 3 min.</p>`
    : `<p>Puedes reagendar tu clase aquí:</p><a class=btn href="${rescheduleUrl}">📅 Elegir nueva fecha</a>`;
  const body = `<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>¡Genial!</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:480px;padding:32px;text-align:center}
h1{font-size:24px;margin:0 0 12px 0}p{color:#475569;font-size:16px;line-height:1.5}
.btn{display:inline-block;background:#d97706;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;margin-top:18px}
.muted{font-size:13px;color:#94a3b8;margin-top:24px}</style>
<div class=card>
<div style="font-size:48px">🎉</div>
<h1>¡Genial ${escape(name)}!</h1>
${waLine}
<p class=muted>— Stiv · Aprender-Aleman.de</p>
</div></html>`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function htmlError(msg: string) {
  const body = `<!doctype html><html lang=es><meta charset=utf-8>
<style>body{font-family:system-ui;background:#f8fafc;color:#0f172a;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:480px;padding:32px;text-align:center}</style>
<div class=card><div style="font-size:48px">⚠️</div><h1>Enlace inválido</h1><p>${escape(msg)}</p></div></html>`;
  return new NextResponse(body, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escape(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
