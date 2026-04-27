// Server-side helpers shared by the /api/admin/* routes.
// Every mutation also writes to lead_timeline so the dashboard has an audit trail.

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";

export async function addGelfisNote(leadId: string, note: string): Promise<void> {
  const sb = supabaseAdmin();
  const clean = note.trim();
  if (!clean) return;
  await sb.from("gelfis_notes").insert({ lead_id: leadId, note: clean });
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "gelfis_note",
    author: "gelfis",
    content: clean,
  });
}

export async function markConverted(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("leads").update({ status: "converted", next_contact_date: null }).eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "conversion",
    author: "gelfis",
    content: "Payment confirmed — lead converted.",
    metadata: { trigger_welcome: true },
  });
}

export async function markLost(leadId: string, reason = "Marked lost by admin"): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("leads").update({ status: "lost", next_contact_date: null }).eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: reason,
  });
}

export async function reactivate(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  // Moves the lead back into the pipeline — Agent 0 will pick it up on next tick.
  await sb
    .from("leads")
    .update({ status: "in_conversation", next_contact_date: new Date().toISOString() })
    .eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Reactivated — auto follow-up resumed.",
  });
}

/**
 * The lead attended their trial class. Move them back into the normal
 * conversation pipeline (Stiv can answer, agent_0 stays paused while
 * we figure out conversion) and ship a quick WhatsApp follow-up so
 * the lead has a clear next step. If they reply "sí, me interesa",
 * Gelfis takes over from /admin/leads/{id} → "Convertir en estudiante".
 */
export async function markTrialAttendedAwaitingConversion(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads")
    .select("name, language, whatsapp_normalized")
    .eq("id", leadId)
    .maybeSingle();
  const lead = (leadRow ?? null) as {
    name: string | null; language: "es" | "de" | null; whatsapp_normalized: string | null;
  } | null;

  await sb
    .from("leads")
    .update({ status: "in_conversation", next_contact_date: null })
    .eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead attended trial — awaiting conversion decision.",
  });

  // Best-effort follow-up. Skip silently if no WhatsApp on file.
  if (!lead?.whatsapp_normalized) return;
  const firstName = (lead.name || "").split(/\s+/)[0] || "";
  const text = lead.language === "de"
    ? `Hallo ${firstName}! 😊\n\nDanke, dass du in deiner Probestunde dabei warst! Wie hat es dir gefallen?\n\nWenn du weitermachen möchtest, kann ich dir einen persönlichen Plan mit Zeiten und Preis vorbereiten — sag mir einfach Bescheid.\n\nStiv, Aprender-Aleman.de`
    : `¡Hola ${firstName}! 😊\n\n¡Gracias por asistir a tu clase de prueba de alemán!\n\n¿Qué te pareció? Si te interesa avanzar, te preparo un plan personalizado con horarios y precio exacto — dime cuando quieras seguir.\n\nStiv, Aprender-Aleman.de`;

  const res = await sendWhatsappText(lead.whatsapp_normalized, text);
  if (res.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "system_message_sent",
      author: "gelfis",
      content: `💬 Follow-up post-clase enviado a ${lead.whatsapp_normalized}`,
      metadata: { kind: "post_trial_followup", channel: "whatsapp" },
    });
  } else {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "send_failed",
      author: "gelfis",
      content: `💬 Falló el follow-up post-clase: ${res.reason}`,
      metadata: { kind: "post_trial_followup", channel: "whatsapp" },
    });
  }
}

export async function markTrialAbsent(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  const nextContact = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await sb
    .from("leads")
    .update({ status: "trial_absent", next_contact_date: nextContact })
    .eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead did not attend trial — absent follow-up scheduled.",
  });
}
