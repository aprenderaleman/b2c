import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { listTeacherMaterials } from "@/lib/materials";
import { MaterialsClient } from "./MaterialsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Materiales · Profesor" };

export default async function TeacherMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const me = await getTeacherByUserId(session.user.id);
  if (!me) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Materiales</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor.
        </p>
      </main>
    );
  }

  const sp = await searchParams;
  const materials = await listTeacherMaterials(me.id, sp.q, sp.tag);
  // Aggregate tags for the sidebar.
  const tagCounts: Record<string, number> = {};
  for (const m of materials) for (const t of m.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis materiales</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Biblioteca personal de PDFs, audios, imágenes. Tagéalos por nivel / destreza / tema para
          reutilizarlos fácilmente en distintas clases.
        </p>
      </header>

      <MaterialsClient
        initialMaterials={materials}
        tagCounts={tagCounts}
        currentQ={sp.q ?? ""}
        currentTag={sp.tag ?? ""}
      />
    </main>
  );
}
