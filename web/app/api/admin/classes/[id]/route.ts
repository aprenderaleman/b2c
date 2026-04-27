import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { cancelClass } from "@/lib/classes";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH  /api/admin/classes/[id]   → edit a class or a whole series.
 * DELETE /api/admin/classes/[id]?whole=1 → cancel (existing behaviour).
 *
 * PATCH body:
 *   {
 *     scope:              "this" | "series"       required
 *     scheduled_at?:      ISO datetime
 *     duration_minutes?:  int 15..240
 *     title?:             string
 *     topic?:             string | null
 *     teacher_id?:        uuid                    (reassign)
 *     decouple_group?:    boolean                 (sets group_id=NULL)
 *     participants_set?:  uuid[] (max 50)         (replace member list)
 *   }
 *
 * When scope === "series" AND the class is part of a recurrence chain
 * (parent_class_id set OR this class IS the parent), the change applies
 * to THIS class and every LATER still-scheduled instance. Past classes
 * (status='completed'|'cancelled' or scheduled_at earlier than this
 * anchor) are left alone — editing history would break attendance.
 *
 * For scheduled_at on "series", we apply the time DELTA (new - old) to
 * every affected instance so weekly spacing is preserved.
 *
 * `participants_set` requires the class to have NO group link
 * (`classes.group_id IS NULL`) — a group-driven class gets its members
 * synced from `student_group_members`, so per-class edits would be
 * silently overwritten on the next group update. If you also pass
 * `decouple_group: true` in the same request the decouple runs FIRST,
 * so the participant edit lands cleanly.
 */
export const runtime = "nodejs";

const PatchBody = z.object({
  scope:            z.enum(["this", "series"]),
  scheduled_at:     z.string().datetime().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(240).optional(),
  title:            z.string().trim().min(1).max(200).optional(),
  topic:            z.string().trim().max(500).nullable().optional(),
  teacher_id:       z.string().uuid().optional(),
  decouple_group:   z.boolean().optional(),
  participants_set: z.array(z.string().uuid()).max(50).optional(),
}).refine(b => {
  const keys = Object.keys(b).filter(k => k !== "scope");
  return keys.length > 0;
}, { message: "no_changes" });

