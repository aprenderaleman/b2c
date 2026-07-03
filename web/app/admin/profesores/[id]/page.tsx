import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherById } from "@/lib/academy";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";
import { EditTeacherButton } from "@/components/admin/EditTeacherButton";
import { AcceptsTrialsToggle } from "./AcceptsTrialsToggle";
import { requireRole } from "@/lib/rbac";
import { listAdminNotes } from "@/lib/admin-notes";
import { NotesCard } from "@/components/admin/NotesCard";
import { NotificationsOptOutToggle } from "@/components/admin/NotificationsOptOutToggle";
import { supabaseAdmin } from "@/lib/supabase";
import { PendingApprovalCard } from "./PendingApprovalCard";

export const dynamic = "force-dynamic";

export default async function TeacherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["admin", "superadmin"]);
  const { id } = await params;
  const teacher = await getTeacherById(id);
  if (!teacher) notFound();

  // ─── Métricas de trials del profe ─────────────────────────────────
  // Cuántos trials dió, cuántos se convirtieron, tasa, ingresos.
  // Sumamos en JS porque las queries son chiquitas.
  const trialsAllRes = await supabaseAdmin()
    .from("classes")
    .select(`
      id, scheduled_at, status,
      lead_id,
      participants:class_participants(attended)
    `)
    .eq("teacher_id", id)
    .eq("is_trial", true);
  type TrialRow = {
    id: string; scheduled_at: string; status: string; lead_id: string | null;
    participants: Array<{ attended: boolean | null }> | null;
  };
  const allTrials = (trialsAllRes.data ?? []) as unknown as TrialRow[];
  const trialsCount    = allTrials.length;
  const trialsAttended = allTrials.filter(t =>
    t.status === "completed" &&
    (t.participants ?? []).some(p => p.attended === true)
  ).length;
  // Conversiones: cuántos students apuntan a este profe via trial_teacher_id
  const convertedRes = await supabaseAdmin()
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("trial_teacher_id", id);
  const trialsConverted = convertedRes.count ?? 0;
  const conversionRate  = trialsAttended > 0
    ? (trialsConverted / trialsAttended) * 100
    : 0;
  // Beneficio total del profe por trials (base + comisiones), todo
  // tiempo. Sumamos amount_cents de class_hours_log de TODAS las trial
  // classes de este profe.
  const earningsRes = await supabaseAdmin()
    .from("class_hours_log")
    .select("amount_cents, class:classes!inner(is_trial, teacher_id)")
    .eq("teacher_id", id)
    .eq("classes.is_trial", true);
  type ELog = { amount_cents: number };
  const trialEarningsCents = ((earningsRes.data ?? []) as unknown as ELog[])
    .reduce((s, r) => s + Number(r.amount_cents), 0);

  const [notes, optOutRow, futureClassesRes, reviewsRes] = await Promise.all([
    listAdminNotes("teacher", id),
    supabaseAdmin()
      .from("users")
      .select("notifications_opt_out")
      .eq("id", teacher.user_id)
      .maybeSingle(),
    // Para el warning del modal de edición cuando admin desactive.
    supabaseAdmin()
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", id)
      .eq("status", "scheduled")
      .gt("scheduled_at", new Date().toISOString()),
    // Reseñas que apuntan a clases de ESTE profe.
    supabaseAdmin()
      .from("class_reviews")
      .select(`
        id, rating, comment, created_at,
        classes!inner(id, scheduled_at, teacher_id),
        students!inner(users!inner(full_name, email))
      `)
      .eq("classes.teacher_id", id)
      .not("rating", "is", null)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  type RevRow = {
    id: string; rating: number; comment: string | null; created_at: string;
    classes: { scheduled_at: string };
    students: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }
           | Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
  };
  const reviews = ((reviewsRes.data ?? []) as unknown as RevRow[]);
  const avgRating = reviews.length > 0
    ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length
    : 0;
  const scheduledFutureClasses = futureClassesRes.count ?? 0;
  const optOut = Boolean(
    (optOutRow.data as { notifications_opt_out?: boolean } | null)?.notifications_opt_out,
  );

  const waDigits = teacher.phone?.replace(/\D/g, "") ?? "";

  const isPending = teacher.registered_self === true && !teacher.approved_at;

  return (
    <main className="space-y-5">
      <Link href="/admin/profesores" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a profesores
      </Link>

      {isPending && (
        <PendingApprovalCard
          teacher={{
            id:                     teacher.id,
            full_name:              teacher.full_name,
            email:                  teacher.email,
            phone:                  teacher.phone,
            address:                teacher.address ?? null,
            country:                teacher.country ?? null,
            languages_spoken:       teacher.languages_spoken,
            specialties:            teacher.specialties,
            levels_taught:          teacher.levels_taught ?? [],
            hourly_rate_group:      teacher.hourly_rate_group ?? null,
            hourly_rate_individual: teacher.hourly_rate_individual ?? null,
            iban:                   teacher.iban ?? null,
            created_at:             teacher.created_at,
          }}
        />
      )}

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
          <div className="flex items-center gap-2 flex-wrap">
            {!isPending && (
              <EditTeacherButton teacher={{
                id:                     teacher.id,
                full_name:              teacher.full_name,
                email:                  teacher.email,
                phone:                  teacher.phone,
                language_preference:    teacher.language_preference,
                active:                 teacher.active,
                notifications_opt_out:  optOut,
                bio:                    teacher.bio ?? null,
                languages_spoken:       teacher.languages_spoken ?? [],
                specialties:            teacher.specialties ?? [],
                levels_taught:          teacher.levels_taught ?? [],
                country:                teacher.country ?? null,
                address:                teacher.address ?? null,
                hourly_rate_individual: teacher.hourly_rate_individual != null ? Number(teacher.hourly_rate_individual) : null,
                hourly_rate_group:      teacher.hourly_rate_group      != null ? Number(teacher.hourly_rate_group)      : null,
                currency:               teacher.currency ?? "EUR",
                iban:                   teacher.iban ?? null,
                payment_method:         teacher.payment_method ?? null,
                notes:                  teacher.notes ?? null,
                scheduledFutureClasses,
              }} />
            )}
            <ImpersonateButton
              userId={teacher.user_id}
              userName={teacher.full_name ?? teacher.email}
              role="teacher"
            />
          </div>
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

      {/* Métricas de clases de prueba */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Clases de prueba
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Comisión 75-250 € (único) / 30-75 € (cuotas) · bono ≥30% cierre
          </span>
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
          <Metric label="Recibidas" value={String(trialsCount)} />
          <Metric label="Asistidas" value={String(trialsAttended)} />
          <Metric label="Convertidas" value={String(trialsConverted)} accent="emerald" />
          <Metric
            label="Tasa conversión"
            value={trialsAttended > 0 ? `${conversionRate.toFixed(0)}%` : "—"}
            accent={conversionRate >= 30 ? "emerald" : conversionRate >= 15 ? "amber" : undefined}
          />
          <Metric
            label="Beneficio (€)"
            value={(trialEarningsCents / 100).toFixed(2)}
            accent="brand"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Reseñas de alumnos
          </h2>
          {reviews.length > 0 ? (
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <span className="text-amber-400">★</span>{" "}
              <strong className="text-slate-900 dark:text-slate-50">{avgRating.toFixed(2)}</strong>{" "}
              <span className="text-slate-500 dark:text-slate-400">
                · {reviews.length} reseña{reviews.length === 1 ? "" : "s"} reciente{reviews.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">Aún sin reseñas</span>
          )}
        </div>
        {reviews.length > 0 && (
          <ul className="mt-3 space-y-2.5">
            {reviews.map(r => {
              const s = Array.isArray(r.students) ? r.students[0] : r.students;
              const su = Array.isArray(s.users) ? s.users[0] : s.users;
              const when = new Date(r.classes.scheduled_at).toLocaleString("es-ES", {
                timeZone: "Europe/Berlin", day: "2-digit", month: "short", year: "2-digit",
              });
              return (
                <li key={r.id} className="text-sm border-l-2 border-amber-400 pl-3">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span className="text-amber-400 leading-none">
                      {"★".repeat(r.rating)}<span className="text-slate-300 dark:text-slate-600">{"★".repeat(5 - r.rating)}</span>
                    </span>
                    <span className="text-xs">
                      {su?.full_name ?? su?.email} · clase del {when}
                    </span>
                  </div>
                  {r.comment && (
                    <p className="mt-1 text-slate-700 dark:text-slate-200 italic">“{r.comment}”</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AcceptsTrialsToggle
        teacherId={teacher.id}
        initialValue={teacher.accepts_trials}
      />

      <NotificationsOptOutToggle
        userId={teacher.user_id}
        initialOptOut={optOut}
        personLabel={teacher.full_name || teacher.email}
      />

      <NotesCard
        targetType="teacher"
        targetId={id}
        initialNotes={notes}
        currentUserId={session.user.id}
        currentRole={session.user.role === "superadmin" ? "superadmin" : "admin"}
      />
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

function Metric({
  label, value, accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "amber" | "brand";
}) {
  const valColor =
    accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
    accent === "amber"   ? "text-amber-600 dark:text-amber-400"     :
    accent === "brand"   ? "text-brand-600 dark:text-brand-400"     :
                            "text-slate-900 dark:text-slate-50";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valColor}`}>{value}</div>
    </div>
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
