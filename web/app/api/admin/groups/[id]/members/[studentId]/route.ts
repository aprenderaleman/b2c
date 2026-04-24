import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * DELETE /api/admin/groups/[id]/members/[studentId]
 *
 * Remove a student from a group. Admin-only. Idempotent: if the
 * student isn't actually in the group, returns ok:true with no-op.
 *
 * Does NOT unenroll them from classes they're already on — those
 * stay attached via class_participants. This only affects future
 * classes (which pull from current group membership).
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

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("student_group_members")
    .delete()
    .eq("group_id",   groupId)
    .eq("student_id", studentId);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
