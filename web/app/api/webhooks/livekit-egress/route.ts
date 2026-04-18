import { NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";

/**
 * LiveKit Egress webhook. Configured in livekit.yaml:
 *
 *   webhooks:
 *     - url: https://b2c.aprender-aleman.de/api/webhooks/livekit-egress
 *       api_key: <LIVEKIT_API_KEY>
 *
 * LiveKit signs every payload with the API secret. We validate the
 * signature with the SDK's WebhookReceiver and react to:
 *
 *   - egress_started    → insert a recordings row with status='processing'
 *                         so the class page immediately shows "procesando…"
 *   - egress_updated    → on completion, patch file_url/size/duration and
 *                         flip status='ready'. Notify teacher + students.
 *   - egress_ended      → same completion path; LiveKit fires both
 *                         egress_ended and egress_updated, so we dedupe by
 *                         checking current status before updating.
 *
 * We use the class's livekit_room_id to find the owning class row, so no
 * explicit mapping of egress_id → class_id needs to exist ahead of time.
 */

function receiver(): WebhookReceiver {
  const key    = process.env.LIVEKIT_API_KEY!;
  const secret = process.env.LIVEKIT_API_SECRET!;
  return new WebhookReceiver(key, secret);
}

type EgressInfo = {
  egress_id?: string;
  room_id?:   string;
  room_name?: string;
  status?:    string;                        // "EGRESS_COMPLETE", "EGRESS_FAILED", …
  file?: {
    location?: string;
    size?:     string | number;
  };
  file_results?: Array<{
    location?: string;
    size?:     string | number;
    duration?: string | number;              // nanoseconds as string
  }>;
  error?: string;
  ended_at?: string | number;                // nanoseconds
  started_at?: string | number;
};

type EgressEvent = {
  event:       string;
  egress_info?: EgressInfo;
  id?:         string;
  created_at?: number;
};

export async function POST(req: Request) {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const body = await req.text();
  const authHeader = req.headers.get("authorization") ?? "";

  let event: EgressEvent;
  try {
    event = await receiver().receive(body, authHeader) as EgressEvent;
  } catch (e) {
    console.warn("egress webhook signature invalid:", e);
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const info = event.egress_info;
  if (!info?.egress_id) {
    return NextResponse.json({ ok: true, ignored: "no_egress_info" });
  }

  const sb = supabaseAdmin();
  const roomName = info.room_name;
  if (!roomName) {
    return NextResponse.json({ ok: true, ignored: "no_room_name" });
  }

  // Resolve the class this recording belongs to.
  const { data: cls } = await sb
    .from("classes")
    .select("id, title, teacher_id, teacher:teachers!inner(user_id), class_participants(students!inner(user_id))")
    .eq("livekit_room_id", roomName)
    .maybeSingle();

  if (!cls) {
    return NextResponse.json({ ok: true, ignored: "class_not_found_for_room" });
  }
  const classId = (cls as { id: string }).id;

  // STARTED: upsert a row in processing state so the class page can surface "procesando…".
  if (event.event === "egress_started") {
    await sb.from("recordings").upsert(
      {
        egress_id: info.egress_id,
        class_id:  classId,
        status:    "processing",
      },
      { onConflict: "egress_id" },
    );
    return NextResponse.json({ ok: true, phase: "started" });
  }

  // COMPLETE / UPDATED: pull out the final file info and flip to ready.
  if (event.event === "egress_updated" || event.event === "egress_ended") {
    const fileResult = info.file_results?.[0];
    const fileUrl  = fileResult?.location ?? info.file?.location ?? null;
    const fileSize = Number(fileResult?.size ?? info.file?.size ?? 0) || null;
    const durationNs = fileResult?.duration !== undefined ? Number(fileResult.duration) : 0;
    const durationSeconds = durationNs > 0 ? Math.round(durationNs / 1_000_000_000) : null;

    const failed = info.status === "EGRESS_FAILED" || Boolean(info.error);
    const finalStatus = failed ? "failed" : "ready";

    const { data: existing } = await sb
      .from("recordings")
      .select("id, status")
      .eq("egress_id", info.egress_id)
      .maybeSingle();

    const patch = {
      class_id:         classId,
      egress_id:        info.egress_id,
      file_url:         fileUrl,
      file_size_bytes:  fileSize,
      duration_seconds: durationSeconds,
      status:           finalStatus,
      error:            failed ? (info.error ?? "egress_failed") : null,
      processed_at:     new Date().toISOString(),
    };

    if (existing) {
      // Already at ready/failed? skip to avoid re-notifying.
      if ((existing as { status: string }).status === "ready" && !failed) {
        return NextResponse.json({ ok: true, phase: "already_ready" });
      }
      await sb.from("recordings").update(patch).eq("id", (existing as { id: string }).id);
    } else {
      await sb.from("recordings").insert(patch);
    }

    // Notify participants when the recording becomes viewable.
    if (finalStatus === "ready" && fileUrl) {
      try {
        const teacherUserId = extractUserId((cls as Record<string, unknown>).teacher);
        const studentUserIds = extractStudentUserIds(
          (cls as Record<string, unknown>).class_participants,
        );
        const allUserIds = [teacherUserId, ...studentUserIds].filter(Boolean) as string[];
        const recId = existing?.id ?? (await findRecordingIdByEgressId(info.egress_id));

        for (const uid of allUserIds) {
          await createNotification({
            user_id:  uid,
            type:     "recording_ready",
            title:    "Grabación disponible",
            body:     `Ya puedes ver la grabación de "${(cls as { title: string }).title}".`,
            link:     recId ? `/grabacion/${recId}` : null,
            class_id: classId,
          });
        }
      } catch (e) {
        console.error("recording_ready notifications failed:", e);
      }
    }

    return NextResponse.json({ ok: true, phase: finalStatus });
  }

  return NextResponse.json({ ok: true, ignored: `event:${event.event}` });
}

function extractUserId(teacher: unknown): string | null {
  const t = Array.isArray(teacher) ? teacher[0] : teacher;
  return ((t as { user_id?: string } | null)?.user_id) ?? null;
}

function extractStudentUserIds(parts: unknown): string[] {
  const arr = (parts as Array<{ students: unknown }>) ?? [];
  const out: string[] = [];
  for (const p of arr) {
    const s = Array.isArray(p.students) ? p.students[0] : p.students;
    const uid = (s as { user_id?: string } | null)?.user_id;
    if (uid) out.push(uid);
  }
  return out;
}

async function findRecordingIdByEgressId(egressId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("recordings").select("id").eq("egress_id", egressId).maybeSingle();
  return ((data as { id: string } | null)?.id) ?? null;
}
