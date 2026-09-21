import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { removeTeacherCalendarEvents } from "@/lib/teacher-calendar-sync";
import { deactivateStudent } from "@/lib/student-deactivate";

/**
 * POST /api/admin/students/[id]/deactivate
 *
 * Da de baja a un estudiante (o lo reactiva con { reactivate: true }).
 * La lógica de baja vive en lib/student-deactivate.ts (compartida con la
 * automatización "0 clases → baja" del cron pack-alerts).
 *
 * Reactivación:
 *  - users.active = true, subscription_status = 'active'
 *  - NO recrea clases canceladas — el admin las re-agenda a mano
 *
 * Auth: admin / superadmin.
 */
const Body = z.object({
  reactivate: z.boolean().optional(),
  reason:     z.string().trim().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const { reactivate = false, reason } = parsed.data;
  const actorId = (session.user as { id?: string }).id ?? null;
  const sb = supabaseAdmin();

  if (reactivate) {
    const { data: stu } = await sb.from("students").select("id, user_id").eq("id", id).maybeSingle();
    if (!stu) return NextResponse.json({ error: "student_not_found" }, { status: 404 });
    const userId = (stu as { user_id: string }).user_id;
    const { error: ue } = await sb.from("users").update({ active: true }).eq("id", userId);
    if (ue) return NextResponse.json({ error: "users_update_failed", message: ue.message }, { status: 500 });
    const { error: te } = await sb.from("students").update({ subscription_status: "active" }).eq("id", id);
    if (te) return NextResponse.json({ error: "students_update_failed", message: te.message }, { status: 500 });
    await sb.from("admin_notes").insert({
      target_type: "student", target_id: id, author_id: actorId,
      body: `Estudiante REACTIVADO${reason ? ` — ${reason}` : ""}.`,
    }).then(() => {}, () => {});
    return NextResponse.json({ ok: true, reactivated: true });
  }

  try {
    const r = await deactivateStudent(id, { reason, actorUserId: actorId, status: "cancelled" });
    if (r.cancelledIndividualIds.length > 0) {
      const ids = [...r.cancelledIndividualIds];
      after(() => removeTeacherCalendarEvents(ids).catch(e =>
        console.error("[deactivate] gcal cleanup failed:", e)));
    }
    return NextResponse.json({
      ok: true,
      deactivated: true,
      cancelled_individual: r.cancelledIndividualIds.length,
      removed_from_group:   r.removedFromGroup,
      teachers_notified:    r.teachersNotified,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "student_not_found") return NextResponse.json({ error: "student_not_found" }, { status: 404 });
    return NextResponse.json({ error: "deactivate_failed", message: msg }, { status: 500 });
  }
}
