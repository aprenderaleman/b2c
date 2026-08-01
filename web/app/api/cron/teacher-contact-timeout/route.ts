import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { getTeacherById } from "@/lib/academy";
import { sendWhatsappText } from "@/lib/whatsapp";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  if (xh && xh === expected) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = new Date();
  let reminded = 0;
  let reassigned = 0;

  // Find students with teacher_contact_deadline that has passed
  // and teacher_contacted_at is still null
  const { data: pendingStudents } = await sb
    .from("students")
    .select(`
      id,
      trial_teacher_id,
      teacher_contact_deadline,
      teacher_assigned_at,
      teacher_assignment_source,
      users!inner(full_name)
    `)
    .is("teacher_contacted_at", null)
    .not("teacher_contact_deadline", "is", null)
    .lte("teacher_contact_deadline", now.toISOString());

  if (!pendingStudents || pendingStudents.length === 0) {
    return NextResponse.json({ ok: true, reminded: 0, reassigned: 0 });
  }

  for (const student of pendingStudents) {
    const s = student as {
      id: string;
      trial_teacher_id: string | null;
      teacher_contact_deadline: string;
      teacher_assigned_at: string | null;
      teacher_assignment_source: string | null;
      users: { full_name: string | null }[];
    };

    if (!s.trial_teacher_id) continue;

    const assignedAt = s.teacher_assigned_at
      ? new Date(s.teacher_assigned_at).getTime()
      : new Date(s.teacher_contact_deadline).getTime() - 24 * 3_600_000;
    const elapsed = now.getTime() - assignedAt;
    const usersArr = Array.isArray(s.users) ? s.users : [s.users];
    const studentName = usersArr[0]?.full_name ?? "Nuevo alumno";

    if (elapsed >= 48 * 3_600_000) {
      // 48h passed — REASSIGN to next best teacher
      const newTeacherId = await findReplacementTeacher(sb, s.trial_teacher_id);

      if (newTeacherId) {
        await sb.from("students").update({
          trial_teacher_id: newTeacherId,
          teacher_assignment_source: "reassigned",
          teacher_assigned_at: now.toISOString(),
          teacher_contact_deadline: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
        }).eq("id", s.id);

        // Notify new teacher
        const newTeacher = await getTeacherById(newTeacherId);
        if (newTeacher) {
          await createNotification({
            user_id: newTeacher.user_id,
            type: "student_converted",
            title: `Nuevo alumno reasignado: ${studentName}`,
            body: "El profesor anterior no contacto en 48h. CONTACTA HOY para coordinar horarios.",
            link: "/profesor/alumnos",
          }).catch(() => {});

          if (newTeacher.phone) {
            await sendWhatsappText(
              newTeacher.phone,
              `Nuevo alumno reasignado: ${studentName}\n\nEl profesor anterior no contacto en 48h. Por favor contacta al alumno HOY para coordinar horarios.`,
              { kind: "teacher_reassignment" },
            ).catch(() => {});
          }
        }

        // Log the reassignment
        await sb.from("lead_timeline").insert({
          lead_id: s.id,
          type: "status_change",
          author: "system",
          content: `Profe reasignado: ${s.trial_teacher_id} → ${newTeacherId} (48h sin contacto)`,
          metadata: {
            kind: "teacher_reassignment",
            old_teacher_id: s.trial_teacher_id,
            new_teacher_id: newTeacherId,
            student_id: s.id,
          },
        });

        reassigned++;
      }
    } else if (elapsed >= 24 * 3_600_000) {
      // 24h passed — send REMINDER to current teacher
      const teacher = await getTeacherById(s.trial_teacher_id);
      if (teacher) {
        await createNotification({
          user_id: teacher.user_id,
          type: "teacher_contact_reminder",
          title: `Recordatorio: contactar a ${studentName}`,
          body: "Llevas 24h sin contactar a tu nuevo alumno. Si no contactas en las proximas 24h, sera reasignado.",
          link: "/profesor/alumnos",
        }).catch(() => {});

        if (teacher.phone) {
          await sendWhatsappText(
            teacher.phone,
            `Recordatorio: llevas 24h sin contactar a ${studentName}.\n\nSi no lo contactas en las proximas 24h, sera reasignado a otro profesor.`,
            { kind: "teacher_contact_reminder" },
          ).catch(() => {});
        }

        reminded++;
      }
    }
  }

  return NextResponse.json({ ok: true, reminded, reassigned });
}

async function findReplacementTeacher(
  sb: ReturnType<typeof supabaseAdmin>,
  excludeTeacherId: string,
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
    .eq("users.active", true)
    .neq("id", excludeTeacherId);

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
