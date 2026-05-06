import { requireRole } from "@/lib/rbac";
import { CreateStudentForm } from "@/components/admin/CreateStudentForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo estudiante · admin" };

export default async function NewStudentPage() {
  await requireRole(["admin", "superadmin"]);
  return (
    <main className="max-w-2xl mx-auto space-y-5">
      <a href="/admin/estudiantes" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600">
        ← Volver a estudiantes
      </a>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Crear estudiante</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Para alumnos que llegan por canal externo (referido, presencial, email directo). Para los que vienen del funnel
          usa la conversión desde su lead.
        </p>
      </header>
      <CreateStudentForm />
    </main>
  );
}
