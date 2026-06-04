import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
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
 *
 * Cada token mint genera una identity ÚNICA (userId + sufijo aleatorio)
 * para que un mismo usuario pueda unirse desde varios dispositivos
 * simultáneamente (caso Sandra 02/06: cámara del PC rota → quería usar
 * móvil para vídeo + PC para leer ejercicios). LiveKit antes expulsaba
 * la primera sesión al conectarse la segunda porque la identity era
 * únicamente userId.
 *
 * El display name se mantiene como el nombre del usuario, así el profe
 * ve "Sandra" en la lista (con dispositivo opcional entre paréntesis).
 * La asistencia se trackea por student_id en class_participants, así
 * que múltiples conexiones del mismo alumno NO inflan asistencia.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const trial   = !session?.user ? await getTrialSession() : null;

  if (!session?.user && !trial) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // Detección heurística de dispositivo para etiqueta humana
  // ("Sandra (móvil)" / "Sandra (PC)"). NO afecta a la identity — esa
  // siempre es única por mint.
  const ua = req.headers.get("user-agent") ?? "";
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const deviceLabel = isMobile ? "móvil" : "PC";
  const deviceSuffix = randomBytes(4).toString("hex");

  let access: Awaited<ReturnType<typeof authorizeAulaAccess>>;
  let identity: string;
  let displayName: string;

  if (session?.user) {
    const userId = (session.user as { id: string }).id;
    const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;
    access = await authorizeAulaAccess(id, userId, role);
    // Unique identity per mint: userId + suffix. Permite múltiples
    // dispositivos a la vez sin que LiveKit los expulse mutuamente.
    identity = `${userId}-${deviceSuffix}`;
    const baseName = session.user.name ?? session.user.email ?? "Participante";
    displayName = `${baseName} (${deviceLabel})`;
  } else {
    if (!trial || trial.class_id !== id) {
      return NextResponse.json({ ok: false, reason: "not_authorized" }, { status: 403 });
    }
    access = await authorizeTrialAulaAccess(id, trial.lead_id);
    identity = `lead:${trial.lead_id}-${deviceSuffix}`;
    const sb = supabaseAdmin();
    const { data: lead } = await sb.from("leads").select("name").eq("id", trial.lead_id).maybeSingle();
    const baseName = (lead as { name: string | null } | null)?.name ?? "Invitado";
    displayName = `${baseName} (${deviceLabel})`;
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
