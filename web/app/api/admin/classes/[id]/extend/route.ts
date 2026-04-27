import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/classes/[id]/extend
 * Body: { count: int 1..52 }
 *
 * Adds N more class instances to an existing recurring series. The
 * caller can target any class in the series (parent or child) — we
 * find the head via `parent_class_id ?? id`, take the latest existing
 * instance as the anchor, and apply the series' recurrence pattern N
 * more times forward.
 *
 * The new rows inherit:
 *   - teacher_id, type, duration_minutes, title, topic, group_id,
 *     notes_admin from the head class
 *   - parent_class_id = head id
 *   - status = 'scheduled'
 *
 * Participants:
 *   - If the series is group-linked (group_id != null), each new row
 *     gets the CURRENT student_group_members of that group. Same path
 *     used by lib/group-membership.ts addStudentToGroup so the
 *     behaviour matches.
 *   - Otherwise, copies the participant set from the most recent
 *     existing instance (the closest "what we have today" snapshot).
 *
 * Refuses to extend if the head class' `recurrence_pattern` is 'none'
 * — there's no rhythm to follow.
 */
export const runtime = "nodejs";

const Body = z.object({
  count: z.coerce.number().int().min(1).max(52),
});

const STRIDE_DAYS: Record<string, number | null> = {
  weekly:   7,
  biweekly: 14,
  monthly:  null,   // handled separately (month math)
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const count = parsed.data.count;

  const sb = supabaseAdmin();

  // ── Find the head of the series ──
  const { data: anchor } = await sb
    .from("classes")
    .select("id, parent_class_id, recurrence_pattern, type, teacher_id, duration_minutes, title, topic, group_id, notes_admin")
    .eq("id", id)
    .maybeSingle();
  if (!anchor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const a = anchor as {
    id: string;
    parent_class_id: string | null;
    recurrence_pattern: "none" | "weekly" | "biweekly" | "monthly";
    type: "individual" | "group";
    teacher_id: string;
    duration_minutes: number;
    title: string;
    topic: string | null;
    group_id: string | null;
    notes_admin: string | null;
  };

  if (a.recurrence_pattern === "none") {
    return NextResponse.json({
      error: "no_recurrence",
      message: "Esta clase es única — no se puede extender. Crea una nueva serie.",
    }, { status: 400 });
  }

  const headId = a.parent_class_id ?? a.id;

  // Read the head's recurrence pattern in case the user clicked on a
  // child whose pattern column might be out of date.
  const { data: head } = await sb
    .from("classes")
    .select("recurrence_pattern, type, teacher_id, duration_minutes, title, topic, group_id, notes_admin, recurrence_end_date")
    .eq("id", headId)
    .maybeSingle();
  const h = head as typeof a & { recurrence_end_date: string | null };
  if (!h) return NextResponse.json({ error: "head_missing" }, { status: 500 });

  // ── Find the latest existing instance ──
  const { data: latestRows } = await sb
    .from("classes")
    .select("id, scheduled_at")
    .or(`id.eq.${headId},parent_class_id.eq.${headId}`)
    .order("scheduled_at", { ascending: false })
    .limit(1);
  const latest = ((latestRows ?? []) as Array<{ id: string; scheduled_at: string }>)[0];
  if (!latest) {
    return NextResponse.json({ error: "no_existing_instances" }, { status: 500 });
  }

  // ── Generate N new dates after `latest` ──
  const stride = STRIDE_DAYS[h.recurrence_pattern];
  const cursor = new Date(latest.scheduled_at);
  const newDates: string[] = [];
  for (let i = 0; i < count; i++) {
    if (h.recurrence_pattern === "monthly") {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else if (stride !== null) {
      cursor.setUTCDate(cursor.getUTCDate() + stride);
    }
    newDates.push(cursor.toISOString());
  }

  // ── Resolve participants for the new instances ──
  let participantStudentIds: string[] = [];
  if (h.group_id) {
    const { data: members } = await sb
      .from("student_group_members")
      .select("student_id")
      .eq("group_id", h.group_id);
    participantStudentIds = ((members ?? []) as Array<{ student_id: string }>).map(r => r.student_id);
  } else {
    const { data: latestParts } = await sb
      .from("class_participants")
      .select("student_id")
      .eq("class_id", latest.id);
    participantStudentIds = ((latestParts ?? []) as Array<{ student_id: string }>).map(r => r.student_id);
  }

  // ── Bulk insert the new class rows ──
  const newRows = newDates.map(iso => ({
    type:                h.type,
    teacher_id:          h.teacher_id,
    scheduled_at:        iso,
    duration_minutes:    h.duration_minutes,
    recurrence_pattern:  h.recurrence_pattern,
    // Don't drag the legacy recurrence_end_date forward — that's the
    // OLD end. The new rows are open-ended additions.
    recurrence_end_date: null,
    parent_class_id:     headId,
    title:               h.title,
    topic:               h.topic,
    group_id:            h.group_id,
    notes_admin:         h.notes_admin,
    status:              "scheduled" as const,
  }));
  const { data: inserted, error: insErr } = await sb
    .from("classes")
    .insert(newRows)
    .select("id");
  if (insErr) {
    return NextResponse.json({ error: "insert_failed", message: insErr.message }, { status: 500 });
  }
  const newIds = ((inserted ?? []) as Array<{ id: string }>).map(r => r.id);

  // ── Wire participants for each new class ──
  if (newIds.length > 0 && participantStudentIds.length > 0) {
    const partRows = newIds.flatMap(cid =>
      participantStudentIds.map(sid => ({
        class_id:          cid,
        student_id:        sid,
        attended:          null,
        counts_as_session: true,
      })),
    );
    const { error: partErr } = await sb
      .from("class_participants")
      .upsert(partRows, { onConflict: "class_id,student_id" });
    if (partErr) {
      // Roll back the class rows so we don't leave orphans.
      await sb.from("classes").delete().in("id", newIds);
      return NextResponse.json({ error: "participants_insert_failed", message: partErr.message }, { status: 500 });
    }
  }

  // ── Bump the group's total_sessions if the column exists ──
  // (Tarea A adds the column; this code is a no-op until then because
  // Supabase's update() with a non-existent column would error — so we
  // skip if the value is unknown.)
  if (h.group_id) {
    const { data: g } = await sb
      .from("student_groups")
      .select("total_sessions")
      .eq("id", h.group_id)
      .maybeSingle();
    if (g && (g as { total_sessions?: number | null }).total_sessions != null) {
      const current = (g as { total_sessions: number }).total_sessions;
      await sb.from("student_groups")
        .update({ total_sessions: current + count })
        .eq("id", h.group_id);
    }
  }

  return NextResponse.json({
    ok:               true,
    addedCount:       newIds.length,
    newClassIds:      newIds,
    seriesNewSize:    null,  // computed by caller via getClassById refresh
  });
}
