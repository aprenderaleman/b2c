import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import {
  listResources, levelsForStudent,
  RESOURCE_KINDS, RESOURCE_LEVELS,
  type ResourceKind, type ResourceLevel,
} from "@/lib/teacher-resources";
import { StudentLibraryClient } from "./StudentLibraryClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Biblioteca · Aprender-Aleman.de" };

/**
 * /estudiante/biblioteca
 *
 * Vídeos y enlaces curados por los profesores. Los profes marcan
 * "visible para alumnos" cuando suben un recurso (typically un
 * enlace a vídeo de YouTube o una fuente externa de estudio).
 *
 * Filtros: nivel (default: nivel del alumno + niveles inferiores),
 * tipo (vídeo, fuente), búsqueda libre.
 */
export default async function StudentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; kind?: string; q?: string; all?: string }>;
}) {
  const session = await requireRoleWithImpersonation(
    ["student", "teacher", "admin", "superadmin"],
    "student",
  );
  const student = await getStudentByUserId(session.user.id);
  const currentLevel = student?.current_level ?? "A1";

  const sp = await searchParams;
  const showAll = sp.all === "1";

  // Por defecto el alumno ve solo recursos de su nivel y por debajo.
  // Con `?all=1` ve todos. El filtro `level` explícito siempre gana.
  let levelFilter: ResourceLevel | null = null;
  let levelsIn: ResourceLevel[] | null = null;
  if (sp.level && RESOURCE_LEVELS.some(l => l.id === sp.level)) {
    levelFilter = sp.level as ResourceLevel;
  } else if (!showAll) {
    levelsIn = levelsForStudent(currentLevel);
  }

  const kind = (sp.kind && RESOURCE_KINDS.some(k => k.id === sp.kind))
    ? (sp.kind as ResourceKind) : null;

  // Solo recursos compatibles con alumnos:
  //   - student_visible = true
  //   - kind ∈ {video_link, source_link, pdf} (pdf/doc opcionalmente —
  //     los profes los marcan visibles cuando son materiales lecturables
  //     directamente por el alumno; nunca a la fuerza)
  const resources = await listResources({
    studentVisible: true,
    level:    levelFilter,
    levelsIn: levelsIn,
    kind,
    q: sp.q ?? null,
  });

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Biblioteca</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Vídeos, lecturas y enlaces seleccionados por tus profesores para tu nivel.
        </p>
      </header>

      <StudentLibraryClient
        initialResources={resources}
        currentLevel={currentLevel}
        showAll={showAll}
        initialFilters={{
          level: (sp.level as ResourceLevel | undefined) ?? null,
          kind:  kind,
          q:     sp.q ?? "",
        }}
      />
    </main>
  );
}
