import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { deleteMaterial } from "@/lib/materials";

/**
 * DELETE /api/teacher/materials/[id]
 * Owner teacher only — admins can't delete a teacher's personal materials
 * today (we'll revisit if needed).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role: string }).role;
  if (role !== "teacher") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const me = await getTeacherByUserId((session.user as { id: string }).id);
  if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });

  const { id } = await params;
  const ok = await deleteMaterial(me.id, id);
  if (!ok) return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
