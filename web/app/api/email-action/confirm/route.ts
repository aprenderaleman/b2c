import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyEmailActionToken } from "@/lib/email-action-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email-action/confirm?t={token}
 *
 * Botón "✅ CONFIRMAR ASISTENCIA" del email. Un clic y:
 *  1. Valida token JWT-like (HMAC NEXTAUTH_SECRET).
 *  2. Marca classes.trial_confirmed_at = NOW() (idempotente — si ya
 *     estaba confirmado, no sobreescribe).
 *  3. Inserta lead_timeline (type=trial_confirmed_by_email).
 *  4. Devuelve HTML "✅ Confirmado" minimal (sin auth, sin navegación
 *     a la app — el lead no tiene cuenta).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return htmlError("Enlace inválido. Vuelve a abrir el email y prueba otra vez.");
  const payload = verifyEmailActionToken(token);
  if (!payload || payload.action !== "confirm") {
    return htmlError("Este enlace ha caducado o no es válido. Si necesitas confirmar tu clase, escríbeme a soporte@aprender-aleman.de.");
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, scheduled_at, status, short_code, is_trial")
    .eq("id", payload.class_id)
    .maybeSingle();
  if (!cls) return htmlError("No encontramos tu clase. Es posible que haya sido cancelada.");
  if (cls.lead_id !== payload.lead_id) return htmlError("Enlace inválido.");
  if (cls.status === "cancelled") return htmlError("Esta clase fue cancelada. Si quieres reagendar, escríbeme a soporte@aprender-aleman.de.");

  const { data: lead } = await sb
    .from("leads")
    .select("id, trial_confirmed_at")
    .eq("id", cls.lead_id)
    .maybeSingle();
  const alreadyConfirmed = !!lead?.trial_confirmed_at;
  if (!alreadyConfirmed) {
    await sb.from("leads").update({ trial_confirmed_at: new Date().toISOString() }).eq("id", cls.lead_id);
    await sb.from("lead_timeline").insert({
      lead_id: cls.lead_id,
      type: "trial_confirmed_by_email",
      author: "lead",
      content: "✅ Lead confirmó asistencia con un clic desde el email",
      metadata: { class_id: cls.id, channel: "email_button" },
    });
  }

  const when = cls.scheduled_at
    ? new Date(cls.scheduled_at).toLocaleString("es-ES", {
        timeZone: "Europe/Berlin",
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      }) + " (Berlín)"
    : "";

  const joinUrl = cls.short_code
    ? `https://b2c.aprender-aleman.de/c/${cls.short_code}`
    : null;

  return htmlOk(when, joinUrl, alreadyConfirmed);
}

function htmlOk(when: string, joinUrl: string | null, alreadyConfirmed: boolean) {
  const headline = alreadyConfirmed ? "Ya estabas confirmado 👍" : "¡Confirmado! 🎉";
  const body = `<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${headline}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:480px;padding:32px;text-align:center}
h1{font-size:24px;margin:0 0 12px 0}
p{color:#475569;font-size:16px;line-height:1.5}
.btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;margin-top:18px}
.muted{font-size:13px;color:#94a3b8;margin-top:24px}
</style>
<div class=card>
<div style="font-size:48px">✅</div>
<h1>${headline}</h1>
${when ? `<p>Te esperamos el <strong>${when}</strong>.</p>` : `<p>Te esperamos en tu clase.</p>`}
<p>Tu profesor ya sabe que vas a asistir. ¡Nos vemos pronto!</p>
${joinUrl ? `<a class=btn href="${joinUrl}">Entrar al aula</a>` : ""}
<p class=muted>Guarda este enlace — lo usarás el día de la clase para entrar sin contraseña.</p>
<p class=muted>— Stiv · Aprender-Aleman.de</p>
</div>
</html>`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function htmlError(msg: string) {
  const body = `<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Enlace inválido</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06);max-width:480px;padding:32px;text-align:center}
h1{font-size:22px;margin:0 0 12px 0}
p{color:#475569;font-size:16px;line-height:1.5}
</style>
<div class=card>
<div style="font-size:48px">⚠️</div>
<h1>No pudimos procesar tu confirmación</h1>
<p>${msg}</p>
</div>
</html>`;
  return new NextResponse(body, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
