import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/leads/[id]/ai-pause
 *
 * Toggles Stiv (the AI WhatsApp assistant) for this single lead.
 *
 * Body:
 *   { paused: true,  hours?: number }   — pause for `hours` (default 24)
 *   { paused: false }                   — clear pause, AI free to reply again
 *
 * The endpoint is intentionally idempotent — calling pause twice just
 * extends the timer. We DO NOT change `lead.status`, so funnel
 * counters, follow-up scheduling and conversion logic stay intact;
 * Stiv just stays silent while the admin handles the chat in person.
 *
 * Form-style requests redirect back to the lead page (used by the
 * inline button); JSON requests get a JSON response.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Accept either JSON or form-data so the same endpoint serves the
  // inline button (form post) and any future programmatic clients.
  let paused = false;
  let hours  = 24;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    paused = Boolean(body?.paused);
    hours  = Number.isFinite(body?.hours) ? Number(body.hours) : 24;
  } else {
    const form = await req.formData().catch(() => null);
    paused = form?.get("paused") === "true" || form?.get("paused") === "1";
    const h = Number(form?.get("hours"));
    if (Number.isFinite(h) && h > 0) hours = h;
  }

  const value = paused
    ? new Date(Date.now() + hours * 3600_000).toISOString()
    : null;

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("leads")
    .update({ ai_paused_until: value })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Note in the timeline so the chronology shows who paused/resumed.
  await sb.from("lead_timeline").insert({
    lead_id: id,
    type:    "agent_note",
    author:  "admin",
    content: paused
      ? `Stiv pausado ${hours}h — admin toma la conversación manual.`
      : "Stiv reactivado — vuelve a responder automáticamente.",
  });

  if (ct.includes("application/json")) {
    return NextResponse.json({ ok: true, paused, until: value });
  }
  return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
}
