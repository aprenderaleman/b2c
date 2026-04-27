import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { removeStudentFromGroup } from "@/lib/group-membership";

/**
 * DELETE /api/teacher/groups/[id]/members/[studentId]
 *
 * Remove a student from one of MY groups. Ownership-gated to the
 * calling teacher's group only. Propagates: also un-enrolls the
 * student from every future scheduled class of the group. Past +
 * cancelled classes stay (audit / attendance history).
 */
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; studentId: string }> },
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

  const { id: groupId, studentId } = await params;
  const sb = supabaseAdmin();

  // Ownership gate on the group
  const { data: g } = await sb
    .from("student_groups")
    .select("id, teacher_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!g) return NextResponse.json({ error: "group_not_found" }, { status: 404 });
  if ((g as { teacher_id: string | null }).teacher_id !== me.id) {
    return NextResponse.json({ error: "not_your_group" }, { status: 403 });
  }

  const result = await removeStudentFromGroup(groupId, studentId);
  if (!result.ok) {
    return NextResponse.json({ error: "delete_failed", message: result.reason }, { status: 500 });
  }
  return NextResponse.json({ ok: true, classesAffected: result.classesAffected });
}
