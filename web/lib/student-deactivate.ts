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

/** Lo que necesitamos saber de un student_group para clasificar sus clases. */
export type GroupInfo = { class_type: string | null; capacity: number | null };

/**
 * Un grupo es "individual" si su class_type es 'individual' o si solo cabe
 * un alumno. Desde que post-conversion-flow crea un student_group individual
 * para cada alumno, sus clases 1:1 llevan group_id: no basta con mirar si
 * classes.group_id es null (bug 2026-11-03: la clase quedaba `scheduled`
 * sin alumno en el calendario del profe).
 */
export function isIndividualGroup(g: GroupInfo | null | undefined): boolean {
  if (!g) return false;
  return g.class_type === "individual" || g.capacity === 1;
}

export type FutureClassRow = {
  classId: string;
  groupId: string | null;
  teacherUserId: string;
  teacherName: string | null;
  teacherPhone: string | null;
};

export type TeacherNotif = { phone: string; teacherName: string; n: number };

export type Partition = {
  /** Clases 1:1 (sin grupo o con grupo individual): se cancelan. */
  individualIds: string[];
  /** Clases de grupo real (dúo/trío/grupo): se quita al alumno del roster. */
  groupClassIds: string[];
  /** Profes con teléfono a avisar, por user_id, con nº de clases afectadas. */
  teacherNotifs: Map<string, TeacherNotif>;
};

/**
 * Clasifica las clases futuras del alumno. Pura, para poder testearla.
 * Un group_id que no aparece en `groups` se trata como grupo real
 * (comportamiento anterior): solo se quita al alumno del roster.
 */
export function partitionFutureClasses(rows: FutureClassRow[], groups: Map<string, GroupInfo>): Partition {
  const individualIds: string[] = [];
  const groupClassIds: string[] = [];
  const teacherNotifs = new Map<string, TeacherNotif>();

  for (const r of rows) {
    const oneOnOne = !r.groupId || isIndividualGroup(groups.get(r.groupId));
    if (oneOnOne) individualIds.push(r.classId); else groupClassIds.push(r.classId);
    if (r.teacherPhone) {
      const slot = teacherNotifs.get(r.teacherUserId) ?? { phone: r.teacherPhone, teacherName: r.teacherName ?? "Profesor", n: 0 };
      slot.n += 1;
      teacherNotifs.set(r.teacherUserId, slot);
    }
  }
  return { individualIds, groupClassIds, teacherNotifs };
}

export async function deactivateStudent(
  studentId: string,
  opts: { reason?: string; actorUserId?: string | null; status?: "cancelled" | "expired"; notifyTeachers?: boolean } = {},
): Promise<DeactivateResult> {
  const sb = supabaseAdmin();
  const status = opts.status ?? "cancelled";
  const notify = opts.notifyTeachers !== false;

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
        teacher:teachers!classes_teacher_id_fkey!inner(id, user_id, users!inner(full_name, phone))
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

  const rows: FutureClassRow[] = ((parts ?? []) as unknown as Row[]).map(r => {
    const c = r.classes;
    const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
    const tu = Array.isArray(t.users) ? t.users[0] : t.users;
    return {
      classId: c.id,
      groupId: c.group_id,
      teacherUserId: t.user_id,
      teacherName: tu?.full_name ?? null,
      teacherPhone: tu?.phone ?? null,
    };
  });

  // Tipo/capacidad de los grupos de esas clases, para distinguir el grupo
  // individual del alumno (clase 1:1 → cancelar) de un dúo/trío/grupo real.
  const groups = new Map<string, GroupInfo>();
  const groupIds = [...new Set(rows.map(r => r.groupId).filter((g): g is string => !!g))];
  if (groupIds.length > 0) {
    const { data: gs, error: gErr } = await sb
      .from("student_groups")
      .select("id, class_type, capacity")
      .in("id", groupIds);
    if (gErr) console.error("[deactivateStudent] student_groups lookup failed:", gErr.message);
    for (const g of (gs ?? []) as Array<{ id: string; class_type: string | null; capacity: number | null }>) {
      groups.set(g.id, { class_type: g.class_type, capacity: g.capacity });
    }
  }

  const { individualIds, groupClassIds, teacherNotifs } = partitionFutureClasses(rows, groups);

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

  // Cerrar sus grupos individuales: si quedan activos, el profe sigue
  // viéndolo en /profesor/estudiantes y en los chats (caso Ayman/Marcela/
  // Sandra/María S. 2026-10-06, grupos huérfanos tras la baja).
  const { data: memberships } = await sb
    .from("student_group_members")
    .select("group_id, student_groups!inner(class_type, capacity, active)")
    .eq("student_id", studentId)
    .eq("student_groups.active", true);
  for (const m of (memberships ?? []) as Array<{ group_id: string; student_groups: unknown }>) {
    const g = (Array.isArray(m.student_groups) ? m.student_groups[0] : m.student_groups) as GroupInfo | undefined;
    if (isIndividualGroup(g)) {
      await sb.from("student_groups").update({ active: false }).eq("id", m.group_id);
    } else {
      await sb.from("student_group_members").delete().eq("group_id", m.group_id).eq("student_id", studentId);
    }
  }

  const studentName = u.full_name ?? u.email;
  const teachersNotified = notify ? teacherNotifs.size : 0;
  if (notify) {
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

  // Nota de auditoría (best-effort: no rompe la baja, pero sí se loguea).
  const { error: nErr } = await sb.from("admin_notes").insert({
    target_type: "student",
    target_id:   studentId,
    author_id:   opts.actorUserId ?? null,
    content:     `Estudiante DADO DE BAJA${opts.reason ? ` — ${opts.reason}` : ""}.\n` +
                 `Clases 1:1 canceladas: ${individualIds.length}\n` +
                 `Grupales (removido del roster): ${groupClassIds.length}\n` +
                 `Profes notificados por WA: ${teachersNotified}`,
  });
  if (nErr) console.error("[deactivateStudent] admin_notes insert failed:", studentId, nErr.message);

  return {
    cancelledIndividualIds: individualIds,
    removedFromGroup: groupClassIds.length,
    teachersNotified,
  };
}
