import { requireRole } from "@/lib/rbac";
import { CreateLeadForm } from "@/components/admin/CreateLeadForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo lead · admin" };

export default async function NewLeadPage() {
  await requireRole(["admin", "superadmin"]);
  return (
    <main className="max-w-2xl mx-auto space-y-5">
      <a href="/admin/leads" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600">
        ← Volver a leads
      </a>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Crear lead</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Para leads que llegan por canal externo (DM, referido, llamada). Los del funnel se crean solos.
        </p>
      </header>
      <CreateLeadForm />
    </main>
  );
}
