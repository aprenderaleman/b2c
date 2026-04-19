import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/internal/student/verify?email=...
 *
 * Called server-to-server by hans-server (and potentially schule) to
 * check whether the caller email belongs to an active b2c student.
 * Used by Hans during register to auto-grant the starter plan.
 *
 * Auth: X-Internal-Api-Key header must match env.B2C_INTERNAL_API_KEY.
 * Keep this separate from B2C_SYNC_SECRET so we can rotate independently.
 *
 * Response shape matches what Hans already expects:
 *   { success: true, data: { isActiveStudent: boolean } }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.B2C_INTERNAL_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { success: false, error: "not_configured" },
      { status: 503 },
    );
  }
  const key = req.headers.get("x-internal-api-key");
  if (key !== expected) {
    return NextResponse.json(
      { success: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { success: false, error: "email_required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("id, active, students(subscription_status, pack_expires_at)")
    .eq("email", email)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ success: true, data: { isActiveStudent: false } });
  }

  type Row = {
    active: boolean;
    students:
      | { subscription_status: string; pack_expires_at: string | null }
      | Array<{ subscription_status: string; pack_expires_at: string | null }>
      | null;
  };
  const r = data as Row;
  const s = Array.isArray(r.students) ? r.students[0] : r.students;

  const userActive = r.active;
  const subActive  = !!s && (s.subscription_status === "active" || s.subscription_status === "paused");
  const notExpired = !s?.pack_expires_at || new Date(s.pack_expires_at) > new Date();

  return NextResponse.json({
    success: true,
    data: { isActiveStudent: Boolean(userActive && subActive && notExpired) },
  });
}
