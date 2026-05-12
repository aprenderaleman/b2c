import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revokeInvitation } from "@/lib/teacher-invitations";

/**
 * POST /api/admin/teacher-invitations/[id]/revoke
 *
 * Invalida una invitación pendiente (no la borra — la marca con
 * revoked_at=now). Auth: admin / superadmin.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await revokeInvitation(id);
  return NextResponse.json({ ok: true });
}
