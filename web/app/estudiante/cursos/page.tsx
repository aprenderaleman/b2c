import { requireRoleWithImpersonation } from "@/lib/rbac";
import { CursosGrid } from "@/components/cursos/CursosGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cursos · Aprender-Aleman.de" };

export default async function StudentCursosPage() {
  await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Cursos</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Accede a tus cursos de alemán. Cada nivel incluye lecciones, ejercicios y material interactivo.
        </p>
      </header>
      <CursosGrid />
    </main>
  );
}
