import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { getTeacherAvailability } from "@/lib/availability";
import { WeekCalendar } from "@/components/calendar/WeekCalendar";
import { AvailabilityEditor } from "../disponibilidad/AvailabilityEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario · Profesor" };

/**
 * Calendario semanal del profesor (spec Gelfis 2026-08): vista rápida
 * de la semana, azul recurrentes / naranja pruebas / gris pasadas,
 * click en clase → reagendar / cancelar (suelta o serie) / contacto,
 * agendar nueva clase, y la disponibilidad editable en el mismo sitio.
 */
export default async function TeacherCalendarPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Calendario</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor. Pide al admin que te cree el perfil.
        </p>
      </main>
    );
  }

  const blocks = await getTeacherAvailability(teacher.id);
  const initial = blocks.map(b => ({
    day_of_week: b.day_of_week,
    start_time:  b.start_time.slice(0, 5),
    end_time:    b.end_time.slice(0, 5),
    available:   b.available,
  }));

  return (
    <main className="space-y-8">
      <header>
        <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Tu calendario</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Todas tus clases de la semana (hora de Berlín). Haz click en una clase para
          reagendarla, cancelarla o contactar al alumno.
        </p>
      </header>

      <WeekCalendar role="teacher" />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Tu disponibilidad</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Las franjas marcadas aquí se pintan en verde en el calendario de arriba.
          </p>
        </div>
        <AvailabilityEditor initialBlocks={initial} />
      </section>
    </main>
  );
}
