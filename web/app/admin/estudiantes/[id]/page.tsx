import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudentById, moneyFromCents, subscriptionStatusEs, subscriptionTypeEs } from "@/lib/academy";
import { listStudentPayments, moneyFromCents as moneyFromCentsFinance } from "@/lib/finance";
import { RecordPaymentButton } from "@/components/admin/RecordPaymentButton";
import { IssueCertificateButton } from "@/components/admin/IssueCertificateButton";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";
import { AdjustClassesButton } from "@/components/admin/AdjustClassesButton";
import { listStudentCertificates } from "@/lib/certificates";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const student = await getStudentById(id);
  if (!student) notFound();

  const payments = await listStudentPayments(id);
  const certs    = await listStudentCertificates(id);
  const waDigits = student.phone?.replace(/\D/g, "") ?? "";

  // Pull the pack numbers from the view so we can show + adjust them.
  const { data: pack } = await supabaseAdmin()
    .from("v_student_packs")
    .select("classes_purchased, classes_adjustment, classes_consumed, classes_remaining")
    .eq("student_id", id)
    .maybeSingle();
  const packRow = pack as {
    classes_purchased: number; classes_adjustment: number;
    classes_consumed:  number; classes_remaining: number;
  } | null;

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
          <div className="flex items-center gap-2 flex-wrap">
            <ImpersonateButton
              userId={student.user_id}
              userName={student.full_name ?? student.email}
              role="student"
            />
            {packRow && (
              <AdjustClassesButton
                studentId={student.id}
                studentName={student.full_name ?? student.email}
                currentRemaining={packRow.classes_remaining}
                purchased={packRow.classes_purchased}
                consumed={packRow.classes_consumed}
                currentAdjustment={packRow.classes_adjustment}
              />
            )}
            <RecordPaymentButton studentId={student.id} currentLevel={student.current_level} />
            <IssueCertificateButton studentId={student.id} />
            {student.lead_id && (
              <Link
                href={`/admin/leads/${student.lead_id}`}
                className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Ver lead original →
              </Link>
            )}
          </div>
        </div>
      </header>

      {packRow && (
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Pack de clases
            </h2>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Restantes: <strong className="text-slate-900 dark:text-slate-50 text-base">{packRow.classes_remaining}</strong>
              {" "}· comprado: {packRow.classes_purchased}
              {" "}· dadas: {packRow.classes_consumed}
              {packRow.classes_adjustment !== 0 && (
                <> · ajuste manual: <strong className={
                  packRow.classes_adjustment > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }>{packRow.classes_adjustment > 0 ? `+${packRow.classes_adjustment}` : packRow.classes_adjustment}</strong></>
              )}
            </div>
          </div>
        </section>
      )}

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
          <Panel title={`Pagos (${payments.length})`}>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Aún no hay pagos registrados. Pulsa &quot;Registrar pago&quot; cuando recibas uno.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {payments.map(p => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {moneyFromCentsFinance(p.amount_cents, p.currency)}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="capitalize">{p.type.replace(/_/g, " ")}</span>
                        {p.classes_added > 0 && <> · +{p.classes_added} clases</>}
                        {p.note && <> · {p.note}</>}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400">
                      {p.paid_at ? new Date(p.paid_at).toLocaleDateString("es-ES") : new Date(p.created_at).toLocaleDateString("es-ES")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={`Certificados (${certs.length})`}>
            {certs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Aún sin certificados. Se emiten automáticamente al pasar hitos
                (50 clases) o manualmente con el botón &quot;🏅 Emitir certificado&quot; arriba.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {certs.map(c => (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{c.title}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Emitido {new Date(c.issued_at).toLocaleDateString("es-ES")}
                      </div>
                    </div>
                    <a
                      href={`/api/certificates/${c.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      PDF →
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Próxima clase">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Las clases asignadas aparecerán aquí. Mientras tanto, agenda una desde
              <Link href="/admin/clases" className="text-brand-600 dark:text-brand-400 hover:underline"> Clases</Link>.
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
