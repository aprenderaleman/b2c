import { NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { logClassHoursAndRollup } from "@/lib/finance";

/**
 * POST /api/webhooks/livekit-room
 *
 * Handles LiveKit room lifecycle events:
 *   - room_started  → record room_opened_at on the class
 *   - room_finished → auto-complete the class if still live,
 *                     using real duration from started_at to now
 *
 * This is the safety net that makes hour tracking 100% automatic.
 * If the teacher already ended the class via /api/aula/[id]/end,
 * room_finished is a no-op (class is already completed).
 */

function receiver(): WebhookReceiver {
  const key    = process.env.LIVEKIT_API_KEY!;
  const secret = process.env.LIVEKIT_API_SECRET!;
  return new WebhookReceiver(key, secret);
}

type RoomEvent = {
  event: string;
  room?: {
    name?:          string;
    sid?:           string;
    creation_time?: number; // unix seconds
  };
  participant?: {
    identity?: string;
    joined_at?: number;
  };
  id?:         string;
  created_at?: number; // unix nanoseconds
};

export async function POST(req: Request) {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const body = await req.text();
  const authHeader = req.headers.get("authorization") ?? "";

  let event: RoomEvent;
  try {
    event = await receiver().receive(body, authHeader) as RoomEvent;
  } catch (e) {
    console.warn("room webhook signature invalid:", e);
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const roomName = event.room?.name;
  if (!roomName) {
    return NextResponse.json({ ok: true, ignored: "no_room_name" });
  }

  const sb = supabaseAdmin();

  // Find the class by livekit_room_id
  const { data: cls } = await sb
    .from("classes")
    .select("id, status, started_at, teacher_id, is_content_recording")
    .eq("livekit_room_id", roomName)
    .maybeSingle();

  if (!cls) {
    return NextResponse.json({ ok: true, ignored: "class_not_found" });
  }

  const classId   = (cls as { id: string }).id;
  const status    = (cls as { status: string }).status;
  const teacherId = (cls as { teacher_id: string }).teacher_id;
  const startedAt = (cls as { started_at: string | null }).started_at;
  const isContent = (cls as { is_content_recording?: boolean }).is_content_recording;

  if (event.event === "room_started") {
    await sb
      .from("classes")
      .update({ room_opened_at: new Date().toISOString() })
      .eq("id", classId);
    return NextResponse.json({ ok: true, phase: "room_opened" });
  }

  if (event.event === "room_finished") {
    const now = new Date();

    // Record room close time regardless of class status
    await sb
      .from("classes")
      .update({ room_closed_at: now.toISOString() })
      .eq("id", classId);

    // If class is already completed or cancelled, nothing more to do
    if (status === "completed" || status === "cancelled" || status === "absent") {
      return NextResponse.json({ ok: true, phase: "already_closed" });
    }

    // Auto-complete: class is still 'live' (or 'scheduled' if teacher
    // never clicked start but the room ran anyway)
    const realStarted = startedAt ? new Date(startedAt) : (
      event.room?.creation_time
        ? new Date(event.room.creation_time * 1000)
        : null
    );

    let actualMinutes = 50; // fallback
    if (realStarted) {
      actualMinutes = Math.round((now.getTime() - realStarted.getTime()) / 60000);
      if (actualMinutes < 1) actualMinutes = 1;
      if (actualMinutes > 240) actualMinutes = 240;
    }

    const { error } = await sb
      .from("classes")
      .update({
        status:                  "completed",
        ended_at:                now.toISOString(),
        actual_duration_minutes: actualMinutes,
      })
      .eq("id", classId)
      .in("status", ["live", "scheduled"]);

    if (error) {
      console.error("room_finished auto-complete failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Trigger billing (same as manual end flow)
    if (!isContent) {
      try {
        await logClassHoursAndRollup({
          classId,
          teacherId,
          durationMinutes: actualMinutes,
        });
      } catch (e) {
        console.error("room_finished billing failed:", e);
      }
    }

    return NextResponse.json({ ok: true, phase: "auto_completed", minutes: actualMinutes });
  }

  return NextResponse.json({ ok: true, ignored: `event:${event.event}` });
}
