import { supabaseAdmin } from "./supabase";
import { getTeacherById } from "./academy";
import { createNotification } from "./notifications";
import { sendWhatsappText } from "./whatsapp";
import { createStudentNotesDoc, getTeacherEmail } from "./google-docs";

export type ConversionScenario = "E1" | "E2" | "E3";

type PostConversionOpts = {
  leadId: string;
  studentId: string;
  leadName: string;
  closerId: string | null;
  trialTeacherId: string | null;
  trialAttended: boolean;
  packLabel: string;
};

export function detectScenario(opts: {
  closerId: string | null;
  trialAttended: boolean;
}): ConversionScenario {
  if (!opts.closerId) return "E1";
  if (opts.trialAttended) return "E2";
  return "E3";
}

export async function runPostConversionFlow(opts: PostConversionOpts): Promise<void> {
  const scenario = detectScenario({
    closerId: opts.closerId,
    trialAttended: opts.trialAttended,
  });

  const sb = supabaseAdmin();

  await sb.from("lead_timeline").insert({
    lead_id: opts.leadId,
    type: "conversion",
    author: "system",
    content: `Conversion ${scenario}: ${opts.leadName} se inscribio (${opts.packLabel})`,
    metadata: {
      kind: "post_conversion",
      scenario,
      closer_id: opts.closerId,
      teacher_id: opts.trialTeacherId,
      student_id: opts.studentId,
    },
  });

  switch (scenario) {
    case "E1":
      if (opts.trialTeacherId) {
        await notifyTeacherOfConversion(opts.trialTeacherId, opts.leadName, opts.packLabel, "E1");
        await setupStudentWithTeacher(sb, opts.studentId, opts.leadName, opts.trialTeacherId, "trial_teacher");
      }
      break;

    case "E2":
      if (opts.trialTeacherId) {
        await notifyTeacherOfConversion(opts.trialTeacherId, opts.leadName, opts.packLabel, "E2");
        await setupStudentWithTeacher(sb, opts.studentId, opts.leadName, opts.trialTeacherId, "trial_teacher");
      }
      break;

    case "E3":
      await assignBestTeacherToStudent(sb, opts.studentId, opts.leadName, opts.packLabel);
      break;
  }
}

async function setupStudentWithTeacher(
  sb: ReturnType<typeof supabaseAdmin>,
  studentId: string,
  studentName: string,
  teacherId: string,
  source: "trial_teacher" | "auto_assigned",
): Promise<void> {
  const deadline = new Date(Date.now() + 24 * 3_600_000).toISOString();

  const { data: student } = await sb
    .from("students")
    .select("current_level")
    .eq("id", studentId)
    .maybeSingle();
  const level = (student as { current_level?: string } | null)?.current_level ?? null;

  const teacherEmail = await getTeacherEmail(teacherId);
  const teacher = await getTeacherById(teacherId);
  const teacherName = teacher?.full_name ?? "Profesor";

  const doc = await createStudentNotesDoc(studentName, level ?? "A1", teacherName, teacherEmail);
  const documentUrl = doc?.url ?? null;

  const { data: group } = await sb.from("student_groups").insert({
    name: studentName,
    teacher_id: teacherId,
    class_type: "individual",
    capacity: 1,
    level,
    document_url: documentUrl,
    active: true,
  }).select("id").single();

  if (group) {
    await sb.from("student_group_members").insert({
      group_id: (group as { id: string }).id,
      student_id: studentId,
    });
  }

  const studentUpdate: Record<string, unknown> = {
    teacher_assignment_source: source,
    teacher_assigned_at: new Date().toISOString(),
    teacher_contact_deadline: deadline,
  };
  if (documentUrl) {
    studentUpdate.document_url = documentUrl;
  }
  await sb.from("students").update(studentUpdate).eq("id", studentId);
}

async function notifyTeacherOfConversion(
  teacherId: string,
  leadName: string,
  packLabel: string,
  scenario: ConversionScenario,
): Promise<void> {
  const teacher = await getTeacherById(teacherId);
  if (!teacher) return;

  const isE2 = scenario === "E2";
  const commissionNote = isE2
    ? "Recibes 50% comision de precalificacion"
    : "Recibes comision completa";

  const title = `${leadName} se inscribio!`;
  const body = `${packLabel} · ${commissionNote}. CONTACTA HOY para coordinar horarios.`;

  await createNotification({
    user_id: teacher.user_id,
    type: "student_converted",
    title,
    body,
    link: "/profesor/alumnos",
  }).catch(e => console.error("[post-conversion] notification failed:", e));

  if (teacher.phone) {
    const waMsg = `${title}\n\n${body}\n\nEntra a tu panel para ver los detalles del nuevo alumno.`;
    await sendWhatsappText(teacher.phone, waMsg, { kind: "teacher_conversion_notify" })
      .catch(e => console.error("[post-conversion] WA to teacher failed:", e));
  }
}

async function assignBestTeacherToStudent(
  sb: ReturnType<typeof supabaseAdmin>,
  studentId: string,
  leadName: string,
  packLabel: string,
): Promise<void> {
  const bestTeacherId = await findBestTeacherForStudent(sb);
  if (!bestTeacherId) {
    console.warn("[post-conversion] E3: no active teacher found for auto-assignment");
    return;
  }

  await sb.from("students").update({
    trial_teacher_id: bestTeacherId,
  }).eq("id", studentId);

  await setupStudentWithTeacher(sb, studentId, leadName, bestTeacherId, "auto_assigned");
  await notifyTeacherOfConversion(bestTeacherId, leadName, packLabel, "E3");
}

async function findBestTeacherForStudent(
  sb: ReturnType<typeof supabaseAdmin>,
): Promise<string | null> {
  const { data: teachers } = await sb
    .from("teachers")
    .select(`
      id,
      users!inner(active),
      student_groups(count)
    `)
    .eq("active", true)
    .eq("accepts_trials", true)
    .eq("users.active", true);

  if (!teachers || teachers.length === 0) return null;

  type TeacherWithCount = {
    id: string;
    student_groups: { count: number }[] | { count: number };
  };

  const ranked = (teachers as unknown as TeacherWithCount[])
    .map(t => {
      const groups = t.student_groups;
      const count = Array.isArray(groups)
        ? (groups[0]?.count ?? 0)
        : (typeof groups === "object" && groups ? groups.count : 0);
      return { id: t.id, studentCount: count };
    })
    .sort((a, b) => a.studentCount - b.studentCount);

  return ranked[0]?.id ?? null;
}
