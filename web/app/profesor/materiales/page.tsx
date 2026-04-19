import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { listTeacherMaterials } from "@/lib/materials";
import { listSharedMaterials } from "@/lib/shared-materials";
import { SharedMaterialsSection } from "@/components/materials/SharedMaterialsSection";
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
  const [materials, sharedMaterials] = await Promise.all([
    listTeacherMaterials(me.id, sp.q, sp.tag),
    listSharedMaterials(),
  ]);
  // Aggregate tags for the sidebar.
  const tagCounts: Record<string, number> = {};
  for (const m of materials) for (const t of m.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Materiales</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Presentaciones Gamma oficiales de la academia (todos los niveles) + tu biblioteca personal.
        </p>
      </header>

      <SharedMaterialsSection materials={sharedMaterials} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Tu biblioteca personal</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            PDFs, audios, imágenes que subes tú. Tagéalos por nivel / destreza / tema para
            reutilizarlos fácilmente en distintas clases.
          </p>
        </div>
        <MaterialsClient
          initialMaterials={materials}
          tagCounts={tagCounts}
          currentQ={sp.q ?? ""}
          currentTag={sp.tag ?? ""}
        />
      </section>
    </main>
  );
}
