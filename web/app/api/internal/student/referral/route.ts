import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrCreateReferralCode, referralStats, buildReferralLink } from "@/lib/referrals";

/**
 * GET /api/internal/student/referral?email=X
 *
 * Endpoint interno para que SCHULE muestre el mismo botón de referidos.
 * Auth: X-Internal-Api-Key (la misma que /api/internal/student/verify).
 *
 * → { ok, code, link, invited_count, classes_earned }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.B2C_INTERNAL_API_KEY;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  if (req.headers.get("x-internal-api-key") !== expected) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("id, students(id)")
    .eq("email", email)
    .maybeSingle();
  const stRaw = (data as { students?: { id: string } | Array<{ id: string }> } | null)?.students;
  const st = Array.isArray(stRaw) ? stRaw[0] : stRaw;
  if (!st) {
    return NextResponse.json({ ok: false, error: "student_not_found" }, { status: 404 });
  }

  const code = await getOrCreateReferralCode(st.id);
  if (!code) {
    return NextResponse.json({ ok: false, error: "code_generation_failed" }, { status: 500 });
  }
  const stats = await referralStats(st.id);

  return NextResponse.json({
    ok: true,
    code,
    link: buildReferralLink(code),
    invited_count:  stats.invited_count,
    classes_earned: stats.classes_earned,
  });
}
