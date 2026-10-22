import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRoleWithImpersonation } from "@/lib/rbac";

/**
 * POST /api/teacher/coaching — Lead teacher schedules a coaching session.
 * Body: { coacheeTeacherId, scheduledAt, title? }
 *
 * Creates a class with is_coaching=true and coaching_teacher_id pointing
 * to the teacher being coached. The recording will only be visible to
 * superadmin (Gelfis).
 */
export async function POST(req: Request) {
  let session;
  try { session = await requireRoleWithImpersonation(["teacher", "superadmin"], "teacher"); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("id, is_lead")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!teacher || !(teacher as { is_lead?: boolean }).is_lead) {
    return NextResponse.json({ error: "not_lead_teacher" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const coacheeTeacherId = body.coacheeTeacherId as string | undefined;
  const scheduledAt = body.scheduledAt as string | undefined;
  const title = (body.title as string) || "Sesión de coaching";

  if (!coacheeTeacherId || !scheduledAt) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const { data: coachee } = await sb
    .from("teachers")
    .select("id, users(full_name)")
    .eq("id", coacheeTeacherId)
    .maybeSingle();
  if (!coachee) return NextResponse.json({ error: "coachee_not_found" }, { status: 404 });
  const coacheeName = ((coachee as { users: { full_name: string } | Array<{ full_name: string }> }).users as { full_name: string })?.full_name ?? "Profesor";

  const { data: cls, error } = await sb
    .from("classes")
    .insert({
      title: `${title} — ${coacheeName}`,
      teacher_id: (teacher as { id: string }).id,
      scheduled_at: scheduledAt,
      duration_minutes: 45,
      class_type: "coaching",
      is_coaching: true,
      coaching_teacher_id: coacheeTeacherId,
      status: "scheduled",
      is_trial: false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[coaching] create failed:", error);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, classId: (cls as { id: string }).id });
}

/**
 * GET /api/teacher/coaching — List colleagues for the lead teacher.
 */
export async function GET() {
  let session;
  try { session = await requireRoleWithImpersonation(["teacher", "superadmin"], "teacher"); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const sb = supabaseAdmin();
  const { data: teacher } = await sb
    .from("teachers")
    .select("id, is_lead")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!teacher || !(teacher as { is_lead?: boolean }).is_lead) {
    return NextResponse.json({ error: "not_lead_teacher" }, { status: 403 });
  }

  const { data: colleagues } = await sb
    .from("teachers")
    .select("id, users!inner(full_name, role, active)")
    .neq("id", (teacher as { id: string }).id)
    .eq("active", true)
    .eq("users.active", true);

  const list = ((colleagues ?? []) as Array<{ id: string; users: { full_name: string; role: string } | Array<{ full_name: string; role: string }> }>)
    .map(t => {
      const u = Array.isArray(t.users) ? t.users[0] : t.users;
      return { id: t.id, name: u?.full_name ?? "Profesor", role: u?.role ?? "teacher" };
    })
    .filter(t => t.role !== "superadmin");

  return NextResponse.json({ colleagues: list });
}
