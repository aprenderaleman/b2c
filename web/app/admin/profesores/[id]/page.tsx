import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherById } from "@/lib/academy";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const dynamic = "force-dynamic";

export default async function TeacherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teacher = await getTeacherById(id);
  if (!teacher) notFound();

  const waDigits = teacher.phone?.replace(/\D/g, "") ?? "";

  return (
    <main className="space-y-5">
      <Link href="/admin/profesores" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a profesores
      </Link>

      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {teacher.full_name || "Profesor sin nombre"}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
              <span className="font-mono">{teacher.email}</span>
              {teacher.phone && (
                <>
                  <span>·</span>
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    {teacher.phone}
                  </a>
                </>
              )}
              <span>·</span>
              <span>{teacher.language_preference.toUpperCase()}</span>
            </div>
          </div>
          <ImpersonateButton
            userId={teacher.user_id}
            userName={teacher.full_name ?? teacher.email}
            role="teacher"
          />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Perfil">
          <Kv k="Biografía"      v={teacher.bio ?? "—"} />
          <Kv k="Idiomas"        v={teacher.languages_spoken.join(", ") || "—"} />
          <Kv k="Especialidades" v={teacher.specialties.join(", ") || "—"} />
        </Panel>

        <Panel title="Económico (admin-only)">
          <Kv k="Tarifa por hora" v={teacher.hourly_rate ? `${Number(teacher.hourly_rate).toFixed(2)} ${teacher.currency}` : "—"} />
          <Kv k="Método de pago"  v={teacher.payment_method ?? "—"} />
          <Kv k="Notas"           v={teacher.notes ?? "—"} />
        </Panel>
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
