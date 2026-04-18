import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { getTeacherAvailability } from "@/lib/availability";
import { AvailabilityEditor } from "./AvailabilityEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disponibilidad · Profesor" };

export default async function TeacherAvailabilityPage() {
  const session = await requireRole(["teacher", "admin", "superadmin"]);
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Disponibilidad</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor. Pide al admin que te cree el perfil.
        </p>
      </main>
    );
  }

  const blocks = await getTeacherAvailability(teacher.id);
  const initial = blocks.map(b => ({
    day_of_week: b.day_of_week,
    start_time:  b.start_time.slice(0, 5),  // strip seconds: "14:00:00" → "14:00"
    end_time:    b.end_time.slice(0, 5),
    available:   b.available,
  }));

  return (
    <main className="space-y-5">
      <header>
        <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Tu disponibilidad</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Marca en qué franjas horarias sueles estar disponible para dar clase.
          El admin verá esto como referencia al agendar clases contigo — no es
          un calendario cerrado, así que siempre puedes decir que sí a una
          clase fuera de estos horarios.
        </p>
      </header>

      <AvailabilityEditor initialBlocks={initial} />
    </main>
  );
}
