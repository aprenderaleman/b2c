import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyEmailActionToken } from "@/lib/email-action-token";
import { sendWhatsappText } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email-action/absent-interest-no?t={token}
 *
 * El lead absent pulsó NO en el email "¿sigues teniendo interés?".
 * Le mandamos WA de cierre amable + marcamos lead como `lost` + nota
 * en timeline. Sale del funnel de recuperación.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return htmlError("Enlace inválido.");
  const payload = verifyEmailActionToken(token);
  if (!payload || payload.action !== "absent-interest-no") {
    return htmlError("Este enlace ha caducado o no es válido.");
  }

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, language, status")
    .eq("id", payload.lead_id)
    .maybeSingle();
  if (!lead) return htmlError("Lead no encontrado.");
  const l = lead as { id: string; name: string | null; whatsapp_normalized: string | null; language: "es"|"de"|null; status: string };
  const firstName = (l.name || "").split(/\s+/)[0] || l.name || "";

  // Marca lost + limpia reschedule_state
  await sb.from("leads").update({
    status: "lost",
    next_contact_date: null,
    reschedule_state: null,
  }).eq("id", l.id);

  await sb.from("lead_timeline").insert({
    lead_id: l.id,
    type:    "status_change",
    author:  "lead",
    content: "🚫 Lead marcó 'ya no me interesa' (clic email absent-interest-no) → status=lost",
    metadata: { kind: "absent_interest_no", channel: "email_button", previous_status: l.status },
  });

  // Cierre WA amable
  if (l.whatsapp_normalized) {
    const waText = l.language === "de"
      ? `Verstanden ${firstName}. Falls du dich später umentscheidest, sind wir hier. Viel Erfolg mit allem! 🍀\n\n— Stiv · Aprender-Aleman.de`
      : `Entendido ${firstName}. Si algún día cambias de opinión, aquí estamos. ¡Éxito con lo que decidas! 🍀\n\n— Stiv · Aprender-Aleman.de`;
    const waRes = await sendWhatsappText(l.whatsapp_normalized, waText, { kind: "trial_absent_interest_close" });
    await sb.from("lead_timeline").insert({
      lead_id: l.id,
      type:    waRes.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: waRes.ok
        ? `💬 Cierre amable enviado a ${l.whatsapp_normalized} tras absent-interest-no`
        : `💬 Falló WA cierre absent-interest-no: ${waRes.reason ?? "unknown"}`,
      metadata: { kind: "trial_absent_interest_close", channel: "whatsapp" },
    });
  }

  return htmlOk(firstName);
}

function htmlOk(name: string) {
  const body = `<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Entendido</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:480px;padding:32px;text-align:center}
h1{font-size:22px;margin:0 0 12px 0}p{color:#475569;font-size:16px;line-height:1.5}
.muted{font-size:13px;color:#94a3b8;margin-top:24px}</style>
<div class=card>
<div style="font-size:48px">🍀</div>
<h1>Entendido, ${escape(name)}</h1>
<p>No te seguimos escribiendo. Si algún día quieres retomar, aquí estaremos.</p>
<p>¡Éxito con lo que decidas!</p>
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
