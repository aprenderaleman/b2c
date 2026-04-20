import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/students/{id}/edit-pack
 *
 * Directly edits students.classes_purchased — the "horas del pack
 * comprado". Complements /adjust-classes (which tweaks the manual
 * adjustment delta). Use this one when you need to correct the actual
 * paid amount (e.g. student upgraded from 48h to 96h, or we miscounted
 * the pack on import from the legacy platform).
 *
 * The DB trigger from migration 029 (students_adjustment_sync) picks
 * up the classes_purchased change and recomputes classes_remaining
 * automatically — no manual recalc needed here.
 *
 * Body:
 *   { classes_purchased: number, reason: string }
 *
 * Audit is reused from student_class_adjustments — reason is
 * prefixed with "[Pack comprado: X→Y]" so the history is still clear
 * when browsing the audit table directly.
 */

export const runtime = "nodejs";

const Body = z.object({
  classes_purchased: z.coerce.number().int().min(0).max(9999),
  reason:            z.string().trim().min(3).max(500),
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
  const { classes_purchased, reason } = parsed.data;

  const sb = supabaseAdmin();

  // Fetch current value so we can compute + log delta
  const { data: current } = await sb
    .from("students")
    .select("classes_purchased, classes_adjustment")
    .eq("id", studentId)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  const c = current as { classes_purchased: number; classes_adjustment: number };

  const delta = classes_purchased - c.classes_purchased;
  if (delta === 0) {
    return NextResponse.json({ ok: true, no_change: true });
  }

  // Apply the change — the DB trigger recomputes classes_remaining.
  const { error: upErr } = await sb
    .from("students")
    .update({ classes_purchased })
    .eq("id", studentId);
  if (upErr) {
    return NextResponse.json({ error: "update_failed", message: upErr.message }, { status: 500 });
  }

  // Audit trail reuses student_class_adjustments: prefix the reason so the
  // pack-purchased edits are distinguishable from classes-remaining tweaks.
  await sb.from("student_class_adjustments").insert({
    student_id:     studentId,
    admin_user_id:  (session.user as { id: string }).id,
    delta,
    reason:         `[Pack comprado: ${c.classes_purchased}→${classes_purchased}] ${reason}`,
    new_adjustment: c.classes_adjustment,   // unchanged — we didn't touch the manual adjustment
  });

  return NextResponse.json({
    ok:                 true,
    classes_purchased,
    delta,
  });
}
