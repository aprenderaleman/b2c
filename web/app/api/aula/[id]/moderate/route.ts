import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { auth } from "@/lib/auth";
import { authorizeAulaAccess } from "@/lib/aula";
import { livekitConfigured, livekitUrl } from "@/lib/livekit";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/aula/{id}/moderate
 *
 * Teacher-only moderation endpoints. Requires:
 *   - Authenticated session
 *   - User is the class's teacher (OR admin/superadmin)
 *
 * Actions:
 *   - mute_audio      { identity }      mute participant's microphone
 *   - mute_video      { identity }      mute participant's camera
 *   - kick            { identity }      remove participant from the room
 *   - end_class                         delete the room — disconnects everyone
 *
 * Behind the scenes uses LiveKit's RoomService admin API with our server
 * credentials. The browser never touches those credentials.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

type Body = {
  action:   "mute_audio" | "mute_video" | "kick" | "end_class";
  identity?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: classId } = await params;
  const userRole = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;
  const decision = await authorizeAulaAccess(
    classId,
    (session.user as { id: string }).id,
    userRole,
  );

  // Only the host (teacher of this class) or an admin can moderate.
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  const isHost  = decision.ok && decision.role === "host";
  if (!decision.ok || (!isHost && !isAdmin)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  if (!livekitConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("livekit_room_id, status")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const roomName = (cls as { livekit_room_id: string }).livekit_room_id;

  const httpsUrl = livekitUrl().replace(/^wss:/, "https:");
  const svc = new RoomServiceClient(
    httpsUrl,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );

  try {
    switch (body.action) {
      case "end_class": {
        // Deleting the room disconnects every participant.
        await svc.deleteRoom(roomName);
        // Also mark our class as ending — the teacher will still confirm
        // the real duration in the end-class flow.
        await sb.from("classes")
          .update({ status: "completed", ended_at: new Date().toISOString() })
          .eq("id", classId);
        return NextResponse.json({ ok: true });
      }

      case "kick": {
        if (!body.identity) return NextResponse.json({ error: "missing_identity" }, { status: 400 });
        await svc.removeParticipant(roomName, body.identity);
        return NextResponse.json({ ok: true });
      }

      case "mute_audio":
      case "mute_video": {
        if (!body.identity) return NextResponse.json({ error: "missing_identity" }, { status: 400 });
        // Find the matching track sid for this participant and source.
        const p = await svc.getParticipant(roomName, body.identity);
        // Track source enum: 1 = CAMERA, 2 = MICROPHONE, 3 = SCREEN_SHARE
        const wantSource = body.action === "mute_audio" ? 2 : 1;
        const tracks = (p.tracks ?? []).filter(t => t.source === wantSource);
        if (tracks.length === 0) {
          // Nothing to mute — participant doesn't currently publish this source.
          return NextResponse.json({ ok: true, note: "no_track" });
        }
        for (const t of tracks) {
          await svc.mutePublishedTrack(roomName, body.identity, t.sid, true);
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "livekit_error", message }, { status: 500 });
  }
}
