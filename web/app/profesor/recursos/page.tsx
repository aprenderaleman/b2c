import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import {
  listResources, RESOURCE_KINDS, RESOURCE_LEVELS,
  type ResourceKind, type ResourceLevel,
} from "@/lib/teacher-resources";
import { ResourcesClient } from "./ResourcesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recursos · Profesor" };

/**
 * /profesor/recursos
 *
 * Biblioteca compartida de recursos entre profesores. Cualquier profe
 * sube — todos ven. Filtros: nivel CEFR, tipo (pdf/doc/vídeo/web),
 * tema, búsqueda libre.
 */
export default async function TeacherResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; kind?: string; topic?: string; q?: string }>;
}) {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const me = await getTeacherByUserId(session.user.id);
  const role = session.user.role;
  const isStaff = role === "admin" || role === "superadmin";

  const sp = await searchParams;
  const level = (sp.level && RESOURCE_LEVELS.some(l => l.id === sp.level))
    ? (sp.level as ResourceLevel) : null;
  const kind = (sp.kind && RESOURCE_KINDS.some(k => k.id === sp.kind))
    ? (sp.kind as ResourceKind) : null;
  const topic = sp.topic ?? null;
  const q = sp.q ?? null;

  const resources = await listResources({ level, kind, topic, q });

  return (
    <main className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Recursos para profesores
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Biblioteca compartida: PDFs, documentos, vídeos y enlaces que cualquier profe puede subir
            para que el resto los use. Filtros por nivel y tipo.
          </p>
        </div>
      </header>

      <ResourcesClient
        initialResources={resources}
        initialFilters={{ level, kind, topic: topic ?? "", q: q ?? "" }}
        canUpload={Boolean(me)}
        myTeacherId={me?.id ?? null}
        isStaff={isStaff}
      />
    </main>
  );
}
