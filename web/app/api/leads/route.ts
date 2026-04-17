import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidE164, normalizePhone } from "@/lib/phone";

// All enums must match the Postgres enums in db/migrations/001.
const LeadSchema = z.object({
  name:                z.string().trim().min(2).max(80),
  german_level:        z.enum(["A0", "A1-A2", "B1", "B2+"]),
  goal:                z.enum(["work", "visa", "studies", "exam", "travel", "already_in_dach"]),
  urgency:             z.enum(["asap", "under_3_months", "in_6_months", "next_year", "just_looking"]),
  whatsapp_raw:        z.string().min(5).max(60),
  whatsapp_normalized: z.string().min(5).max(20),
  language:            z.enum(["es", "de"]),
  gdpr_accepted:       z.literal(true),   // must be true
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Server-side re-normalization as defense in depth — never trust the client.
  let normalized = data.whatsapp_normalized;
  try {
    normalized = normalizePhone(data.whatsapp_raw);
  } catch {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  if (!isValidE164(normalized)) {
    return NextResponse.json({ error: "Invalid phone E.164" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Upsert by whatsapp_normalized to avoid duplicates.
  const insert = {
    name: data.name,
    whatsapp_normalized: normalized,
    whatsapp_raw: data.whatsapp_raw,
    language: data.language,
    german_level: data.german_level,
    goal: data.goal,
    urgency: data.urgency,
    gdpr_accepted: true,
    gdpr_accepted_at: new Date().toISOString(),
    source: "funnel",
    status: "new",
  };

  const { data: existing } = await sb
    .from("leads")
    .select("id, status")
    .eq("whatsapp_normalized", normalized)
    .maybeSingle();

  if (existing) {
    // Re-submission: update funnel fields but keep current status /
    // conversation state intact. We never reset status back to 'new'.
    const { error } = await sb
      .from("leads")
      .update({
        name: insert.name,
        language: insert.language,
        german_level: insert.german_level,
        goal: insert.goal,
        urgency: insert.urgency,
      })
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logTimeline(existing.id, {
      type: "agent_note",
      author: "system",
      content: "Lead re-submitted funnel — fields refreshed, status preserved.",
    });
    return NextResponse.json({ id: existing.id, deduplicated: true });
  }

  const { data: created, error } = await sb
    .from("leads")
    .insert(insert)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logTimeline(created.id, {
    type: "agent_note",
    author: "system",
    content: `New lead from funnel — level=${data.german_level}, goal=${data.goal}, urgency=${data.urgency}, lang=${data.language}.`,
  });

  return NextResponse.json({ id: created.id, deduplicated: false });
}

async function logTimeline(
  leadId: string,
  entry: { type: string; author: string; content: string },
) {
  const sb = supabaseAdmin();
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: entry.type,
    author: entry.author,
    content: entry.content,
  });
}
