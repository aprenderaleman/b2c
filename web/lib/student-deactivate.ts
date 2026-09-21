import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";

/**
 * Baja de un estudiante — misma lógica para el botón admin y para la
 * automatización "0 clases restantes → baja" del cron pack-alerts.
 *
 *  - users.active = false                 → bloquea login (auth.ts)
 *  - students.subscription_status         → 'cancelled' (manual) | 'expired' (automático)
 *  - Cancela las clases 1:1 futuras; le saca de las grupales futuras
 *  - Avisa por WA al profe de cada clase afectada (best-effort)
 *  - Nota de auditoría en admin_notes
 *
 * Devuelve los ids de las clases 1:1 canceladas para que el caller libere
 * los huecos en Google Calendar (removeTeacherCalendarEvents).
 */
export type DeactivateResult = {
  cancelledIndividualIds: string[];
  removedFromGroup: number;
  teachersNotified: number;
};

export async function deactivateStudent(
  studentId: string,
  opts: { reason?: string; actorUserId?: string | null; status?: "cancelled" | "expired"; notifyTeachers?: boolean } = {},
): Promise<DeactivateResult> {
  const sb = supabaseAdmin();
  const status = opts.status ?? "cancelled";

  const { data: stu, error: sErr } = await sb
    .from("students")
    .select("id, user_id, users!inner(full_name, email)")
    .eq("id", studentId)
    .maybeSingle();
  if (sErr || !stu) throw new Error("student_not_found");
  type U = { full_name: string | null; email: string };
  const usersField = (stu as unknown as { users: U | U[] }).users;
  const u: U = Array.isArray(usersField) ? usersField[0] : usersField;
  const userId = (stu as unknown as { user_id: string }).user_id;

  const nowIso = new Date().toISOString();
  const { data: parts } = await sb
    .from("class_participants")
    .select(`
      class_id,
      classes!inner(
        id, scheduled_at, status, group_id,
        teacher:teachers!inner(id, user_id, users!inner(full_name, phone))
      )
    `)
    .eq("student_id", studentId)
    .eq("classes.status", "scheduled")
    .gte("classes.scheduled_at", nowIso);

  type TU = { full_name: string | null; phone: string | null };
  type Row = {
    class_id: string;
    classes: { id: string; scheduled_at: string; group_id: string | null;
      teacher: { id: string; user_id: string; users: TU | TU[] } | Array<{ id: string; user_id: string; users: TU | TU[] }> };
  };

  const individualIds: string[] = [];
  const groupClassIds: string[] = [];
  const teacherNotifs = new Map<string, { phone: string; teacherName: string; n: number }>();

  for (const r of ((parts ?? []) as unknown as Row[])) {
    const c = r.classes;
    const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
    const tu = Array.isArray(t.users) ? t.users[0] : t.users;
    if (!c.group_id) individualIds.push(c.id); else groupClassIds.push(c.id);
    if (tu?.phone) {
      const slot = teacherNotifs.get(t.user_id) ?? { phone: tu.phone, teacherName: tu.full_name ?? "Profesor", n: 0 };
      slot.n += 1;
      teacherNotifs.set(t.user_id, slot);
    }
  }

  if (individualIds.length > 0) {
    await sb.from("classes").update({ status: "cancelled" }).in("id", individualIds);
  }
  if (groupClassIds.length > 0) {
    await sb.from("class_participants").delete().eq("student_id", studentId).in("class_id", groupClassIds);
  }

  const { error: ue } = await sb.from("users").update({ active: false }).eq("id", userId);
  if (ue) throw new Error(`users_update_failed: ${ue.message}`);
  const { error: te } = await sb.from("students").update({ subscription_status: status }).eq("id", studentId);
  if (te) throw new Error(`students_update_failed: ${te.message}`);

  const studentName = u.full_name ?? u.email;
  if (opts.notifyTeachers !== false) {
    for (const [, n] of teacherNotifs) {
      const msg =
        `Hola ${n.teacherName}, te aviso: ${studentName} ha sido dado de baja` +
        `${status === "expired" ? " (completó sus clases)" : " por administración"}. ` +
        `Sus ${n.n} clase${n.n === 1 ? "" : "s"} futura${n.n === 1 ? "" : "s"} ya ` +
        `${n.n === 1 ? "fue cancelada / se quitó del grupo" : "fueron canceladas / se quitó del grupo"} ` +
        `en tu calendario. No necesitas hacer nada.`;
      sendWhatsappText(n.phone, msg, { kind: "admin_manual" }).catch(() => {});
    }
  }

  await sb.from("admin_notes").insert({
    target_type: "student",
    target_id:   studentId,
    author_id:   opts.actorUserId ?? null,
    body:        `Estudiante DADO DE BAJA${opts.reason ? ` — ${opts.reason}` : ""}.\n` +
                 `Clases 1:1 canceladas: ${individualIds.length}\n` +
                 `Grupales (removido del roster): ${groupClassIds.length}\n` +
                 `Profes notificados por WA: ${teacherNotifs.size}`,
  }).then(() => {}, () => {});

  return {
    cancelledIndividualIds: individualIds,
    removedFromGroup: groupClassIds.length,
    teachersNotified: teacherNotifs.size,
  };
}
