import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/comunicados/history
 *
 * Last 20 broadcasts (newest first). Used by the history panel on
 * /admin/comunicados so the admin can scan recent sends without
 * leaving the page.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("admin_broadcasts")
    .select("id, created_at, admin_user_id, audience_filter, subject, channels, total_recipients, ok_count, fail_count")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, broadcasts: data ?? [] });
}
