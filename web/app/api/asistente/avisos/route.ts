import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { getClassBalance } from "@/lib/class-balance";
import { getStudentHomework } from "@/lib/homework";
import { getStudentUpcomingClasses, getTeacherUpcomingClasses } from "@/lib/classes";
import { teacherStudents } from "@/lib/asistente/tools";

/**
 * GET /api/asistente/avisos → avisos proactivos DENTRO del panel, sin LLM,
 * sin email ni WhatsApp. Cada aviso trae la pregunta que se le pasa al
 * asistente si el usuario lo pulsa.
 */

export const runtime = "nodejs";

type Aviso = { texto: string; pregunta: string };

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role   = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;
  const avisos: Aviso[] = [];

  try {
    if (role === "student") {
      const { data } = await supabaseAdmin().from("students").select("id").eq("user_id", userId).maybeSingle();
      if (data) {
        const id = (data as { id: string }).id;
        const [balance, upcoming, homework] = await Promise.all([
          getClassBalance(id), getStudentUpcomingClasses(id), getStudentHomework(id),
        ]);
        if (upcoming.length === 0 && balance.disponibles > 0) {
          avisos.push({ texto: "No tienes ninguna clase agendada.", pregunta: "Quiero agendar una clase, ¿qué huecos hay?" });
        }
        if (balance.total != null && balance.disponibles <= 2 && upcoming.length <= 2) {
          avisos.push({ texto: `Te quedan ${balance.disponibles} clases por agendar.`, pregunta: "¿Cuál es mi saldo de clases?" });
        }
        const pendientes = homework.filter(h => !h.submission || h.submission.status === "needs_revision").length;
        if (pendientes > 0) {
          avisos.push({ texto: `Tienes ${pendientes} ${pendientes === 1 ? "tarea pendiente" : "tareas pendientes"}.`, pregunta: "¿Qué tareas tengo pendientes?" });
        }
      }
    } else if (role === "teacher") {
      const me = await getTeacherByUserId(userId);
      if (me) {
        const [students, upcoming] = await Promise.all([teacherStudents(me.id), getTeacherUpcomingClasses(me.id, new Date(), 14)]);
        const conClase = new Set(upcoming.flatMap(c => c.participants.map(p => p.student_id)));
        const sinClase = students.filter(s => !conClase.has(s.id));
        if (sinClase.length > 0) {
          avisos.push({
            texto: `${sinClase.length} ${sinClase.length === 1 ? "alumno sin clase" : "alumnos sin clase"} en las próximas 2 semanas.`,
            pregunta: "¿Qué alumnos míos no tienen clase agendada en las próximas 2 semanas?",
          });
        }
      }
    }
  } catch (e) {
    console.error("[asistente/avisos] failed:", e);
  }
  return NextResponse.json({ avisos });
}
