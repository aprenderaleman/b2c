import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

/**
 * POST /api/admin/leads/[id]/update
 *
 * Manual editor for the admin's lead detail page. Lets Gelfis fix the
 * fields that come through wrong from the public funnel — most often
 * the WhatsApp number (e.g. lead typed +34 in the country picker AND
 * "34..." in the phone field, ending up with "+3434..."), but also
 * the name, email, language and qualifying answers.
 *
 * The phone is re-run through `normalizePhone` server-side so the
 * stored value always matches our canonical E.164 shape; if the
 * normaliser rejects the input we fail fast with `phone_invalid`.
 *
 * Every change is logged to `lead_timeline` as an `agent_note` with
 * author 'gelfis' and a metadata diff (old → new) for auditability.
 */

const Body = z.object({
  name:                z.string().trim().min(1).max(120).nullable().optional(),
  email:               z.string().trim().email().nullable().optional(),
  whatsapp_normalized: z.string().trim().min(4).max(40).nullable().optional(),
  whatsapp_country:    z.string().trim().regex(/^\+?\d{1,4}$/).optional(),
  language:            z.enum(["es", "de"]).optional(),
  german_level:        z.enum(["A0", "A1-A2", "B1", "B2+"]).nullable().optional(),
  goal:                z.string().trim().max(40).nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const sb = supabaseAdmin();

  // Pull current values for the diff (and to detect collisions).
  const { data: cur, error: getErr } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, german_level, goal")
    .eq("id", id)
    .maybeSingle();
  if (getErr || !cur) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Re-normalise the phone if provided. The default country is taken
  // from the explicit `whatsapp_country` field if present; otherwise
  // we fall back to the prefix already in DB or the funnel default
  // (49 — DACH-first).
  let normalisedPhone: string | null | undefined = body.whatsapp_normalized;
  if (body.whatsapp_normalized !== undefined && body.whatsapp_normalized !== null) {
    const defaultCC = (body.whatsapp_country?.replace("+", "") ?? "49");
    try {
      normalisedPhone = normalizePhone(body.whatsapp_normalized, defaultCC);
    } catch (e) {
      return NextResponse.json(
        { error: "phone_invalid", message: e instanceof Error ? e.message : "invalid phone" },
        { status: 400 },
      );
    }
    // Block accidental overlap with another lead (whatsapp_normalized
    // is a soft business key for the agents pipeline).
    if (normalisedPhone !== cur.whatsapp_normalized) {
      const { data: collision } = await sb
        .from("leads")
        .select("id")
        .eq("whatsapp_normalized", normalisedPhone)
        .neq("id", id)
        .maybeSingle();
      if (collision) {
        return NextResponse.json(
          { error: "phone_already_used_by_another_lead", other_lead_id: (collision as { id: string }).id },
          { status: 409 },
        );
      }
    }
  }

  // Build the patch with only fields actually sent.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const setIfChanged = (key: string, oldValue: unknown, newValue: unknown) => {
    if (newValue === undefined) return;
    if (newValue !== oldValue) {
      patch[key] = newValue;
      diff[key]  = { from: oldValue, to: newValue };
    }
  };
  setIfChanged("name",                body.name              ?? cur.name,         body.name);
  setIfChanged("email",               body.email             ?? cur.email,        body.email);
  setIfChanged("whatsapp_normalized", cur.whatsapp_normalized,                    normalisedPhone);
  setIfChanged("language",            body.language          ?? cur.language,     body.language);
  setIfChanged("german_level",        body.german_level      ?? cur.german_level, body.german_level);
  setIfChanged("goal",                body.goal              ?? cur.goal,         body.goal);

  if (Object.keys(diff).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: upErr } = await sb.from("leads").update(patch).eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: "update_failed", message: upErr.message }, { status: 500 });
  }

  // Audit trail — one timeline note per edit, with the diff embedded.
  const summary = Object.entries(diff)
    .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
    .join("\n");
  await sb.from("lead_timeline").insert({
    lead_id: id,
    type:    "agent_note",
    author:  "gelfis",
    content: `Edición manual del lead:\n${summary}`,
    metadata: { diff },
  });

  return NextResponse.json({ ok: true, changed: true, diff });
}
