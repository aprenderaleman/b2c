import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { clearImpersonation, getImpersonation } from "@/lib/impersonation";

/**
 * POST /api/admin/impersonate/stop
 * Closes the audit row (ended_at) and clears the cookie.
 */
export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const imp = await getImpersonation();
  if (imp) {
    const sb = supabaseAdmin();
    await sb
      .from("impersonation_log")
      .update({ ended_at: new Date().toISOString() })
      .eq("admin_user_id", imp.admin_id)
      .eq("target_user_id", imp.target_id)
      .is("ended_at", null);
  }

  await clearImpersonation();
  return NextResponse.json({ ok: true, redirect: "/admin" });
}
