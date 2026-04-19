import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getImpersonation } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { createSchuleSsoLink } from "@/lib/entitlements";

/**
 * POST /api/entitlements/schule-link
 *
 * Any authenticated b2c user (student, teacher or admin) can call this
 * to get a one-shot SSO URL that logs them (or, if admin-impersonating,
 * the target student) straight into Schule with Full access.
 *
 * Students get access based on the rule: subscription_status='active'
 * AND pack not expired. Everyone else (admin / teacher) gets access
 * because Gelfis wants to be able to preview.
 */

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Resolve the "effective" user — if admin is impersonating a student,
  // open Schule AS that student.
  const imp = await getImpersonation();
  const userId = imp?.target_id ?? (session.user as { id: string }).id;

  const sb = supabaseAdmin();
  const { data: u } = await sb
    .from("users")
    .select("email, full_name, phone, role")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const role = (u as { role: string }).role;

  // Entitlement rule: active students only. Teachers and admins bypass
  // (they can open Schule to see what the student sees).
  if (role === "student") {
    const { data: s } = await sb
      .from("students")
      .select("subscription_status, pack_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!s) return NextResponse.json({ error: "no_student_profile" }, { status: 403 });
    const status = (s as { subscription_status: string }).subscription_status;
    const exp    = (s as { pack_expires_at: string | null }).pack_expires_at;
    const expired = exp ? new Date(exp) < new Date() : false;
    const eligible = (status === "active" || status === "paused") && !expired;
    if (!eligible) {
      return NextResponse.json({
        error:   "not_eligible",
        message: "Tu pack no está activo. Contacta con nosotros si crees que es un error.",
      }, { status: 403 });
    }
  }

  const link = await createSchuleSsoLink({
    email:    (u as { email: string }).email,
    fullName: (u as { full_name: string | null }).full_name,
    phone:    (u as { phone: string | null }).phone,
  });

  if (!link.ok) {
    return NextResponse.json({ error: link.error }, { status: link.status });
  }
  return NextResponse.json({ ok: true, url: link.redirectUrl });
}
