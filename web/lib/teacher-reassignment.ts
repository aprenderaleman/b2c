import { supabaseAdmin } from "./supabase";
import { ensureDirectChat } from "./chat";
import { createNotification } from "./notifications";

export async function reassignTeacher(input: {
  studentId: string;
  newTeacherId: string;
  reason?: string;
  reassignedByUserId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();

  const { data: student } = await sb
    .from("students")
    .select("id, user_id, users!inner(full_name, email)")
    .eq("id", input.studentId)
    .maybeSingle();
  if (!student) return { ok: false, error: "student_not_found" };

  const su = student.users as { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
  const studentUser = Array.isArray(su) ? su[0] : su;
  const studentName = studentUser?.full_name ?? studentUser?.email ?? "Estudiante";

  const { data: newTeacher } = await sb
    .from("teachers")
    .select("id, user_id, users!inner(full_name, email)")
    .eq("id", input.newTeacherId)
    .maybeSingle();
  if (!newTeacher) return { ok: false, error: "new_teacher_not_found" };

  const ntu = newTeacher.users as { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
  const newTeacherUser = Array.isArray(ntu) ? ntu[0] : ntu;
  const newTeacherName = newTeacherUser?.full_name ?? "Profesor";

  const { data: group } = await sb
    .from("student_group_members")
    .select("group_id, student_groups!inner(id, teacher_id, type)")
    .eq("student_id", input.studentId)
    .limit(10);

  const individualGroup = (group ?? []).find(g => {
    const sg = Array.isArray(g.student_groups) ? g.student_groups[0] : g.student_groups;
    return (sg as { type?: string })?.type === "individual";
  });

  const oldTeacherId = (() => {
    if (!individualGroup) return null;
    const sg = Array.isArray(individualGroup.student_groups)
      ? individualGroup.student_groups[0]
      : individualGroup.student_groups;
    return (sg as { teacher_id?: string })?.teacher_id ?? null;
  })();

  if (oldTeacherId === input.newTeacherId) {
    return { ok: false, error: "same_teacher" };
  }

  // 1. Update the 1:1 group's teacher_id
  if (individualGroup) {
    await sb
      .from("student_groups")
      .update({ teacher_id: input.newTeacherId })
      .eq("id", individualGroup.group_id);
  }

  // 2. Reassign future scheduled classes
  const now = new Date().toISOString();
  if (oldTeacherId) {
    const { data: futureClasses } = await sb
      .from("class_participants")
      .select("class_id, class:classes!inner(id, teacher_id, status, scheduled_at)")
      .eq("student_id", input.studentId);

    const classIds = (futureClasses ?? [])
      .filter(c => {
        const cls = Array.isArray(c.class) ? c.class[0] : c.class;
        return cls &&
          (cls as { status: string }).status === "scheduled" &&
          (cls as { scheduled_at: string }).scheduled_at > now &&
          (cls as { teacher_id: string }).teacher_id === oldTeacherId;
      })
      .map(c => {
        const cls = Array.isArray(c.class) ? c.class[0] : c.class;
        return (cls as { id: string }).id;
      });

    if (classIds.length > 0) {
      await sb
        .from("classes")
        .update({ teacher_id: input.newTeacherId })
        .in("id", classIds);
    }
  }

  // 3. Create direct chat with new teacher
  const studentUserId = (student as { user_id: string }).user_id;
  const newTeacherUserId = (newTeacher as { user_id: string }).user_id;
  await ensureDirectChat(newTeacherUserId, studentUserId);

  // 4. Log the reassignment
  await sb.from("teacher_reassignments").insert({
    student_id: input.studentId,
    old_teacher_id: oldTeacherId,
    new_teacher_id: input.newTeacherId,
    reason: input.reason ?? null,
    reassigned_by: input.reassignedByUserId,
  });

  // 5. Notify both teachers + student
  if (oldTeacherId) {
    const { data: oldTeacher } = await sb
      .from("teachers")
      .select("user_id")
      .eq("id", oldTeacherId)
      .maybeSingle();
    if (oldTeacher) {
      await createNotification({
        user_id: (oldTeacher as { user_id: string }).user_id,
        type: "generic",
        title: "Alumno reasignado",
        body: `${studentName} ha sido reasignado a ${newTeacherName}.`,
        link: null,
      });
    }
  }

  await createNotification({
    user_id: newTeacherUserId,
    type: "generic",
    title: "Nuevo alumno asignado",
    body: `${studentName} ha sido asignado a ti.`,
    link: `/profesor/estudiantes`,
  });

  await createNotification({
    user_id: studentUserId,
    type: "generic",
    title: "Nuevo profesor asignado",
    body: `Tu nuevo profesor es ${newTeacherName}. Puedes contactarlo desde tu chat.`,
    link: `/estudiante`,
  });

  return { ok: true };
}
