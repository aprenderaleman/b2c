import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyUnsubscribeToken } from "@/lib/email-unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/email-action/unsubscribe?t={token} → página con botón "Darme de baja"
 *      (no da de baja directamente: los escáneres de correo abren los
 *      enlaces solos y darían de baja a gente que no lo pidió).
 * POST /api/email-action/unsubscribe?t={token} → baja efectiva. Lo usan el
 *      botón de la página y la baja con un clic de Gmail/Outlook (RFC 8058).
 *
 * Marca leads.email_status = "unsubscribed": a partir de ahí sendRaw
 * suprime los envíos marketing a ese lead.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const leadId = verifyUnsubscribeToken(token);
  if (!leadId) return page("⚠️", "Enlace no válido", "Este enlace de baja no es válido. Si quieres dejar de recibir correos, respóndenos a info@aprender-aleman.de.", 400);
  return page("✉️", "¿Dejar de recibir correos?",
    `Ya no te enviaremos más correos con novedades u ofertas de Aprender-Aleman.de.</p>
<form method="post" action="?t=${encodeURIComponent(token)}"><button class=btn type=submit>Darme de baja</button></form><p class=muted>Si reservas una clase, te seguiremos enviando su confirmación.`);
}

export async function POST(req: Request) {
  const leadId = verifyUnsubscribeToken(new URL(req.url).searchParams.get("t") ?? "");
  if (!leadId) return page("⚠️", "Enlace no válido", "Este enlace de baja no es válido.", 400);

  const sb = supabaseAdmin();
  const { data: lead } = await sb.from("leads").select("id, email_status").eq("id", leadId).maybeSingle();
  if (lead && lead.email_status !== "unsubscribed") {
    // bounced/complained ya bloquean más que una baja: no los pisamos.
    if (lead.email_status !== "bounced" && lead.email_status !== "complained") {
      await sb.from("leads").update({
        email_status: "unsubscribed", email_status_at: new Date().toISOString(),
      }).eq("id", leadId);
    }
    await sb.from("lead_timeline").insert({
      lead_id: leadId, type: "status_change", author: "lead",
      content: "✉️ Se dio de baja de los correos comerciales",
      metadata: { channel: "email", kind: "email_unsubscribe" },
    });
  }
  return page("✅", "Listo, te hemos dado de baja", "No te enviaremos más correos comerciales. ¡Gracias por tu tiempo y mucha suerte con el alemán!");
}

function page(icon: string, title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:480px;padding:32px;text-align:center}
h1{font-size:22px;margin:0 0 12px 0}
p{color:#475569;font-size:16px;line-height:1.5}
.btn{background:#2563eb;color:#fff;border:0;padding:12px 22px;border-radius:10px;font-weight:600;font-size:16px;margin-top:12px;cursor:pointer}
.muted{font-size:13px;color:#94a3b8;margin-top:20px}
</style>
<div class=card>
<div style="font-size:48px">${icon}</div>
<h1>${title}</h1>
<p>${body}</p>
</div>
</html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
