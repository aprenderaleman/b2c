import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { markBonoConversacion } from "@/lib/bono-conversacion";

/**
 * POST /api/teacher/students/[id]/bono-conversacion
 *
 * El PROFESOR marca la clase de conversación del bono 48h como dada
 * (Gelfis 2026-09-30: "que sea el mismo profesor el que la marque").
 * Gate: debe enseñar al estudiante — misma regla que la ficha
 * /profesor/estudiantes/[id] (clase compartida o grupo activo suyo).
 * Al marcarse, el banner desaparece para estudiante y profe, y se
 * aplica el ajuste +1 (la clase es adicional, no descuenta del pack).
 *
 * Admins también pueden llamar (sin gate). Form post → redirect 303
 * de vuelta a la ficha del profe.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: studentId } = await params;

  if (role === "teacher") {
    const me = await getTeacherByUserId((session.user as { id: string }).id);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    const sb = supabaseAdmin();
    const [shared, groupMembership] = await Promise.all([
      sb.from("class_participants")
        .select("class_id, classes!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("classes.teacher_id", me.id)
        .limit(1),
      sb.from("student_group_members")
        .select("student_id, group:student_groups!inner(teacher_id, active)")
        .eq("student_id", studentId)
        .eq("group.teacher_id", me.id)
        .eq("group.active", true)
        .limit(1),
    ]);
    const teaches = (shared.data?.length ?? 0) > 0 || (groupMembership.data?.length ?? 0) > 0;
    if (!teaches) return NextResponse.json({ error: "not_your_student" }, { status: 403 });
  }

  // El profe solo marca (sin undo) — deshacer queda para el admin.
  const result = await markBonoConversacion(studentId, false);
  if (!result.ok) {
    const status = result.error === "student_not_found" ? 404 : result.error === "no_bono" ? 400 : 500;
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(new URL(`/profesor/estudiantes/${studentId}`, req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, used: result.used, already: result.already });
}
