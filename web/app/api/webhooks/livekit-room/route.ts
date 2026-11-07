import { NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { logClassHoursAndRollup } from "@/lib/finance";

type RoomEvent = {
  event: string;
  room?: {
    name?:          string;
    sid?:           string;
    creation_time?: number;
  };
  participant?: {
    identity?:  string;
    joined_at?: number;
  };
  id?:         string;
  created_at?: number;
};

/**
 * Extract the lead or user id from a LiveKit participant identity.
 *   Lead format:  "lead:{uuid}-{suffix}"  → { type: "lead", id: uuid }
 *   User format:  "{uuid}-{suffix}"       → { type: "user", id: uuid }
 */
function parseIdentity(identity: string): { type: "lead" | "user"; id: string } | null {
  if (identity.startsWith("lead:")) {
    const rest = identity.slice(5);
    const dashIdx = rest.indexOf("-", 36);
    const id = dashIdx > 0 ? rest.slice(0, dashIdx) : rest;
    if (id.length >= 36) return { type: "lead", id };
    return null;
  }
  const dashIdx = identity.indexOf("-", 36);
  const id = dashIdx > 0 ? identity.slice(0, dashIdx) : identity;
  if (id.length >= 36) return { type: "user", id };
  return null;
}

/**
 * Core room event handler, exported so the egress webhook can delegate
 * room_started/room_finished events here without needing a second
 * LiveKit webhook URL configured.
 */
export async function handleRoomEvent(event: RoomEvent): Promise<Response> {
  const roomName = event.room?.name;
  if (!roomName) {
    return NextResponse.json({ ok: true, ignored: "no_room_name" });
  }

  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select("id, status, started_at, teacher_id, is_content_recording, is_trial, lead_id")
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
  const isTrial   = Boolean((cls as { is_trial?: boolean }).is_trial);
  const leadId    = (cls as { lead_id?: string | null }).lead_id;

  if (event.event === "room_started") {
    await sb
      .from("classes")
      .update({ room_opened_at: new Date().toISOString() })
      .eq("id", classId);
    return NextResponse.json({ ok: true, phase: "room_opened" });
  }

  if (event.event === "room_finished") {
    const now = new Date();

    await sb
      .from("classes")
      .update({ room_closed_at: now.toISOString() })
      .eq("id", classId);

    if (status === "completed" || status === "cancelled" || status === "absent") {
      return NextResponse.json({ ok: true, phase: "already_closed" });
    }

    const realStarted = startedAt ? new Date(startedAt) : (
      event.room?.creation_time
        ? new Date(event.room.creation_time * 1000)
        : null
    );

    let actualMinutes = 50;
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

  // ── participant_joined: auto-detect attendance ──────────────────
  if (event.event === "participant_joined") {
    const identity = event.participant?.identity;
    if (!identity) return NextResponse.json({ ok: true, ignored: "no_identity" });

    const parsed = parseIdentity(identity);
    if (!parsed) return NextResponse.json({ ok: true, ignored: "unparseable_identity" });

    const now = new Date().toISOString();

    if (parsed.type === "lead" && isTrial && leadId === parsed.id) {
      // Trial lead entered the room → mark attended (idempotent)
      const { data: lead } = await sb
        .from("leads")
        .select("id, trial_attended_at, trial_absent_at")
        .eq("id", parsed.id)
        .maybeSingle();

      if (lead && !(lead as { trial_attended_at: string | null }).trial_attended_at) {
        await sb.from("leads").update({
          trial_attended_at: now,
        }).eq("id", parsed.id)
          .is("trial_attended_at", null);

        await sb.from("lead_timeline").insert({
          lead_id: parsed.id,
          type:    "status_change",
          author:  "system",
          content: "Asistencia detectada automáticamente — el lead entró al aula de LiveKit.",
          metadata: {
            kind:     "trial_attended_auto",
            actor:    "livekit_webhook",
            class_id: classId,
          },
        }).then(() => {}, () => {});

        return NextResponse.json({ ok: true, phase: "lead_attendance_marked", leadId: parsed.id });
      }
      return NextResponse.json({ ok: true, phase: "lead_already_marked" });
    }

    if (parsed.type === "user") {
      // Regular student/teacher joined → populate joined_at
      const { data: student } = await sb
        .from("students")
        .select("id")
        .eq("user_id", parsed.id)
        .maybeSingle();

      if (student) {
        await sb
          .from("class_participants")
          .update({ joined_at: now })
          .eq("class_id", classId)
          .eq("student_id", (student as { id: string }).id)
          .is("joined_at", null);

        return NextResponse.json({ ok: true, phase: "student_joined", studentId: (student as { id: string }).id });
      }
    }

    return NextResponse.json({ ok: true, ignored: "participant_no_match" });
  }

  // ── participant_left: record departure time ───────────────────
  if (event.event === "participant_left") {
    const identity = event.participant?.identity;
    if (!identity) return NextResponse.json({ ok: true, ignored: "no_identity" });

    const parsed = parseIdentity(identity);
    if (!parsed || parsed.type !== "user") {
      return NextResponse.json({ ok: true, ignored: "left_not_student" });
    }

    const now = new Date().toISOString();
    const { data: student } = await sb
      .from("students")
      .select("id")
      .eq("user_id", parsed.id)
      .maybeSingle();

    if (student) {
      await sb
        .from("class_participants")
        .update({ left_at: now })
        .eq("class_id", classId)
        .eq("student_id", (student as { id: string }).id);

      return NextResponse.json({ ok: true, phase: "student_left" });
    }
    return NextResponse.json({ ok: true, ignored: "left_no_student" });
  }

  return NextResponse.json({ ok: true, ignored: `event:${event.event}` });
}

function receiver(): WebhookReceiver {
  const key    = process.env.LIVEKIT_API_KEY!;
  const secret = process.env.LIVEKIT_API_SECRET!;
  return new WebhookReceiver(key, secret);
}

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

  return handleRoomEvent(event);
}
