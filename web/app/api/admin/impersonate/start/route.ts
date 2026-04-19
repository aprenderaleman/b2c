import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { setImpersonation } from "@/lib/impersonation";

/**
 * POST /api/admin/impersonate/start
 * Body: { target_user_id: uuid }
 *
 * Admin-only. Writes an impersonation_log row and sets the cookie.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { target_user_id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const targetId = body.target_user_id;
  if (!targetId) return NextResponse.json({ error: "missing target_user_id" }, { status: 400 });

  const adminId   = (session.user as { id: string }).id;
  const adminName = (session.user.name ?? session.user.email ?? "Admin") as string;

  if (targetId === adminId) {
    return NextResponse.json({ error: "cannot impersonate self" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: target } = await sb
    .from("users")
    .select("id, role, full_name, email, active")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "target not found" }, { status: 404 });
  if (!(target as { active: boolean }).active) {
    return NextResponse.json({ error: "target inactive" }, { status: 400 });
  }

  const targetRole = (target as { role: string }).role;
  if (targetRole !== "student" && targetRole !== "teacher") {
    return NextResponse.json({ error: "can only impersonate students or teachers" }, { status: 400 });
  }

  // Audit log entry.
  await sb.from("impersonation_log").insert({
    admin_user_id:  adminId,
    target_user_id: targetId,
    ip:             req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent:     req.headers.get("user-agent") ?? null,
  });

  await setImpersonation({
    admin_id:     adminId,
    admin_name:   adminName,
    target_id:    targetId,
    target_role:  targetRole as "student" | "teacher",
    target_name:  (target as { full_name: string | null }).full_name ?? (target as { email: string }).email,
    target_email: (target as { email: string }).email,
  });

  const homeUrl = targetRole === "teacher" ? "/profesor" : "/estudiante";
  return NextResponse.json({ ok: true, redirect: homeUrl, role: targetRole });
}
