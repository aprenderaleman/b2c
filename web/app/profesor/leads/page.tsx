import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { LeadsList, type LeadItem, type LeadSemaforo, type LastContactInfo } from "@/components/leads/LeadsList";
import { getSemaforoBatch, feedbackPendienteProfe } from "@/lib/semaforo";
import { getLastContacts, fmtLastContact } from "@/lib/contacts";

/**
 * /profesor/leads — "Mis leads" del profesor. MISMA página que la del
 * closer (components/leads/LeadsList, decisión Gelfis 2026-08-17):
 * misma lógica, mismo orden por semáforo, mismo popup de notas — cada
 * rol con sus leads. Criterio del profe: leads que agendaron una CLASE
 * DE PRUEBA con él.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Mis leads · Profesor" };

type Row = {
  scheduled_at: string;
  status: string;
  duration_minutes: number | null;
  lead: LeadRow | LeadRow[];
};

type LeadRow = {
  id: string; name: string | null; email: string | null;
  whatsapp_normalized: string | null; status: string; estado_cierre: string | null;
  created_at: string; german_level: string | null;
  qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
  reserva_prioritaria: boolean | null; priority_deadline: string | null;
  deposit_intent_at: string | null;
  trial_attended_at: string | null; trial_absent_at: string | null;
  sesion_plan_at: string | null;
};

const flat = <T,>(x: T | T[] | null | undefined): T | null =>
  !x ? null : Array.isArray(x) ? x[0] ?? null : x;

export default async function TeacherLeadsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis leads</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor. Pide al admin que te cree el perfil.
        </p>
      </main>
    );
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      scheduled_at, status, duration_minutes,
      lead:leads!inner(
        id, name, email, whatsapp_normalized, status, estado_cierre, created_at,
        german_level, qualification_answers,
        reserva_prioritaria, priority_deadline, deposit_intent_at,
        trial_attended_at, trial_absent_at, sesion_plan_at
      )
    `)
    .eq("teacher_id", teacher.id)
    .eq("is_trial", true)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: false })
    .limit(300);

  // Dedupe por lead (su trial más reciente con este profe) y mapeo al
  // shape compartido. trial_scheduled_at = la clase con ESTE profe.
  const byLead = new Map<string, LeadItem>();
  const trialInfo = new Map<string, { scheduledAt: string; durationMin: number | null; status: string }>();
  for (const r of ((data ?? []) as unknown as Row[])) {
    const lead = flat(r.lead);
    if (!lead || byLead.has(lead.id)) continue;
    byLead.set(lead.id, {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      whatsapp_normalized: lead.whatsapp_normalized,
      status: lead.status,
      estado_cierre: lead.estado_cierre,
      created_at: lead.created_at,
      german_level: lead.german_level,
      qualification_answers: lead.qualification_answers,
      reserva_prioritaria: lead.reserva_prioritaria,
      priority_deadline: lead.priority_deadline,
      deposit_intent_at: lead.deposit_intent_at,
      trial_scheduled_at: r.scheduled_at,
      trial_attended_at: lead.trial_attended_at,
      trial_absent_at: lead.trial_absent_at,
      sesion_plan_at: lead.sesion_plan_at,
    });
    trialInfo.set(lead.id, { scheduledAt: r.scheduled_at, durationMin: r.duration_minutes, status: r.status });
  }

  const leads = [...byLead.values()];

  // Semáforo global + rojo propio del profe (🎓 feedback post-clase sin
  // registrar en 2h hábiles) + último contacto.
  const [semaforos, lastContacts] = await Promise.all([
    getSemaforoBatch(leads.map(l => l.id)),
    getLastContacts(leads.map(l => l.id)),
  ]);
  const semaforoByLead: Record<string, LeadSemaforo> = {};
  for (const l of leads) {
    const t = trialInfo.get(l.id);
    const fb = t && t.status !== "cancelled"
      ? feedbackPendienteProfe({
          scheduledAt: t.scheduledAt,
          durationMin: t.durationMin,
          attendedAt: l.trial_attended_at,
          absentAt: l.trial_absent_at,
        })
      : null;
    if (fb) {
      semaforoByLead[l.id] = { color: "rojo", badge: fb.badge, detalle: fb.detalle };
      continue;
    }
    const s = semaforos.get(l.id);
    if (s && s.color !== "fuera") {
      semaforoByLead[l.id] = { color: s.color, badge: s.badge, detalle: s.detalle };
    }
  }
  const lastContactByLead: Record<string, LastContactInfo> = {};
  for (const l of leads) {
    const c = lastContacts.get(l.id) ?? null;
    lastContactByLead[l.id] = { label: fmtLastContact(c), at: c?.occurred_at ?? null };
  }

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          ¿Quieres más estudiantes? Contacta tus leads
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Estos leads agendaron una clase de prueba contigo. Un mensaje tuyo
          después de la clase marca la diferencia — si se inscriben, tú cobras
          la comisión por conversión.
        </p>
      </header>

      <LeadsList
        role="profesor"
        leads={leads}
        semaforoByLead={semaforoByLead}
        lastContactByLead={lastContactByLead}
      />
    </main>
  );
}
