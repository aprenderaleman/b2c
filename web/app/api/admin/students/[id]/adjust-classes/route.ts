import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/students/{id}/adjust-classes
 *
 * Lets an admin override a student's classes_remaining by setting the
 * `classes_adjustment` column. The DB trigger from migration 029
 * recomputes classes_remaining automatically on write.
 *
 * Body:
 *   { target_remaining: number, reason: string }
 *
 * We compute the delta (target − current_remaining) and store that
 * delta in student_class_adjustments for audit, and set the resulting
 * new adjustment on the students row.
 *
 * This lets the admin think in "nuevo número restante" terms without
 * having to do math.
 */

export const runtime = "nodejs";

const Body = z.object({
  target_remaining: z.coerce.number().int().min(0).max(9999),
  reason:           z.string().trim().min(3).max(500),
});

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

  const { id: studentId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { target_remaining, reason } = parsed.data;

  const sb = supabaseAdmin();

  // Pull current values from the view (that already sums consumption)
  const { data: current } = await sb
    .from("v_student_packs")
    .select("classes_purchased, classes_adjustment, classes_consumed, classes_remaining")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  const c = current as {
    classes_purchased: number;
    classes_adjustment: number;
    classes_consumed:  number;
    classes_remaining: number;
  };

  // What adjustment yields target_remaining?
  //   remaining = purchased + adjustment − consumed
  //   adjustment = target_remaining + consumed − purchased
  const newAdjustment = target_remaining + c.classes_consumed - c.classes_purchased;
  const delta         = target_remaining - c.classes_remaining;

  if (delta === 0) {
    return NextResponse.json({ ok: true, no_change: true });
  }

  // Apply + audit
  const { error: upErr } = await sb
    .from("students")
    .update({ classes_adjustment: newAdjustment })
    .eq("id", studentId);
  if (upErr) {
    return NextResponse.json({ error: "update_failed", message: upErr.message }, { status: 500 });
  }

  await sb.from("student_class_adjustments").insert({
    student_id:     studentId,
    admin_user_id:  (session.user as { id: string }).id,
    delta,
    reason,
    new_adjustment: newAdjustment,
  });

  return NextResponse.json({
    ok: true,
    target_remaining,
    delta,
    new_adjustment: newAdjustment,
  });
}
