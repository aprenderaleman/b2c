import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hideComment } from "@/lib/serie";

/** DELETE /api/admin/serie/comments/[id] → oculta el comentario (deleted_at). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await hideComment(id);
  return NextResponse.json({ ok: true });
}
