import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { ReconcileRecordingsButton } from "./ReconcileRecordingsButton";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Mantenimiento · Admin" };

/**
 * Small admin page grouping "manual recovery" buttons — used when an
 * async flow fails (webhook lost, background job crashed, etc.) and
 * something needs a nudge by hand. Everything here has a corresponding
 * automatic path; these are the manual fallbacks.
 */
export default async function MaintenancePage() {
  await requireRole(["admin", "superadmin"]);

  const sb = supabaseAdmin();
  const { count: pendingRecordings } = await sb
    .from("recordings")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing");

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mantenimiento</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Herramientas manuales para rescatar flujos que se hayan quedado colgados.
        </p>
      </header>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Grabaciones pendientes
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Cuando el webhook de LiveKit no llega (por ejemplo si no está configurado en
            LiveKit Cloud), las grabaciones se quedan en <code className="rounded bg-slate-100 dark:bg-slate-800 px-1">processing</code> aunque el archivo ya exista.
            Este botón consulta LiveKit para cada una y la marca como <code className="rounded bg-slate-100 dark:bg-slate-800 px-1">ready</code> si
            está completa.
          </p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
            Ahora mismo: <strong>{pendingRecordings ?? 0}</strong> grabación{(pendingRecordings ?? 0) === 1 ? "" : "es"} en <code>processing</code>.
          </p>
        </div>
        <ReconcileRecordingsButton initialCount={pendingRecordings ?? 0} />
      </section>
    </main>
  );
}
