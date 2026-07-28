import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { CreateCloserForm } from "@/components/admin/CreateCloserForm";

export const metadata = { title: "Nuevo closer · Admin" };

export default async function NewCloserPage() {
  await requireRole(["superadmin", "admin"]);

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin/closers" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver a closers
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Crear closer</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Crea un closer que podra dar seguimiento a leads asignados desde el panel /closer.
        </p>
      </div>
      <CreateCloserForm />
    </main>
  );
}
