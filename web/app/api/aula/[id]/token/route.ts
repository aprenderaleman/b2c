import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorizeAulaAccess, authorizeTrialAulaAccess } from "@/lib/aula";
import { livekitConfigured, livekitUrl, mintLivekitToken } from "@/lib/livekit";
import { getTrialSession } from "@/lib/trial-token";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/aula/[id]/token
 *
 * Returns a LiveKit JWT the browser uses to join the class's room.
 *
 * Two callers supported:
 *   - logged-in users (admin/teacher/student) — usual path
 *   - trial-class leads via the magic-link cookie aa_trial_session
 *     — they have no user row, but are still entitled to enter their
 *     own trial class.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const trial   = !session?.user ? await getTrialSession() : null;

  if (!session?.user && !trial) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  let access: Awaited<ReturnType<typeof authorizeAulaAccess>>;
  let identity: string;
  let displayName: string;

  if (session?.user) {
    const userId = (session.user as { id: string }).id;
    const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;
    access = await authorizeAulaAccess(id, userId, role);
    identity = userId;
    displayName = session.user.name ?? session.user.email ?? "Participante";
  } else {
    if (!trial || trial.class_id !== id) {
      return NextResponse.json({ ok: false, reason: "not_authorized" }, { status: 403 });
    }
    access = await authorizeTrialAulaAccess(id, trial.lead_id);
    identity = `lead:${trial.lead_id}`;
    const sb = supabaseAdmin();
    const { data: lead } = await sb.from("leads").select("name").eq("id", trial.lead_id).maybeSingle();
    displayName = (lead as { name: string | null } | null)?.name ?? "Invitado";
  }

  if (!access.ok) {
    return NextResponse.json({ ok: false, reason: access.reason }, { status: 403 });
  }
  if (!access.canEnterNow) {
    return NextResponse.json({
      ok: false, reason: "too_early_or_too_late",
      opensAt:  access.opensAt.toISOString(),
      closesAt: access.closesAt.toISOString(),
    }, { status: 403 });
  }

  if (!livekitConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "not_configured" },
      { status: 503 },
    );
  }

  const token = await mintLivekitToken({
    identity,
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
