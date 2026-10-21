import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { authorizeAulaAccess } from "@/lib/aula";
import { logClassHoursAndRollup } from "@/lib/finance";

/**
 * POST /api/aula/[id]/end
 *
 * Body: { actualDurationMinutes?: number }
 *
 * Called by the teacher to end a class. Duration is auto-calculated
 * from started_at → now. The optional field is accepted for backwards
 * compatibility but ignored — the real duration comes from the timer.
 *
 * Only the host teacher (or admin) can end a class.
 */
const Body = z.object({
  actualDurationMinutes: z.coerce.number().int().min(1).max(240).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const access = await authorizeAulaAccess(id, userId, role);
  if (!access.ok || (access.role !== "host" && role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Fetch class details including started_at for auto-duration.
  const { data: cls } = await sb
    .from("classes")
    .select("teacher_id, status, is_content_recording, started_at")
    .eq("id", id)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Auto-calculate duration from started_at to now (no manual input needed).
  const now = new Date();
  const startedAt = (cls as { started_at: string | null }).started_at;
  let actualMinutes: number;
  if (startedAt) {
    actualMinutes = Math.round((now.getTime() - new Date(startedAt).getTime()) / 60000);
    if (actualMinutes < 1) actualMinutes = 1;
    if (actualMinutes > 240) actualMinutes = 240;
  } else {
    actualMinutes = parsed.data.actualDurationMinutes ?? 50;
  }

  const { error } = await sb
    .from("classes")
    .update({
      status:                  "completed",
      ended_at:                now.toISOString(),
      actual_duration_minutes: actualMinutes,
    })
    .eq("id", id)
    .in("status", ["live", "scheduled"]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Skip billing for content recording sessions (YouTube videos etc.)
  if (!(cls as { is_content_recording?: boolean }).is_content_recording) {
    try {
      await logClassHoursAndRollup({
        classId:         id,
        teacherId:       (cls as { teacher_id: string }).teacher_id,
        durationMinutes: actualMinutes,
      });
    } catch (e) {
      console.error("logClassHoursAndRollup failed:", e);
    }
  }

  // Clases "dobles" agendadas como dos clases seguidas (caso Francisco/Simon
  // 2026-10-22): profe y alumno se quedaron en la primera sala y la segunda
  // quedó "agendada" sin facturar. Si la sala estuvo abierta hasta pasado el
  // inicio de la siguiente clase del mismo profe con los mismos alumnos, la
  // damos por dada también (misma asistencia, facturación normal).
  try {
    await completeConsecutiveClasses(sb, id, (cls as { teacher_id: string }).teacher_id, now);
  } catch (e) {
    console.error("completeConsecutiveClasses failed:", e);
  }

  return NextResponse.json({ ok: true });
}

async function completeConsecutiveClasses(
  sb: ReturnType<typeof supabaseAdmin>,
  classId: string,
  teacherId: string,
  endedAt: Date,
): Promise<void> {
  const { data: me } = await sb.from("classes").select("scheduled_at, is_trial").eq("id", classId).maybeSingle();
  if (!me || (me as { is_trial: boolean | null }).is_trial) return;
  const { data: myParts } = await sb.from("class_participants").select("student_id, attended").eq("class_id", classId);
  const mine = ((myParts ?? []) as Array<{ student_id: string; attended: boolean | null }>);
  const myIds = mine.map(p => p.student_id).sort();
  if (myIds.length === 0) return;

  // Candidatas: mismas participantes, mismo profe, empiezan después de esta
  // y al menos 15 min antes de que se cerrara la sala.
  const start = (me as { scheduled_at: string }).scheduled_at;
  const cutoff = new Date(endedAt.getTime() - 15 * 60_000).toISOString();
  const { data: next } = await sb.from("classes")
    .select("id, scheduled_at, class_participants(student_id)")
    .eq("teacher_id", teacherId).eq("status", "scheduled").eq("is_trial", false)
    .gt("scheduled_at", start).lte("scheduled_at", cutoff)
    .order("scheduled_at").limit(3);
  for (const n of (next ?? []) as Array<{ id: string; scheduled_at: string; class_participants: Array<{ student_id: string }> }>) {
    const ids = (n.class_participants ?? []).map(p => p.student_id).sort();
    if (ids.length !== myIds.length || !ids.every((v, i) => v === myIds[i])) continue;
    const minutes = Math.max(15, Math.min(240, Math.round((endedAt.getTime() - new Date(n.scheduled_at).getTime()) / 60_000)));
    for (const p of mine) {
      await sb.from("class_participants").update({ attended: p.attended }).eq("class_id", n.id).eq("student_id", p.student_id);
    }
    await sb.from("classes").update({
      status: "completed", started_at: n.scheduled_at, ended_at: endedAt.toISOString(), actual_duration_minutes: minutes,
      notes_admin: `Dada en la misma sala que la clase anterior (auto-cierre de clase consecutiva, ${new Date().toISOString().slice(0, 10)})`,
    }).eq("id", n.id).eq("status", "scheduled");
    try { await logClassHoursAndRollup({ classId: n.id, teacherId, durationMinutes: minutes }); }
    catch (e) { console.error("logClassHoursAndRollup (consecutiva) failed:", e); }
  }
}
