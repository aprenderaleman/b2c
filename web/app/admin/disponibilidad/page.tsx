import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTeacherByUserId } from "@/lib/academy";
import { getTeacherAvailability } from "@/lib/availability";
import { AvailabilityEditor } from "@/app/profesor/disponibilidad/AvailabilityEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi disponibilidad · Admin" };

/**
 * Admin-side availability page (Gelfis).
 *
 * The trial-slot funnel pulls every active teacher with
 * accepts_trials=true and reads their `teacher_availability`
 * windows. Gelfis is one of those teachers, so this page is just
 * a teacher-self editor surfaced from the admin nav so he doesn't
 * have to bounce through /profesor/disponibilidad.
 *
 * If he has no availability rows yet, we pre-fill the screen with
 * the requested defaults — Mon-Fri 08:00-20:00 + Sat-Sun
 * 10:00-15:00 — so the first load is editable rather than empty.
 * Nothing is persisted until he hits "Guardar".
 */

const DEFAULT_BLOCKS: Array<{ day_of_week: number; start_time: string; end_time: string; available: boolean }> = [
  // Mon-Fri 08:00-20:00
  { day_of_week: 1, start_time: "08:00", end_time: "20:00", available: true },
  { day_of_week: 2, start_time: "08:00", end_time: "20:00", available: true },
  { day_of_week: 3, start_time: "08:00", end_time: "20:00", available: true },
  { day_of_week: 4, start_time: "08:00", end_time: "20:00", available: true },
  { day_of_week: 5, start_time: "08:00", end_time: "20:00", available: true },
  // Sat-Sun 10:00-15:00
  { day_of_week: 6, start_time: "10:00", end_time: "15:00", available: true },
  { day_of_week: 0, start_time: "10:00", end_time: "15:00", available: true },
];

export default async function AdminAvailabilityPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") redirect("/login");

  const userId = (session.user as { id: string }).id;
  const teacher = await getTeacherByUserId(userId);

  if (!teacher) {
    return (
      <main className="space-y-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi disponibilidad</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Tu cuenta de admin no tiene un perfil de profesor asociado. Para
          recibir clases de prueba a través del funnel necesitas tener un
          row en <code className="text-xs">teachers</code> con{" "}
          <code className="text-xs">accepts_trials = true</code>.
        </p>
      </main>
    );
  }

  const blocks = await getTeacherAvailability(teacher.id);
  const initial = blocks.length > 0
    ? blocks.map(b => ({
        day_of_week: b.day_of_week,
        start_time:  b.start_time.slice(0, 5),
        end_time:    b.end_time.slice(0, 5),
        available:   b.available,
      }))
    : DEFAULT_BLOCKS;

  return (
    <main className="space-y-5">
      <header>
        <Link href="/admin" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Mi disponibilidad para clases de prueba
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Estas son las franjas en las que <strong>tú</strong> apareces como
          opción para los leads que reservan una clase de prueba en el funnel
          público. Puedes añadir varias franjas por día (p. ej. 08:00–14:00 +
          18:00–20:00) pulsando "+ Añadir franja".
        </p>
        {blocks.length === 0 && (
          <div className="mt-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Aún no tienes disponibilidad guardada. Te hemos pre-cargado el
            horario por defecto: <strong>Lun-Vie 08:00–20:00</strong> y{" "}
            <strong>Sáb-Dom 10:00–15:00</strong>. Pulsa <strong>Guardar</strong>{" "}
            para confirmarlo o ajústalo antes.
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
          El funnel también considera la disponibilidad del resto de profesores
          activos con clases de prueba habilitadas (toggle en{" "}
          <Link href="/admin/profesores" className="underline">/admin/profesores</Link>) — los slots se reparten entre todos
          mediante rotación.
        </p>
      </header>

      <AvailabilityEditor initialBlocks={initial} targetTeacherId={teacher.id} />
    </main>
  );
}
