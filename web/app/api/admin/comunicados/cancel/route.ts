import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { cancelBodySchema } from "@/lib/comunicados/schema";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/comunicados/cancel
 *
 * Atomically flip a queued broadcast to 'cancelled'. Race-safe: if the
 * dispatch cron has already claimed the row (status='sending') or it
 * has already gone out (status='sent') the UPDATE matches no row and
 * we return 409 — the UI surfaces "ya salió, no se puede cancelar".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const parsed = cancelBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("admin_broadcasts")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("status", "queued")
    .select("id, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  }
  if (!data) {
    // Either id doesn't exist or row is no longer queued.
    return NextResponse.json({ error: "not_cancelable" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
