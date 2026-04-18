import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudentById, moneyFromCents, subscriptionStatusEs, subscriptionTypeEs } from "@/lib/academy";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const student = await getStudentById(id);
  if (!student) notFound();

  const waDigits = student.phone?.replace(/\D/g, "") ?? "";

  return (
    <main className="space-y-5">
      <Link href="/admin/estudiantes" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a estudiantes
      </Link>

      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {student.full_name || "Estudiante sin nombre"}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
              <span className="font-mono">{student.email}</span>
              {student.phone && (
                <>
                  <span>·</span>
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    {student.phone}
                  </a>
                </>
              )}
              <span>·</span>
              <span>{student.language_preference.toUpperCase()}</span>
              <span>·</span>
              <StatusBadge status={student.subscription_status} />
            </div>
          </div>
          {student.lead_id && (
            <Link
              href={`/admin/leads/${student.lead_id}`}
              className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Ver lead original →
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-5">
          <Panel title="Datos académicos">
            <Kv k="Nivel actual" v={student.current_level} />
            <Kv k="Meta"         v={student.goal ?? "—"} />
          </Panel>

          <Panel title="Plan">
            <Kv k="Tipo"          v={subscriptionTypeEs(student.subscription_type)} />
            <Kv k="Estado"        v={subscriptionStatusEs(student.subscription_status)} />
            {student.subscription_type === "monthly_subscription" ? (
              <>
                <Kv k="Clases/mes"    v={String(student.classes_per_month ?? "—")} />
                <Kv k="Precio mensual" v={moneyFromCents(student.monthly_price_cents, student.currency)} />
              </>
            ) : (
              <Kv k="Clases restantes" v={String(student.classes_remaining)} />
            )}
          </Panel>

          <Panel title="Accesos">
            <Kv k="SCHULE" v={student.schule_access ? "Sí" : "No"} />
            <Kv k="HANS"   v={student.hans_access ? "Sí" : "No"} />
          </Panel>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <Panel title="Próxima clase">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              La agenda de clases llegará en la siguiente fase.
            </p>
          </Panel>
          <Panel title="Historial de clases">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Aquí verás las clases pasadas, grabaciones y asistencia.
            </p>
          </Panel>
          <Panel title="Notas de Gelfis">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Las notas del admin sobre el estudiante llegan en la siguiente fase.
            </p>
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className="text-slate-900 dark:text-slate-100 text-right break-all">{v}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "active"    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" :
    status === "paused"    ? "bg-amber-50   dark:bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-200   dark:border-amber-500/30"   :
    status === "cancelled" ? "bg-slate-100  dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700"      :
                             "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {subscriptionStatusEs(status)}
    </span>
  );
}
