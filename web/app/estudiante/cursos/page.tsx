import { requireRoleWithImpersonation } from "@/lib/rbac";
import { recordOnboardingEventByUser } from "@/lib/onboarding";
import { CursosGrid } from "@/components/cursos/CursosGrid";
import { CursosMateriales, type MaterialLevel } from "@/components/cursos/CursosMateriales";
import { listResources } from "@/lib/teacher-resources";

const LEVEL_LABELS: Record<string, string> = {
  A0: "Primeros pasos",
  A1: "Básico",
  A2: "Elemental",
  B1: "Intermedio",
  B2: "Intermedio alto",
  C1: "Avanzado",
  C2: "Maestría",
};

/** Nº de lección sacado del título ("Lektion 7 — …") para ordenar 1→10. */
function lessonNumber(title: string): number {
  const m = title.match(/Lektion\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : 999;
}

async function loadMateriales(): Promise<MaterialLevel[]> {
  const all = await listResources({ kind: "pdf", studentVisible: true });
  const order = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
  return order
    .map((level) => ({
      level,
      label: LEVEL_LABELS[level] ?? level,
      items: all
        .filter((r) => r.level === level)
        .sort((a, b) => lessonNumber(a.title) - lessonNumber(b.title))
        .map((r) => ({
          id: r.id,
          // "A1 · Lektion 1 — …" → dentro del acordeón A1 el prefijo sobra.
          title: r.title.replace(new RegExp(`^${level}\\s*·\\s*`), ""),
          file_name: r.file_name,
          size_mb: r.file_size_bytes
            ? (r.file_size_bytes / 1024 / 1024).toFixed(1)
            : null,
        })),
    }))
    .filter((l) => l.items.length > 0);
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Cursos · Aprender-Aleman.de" };

export default async function StudentCursosPage() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );
  if (session.user.role === "student") {
    recordOnboardingEventByUser("student", session.user.id, "cursos").catch(() => {});
  }

  const materiales = await loadMateriales();

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Cursos</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Accede a tus cursos de alemán. Cada nivel incluye lecciones, ejercicios y material interactivo.
        </p>
      </header>
      <CursosGrid />
      <CursosMateriales levels={materiales} />
    </main>
  );
}
