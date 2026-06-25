import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyEmailActionToken } from "@/lib/email-action-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email-action/reschedule?t={token}
 *
 * Botón "📅 CAMBIAR DE FECHA" del email. Verifica el token, registra
 * la intención en el timeline (para que el profesor/admin vean que el
 * lead quiere reagendar) y redirige al flujo /agendar/cuando con el
 * contexto necesario para preseleccionar la clase a mover.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  if (!token) return redirectToAgendar(null, null);
  const payload = verifyEmailActionToken(token);
  if (!payload || payload.action !== "reschedule") return redirectToAgendar(null, null);

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, status")
    .eq("id", payload.class_id)
    .maybeSingle();
  if (cls && cls.lead_id === payload.lead_id && cls.status !== "cancelled") {
    await sb.from("lead_timeline").insert({
      lead_id: cls.lead_id,
      type: "trial_reschedule_requested",
      author: "lead",
      content: "📅 Lead pidió cambiar fecha (clic desde email)",
      metadata: { class_id: cls.id, channel: "email_button" },
    });
    // Reset confirmed flag: el lead acaba de pedir cambiar fecha, así
    // que la confirmación previa (si la había) ya no aplica a la nueva
    // reserva que va a hacer en /agendar/cuando.
    await sb.from("leads").update({ trial_confirmed_at: null }).eq("id", cls.lead_id);
  }

  return redirectToAgendar(payload.class_id, payload.lead_id);
}

function redirectToAgendar(classId: string | null, leadId: string | null) {
  const base = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const url = new URL(`${base}/agendar/cuando`);
  if (classId) url.searchParams.set("class", classId);
  if (leadId) url.searchParams.set("lead", leadId);
  url.searchParams.set("from", "email_reschedule");
  return NextResponse.redirect(url.toString(), 302);
}
