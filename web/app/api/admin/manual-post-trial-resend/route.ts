import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { sendTrialAttendedFollowupEmail } from "@/lib/email/send";
import { getPack, type PackId } from "@/lib/trial-packs";

/**
 * POST /api/admin/manual-post-trial-resend
 *
 * One-shot admin tool: re-envía el WA + email post-trial (con link de
 * pago del pack ofertado) a un lead que ya está marcado attended pero
 * no recibió (o Gelfis no está seguro que recibió) el mensaje inicial.
 *
 * Reutiliza la oferta_enviada más reciente del lead — NO crea oferta
 * nueva. NO cambia estado del lead ni reinicia cadenas.
 *
 * Auth: Bearer CRON_SECRET.
 * Body: { leadId: string, note?: string }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function POST(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { leadId?: string; note?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const leadId = body.leadId;
  if (!leadId) return NextResponse.json({ error: "missing_leadId" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, email, status, trial_attended_at")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  // Oferta más reciente
  const { data: ofertas } = await sb
    .from("ofertas_enviadas")
    .select("id, ritmo, tipo_pago, importe_cents, meta")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1);
  const oferta = ofertas?.[0] as { id: string; ritmo: string; tipo_pago: string; importe_cents: number; meta: string } | undefined;
  if (!oferta) return NextResponse.json({ error: "no_oferta_found_for_lead" }, { status: 404 });

  const packInfo = getPack(oferta.ritmo as PackId);
  const packName = packInfo?.name ?? oferta.ritmo;
  const packLink = `${BASE}/pago/${oferta.id}`;
  const firstName = (lead.name ?? "").split(/\s+/)[0] || (lead.name ?? "");

  const text = [
    `¡Hola ${firstName}! 😊`,
    ``,
    `Me alegra que hayas decidido dar el paso. Aquí tienes el enlace para formalizar tu inscripción en el ${packName}:`,
    `👉 ${packLink}`,
    ``,
    `Son 5 minutos. Cualquier duda durante el proceso, aquí estoy 😊`,
  ].join("\n");

  const results: Record<string, unknown> = { leadId, oferta_id: oferta.id, pack: packName, packLink };

  // WA
  if (lead.whatsapp_normalized) {
    const wa = await sendWhatsappText(lead.whatsapp_normalized, text, { kind: "trial_inscription_initial" });
    results.wa = wa;
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    wa.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: wa.ok
        ? `💬 Post-trial follow-up REENVIADO manualmente a ${lead.whatsapp_normalized} — pack ${packName}. ${body.note ?? ""}`
        : `💬 Falló reenvío post-trial: ${wa.reason ?? "unknown"}`,
      metadata: { kind: "post_trial_followup_manual_resend", channel: "whatsapp", oferta_id: oferta.id, message_id: (wa as { messageId?: string | null }).messageId ?? null },
    }).then(() => {}, () => {});
  } else {
    results.wa = { skipped: "no_whatsapp" };
  }

  // Email
  if (lead.email) {
    const em = await sendTrialAttendedFollowupEmail(lead.email, {
      leadName: firstName || lead.name || "",
      language: "es",
      ctaUrl:   packLink,
      packName,
    });
    results.email = em;
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    em.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: em.ok
        ? `📧 Post-trial follow-up REENVIADO manualmente por email a ${lead.email} — pack ${packName}`
        : `📧 Falló reenvío por email: ${em.error ?? "unknown"}`,
      metadata: { kind: "post_trial_followup_manual_resend", channel: "email", oferta_id: oferta.id },
    }).then(() => {}, () => {});
  } else {
    results.email = { skipped: "no_email" };
  }

  return NextResponse.json({ ok: true, ...results });
}
