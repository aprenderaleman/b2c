import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { deleteResource } from "@/lib/teacher-resources";
import { deleteRecordingObject } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/profesor/recursos/{id}
 *
 * Solo lo puede borrar el profesor que lo subió, o un superadmin/admin.
 * Borramos primero la fila DB y, si tenía archivo, intentamos borrar
 * el objeto en R2 después (best-effort).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role: string }).role;
  const isStaff = role === "admin" || role === "superadmin";
  if (role !== "teacher" && !isStaff) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const teacher = await getTeacherByUserId((session.user as { id: string }).id);
  const teacherId = teacher?.id ?? null;

  const { id } = await params;
  const r = await deleteResource(id, teacherId, isStaff);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.error },
      { status: r.error === "forbidden" ? 403 : r.error === "not_found" ? 404 : 500 },
    );
  }

  // Best-effort: borrar archivo en R2 si lo había
  if (r.storage_key) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET || "aprender-aleman-recordings";
    if (accountId) {
      const fakeUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${r.storage_key}`;
      await deleteRecordingObject(fakeUrl);
    }
  }

  return NextResponse.json({ ok: true });
}
