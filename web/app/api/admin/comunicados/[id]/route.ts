import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/comunicados/<id>
 *
 * Returns one broadcast with the full body payload (message, audience,
 * attachments, etc.) — used by the composer when entering edit mode
 * for a queued row. The history list intentionally omits these heavy
 * fields to keep the panel snappy.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("admin_broadcasts")
    .select("id, created_at, audience_filter, subject, message_markdown, channels, attachments, scheduled_at, status, total_recipients, ok_count, fail_count, results")
    .eq("id", id)
    .maybeSingle();

  if (error)  return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, broadcast: data });
}
