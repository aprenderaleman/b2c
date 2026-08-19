import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { computeBillingUnits, rollupTeacherMonth } from "@/lib/finance";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  classId: z.string().uuid(),
  billedHours: z.number().int().min(0).max(10).optional(),
});

export async function POST(req: Request) {
  await requireRole(["superadmin", "admin"]);

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { classId, billedHours: overrideBh } = parsed.data;
  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id, duration_minutes, actual_duration_minutes, started_at, ended_at, status, is_trial, billed_hours, scheduled_at")
    .eq("id", classId)
    .maybeSingle();

  const c = cls as {
    id: string;
    teacher_id: string;
    duration_minutes: number;
    actual_duration_minutes: number | null;
    started_at: string | null;
    ended_at: string | null;
    status: string;
    is_trial: boolean;
    billed_hours: number;
    scheduled_at: string;
  } | null;

  if (!c) {
    return NextResponse.json({ ok: false, error: "Class not found" }, { status: 404 });
  }
  if (c.status !== "completed") {
    return NextResponse.json({ ok: false, error: "Class is not completed" }, { status: 400 });
  }
  if (c.is_trial) {
    return NextResponse.json({ ok: false, error: "Cannot bill trial classes" }, { status: 400 });
  }

  let effectiveDur: number;
  if (c.actual_duration_minutes && c.actual_duration_minutes > 0) {
    effectiveDur = c.actual_duration_minutes;
  } else if (c.started_at && c.ended_at) {
    effectiveDur = Math.round(
      (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 60_000
    );
  } else {
    effectiveDur = c.duration_minutes;
  }

  const units = overrideBh ?? computeBillingUnits(effectiveDur);

  // Update billed_hours — the AFTER trigger handles class_hours_log + earnings
  const { error: updateErr } = await sb
    .from("classes")
    .update({
      billed_hours: units,
      actual_duration_minutes: c.actual_duration_minutes ?? effectiveDur,
    })
    .eq("id", classId);

  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 }
    );
  }

  // Also recompute the month's earnings for safety
  await rollupTeacherMonth(c.teacher_id, new Date(c.scheduled_at));

  return NextResponse.json({ ok: true, billed_hours: units });
}
