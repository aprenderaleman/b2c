import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { removeTeacherCalendarEvents } from "@/lib/teacher-calendar-sync";

/**
 * POST /api/admin/students/[id]/deactivate
 *
 * Da de baja a un estudiante (o lo reactiva con { reactivate: true }).
 *
 * Baja:
 *  - users.active = false              → bloquea login (auth.ts:49)
 *  - students.subscription_status = 'cancelled'
 *  - Cancela TODAS las clases scheduled futuras del estudiante:
 *      * 1:1 (sin group_id): UPDATE classes SET status='cancelled'
 *      * Grupales: DELETE de class_participants
 *        — la clase sigue para el resto del grupo
 *  - Notifica por WA al profe de cada clase afectada (best-effort)
 *  - Asienta nota en admin_notes con el resumen
 *
 * Reactivación:
 *  - users.active = true
 *  - subscription_status = 'active'
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
  const sb = supabaseAdmin();

  const { data: stu, error: sErr } = await sb
    .from("students")
    .select("id, user_id, users!inner(full_name, email, active)")
    .eq("id", id)
    .maybeSingle();
  if (sErr || !stu) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }
  type U = { full_name: string | null; email: string; active: boolean };
  const usersField = (stu as unknown as { users: U | U[] }).users;
  const u: U = Array.isArray(usersField) ? usersField[0] : usersField;
  const s = stu as unknown as { user_id: string };

  // ─── REACTIVAR ───────────────────────────────────────────────────────
  if (reactivate) {
    const { error: ue } = await sb.from("users").update({ active: true }).eq("id", s.user_id);
    if (ue) return NextResponse.json({ error: "users_update_failed", message: ue.message }, { status: 500 });
    const { error: te } = await sb
      .from("students")
      .update({ subscription_status: "active" })
      .eq("id", id);
    if (te) return NextResponse.json({ error: "students_update_failed", message: te.message }, { status: 500 });

    await sb.from("admin_notes").insert({
      target_type: "student",
      target_id:   id,
      author_id:   (session.user as { id?: string }).id ?? null,
      body:        `Estudiante REACTIVADO${reason ? ` — ${reason}` : ""}.`,
    }).then(() => {}, () => {});

    return NextResponse.json({ ok: true, reactivated: true });
  }

  // ─── DAR DE BAJA ─────────────────────────────────────────────────────
  // 1. Cargar clases futuras donde aparece como participante.
  const nowIso = new Date().toISOString();
  const { data: parts } = await sb
    .from("class_participants")
    .select(`
      class_id,
      classes!inner(
        id, scheduled_at, status, group_id, duration_minutes,
        teacher:teachers!inner(id, user_id, users!inner(full_name, phone))
      )
    `)
    .eq("student_id", id)
    .eq("classes.status", "scheduled")
    .gte("classes.scheduled_at", nowIso);

  type Row = {
    class_id: string;
    classes: {
      id: string; scheduled_at: string; status: string; group_id: string | null;
      duration_minutes: number;
      teacher: {
        id: string; user_id: string;
        users: { full_name: string | null; phone: string | null }
              | Array<{ full_name: string | null; phone: string | null }>;
      } | Array<{
        id: string; user_id: string;
        users: { full_name: string | null; phone: string | null }
              | Array<{ full_name: string | null; phone: string | null }>;
      }>;
    };
  };
  const rows = ((parts ?? []) as unknown as Row[]);

  // 2. Particionar 1:1 vs grupal.
  const individualClassIds: string[] = [];
  const groupParticipantRemovals: string[] = [];           // class_ids
  const teacherNotifs: Map<string, { phone: string; teacherName: string; events: string[] }> = new Map();

  for (const r of rows) {
    const c = r.classes;
    const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
    const tu = Array.isArray(t.users) ? t.users[0] : t.users;
    const when = new Date(c.scheduled_at).toLocaleString("es-ES", {
      timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
    if (!c.group_id) {
      individualClassIds.push(c.id);
    } else {
      groupParticipantRemovals.push(c.id);
    }
    if (tu?.phone) {
      const slot = teacherNotifs.get(t.user_id) ?? { phone: tu.phone, teacherName: tu.full_name ?? "Profesor", events: [] };
      slot.events.push(`${when} (${c.group_id ? "grupal" : "1:1"})`);
      teacherNotifs.set(t.user_id, slot);
    }
  }

  // 3. Cancelar 1:1 (status='cancelled') + liberar sus huecos en los
  //    Google Calendars espejados (best-effort, tras responder).
  if (individualClassIds.length > 0) {
    await sb.from("classes")
      .update({ status: "cancelled" })
      .in("id", individualClassIds);
    const ids = [...individualClassIds];
    after(() => removeTeacherCalendarEvents(ids).catch(e =>
      console.error("[deactivate] gcal cleanup failed:", e)));
  }
  // 4. Sacar de grupales (preservando la clase para el resto).
  if (groupParticipantRemovals.length > 0) {
    await sb.from("class_participants")
      .delete()
      .eq("student_id", id)
      .in("class_id", groupParticipantRemovals);
  }

  // 5. Flip flags.
  const { error: ue } = await sb.from("users").update({ active: false }).eq("id", s.user_id);
  if (ue) return NextResponse.json({ error: "users_update_failed", message: ue.message }, { status: 500 });
  const { error: te } = await sb
    .from("students")
    .update({ subscription_status: "cancelled" })
    .eq("id", id);
  if (te) return NextResponse.json({ error: "students_update_failed", message: te.message }, { status: 500 });

  // 6. Notificar a profes (best-effort, no rompe la respuesta).
  //    Mensaje breve: NO listamos las fechas — el profe las ve en su
  //    calendario actualizado. Gelfis lo pidió explícitamente
  //    (caso Florian/Luis Emilio, 30 fechas era mucho ruido).
  const studentName = u.full_name ?? u.email;
  for (const [, notif] of teacherNotifs) {
    const total = notif.events.length;
    const msg =
      `Hola ${notif.teacherName}, te aviso: ${studentName} ha sido dado de baja por administración. ` +
      `Sus ${total} clase${total === 1 ? "" : "s"} futura${total === 1 ? "" : "s"} ya ` +
      `${total === 1 ? "fue cancelada / se quitó del grupo" : "fueron canceladas / se quitó del grupo"} ` +
      `en tu calendario. No necesitas hacer nada.`;
    sendWhatsappText(notif.phone, msg).catch(() => {});
  }

  // 7. Auditoría.
  await sb.from("admin_notes").insert({
    target_type: "student",
    target_id:   id,
    author_id:   (session.user as { id?: string }).id ?? null,
    body:        `Estudiante DADO DE BAJA${reason ? ` — ${reason}` : ""}.\n` +
                 `Clases 1:1 canceladas: ${individualClassIds.length}\n` +
                 `Grupales (removido del roster): ${groupParticipantRemovals.length}\n` +
                 `Profes notificados por WA: ${teacherNotifs.size}`,
  }).then(() => {}, () => {});

  return NextResponse.json({
    ok: true,
    deactivated: true,
    cancelled_individual: individualClassIds.length,
    removed_from_group:   groupParticipantRemovals.length,
    teachers_notified:    teacherNotifs.size,
  });
}
