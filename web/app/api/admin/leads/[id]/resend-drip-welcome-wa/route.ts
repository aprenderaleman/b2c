import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/admin/leads/[id]/resend-drip-welcome-wa
 *
 * Reenvía SOLO el WA #1 del drip post-diagnóstico a un lead concreto.
 * Pensado para recuperar leads cuya cohorte cayó dentro de una ventana
 * de pausa global: el cron registró channel="wa+email" pero en realidad
 * solo el email salió. last_drip_msg_n ya está en 1 y el lead nunca
 * más vería el WA sin esta intervención.
 *
 * Auth: CRON_SECRET (X-Cron-Secret o Bearer). No NextAuth — el caller
 * típico es un script ad-hoc o el propio Gelfis vía curl.
 *
 * Idempotencia: NO bumpea last_drip_msg_n (ya está marcado como sent).
 * Loguea un agent_note del reenvío para trazabilidad.
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, german_level, language")
    .eq("id", id)
    .maybeSingle();
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  const l = lead as { id: string; name: string | null; whatsapp_normalized: string | null; german_level: string | null; language: string | null };
  if (!l.whatsapp_normalized) {
    return NextResponse.json({ error: "no_whatsapp" }, { status: 400 });
  }

  const firstName = (l.name ?? "").trim().split(/\s+/)[0] || (l.name ?? "");
  const levelLabel = l.german_level ?? "A0";

  // Copy del recovery: reconoce el retraso para no sonar a bot que
  // saluda con "vi que ACABAS de hacer el diagnóstico" 24h después.
  const text = [
    `¡Hola ${firstName}! 👋`,
    ``,
    `Soy Stiv del equipo de Aprender-Aleman.de — disculpa el retraso, mi WhatsApp tuvo una intermitencia y este mensaje no salió cuando hiciste tu diagnóstico.`,
    ``,
    `Por lo que veo estás en nivel ${levelLabel}.`,
    ``,
    `Pregunta rápida para no quitarte tiempo: ¿qué te motivó a aprender alemán?`,
    `1 Trabajo en Alemania o Suiza`,
    `2 Estudios universitarios`,
    `3 Pareja alemana`,
    `4 Otra razón`,
    ``,
    `Responde con el número y te mando info útil para tu caso 👇`,
  ].join("\n");

  const r = await sendWhatsappText(l.whatsapp_normalized, text);
  if (!r.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: l.id,
      type: "send_failed",
      author: "system",
      content: `💬 Reintento manual WA welcome #1 falló: ${r.reason}`,
      metadata: { kind: "diagnostico_followup_retry", message_n: 1, reason: r.reason },
    });
    return NextResponse.json({ ok: false, reason: r.reason }, { status: 502 });
  }

  await sb.from("lead_timeline").insert({
    lead_id: l.id,
    type: "system_message_sent",
    author: "system",
    content: text,
    metadata: { kind: "diagnostico_followup", channel: "wa", message_n: 1, retry: true, retry_reason: "wa_failed_during_pause" },
  });

  return NextResponse.json({ ok: true, messageId: r.messageId });
}
