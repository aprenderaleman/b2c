import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { removeStudentFromGroup } from "@/lib/group-membership";

/**
 * DELETE /api/admin/groups/[id]/members/[studentId]
 *
 * Remove a student from a group. Admin-only. Idempotent: if the
 * student isn't actually in the group, returns ok:true with no-op.
 *
 * Propagates: the student is also un-enrolled from every future
 * scheduled class of the group. Past + cancelled classes stay (audit).
 */
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: groupId, studentId } = await params;
  const result = await removeStudentFromGroup(groupId, studentId);
  if (!result.ok) {
    return NextResponse.json({ error: "delete_failed", message: result.reason }, { status: 500 });
  }
  return NextResponse.json({ ok: true, classesAffected: result.classesAffected });
}
