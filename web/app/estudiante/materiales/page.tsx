import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { listSharedMaterials, levelsVisibleToStudent, type CefrLevel } from "@/lib/shared-materials";
import { SharedMaterialsSection } from "@/components/materials/SharedMaterialsSection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Material de estudio · Estudiante" };

/**
 * Student-facing catalog of the academy's official Gamma lessons,
 * filtered to their current level and every level below (for review).
 * A1 student → sees A1 only; A2 → A1 + A2; B1 → A1+A2+B1; etc.
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
  const materials = await listSharedMaterials(visible);

  return (
    <main className="space-y-5">
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
        materials={materials}
        heading="Lecciones disponibles para ti"
        description="Clic en cualquier lección para abrirla en Gamma."
      />
    </main>
  );
}
