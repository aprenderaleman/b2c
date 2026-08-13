import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { SesionHubCard, type SesionRow } from "@/components/closer/SesionHubCard";

/**
 * /closer/sesiones — hub de Sesiones de Plan del closer (Gelfis
 * 2026-08-13). Gemelo de /profesor/clasedeprueba: próximas sesiones +
 * historial, con las mismas acciones y cadenas que el profe (asistió,
 * no asistió, objeción, enlace de inscripción, confirmar pago,
 * reagendar, página web).
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Sesiones · Closer" };

type Row = {
  id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  short_code: string | null;
  lead_id: string | null;
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

export default async function CloserSesionesPage() {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");
  const closerId = session.user.id;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, status, short_code, lead_id,
      lead:leads!inner(
        id, name, email, whatsapp_normalized, status, language,
        german_level, goal, qualification_answers,
        reserva_prioritaria, priority_deadline, deposit_intent_at,
        trial_attended_at, trial_absent_at
      )
    `)
    .eq("sesion_closer_id", closerId)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(100);

  const toRow = (r: Row): SesionRow | null => {
    const lead = flat(r.lead);
    if (!lead || !r.lead_id) return null;
    return {
      classId: r.id,
      scheduledAt: r.scheduled_at,
      durationMin: r.duration_minutes ?? 20,
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
    };
  };

  const all = ((data ?? []) as unknown as Row[]).map(toRow).filter((x): x is SesionRow => x !== null);

  // Próximas: agendadas/en vivo desde hace 1h (margen para las que
  // acaban de pasar y aún no se registraron). Historial: el resto.
  const cutoff = Date.now() - 3600_000;
  const proximas = all
    .filter((s) => (s.status === "scheduled" || s.status === "live") && new Date(s.scheduledAt).getTime() >= cutoff)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const historial = all.filter((s) => !proximas.includes(s));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Sesiones de Plan</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tus videollamadas agendadas y el historial. Marca el resultado al
          terminar cada sesión — activa las cadenas de seguimiento automáticas.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Próximas ({proximas.length})
        </h2>
        {proximas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Sin sesiones agendadas. Revisa tus franjas en{" "}
            <a href="/closer/disponibilidad" className="text-brand-600 dark:text-brand-400 hover:underline">Mi disponibilidad</a>.
          </div>
        ) : (
          proximas.map((s) => <SesionHubCard key={s.classId} row={s} />)
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Historial ({historial.length})
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 px-1">Aún no hay sesiones pasadas.</p>
        ) : (
          historial.map((s) => <SesionHubCard key={s.classId} row={s} />)
        )}
      </section>
    </main>
  );
}
