// Server-side helpers shared by the /api/admin/* routes.
// Every mutation also writes to lead_timeline so the dashboard has an audit trail.

import { supabaseAdmin } from "./supabase";

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

export async function markTrialAttendedAwaitingConversion(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("leads").update({ status: "in_conversation" }).eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead attended trial — awaiting conversion decision.",
  });
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