export async function PATCH(
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
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  const sb = supabaseAdmin();
  const { data: anchor } = await sb
    .from("classes")
    .select("id, scheduled_at, parent_class_id, status, group_id")
    .eq("id", id)
    .maybeSingle();
  if (!anchor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const anchorRow = anchor as {
    id: string; scheduled_at: string;
    parent_class_id: string | null; status: string; group_id: string | null;
  };

  // ── Resolve the target id list ──
  const anchorId  = id;
  const anchorIso = anchorRow.scheduled_at;
  const parentId  = anchorRow.parent_class_id ?? anchorId;

  let targetIds: string[] = [anchorId];
  if (b.scope === "series") {
    const { data: siblings } = await sb
      .from("classes")
      .select("id, scheduled_at, status")
      .or(`id.eq.${parentId},parent_class_id.eq.${parentId}`)
      .gte("scheduled_at", anchorIso)
      .in("status", ["scheduled", "live"]);
    targetIds = ((siblings ?? []) as Array<{ id: string }>).map(r => r.id);
    if (!targetIds.includes(anchorId)) targetIds.push(anchorId);
  }

  // ── 1. Plain field updates (title / topic / duration / teacher_id) ──
  const plainUpdate: Record<string, unknown> = {};
  if (b.duration_minutes !== undefined) plainUpdate.duration_minutes = b.duration_minutes;
  if (b.title            !== undefined) plainUpdate.title            = b.title;
  if (b.topic            !== undefined) plainUpdate.topic            = b.topic;
  if (b.teacher_id       !== undefined) plainUpdate.teacher_id       = b.teacher_id;

  const updatedIds: string[] = [];

  if (Object.keys(plainUpdate).length > 0) {
    const { error } = await sb.from("classes").update(plainUpdate).in("id", targetIds);
    if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
    updatedIds.push(...targetIds);
  }

  // ── 2. scheduled_at with delta logic for series ──
  if (b.scheduled_at !== undefined) {
    const newAnchor = new Date(b.scheduled_at).getTime();
    const oldAnchor = new Date(anchorIso).getTime();
    const deltaMs   = newAnchor - oldAnchor;

    if (b.scope === "this" || deltaMs === 0) {
      const { error } = await sb.from("classes")
        .update({ scheduled_at: b.scheduled_at })
        .eq("id", anchorId);
      if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
      if (!updatedIds.includes(anchorId)) updatedIds.push(anchorId);
    } else {
      const { data: currents } = await sb
        .from("classes")
        .select("id, scheduled_at")
        .in("id", targetIds);
      for (const c of (currents ?? []) as Array<{ id: string; scheduled_at: string }>) {
        const shifted = new Date(new Date(c.scheduled_at).getTime() + deltaMs).toISOString();
        const { error } = await sb.from("classes")
          .update({ scheduled_at: shifted })
          .eq("id", c.id);
        if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
        if (!updatedIds.includes(c.id)) updatedIds.push(c.id);
      }
    }
  }

  // ── 3. Decouple from group (run BEFORE participants_set so the
  //       guard below sees the post-decouple state) ──
  if (b.decouple_group) {
    const { error } = await sb.from("classes")
      .update({ group_id: null })
      .in("id", targetIds);
    if (error) return NextResponse.json({ error: "decouple_failed", message: error.message }, { status: 500 });
    if (!updatedIds.includes(anchorId)) updatedIds.push(anchorId);
  }

  // ── 4. participants_set — replace the participant list per target ──
  if (b.participants_set !== undefined) {
    // Guard: every target class must be group-decoupled. Otherwise the
    // group's next sync would silently undo the per-class edit.
    const { data: currentClasses } = await sb
      .from("classes")
      .select("id, group_id")
      .in("id", targetIds);
    const stillCoupled = ((currentClasses ?? []) as Array<{ id: string; group_id: string | null }>)
      .filter(r => r.group_id !== null);
    if (stillCoupled.length > 0) {
      return NextResponse.json({
        error:   "class_still_in_group",
        message: "Para editar los miembros, primero desvincula la clase del grupo (botón 'Desvincular del grupo') o gestiona los miembros desde /admin/grupos/{id}.",
        offending_class_ids: stillCoupled.map(c => c.id),
      }, { status: 400 });
    }

    const desired = new Set(b.participants_set);
    for (const classId of targetIds) {
      // Diff against existing rows so we don't lose attendance / per-row
      // metadata for students who stay.
      const { data: existing } = await sb
        .from("class_participants")
        .select("student_id")
        .eq("class_id", classId);
      const existingIds = new Set(
        ((existing ?? []) as Array<{ student_id: string }>).map(r => r.student_id),
      );

      const toRemove = [...existingIds].filter(s => !desired.has(s));
      const toAdd    = [...desired].filter(s => !existingIds.has(s));

      if (toRemove.length > 0) {
        const { error } = await sb.from("class_participants")
          .delete()
          .eq("class_id", classId)
          .in("student_id", toRemove);
        if (error) return NextResponse.json({ error: "participants_remove_failed", message: error.message }, { status: 500 });
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map(sid => ({
          class_id:   classId,
          student_id: sid,
          attended:   null,
          counts_as_session: true,
        }));
        const { error } = await sb.from("class_participants")
          .upsert(rows, { onConflict: "class_id,student_id" });
        if (error) return NextResponse.json({ error: "participants_add_failed", message: error.message }, { status: 500 });
      }
      if (!updatedIds.includes(classId)) updatedIds.push(classId);
    }
  }

  return NextResponse.json({ ok: true, scope: b.scope, updated_ids: updatedIds });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const whole = url.searchParams.get("whole") === "1";

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  try {
    const r = await cancelClass(id, { whole });
    return NextResponse.json({ ok: true, cancelledIds: r.cancelledIds });
  } catch (e) {
    return NextResponse.json(
      { error: "cancel_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
