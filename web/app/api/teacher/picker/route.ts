import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/teacher/picker
 *
 * Returns ONLY the students the calling teacher already teaches — used
 * to populate the student selector in their "Nueva clase" modal. Keeps
 * other students' data private and prevents accidental scheduling with
 * random strangers.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const me = await getTeacherByUserId((session.user as { id: string }).id);
  if (!me) return NextResponse.json({ students: [] });

  const sb = supabaseAdmin();
  // Distinct student_ids that appear in any class I teach.
  const { data: rows } = await sb
    .from("classes")
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
    .eq("teacher_id", me.id);

  type Row = {
    class_participants: Array<{
      student_id: string;
      students: {
        id: string; current_level: string; subscription_status: string;
        users: { email: string; full_name: string | null } |
               Array<{ email: string; full_name: string | null }>;
      } | Array<{
        id: string; current_level: string; subscription_status: string;
        users: { email: string; full_name: string | null } |
               Array<{ email: string; full_name: string | null }>;
      }>;
    }>;
  };
  const byId = new Map<string, {
    id: string; email: string; full_name: string | null;
    current_level: string; subscription_status: string;
  }>();
  for (const raw of (rows ?? []) as Row[]) {
    for (const cp of raw.class_participants) {
      const s = Array.isArray(cp.students) ? cp.students[0] : cp.students;
      if (!s) continue;
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      if (byId.has(s.id)) continue;
      byId.set(s.id, {
        id:                  s.id,
        email:               u?.email ?? "",
        full_name:           u?.full_name ?? null,
        current_level:       s.current_level,
        subscription_status: s.subscription_status,
      });
    }
  }

  const students = [...byId.values()].sort((a, b) =>
    (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));

  return NextResponse.json({ students });
}
