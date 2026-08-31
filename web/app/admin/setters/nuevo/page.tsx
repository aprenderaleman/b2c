import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { CreateSetterForm } from "@/components/admin/CreateSetterForm";

export const metadata = { title: "Nuevo setter · Admin" };

export default async function NewSetterPage() {
  await requireRole(["superadmin", "admin"]);

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin/setters" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver a setters
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Crear setter</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
          Crea un setter que confirmara, recordara y rescatara citas desde el panel /setter.
          No ve precios, propuestas, pagos ni el pipeline.
        </p>
      </div>
      <CreateSetterForm />
    </main>
  );
}
