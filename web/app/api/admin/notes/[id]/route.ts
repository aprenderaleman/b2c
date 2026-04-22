import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteAdminNote } from "@/lib/admin-notes";

/**
 * DELETE /api/admin/notes/[id]
 *
 * Removes an admin note. Author can delete their own; superadmin can
 * delete anyone's. Regular admin cannot delete notes written by
 * someone else — keeps accountability.
 */
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await deleteAdminNote(
    id,
    (session.user as { id: string }).id,
    role as "admin" | "superadmin",
  );
  if (!result.ok) {
    const status = result.error === "forbidden" ? 403
                 : result.error === "not_found" ? 404
                 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
