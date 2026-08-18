import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { SesionHubCard, type SesionRow } from "@/components/closer/SesionHubCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sesiones de Plan-Alemán · Admin" };

type Row = {
  id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  short_code: string | null;
  lead_id: string | null;
  closer_user: { id: string; full_name: string | null } | Array<{ id: string; full_name: string | null }>;
  lead: {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; status: string; language: string | null;
    german_level: string | null; goal: string | null;
    qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
    reserva_prioritaria: boolean | null; priority_deadline: string | null;
    deposit_intent_at: string | null;
    trial_attended_at: string | null; trial_absent_at: string | null;
  } | Array<{
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; status: string; language: string | null;
    german_level: string | null; goal: string | null;
    qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
    reserva_prioritaria: boolean | null; priority_deadline: string | null;
    deposit_intent_at: string | null;
    trial_attended_at: string | null; trial_absent_at: string | null;
  }>;
};

const flat = <T,>(x: T | T[] | null | undefined): T | null =>
  !x ? null : Array.isArray(x) ? x[0] ?? null : x;

export default async function AdminSesionesPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, status, short_code, lead_id,
      closer_user:users!sesion_closer_id(id, full_name),
      lead:leads!inner(
        id, name, email, whatsapp_normalized, status, language,
        german_level, goal, qualification_answers,
        reserva_prioritaria, priority_deadline, deposit_intent_at,
        trial_attended_at, trial_absent_at
      )
    `)
    .not("sesion_closer_id", "is", null)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(200);

  const toRow = (r: Row): (SesionRow & { closerName: string }) | null => {
    const lead = flat(r.lead);
    const closer = flat(r.closer_user);
    if (!lead || !r.lead_id) return null;
    return {
      classId: r.id,
      scheduledAt: r.scheduled_at,
      durationMin: r.duration_minutes ?? 25,
      status: r.status,
      shortCode: r.short_code,
      leadId: lead.id,
      leadName: lead.name,
      leadWhatsapp: lead.whatsapp_normalized,
      leadEmail: lead.email,
      leadStatus: lead.status,
      leadLanguage: lead.language === "de" ? "de" : "es",
      leadGermanLevel: lead.german_level,
      leadGoal: lead.goal,
      qualification: lead.qualification_answers,
      reservaPrioritaria: lead.reserva_prioritaria,
      priorityDeadline: lead.priority_deadline,
      depositIntentAt: lead.deposit_intent_at,
      trialAttendedAt: lead.trial_attended_at,
      trialAbsentAt: lead.trial_absent_at,
      closerName: closer?.full_name?.split(/\s+/)[0] ?? "—",
    };
  };

  const all = ((data ?? []) as unknown as Row[]).map(toRow).filter((x): x is SesionRow & { closerName: string } => x !== null);

  const cutoff = Date.now() - 3600_000;
  const proximas = all
    .filter((s) => (s.status === "scheduled" || s.status === "live") && new Date(s.scheduledAt).getTime() >= cutoff)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const historial = all.filter((s) => !proximas.includes(s));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Sesiones de Plan-Alem&aacute;n</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Todas las sesiones de plan de los closers. Haz clic en la ficha
          para ver el detalle del lead.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Pr&oacute;ximas ({proximas.length})
        </h2>
        {proximas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Sin sesiones agendadas.
          </div>
        ) : (
          proximas.map((s) => (
            <SesionHubCard key={s.classId} row={s} closerName={s.closerName} fichaHref={`/admin/leads/${s.leadId}`} />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Historial ({historial.length})
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 px-1">A&uacute;n no hay sesiones pasadas.</p>
        ) : (
          historial.map((s) => (
            <SesionHubCard key={s.classId} row={s} closerName={s.closerName} fichaHref={`/admin/leads/${s.leadId}`} />
          ))
        )}
      </section>
    </main>
  );
}
