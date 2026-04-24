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
 */
export const runtime = "nodejs";

const PatchBody = z.object({
  scope:            z.enum(["this", "series"]),
  scheduled_at:     z.string().datetime().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(240).optional(),
  title:            z.string().trim().min(1).max(200).optional(),
  topic:            z.string().trim().max(500).nullable().optional(),
}).refine(b => {
  // Ensure at least one editable field besides `scope`.
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
    .select("id, scheduled_at, parent_class_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!anchor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Which ids to touch?
  const anchorId = id;
  const anchorIso = (anchor as { scheduled_at: string }).scheduled_at;
  const parentId  = (anchor as { parent_class_id: string | null }).parent_class_id ?? anchorId;

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

  // Compute the per-field update. For scheduled_at on a series we apply
  // a delta so weekly spacing is preserved instead of flattening every
  // class to the same timestamp.
  const plainUpdate: Record<string, unknown> = {};
  if (b.duration_minutes !== undefined) plainUpdate.duration_minutes = b.duration_minutes;
  if (b.title            !== undefined) plainUpdate.title            = b.title;
  if (b.topic            !== undefined) plainUpdate.topic            = b.topic;

  const updatedIds: string[] = [];

  if (Object.keys(plainUpdate).length > 0) {
    const { error } = await sb.from("classes").update(plainUpdate).in("id", targetIds);
    if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
    updatedIds.push(...targetIds);
  }

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
      // Apply the same delta to every target. One UPDATE per row — n is
      // typically small (≤ 12 for a Tuesday-semester schedule).
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
