import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { getStudentByUserId } from "@/lib/academy";
import { getLiveClassForStudent } from "@/lib/imminent-class";

/**
 * GET /api/student/live-class
 *
 * Lightweight polling endpoint used by the dashboard's "Entrar ahora"
 * CTA. Returns { live: { classId, title, teacherName, startedAt } | null }.
 * Polled every ~15s so the CTA appears within seconds of the teacher
 * pressing "Iniciar clase ahora" and disappears when the class ends.
 *
 * Honors admin impersonation so "Ver como estudiante" works too.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ live: null });
  const role = (session.user as { role?: string }).role;

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole:   (role ?? "student") as "superadmin" | "admin" | "teacher" | "student",
    expectRole:     "student",
  });
  const student = await getStudentByUserId(eff.userId);
  if (!student) return NextResponse.json({ live: null });

  const live = await getLiveClassForStudent(student.id);
  return NextResponse.json({ live });
}
