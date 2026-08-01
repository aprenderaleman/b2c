import { supabaseAdmin } from "./supabase";
import { createNotification } from "./notifications";

export type RetentionAlert = {
  kind: "no_classes_scheduled" | "low_pace" | "inactive";
  studentId: string;
  studentName: string;
  teacherUserId: string;
  teacherName: string;
  detail: string;
};

export async function computeTeacherRetentionAlerts(): Promise<RetentionAlert[]> {
  const sb = supabaseAdmin();
  const alerts: RetentionAlert[] = [];
  const now = new Date();

  // Get all active students with their teacher (via individual group)
  const { data: students } = await sb
    .from("students")
    .select(`
      id, user_id, classes_remaining, classes_per_month, subscription_status,
      users!inner(full_name, email, last_sign_in_at, active)
    `)
    .eq("subscription_status", "active");

  if (!students?.length) return alerts;

  // Get teacher assignments via individual groups
  const { data: groups } = await sb
    .from("student_group_members")
    .select(`
      student_id,
      student_groups!inner(teacher_id, type)
    `)
    .eq("student_groups.type", "individual");

  const studentTeacher: Record<string, string> = {};
  for (const g of groups ?? []) {
    const sg = Array.isArray(g.student_groups) ? g.student_groups[0] : g.student_groups;
    if (sg && (sg as { teacher_id?: string }).teacher_id) {
      studentTeacher[g.student_id] = (sg as { teacher_id: string }).teacher_id;
    }
  }

  // Get teacher user_ids and names
  const teacherIds = [...new Set(Object.values(studentTeacher))];
  if (!teacherIds.length) return alerts;

  const { data: teachers } = await sb
    .from("teachers")
    .select("id, user_id, users!inner(full_name)")
    .in("id", teacherIds);

  const teacherInfo: Record<string, { userId: string; name: string }> = {};
  for (const t of teachers ?? []) {
    const tu = Array.isArray(t.users) ? t.users[0] : t.users;
    teacherInfo[t.id as string] = {
      userId: t.user_id as string,
      name: (tu as { full_name: string | null })?.full_name ?? "Profesor",
    };
  }

  // For each student, check alerts
  for (const raw of students) {
    const s = raw as {
      id: string; user_id: string; classes_remaining: number | null;
      classes_per_month: number | null; subscription_status: string;
      users: { full_name: string | null; email: string; last_sign_in_at: string | null; active: boolean }
        | Array<{ full_name: string | null; email: string; last_sign_in_at: string | null; active: boolean }>;
    };
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    if (!u?.active) continue;

    const teacherId = studentTeacher[s.id];
    if (!teacherId || !teacherInfo[teacherId]) continue;

    const teacher = teacherInfo[teacherId];
    const studentName = u.full_name ?? u.email;

    // Alert 1: Has available classes but none scheduled for 7+ days
    const remaining = s.classes_remaining ?? 0;
    if (remaining > 0) {
      const { count } = await sb
        .from("class_participants")
        .select("class_id, class:classes!inner(status, scheduled_at)", { count: "exact", head: true })
        .eq("student_id", s.id)
        .eq("class.status", "scheduled")
        .gt("class.scheduled_at", now.toISOString());

      if ((count ?? 0) === 0) {
        // Check last class date
        const { data: lastClass } = await sb
          .from("class_participants")
          .select("class:classes!inner(scheduled_at, status)")
          .eq("student_id", s.id)
          .in("class.status", ["completed", "cancelled"])
          .order("scheduled_at", { ascending: false, foreignTable: "classes" })
          .limit(1)
          .maybeSingle();

        const lastAt = lastClass
          ? new Date((Array.isArray(lastClass.class) ? lastClass.class[0] : lastClass.class as { scheduled_at: string }).scheduled_at)
          : null;
        const daysSince = lastAt ? Math.floor((now.getTime() - lastAt.getTime()) / 86400000) : 999;

        if (daysSince >= 7) {
          alerts.push({
            kind: "no_classes_scheduled",
            studentId: s.id,
            studentName,
            teacherUserId: teacher.userId,
            teacherName: teacher.name,
            detail: `${studentName} tiene ${remaining} clases disponibles pero ninguna agendada (${daysSince} dias sin clase).`,
          });
        }
      }
    }

    // Alert 2: Low pace — consumed <50% of classes_per_month by day 20
    if (s.classes_per_month && s.classes_per_month > 0) {
      const dayOfMonth = now.getDate();
      if (dayOfMonth >= 20) {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const { count: classesThisMonth } = await sb
          .from("class_participants")
          .select("class_id, class:classes!inner(status, scheduled_at)", { count: "exact", head: true })
          .eq("student_id", s.id)
          .in("class.status", ["completed", "live"])
          .gte("class.scheduled_at", monthStart)
          .lt("class.scheduled_at", now.toISOString());

        const taken = classesThisMonth ?? 0;
        const expected = s.classes_per_month;
        if (taken < expected * 0.5) {
          alerts.push({
            kind: "low_pace",
            studentId: s.id,
            studentName,
            teacherUserId: teacher.userId,
            teacherName: teacher.name,
            detail: `${studentName} solo ha tomado ${taken}/${expected} clases este mes (dia ${dayOfMonth}).`,
          });
        }
      }
    }

    // Alert 3: Inactive 14+ days
    if (u.last_sign_in_at) {
      const lastLogin = new Date(u.last_sign_in_at);
      const daysSinceLogin = Math.floor((now.getTime() - lastLogin.getTime()) / 86400000);
      if (daysSinceLogin >= 14) {
        alerts.push({
          kind: "inactive",
          studentId: s.id,
          studentName,
          teacherUserId: teacher.userId,
          teacherName: teacher.name,
          detail: `${studentName} no ha iniciado sesion en ${daysSinceLogin} dias.`,
        });
      }
    }
  }

  return alerts;
}

export async function sendRetentionAlertsToTeachers(): Promise<number> {
  const alerts = await computeTeacherRetentionAlerts();
  const sb = supabaseAdmin();
  let sent = 0;

  for (const alert of alerts) {
    const notifType = alert.kind === "no_classes_scheduled"
      ? "retention_no_classes" as const
      : alert.kind === "low_pace"
        ? "retention_low_pace" as const
        : "retention_inactive" as const;

    const title = alert.kind === "no_classes_scheduled"
      ? `${alert.studentName} — sin clases agendadas`
      : alert.kind === "low_pace"
        ? `${alert.studentName} — ritmo bajo`
        : `${alert.studentName} — inactivo`;

    // Dedup: don't send same alert type for same student in the last 7 days
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: existing } = await sb
      .from("notifications")
      .select("id")
      .eq("user_id", alert.teacherUserId)
      .eq("type", notifType)
      .eq("title", title)
      .gte("created_at", weekAgo)
      .limit(1);

    if (existing && existing.length > 0) continue;

    await createNotification({
      user_id: alert.teacherUserId,
      type: notifType,
      title,
      body: alert.detail,
      link: `/profesor/estudiantes`,
    });
    sent++;
  }

  return sent;
}
