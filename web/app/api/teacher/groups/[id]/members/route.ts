import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/teacher/groups/[id]/members
 * Body: { student_id: uuid }
 *
 * Add a student to one of MY groups. Ownership gate: both the group
 * must be mine, AND the student must already be "mine" via an
 * existing class or another of my groups — prevents a teacher from
 * grabbing random students from other teachers' pools.
 */
export const runtime = "nodejs";

const Body = z.object({ student_id: z.string().uuid() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole:   role as "teacher" | "admin" | "superadmin",
    expectRole:     "teacher",
  });
  const me = await getTeacherByUserId(eff.userId);
  if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });

  const { id: groupId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const studentId = parsed.data.student_id;

  const sb = supabaseAdmin();

  // 1. Is the group mine?
  const { data: g } = await sb
    .from("student_groups")
    .select("id, teacher_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!g) return NextResponse.json({ error: "group_not_found" }, { status: 404 });
  if ((g as { teacher_id: string | null }).teacher_id !== me.id) {
    return NextResponse.json({ error: "not_your_group" }, { status: 403 });
  }

  // 2. Is the student "mine"? Pool = class_participants of classes I teach
  //    OR members of any other group I own. Admins skip this check
  //    (only when viewing as themselves, not when impersonating).
  const isAdmin = (role === "admin" || role === "superadmin") && !eff.impersonated;
  if (!isAdmin) {
    const [classOwn, groupOwn] = await Promise.all([
      sb.from("class_participants")
        .select("class:classes!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("class.teacher_id", me.id)
        .limit(1),
      sb.from("student_group_members")
        .select("student_id, group:student_groups!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("group.teacher_id", me.id)
        .limit(1),
    ]);
    const owns = (classOwn.data?.length ?? 0) > 0 || (groupOwn.data?.length ?? 0) > 0;
    if (!owns) {
      return NextResponse.json({
        error:   "student_not_in_your_pool",
        message: "Solo puedes añadir estudiantes que ya tengas en otros grupos o clases tuyas. Pide al admin que te asigne nuevos estudiantes.",
      }, { status: 403 });
    }
  }

  const { error } = await sb
    .from("student_group_members")
    .upsert({ group_id: groupId, student_id: studentId },
            { onConflict: "group_id,student_id" });
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
