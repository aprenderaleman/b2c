import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getImpersonation } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { createHansSsoLink } from "@/lib/entitlements";

/**
 * POST /api/entitlements/hans-link
 *
 * Same eligibility rules as /schule-link: active b2c students get a
 * one-shot SSO URL to hans.aprender-aleman.de with starter plan
 * granted automatically on the Hans side. Admins + teachers can call
 * it too (useful for previewing).
 */

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const imp = await getImpersonation();
  const userId = imp?.target_id ?? (session.user as { id: string }).id;

  const sb = supabaseAdmin();
  const { data: u } = await sb
    .from("users")
    .select("email, full_name, role")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const role = (u as { role: string }).role;
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

  const link = await createHansSsoLink({
    email:    (u as { email: string }).email,
    fullName: (u as { full_name: string | null }).full_name,
  });
  if (!link.ok) {
    return NextResponse.json({ error: link.error }, { status: link.status });
  }
  return NextResponse.json({ ok: true, url: link.redirectUrl });
}
