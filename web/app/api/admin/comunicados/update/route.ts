import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { updateBodySchema, SCHEDULE_MIN_LEAD_MS } from "@/lib/comunicados/schema";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/comunicados/update
 *
 * Edit a still-queued broadcast in place — subject / body / channels /
 * audience / attachments / scheduled_at can all change. We refuse to
 * touch any row that's already past 'queued' (a sending/sent/failed/
 * cancelled row is immutable history).
 *
 * Atomic guard: WHERE status='queued' on the UPDATE means a row that
 * the dispatch cron just grabbed cannot be retroactively edited.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const parsed = updateBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { id, audience_filter, subject, message_markdown, channels, attachments, scheduled_at } = parsed.data;

  // Editing requires a future scheduled_at — there's no point editing a
  // row that's about to go out immediately, and "edit + send now" is
  // really just "cancel + new send", which we don't expose.
  if (!scheduled_at) {
    return NextResponse.json({ error: "scheduled_at_required" }, { status: 400 });
  }
  const when = new Date(scheduled_at).getTime();
  if (when - Date.now() < SCHEDULE_MIN_LEAD_MS) {
    return NextResponse.json(
      { error: "scheduled_too_soon", min_lead_ms: SCHEDULE_MIN_LEAD_MS },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("admin_broadcasts")
    .update({
      audience_filter,
      subject,
      message_markdown,
      channels,
      attachments,
      scheduled_at,
    })
    .eq("id", id)
    .eq("status", "queued")
    .select("id, status, scheduled_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_editable" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, broadcast: data });
}
