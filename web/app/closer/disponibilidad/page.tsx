import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getCloserAvailability } from "@/lib/availability";
import { AvailabilityEditor } from "@/app/profesor/disponibilidad/AvailabilityEditor";
import { GoogleCalendarConnectButton } from "@/components/calendar/GoogleCalendarConnectButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disponibilidad · Closer" };

export default async function CloserAvailabilityPage() {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");

  const blocks = await getCloserAvailability(session.user.id);
  const initial = blocks.map(b => ({
    day_of_week: b.day_of_week,
    start_time:  b.start_time.slice(0, 5),  // "14:00:00" → "14:00"
    end_time:    b.end_time.slice(0, 5),
    available:   b.available,
  }));

  return (
    <main className="space-y-5">
      <header>
        <Link href="/closer" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver a Hoy
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Mi disponibilidad</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Marca en qué franjas horarias estás disponible para sesiones con leads.
          Puedes añadir <strong>varias franjas en el mismo día</strong> (por ejemplo,
          Lunes 08:00–14:00 + 18:00–20:00) pulsando "+ Añadir franja". Los leads
          podrán agendar sesiones contigo dentro de estas franjas.
        </p>
      </header>

      <AvailabilityEditor initialBlocks={initial} apiUrl="/api/closer/availability" />

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Google Calendar
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
          Vincula tu Google Calendar para que:
          <br />· las Sesiones de Plan que agenden contigo se te añadan automáticamente,
          <br />· el sistema respete tus eventos personales al ofrecer horarios a los leads (así nadie te agenda una sesión encima de una reunión que tengas ya en Google Calendar).
        </p>
        <GoogleCalendarConnectButton basePath="/api/closer/google-calendar" />
      </section>
    </main>
  );
}
