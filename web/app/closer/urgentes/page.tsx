import { requireRoleWithImpersonation } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { getCloserUrgentes } from "@/lib/closer-urgentes";
import { CloserUrgentesTabs } from "@/components/closer/CloserUrgentesTabs";

export const metadata = { title: "Urgentes · Closer" };
export const dynamic = "force-dynamic";

/**
 * /closer/urgentes — CRM Closer F2 (Gelfis 2026-11-25).
 * Cola de cierre con 3 pestañas: post-trial sin cierre (desde 24h del
 * trial, ordenada por bono restante), no-shows y antiguos asignados a
 * mano. Los leads del funnel /sesion-plan siguen en "Mis leads".
 */
export default async function CloserUrgentesPage() {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");

  const data = await getCloserUrgentes(session.user.id);
  const total = data.postTrial.length + data.noShows.length + data.antiguos.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Urgentes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {total === 0
            ? "Sin cierres pendientes ahora mismo."
            : `${total} lead${total === 1 ? "" : "s"} por cerrar. El bono del lead vence a las 48h de su clase de prueba.`}
        </p>
      </header>

      <CloserUrgentesTabs data={data} />
    </div>
  );
}
