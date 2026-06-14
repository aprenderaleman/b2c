import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { listCostesFijos, moneyFromCents } from "@/lib/empresa";
import { CostesManager } from "./CostesManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costes Fijos · Empresa · Admin" };

export default async function CostesPage() {
  await requireRole(["superadmin", "admin"]);
  const costes = await listCostesFijos();

  const totalActiveCents = costes
    .filter(c => c.active)
    .reduce((s, c) => s + c.amount_cents, 0);

  return (
    <main className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Costes Fijos</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Total mensual activo: <strong>{moneyFromCents(totalActiveCents)}</strong>
          </p>
        </div>
        <Link
          href="/admin/empresa"
          className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
        >
          ← Volver al dashboard
        </Link>
      </header>

      <CostesManager initialCostes={costes} />
    </main>
  );
}
