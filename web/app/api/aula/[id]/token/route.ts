import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorizeAulaAccess } from "@/lib/aula";
import { livekitConfigured, livekitUrl, mintLivekitToken } from "@/lib/livekit";

/**
 * POST /api/aula/[id]/token
 *
 * Returns a LiveKit JWT the browser uses to join the class's room. Caller
 * must be authed AND allowed by authorizeAulaAccess(): participant/teacher
 * within the 15-before → 30-after-class window.
 *
 * Response:
 *   { ok: true, token, url, role }
 *   { ok: false, reason: "not_configured" | "not_authorized" | ... }
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const access = await authorizeAulaAccess(id, userId, role);
  if (!access.ok) {
    return NextResponse.json({ ok: false, reason: access.reason }, { status: 403 });
  }
  if (!access.canEnterNow) {
    return NextResponse.json({
      ok: false, reason: "too_early_or_too_late",
      opensAt: access.opensAt.toISOString(),
      closesAt: access.closesAt.toISOString(),
    }, { status: 403 });
  }

  if (!livekitConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "not_configured" },
      { status: 503 },
    );
  }

  const displayName = session.user.name ?? session.user.email ?? "Participante";
  const token = await mintLivekitToken({
    identity: userId,
    name:     displayName,
    roomName: access.roomName,
    isHost:   access.role === "host",
  });

  return NextResponse.json({
    ok:    true,
    token,
    url:   livekitUrl(),
    role:  access.role,
    room:  access.roomName,
  });
}
