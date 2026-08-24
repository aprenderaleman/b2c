import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getCloserAvailability } from "@/lib/availability";
import { WeekCalendar } from "@/components/calendar/WeekCalendar";
import { AvailabilityEditor } from "@/app/profesor/disponibilidad/AvailabilityEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario · Closer" };

/**
 * Calendario semanal del closer: sus Sesiones de Plan de la semana
 * (violeta; gris las pasadas) + disponibilidad editable debajo. Las
 * sesiones se gestionan desde /closer/sesiones — aquí es vista rápida
 * + contacto directo con el lead.
 */
export default async function CloserCalendarPage() {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");

  const blocks = await getCloserAvailability(session.user.id);
  const initial = blocks.map(b => ({
    day_of_week: b.day_of_week,
    start_time:  b.start_time.slice(0, 5),
    end_time:    b.end_time.slice(0, 5),
    available:   b.available,
  }));

  return (
    <main className="space-y-8">
      <header>
        <Link href="/closer" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver a Hoy
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Mi calendario</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tus Sesiones de Plan de la semana (hora de Berlín). Haz click en una sesión
          para ver el lead y contactarlo por WhatsApp.
        </p>
      </header>

      <WeekCalendar role="closer" />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Mi disponibilidad</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Las franjas marcadas aquí se pintan en verde en el calendario de arriba.
          </p>
        </div>
        <AvailabilityEditor initialBlocks={initial} apiUrl="/api/closer/availability" />
      </section>
    </main>
  );
}
