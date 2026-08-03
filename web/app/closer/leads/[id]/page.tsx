import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getLeadTasks } from "@/lib/closer-cadence";
import { getGelfisNotes } from "@/lib/dashboard";
import { redirect } from "next/navigation";
import { CloserLeadDetail } from "@/components/closer/CloserLeadDetail";

export const metadata = { title: "Lead · Closer" };

export default async function CloserLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["closer"]);
  const { id: leadId } = await params;
  const closerId = session.user.id;

  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, estado_cierre, motivo_perdido, closer_id, fecha_asignacion_closer, created_at, meta, reserva_prioritaria, priority_deadline, deposit_intent_at, qualification_answers, landing_intent, source, language, german_level, goal, urgency, budget, messages_seen_count, current_followup_number, next_contact_date, gdpr_accepted, gdpr_accepted_at, trial_scheduled_at, trial_attended_at, trial_absent_at")
    .eq("id", leadId)
    .single();

  if (!lead || lead.closer_id !== closerId) redirect("/closer/leads");
  // El closer solo ve leads post-trial (asistió o no asistió).
  if (!lead.trial_attended_at && !lead.trial_absent_at) redirect("/closer/leads");

  const [tasks, timelineResult, accionesResult, gelfisNotes] = await Promise.all([
    getLeadTasks(leadId),
    sb
      .from("lead_timeline")
      .select("id, type, author, content, timestamp")
      .eq("lead_id", leadId)
      .order("timestamp", { ascending: false })
      .limit(50),
    sb
      .from("acciones_closer")
      .select("id, tipo, contenido, resultado, duracion_seg, created_at")
      .eq("lead_id", leadId)
      .eq("closer_id", closerId)
      .order("created_at", { ascending: false })
      .limit(50),
    getGelfisNotes(leadId),
  ]);

  // lead_timeline usa la columna `timestamp`; el componente espera `created_at`
  const timeline = (timelineResult.data ?? []).map((r) => ({
    id: r.id as string,
    type: r.type as string,
    author: r.author as string,
    content: r.content as string,
    created_at: r.timestamp as string,
  }));
  const acciones = accionesResult.data ?? [];

  // Notas unificadas: teacher_note (timeline) + notas de Gelfis + notas del closer
  const closerName = (session.user.name ?? "").trim().split(/\s+/)[0] || "Closer";
  const notes = [
    ...timeline
      .filter((t) => t.type === "teacher_note")
      .map((t) => ({ id: `tl-${t.id}`, author: t.author || "Profe", content: t.content, created_at: t.created_at })),
    ...gelfisNotes.map((n) => ({ id: `gn-${n.id}`, author: "Gelfis", content: n.note, created_at: n.created_at })),
    ...acciones
      .filter((a) => a.tipo === "nota" && a.contenido)
      .map((a) => ({ id: `ac-${a.id}`, author: closerName, content: a.contenido as string, created_at: a.created_at as string })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const leadTipo = tasks.find((t) => t.tipo === "tipo_a" || t.tipo === "tipo_b")?.tipo ?? null;

  const { data: ventaPendiente } = await sb
    .from("ventas")
    .select("id, pack_id, payment_type, estado")
    .eq("lead_id", leadId)
    .eq("estado", "pendiente")
    .maybeSingle();

  // Trial + teacher name (same pattern as admin)
  let activeTrial: { id: string; scheduled_at: string; short_code: string | null } | null = null;
  let teacherName: string | null = null;

  const { data: trialRows } = await sb
    .from("classes")
    .select("id, scheduled_at, short_code, status, teacher:teachers!inner(users!inner(full_name, email))")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .in("status", ["scheduled", "live", "completed"])
    .order("scheduled_at", { ascending: true });

  type TrialRow = {
    id: string;
    scheduled_at: string;
    short_code: string | null;
    status: string;
    teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  if (trialRows && trialRows.length > 0) {
    const rows = trialRows as TrialRow[];
    const active = rows.find(c => c.status === "scheduled" || c.status === "live") ?? null;
    if (active) {
      activeTrial = { id: active.id, scheduled_at: active.scheduled_at, short_code: active.short_code };
    }
    // Los closers reciben leads DESPUÉS del trial (asistió/no asistió),
    // así que el profe se toma del trial más reciente sin importar status.
    const latest = active ?? rows[rows.length - 1];
    const tw = flat(latest.teacher);
    const u = tw ? flat(tw.users) : null;
    const name = (u?.full_name ?? u?.email ?? "").trim();
    if (name) teacherName = name.split(/\s+/)[0];
  }

  return (
    <main className="space-y-5">
      <CloserLeadDetail
        lead={lead}
        tasks={tasks}
        ventaPendiente={ventaPendiente}
        notes={notes}
        leadTipo={leadTipo}
        activeTrial={activeTrial}
        teacherName={teacherName}
      />
    </main>
  );
}
