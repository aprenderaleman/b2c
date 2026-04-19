import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { listSharedMaterials, levelsVisibleToStudent, type CefrLevel } from "@/lib/shared-materials";
import { SharedMaterialsSection } from "@/components/materials/SharedMaterialsSection";
import { listMaterialsVisibleToStudent } from "@/lib/materials";

export const dynamic = "force-dynamic";
export const metadata = { title: "Material de estudio · Estudiante" };

/**
 * Student-facing catalog, TWO sections:
 *   1. Material oficial de la academia — Gamma curriculum filtered to
 *      their level and below (review).
 *   2. Material de tus profesores — files the teachers who actually
 *      teach this student have uploaded with visibility = 'shared'.
 */
export default async function StudentMaterialsPage() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );
  const student = await getStudentByUserId(session.user.id);

  if (!student) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Material de estudio</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de estudiante.
        </p>
      </main>
    );
  }

  const visible = levelsVisibleToStudent(student.current_level as CefrLevel);
  const [shared, fromTeachers] = await Promise.all([
    listSharedMaterials(visible),
    listMaterialsVisibleToStudent(student.id),
  ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Material de estudio</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Presentaciones oficiales para repasar entre clases. Tu nivel actual es{" "}
          <strong className="text-slate-700 dark:text-slate-200">{student.current_level}</strong>,
          así que puedes ver {visible.join(" · ")}. A medida que subas de nivel se te
          desbloquearán los siguientes.
        </p>
      </header>

      <SharedMaterialsSection
        materials={shared}
        heading="Lecciones oficiales de la academia"
        description="Clic en cualquier lección para abrirla en Gamma."
      />

      {/* Teacher-uploaded materials — only render the section when there's something */}
      {fromTeachers.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
              Material de tus profesores
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Archivos que tus profesores han subido y marcado como compartidos.
            </p>
          </div>
          <ul className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {fromTeachers.map(m => (
              <li key={m.id}>
                <a
                  href={m.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <span className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-xl" aria-hidden>
                    {iconForFileType(m.file_type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{m.title}</div>
                    {m.description && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{m.description}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                      {m.teacher_name && <span>De {m.teacher_name}</span>}
                      <span>·</span>
                      <span className="font-mono">{m.file_type}</span>
                      {m.file_size_bytes != null && (
                        <>
                          <span>·</span>
                          <span>{formatBytes(m.file_size_bytes)}</span>
                        </>
                      )}
                      {m.tags.length > 0 && (
                        <>
                          <span>·</span>
                          {m.tags.slice(0, 3).map(t => (
                            <span key={t} className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5">{t}</span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function iconForFileType(mime: string): string {
  if (mime.startsWith("image/"))     return "🖼️";
  if (mime.startsWith("audio/"))     return "🎧";
  if (mime.startsWith("video/"))     return "🎬";
  if (mime.includes("pdf"))          return "📄";
  if (mime.includes("word"))         return "📝";
  if (mime.includes("spreadsheet"))  return "📊";
  return "📎";
}

function formatBytes(n: number): string {
  if (n < 1024)       return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
