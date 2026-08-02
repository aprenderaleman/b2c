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

  const [tasks, timelineResult, accionesResult, teacherNoteResult, gelfisNotes] = await Promise.all([
    getLeadTasks(leadId),
    sb
      .from("lead_timeline")
      .select("id, type, author, content, metadata, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("acciones_closer")
      .select("id, tipo, contenido, resultado, duracion_seg, created_at")
      .eq("lead_id", leadId)
      .eq("closer_id", closerId)
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("lead_timeline")
      .select("id, content, created_at")
      .eq("lead_id", leadId)
      .eq("author", "teacher")
      .order("created_at", { ascending: false }),
    getGelfisNotes(leadId),
  ]);

  const timeline = timelineResult.data ?? [];
  const acciones = accionesResult.data ?? [];
  const teacherNotes = (teacherNoteResult.data ?? []) as Array<{ id: string; content: string; created_at: string }>;

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

  if (trialRows && trialRows.length > 0) {
    type Row = {
      id: string;
      scheduled_at: string;
      short_code: string | null;
      status: string;
      teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
               Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
    };
    const flat = <T,>(x: T | T[] | null | undefined): T | null =>
      !x ? null : Array.isArray(x) ? x[0] ?? null : x;

    const active = (trialRows as Row[]).find(c => c.status === "scheduled" || c.status === "live") ?? null;
    if (active) {
      activeTrial = { id: active.id, scheduled_at: active.scheduled_at, short_code: active.short_code };
      const tw = flat(active.teacher);
      const u = tw ? flat(tw.users) : null;
      const name = (u?.full_name ?? u?.email ?? "").trim();
      if (name) teacherName = name.split(/\s+/)[0];
    }
  }

  return (
    <main className="space-y-5">
      <CloserLeadDetail
        lead={lead}
        tasks={tasks}
        timeline={timeline}
        acciones={acciones}
        ventaPendiente={ventaPendiente}
        teacherNotes={teacherNotes}
        leadTipo={leadTipo}
        activeTrial={activeTrial}
        teacherName={teacherName}
        gelfisNotes={gelfisNotes}
      />
    </main>
  );
}
