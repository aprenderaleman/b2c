import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { TeacherLeadsList, type TeacherLead } from "@/components/teacher/TeacherLeadsList";
import { getSemaforoBatch, feedbackPendienteProfe } from "@/lib/semaforo";

/**
 * /profesor/leads — "Mis leads" del profesor (Gelfis 2026-08-13).
 *
 * Misma lógica que la lista del closer pero con el criterio del profe:
 * leads que agendaron una CLASE DE PRUEBA con este profesor, con la
 * fecha del trial y la asistencia visibles. Objetivo: que el profe
 * contacte sus leads y convierta más estudiantes (comisión por
 * conversión).
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Mis leads · Profesor" };

type Row = {
  scheduled_at: string;
  status: string;
  duration_minutes: number | null;
  lead: {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; status: string; created_at: string;
    german_level: string | null; landing_intent: string | null;
    qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
    reserva_prioritaria: boolean | null; priority_deadline: string | null;
    deposit_intent_at: string | null;
    trial_attended_at: string | null; trial_absent_at: string | null;
  } | Array<{
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; status: string; created_at: string;
    german_level: string | null; landing_intent: string | null;
    qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
    reserva_prioritaria: boolean | null; priority_deadline: string | null;
    deposit_intent_at: string | null;
    trial_attended_at: string | null; trial_absent_at: string | null;
  }>;
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
        id, name, email, whatsapp_normalized, status, created_at,
        german_level, landing_intent, qualification_answers,
        reserva_prioritaria, priority_deadline, deposit_intent_at,
        trial_attended_at, trial_absent_at
      )
    `)
    .eq("teacher_id", teacher.id)
    .eq("is_trial", true)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: false })
    .limit(300);

  // Dedupe por lead: nos quedamos con su trial más reciente con este profe
  const byLead = new Map<string, TeacherLead>();
  for (const r of ((data ?? []) as unknown as Row[])) {
    const lead = flat(r.lead);
    if (!lead || byLead.has(lead.id)) continue;
    byLead.set(lead.id, {
      leadId: lead.id,
      name: lead.name,
      email: lead.email,
      whatsapp: lead.whatsapp_normalized,
      status: lead.status,
      germanLevel: lead.german_level,
      landingIntent: lead.landing_intent,
      createdAt: lead.created_at,
      qualification: lead.qualification_answers,
      reservaPrioritaria: lead.reserva_prioritaria,
      priorityDeadline: lead.priority_deadline,
      depositIntentAt: lead.deposit_intent_at,
      trialAt: r.scheduled_at,
      trialStatus: r.status,
      trialDurationMin: r.duration_minutes,
      attended: !!lead.trial_attended_at,
      absent: !!lead.trial_absent_at && !lead.trial_attended_at,
      semaforo: null,
    });
  }

  const leads = [...byLead.values()];

  // Semáforo global por lead + rojo propio del profe (🎓 feedback
  // post-clase sin registrar en 2h hábiles — spec sección 4).
  const semaforos = await getSemaforoBatch(leads.map(l => l.leadId));
  for (const l of leads) {
    const fb = feedbackPendienteProfe({
      scheduledAt: l.trialAt,
      durationMin: l.trialDurationMin,
      attendedAt: l.attended ? l.trialAt : null,   // marcador: attended flag
      absentAt: l.absent ? l.trialAt : null,
    });
    if (fb && l.trialStatus !== "cancelled") {
      l.semaforo = { color: "rojo", badge: fb.badge, detalle: fb.detalle };
      continue;
    }
    const s = semaforos.get(l.leadId);
    if (s && s.color !== "fuera") {
      l.semaforo = { color: s.color, badge: s.badge, detalle: s.detalle };
    }
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

      <TeacherLeadsList leads={leads} />
    </main>
  );
}
