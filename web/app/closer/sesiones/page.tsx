import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { SesionHubShell } from "@/components/closer/SesionHubShell";
import type { SesionRow } from "@/components/closer/SesionHubCard";

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

  const now = Date.now();
  const upcoming = all
    .filter((s) => new Date(s.scheduledAt).getTime() >= now && s.status !== "cancelled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const past = all
    .filter((s) => !upcoming.includes(s))
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Sesiones de Plan</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tus videollamadas agendadas y el historial. Marca el resultado al
          terminar cada sesi&oacute;n — activa las cadenas de seguimiento autom&aacute;ticas.
        </p>
      </header>

      <SesionHubShell upcoming={upcoming} past={past} />
    </main>
  );
}
