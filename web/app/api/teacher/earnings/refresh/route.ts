import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole: role as "teacher" | "admin" | "superadmin",
    expectRole: "teacher",
  });
  const teacher = await getTeacherByUserId(eff.userId);
  if (!teacher) return NextResponse.json({ error: "no_teacher" }, { status: 404 });

  const sb = supabaseAdmin();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const { error } = await sb.rpc("recompute_teacher_month", {
    p_teacher_id: teacher.id,
    p_any_date_in_month: monthStart.toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: "recompute_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
