import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/teacher/picker
 *
 * Returns ONLY the students the calling teacher already teaches — used
 * to populate the student selector in their "Nueva clase" modal.
 *
 * Two sources are unioned so the list is never empty for a freshly-made
 * teacher-student pairing:
 *   (a) class_participants in any class where teacher_id = me
 *   (b) student_group_members whose group.teacher_id = me
 *
 * Source (b) is what makes the "agendar clase" modal work for pairings
 * that have no scheduled classes yet (exactly the case "Iniciar clase
 * ahora" exists for).
 *
 * Honors admin impersonation: when an admin "views as Sabine", we
 * resolve to Sabine's teacher_id instead of the admin's user id.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole:   role as "teacher" | "admin" | "superadmin",
    expectRole:     "teacher",
  });
  const me = await getTeacherByUserId(eff.userId);
  if (!me) return NextResponse.json({ students: [] });

  const sb = supabaseAdmin();

  // (a) Students via past/future classes I teach.
  // (b) Students via groups I'm the assigned teacher of.
  const [viaClasses, viaGroups] = await Promise.all([
    sb.from("classes")
      .select(`
        teacher_id,
        class_participants!inner(
          student_id,
          students!inner(
            id, current_level, subscription_status,
            users!inner(email, full_name)
          )
        )
      `)
      .eq("teacher_id", me.id),
    sb.from("student_group_members")
      .select(`
        student_id,
        group:student_groups!inner(teacher_id),
        students!inner(
          id, current_level, subscription_status,
          users!inner(email, full_name)
        )
      `)
      .eq("group.teacher_id", me.id),
  ]);

  type StudentRow = {
    id: string; current_level: string; subscription_status: string;
    users: { email: string; full_name: string | null } |
           Array<{ email: string; full_name: string | null }>;
  };
  type ClassRow = {
    class_participants: Array<{
      student_id: string;
      students: StudentRow | StudentRow[];
    }>;
  };
  type GroupRow = {
    student_id: string;
    students: StudentRow | StudentRow[];
  };

  const byId = new Map<string, {
    id: string; email: string; full_name: string | null;
    current_level: string; subscription_status: string;
  }>();

  const ingestStudent = (raw: StudentRow | StudentRow[] | undefined) => {
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (!s || byId.has(s.id)) return;
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    byId.set(s.id, {
      id:                  s.id,
      email:               u?.email ?? "",
      full_name:           u?.full_name ?? null,
      current_level:       s.current_level,
      subscription_status: s.subscription_status,
    });
  };

  for (const raw of (viaClasses.data ?? []) as ClassRow[]) {
    for (const cp of raw.class_participants) ingestStudent(cp.students);
  }
  for (const raw of (viaGroups.data ?? []) as GroupRow[]) {
    ingestStudent(raw.students);
  }

  const students = [...byId.values()].sort((a, b) =>
    (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));

  return NextResponse.json({ students });
}
