import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { addStudentToGroup } from "@/lib/group-membership";
import { MAX_SESSIONS_PER_SCHEDULE } from "@/lib/schedule";

/**
 * POST /api/admin/groups/with-schedule
 *
 * Single-shot atomic creation of a class group AND its full schedule.
 * Drives the "Crear grupo + agenda" wizard at /admin/grupos.
 *
 * Body:
 *   {
 *     group: {
 *       name, class_type, levels[], teacher_id?, capacity?, notes?,
 *       total_sessions?
 *     },
 *     members: uuid[],                              // student ids
 *     classes: [{ scheduled_at_iso, duration_min }]  // already in UTC ISO
 *   }
 *
 * Steps:
 *   1. Insert the student_groups row.
 *   2. Insert each class with `group_id`, status='scheduled',
 *      teacher_id from group.teacher_id (so future class lifecycle
 *      stays consistent). The first class becomes the parent
 *      (parent_class_id = self), all others reference it.
 *   3. Wire student_group_members for every member, and
 *      class_participants on every class via the shared helper from
 *      lib/group-membership (which already handles propagation).
 *
 * On any insert failure we rollback the rows we created so the user
 * can retry without orphans.
 */
export const runtime = "nodejs";

const Body = z.object({
  group: z.object({
    name:            z.string().trim().min(2).max(200),
    class_type:      z.enum(["group", "individual"]).default("group"),
    levels:          z.array(z.enum(["A0","A1","A2","B1","B2","C1","C2"])).max(7).default([]),
    teacher_id:      z.string().uuid(),
    capacity:        z.coerce.number().int().min(1).max(50).default(10),
    notes:           z.string().trim().max(2000).nullable().optional(),
    total_sessions:  z.coerce.number().int().min(1).max(500).nullable().optional(),
  }),
  members: z.array(z.string().uuid()).max(50).default([]),
  classes: z.array(
    z.object({
      scheduled_at_iso: z.string().datetime(),
      duration_min:     z.coerce.number().int().min(15).max(240),
    }),
  ).min(1).max(MAX_SESSIONS_PER_SCHEDULE),
  /** Default class title — used on every class row. */
  title: z.string().trim().min(2).max(200),
  topic: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  const sb = supabaseAdmin();

  // ── 1. Insert the group ──
  const { data: groupRow, error: groupErr } = await sb
    .from("student_groups")
    .insert({
      name:           b.group.name,
      class_type:     b.group.class_type,
      level:          b.group.levels[0] ?? null,
      levels:         b.group.levels,
      teacher_id:     b.group.teacher_id,
      capacity:       b.group.capacity,
      notes:          b.group.notes ?? null,
      total_sessions: b.group.total_sessions ?? null,
      active:         true,
    })
    .select("id")
    .single();
  if (groupErr || !groupRow) {
    return NextResponse.json({ error: "group_insert_failed", message: groupErr?.message }, { status: 500 });
  }
  const groupId = (groupRow as { id: string }).id;

  // ── 2. Insert classes — first one becomes the parent ──
  // Sort by scheduled_at so chronology matches the parent_class_id chain.
  const sorted = [...b.classes].sort((a, c) =>
    a.scheduled_at_iso.localeCompare(c.scheduled_at_iso),
  );

  const baseRow = {
    type:               b.group.class_type,
    teacher_id:         b.group.teacher_id,
    title:              b.title,
    topic:              b.topic ?? null,
    group_id:           groupId,
    recurrence_pattern: "none" as const,    // wizard uses explicit dates; recurrence is informational only
    status:             "scheduled" as const,
  };

  // First (parent) class
  const { data: parent, error: parentErr } = await sb
    .from("classes")
    .insert({
      ...baseRow,
      scheduled_at:     sorted[0].scheduled_at_iso,
      duration_minutes: sorted[0].duration_min,
      parent_class_id:  null,
    })
    .select("id")
    .single();
  if (parentErr || !parent) {
    // Rollback the group.
    await sb.from("student_groups").delete().eq("id", groupId);
    return NextResponse.json({ error: "parent_class_insert_failed", message: parentErr?.message }, { status: 500 });
  }
  const parentId = (parent as { id: string }).id;
  // Patch parent to point at itself so every series instance is
  // findable by `parent_class_id = parentId`.
  await sb.from("classes").update({ parent_class_id: parentId }).eq("id", parentId);

  // Remaining classes
  const restRows = sorted.slice(1).map(c => ({
    ...baseRow,
    scheduled_at:     c.scheduled_at_iso,
    duration_minutes: c.duration_min,
    parent_class_id:  parentId,
  }));
  const allClassIds: string[] = [parentId];
  if (restRows.length > 0) {
    const { data: rest, error: restErr } = await sb
      .from("classes")
      .insert(restRows)
      .select("id");
    if (restErr) {
      // Rollback parent + group.
      await sb.from("classes").delete().eq("id", parentId);
      await sb.from("student_groups").delete().eq("id", groupId);
      return NextResponse.json({ error: "classes_insert_failed", message: restErr.message }, { status: 500 });
    }
    for (const r of rest ?? []) allClassIds.push((r as { id: string }).id);
  }

  // ── 3. Members → student_group_members + class_participants ──
  // We delegate to the existing helper so behaviour matches the
  // already-shipped add-student-to-group flow (handles dedup,
  // notification email, in-app notification). The first member upsert
  // re-fetches future classes — by then we just inserted them, so
  // each new member gets enrolled in every class of the group.
  for (const studentId of b.members) {
    const r = await addStudentToGroup(groupId, studentId);
    if (!r.ok) {
      // Don't roll back — the group + classes already exist and are
      // valid even with partial membership. Log + continue.
      console.error(`[with-schedule] add-member failed for ${studentId}:`, r.reason);
    }
  }

  return NextResponse.json({
    ok:        true,
    groupId,
    parentClassId: parentId,
    classIds:  allClassIds,
  });
}
