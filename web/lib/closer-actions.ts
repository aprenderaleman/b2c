import { supabaseAdmin } from "./supabase";
import { generateTasks, cancelPendingTasks, type CadenciaType } from "./closer-cadence";

export type AccionTipo = "llamada" | "whatsapp" | "email" | "nota" | "otro";

export type AccionCloser = {
  id: string;
  closer_id: string;
  lead_id: string;
  tipo: AccionTipo;
  contenido: string | null;
  resultado: string | null;
  duracion_seg: number | null;
  created_at: string;
};

export async function logCloserAction(args: {
  closerId: string;
  leadId: string;
  tipo: AccionTipo;
  contenido?: string;
  resultado?: string;
  duracionSeg?: number;
}): Promise<string> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("acciones_closer")
    .insert({
      closer_id: args.closerId,
      lead_id: args.leadId,
      tipo: args.tipo,
      contenido: args.contenido ?? null,
      resultado: args.resultado ?? null,
      duracion_seg: args.duracionSeg ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`logCloserAction failed: ${error.message}`);

  await sb.from("lead_timeline").insert({
    lead_id: args.leadId,
    type: "agent_note",
    author: "closer",
    content: `[${args.tipo}] ${args.contenido ?? args.resultado ?? "Accion registrada"}`,
    metadata: {
      kind: "closer_action",
      closer_id: args.closerId,
      accion_id: data.id,
      tipo: args.tipo,
    },
  });

  return data.id as string;
}

export async function assignCloser(
  leadId: string,
  closerId: string,
  tipo: CadenciaType,
): Promise<number> {
  const sb = supabaseAdmin();

  await sb
    .from("leads")
    .update({
      closer_id: closerId,
      estado_cierre: "activo",
      fecha_asignacion_closer: new Date().toISOString(),
    })
    .eq("id", leadId);

  const tasksCreated = await generateTasks(closerId, leadId, tipo);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "admin",
    content: `Closer asignado. Cadencia ${tipo === "tipo_a" ? "A (asistio)" : "B (no asistio)"} con ${tasksCreated} tareas.`,
    metadata: {
      kind: "closer_assigned",
      closer_id: closerId,
      cadencia: tipo,
      tasks_created: tasksCreated,
    },
  });

  return tasksCreated;
}

export async function unassignCloser(leadId: string): Promise<void> {
  const sb = supabaseAdmin();

  await cancelPendingTasks(leadId);

  await sb
    .from("leads")
    .update({
      closer_id: null,
      estado_cierre: "sin_asignar",
      fecha_asignacion_closer: null,
    })
    .eq("id", leadId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "admin",
    content: "Closer desasignado. Tareas pendientes canceladas.",
    metadata: { kind: "closer_unassigned" },
  });
}

export async function getCloserLeads(closerId: string, estadoCierre?: string) {
  const sb = supabaseAdmin();
  let query = sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, estado_cierre, motivo_perdido, fecha_asignacion_closer, created_at, meta, source, language, german_level, goal, urgency, budget, landing_intent, qualification_answers, reserva_prioritaria, priority_deadline, deposit_intent_at, next_contact_date, current_followup_number, messages_seen_count, trial_scheduled_at, trial_attended_at, trial_absent_at, sesion_plan_at")
    .eq("closer_id", closerId)
    // Regla Gelfis 2026-08-13 (sustituye a la post-trial del 08-02): el
    // closer SOLO ve leads que agendaron por el funnel /sesion-plan.
    // Los leads post-trial ya no se asignan a closers; si un lead viejo
    // agenda una sesión, sesion_plan_at se setea y reaparece aquí.
    .not("sesion_plan_at", "is", null)
    .order("fecha_asignacion_closer", { ascending: false });

  if (estadoCierre) {
    query = query.eq("estado_cierre", estadoCierre);
  }

  const { data } = await query;
  return data ?? [];
}

export async function autoAssignToActiveCloser(
  leadId: string,
  tipo: CadenciaType,
  source: string,
): Promise<string | null> {
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("closer_id")
    .eq("id", leadId)
    .maybeSingle();

  if ((lead as { closer_id: string | null } | null)?.closer_id) return null;

  const { data: closers } = await sb
    .from("users")
    .select("id")
    .eq("role", "closer")
    .eq("active", true)
    .eq("flujo_activo", true);

  const activeClosers = (closers ?? []) as Array<{ id: string }>;
  if (activeClosers.length === 0) return null;

  let chosenId = activeClosers[0].id;

  if (activeClosers.length > 1) {
    const ids = activeClosers.map((c) => c.id);
    const { data: counts } = await sb
      .from("leads")
      .select("closer_id")
      .in("closer_id", ids)
      .in("estado_cierre", ["activo", "seguimiento_pactado"]);

    const loadMap: Record<string, number> = {};
    for (const id of ids) loadMap[id] = 0;
    for (const row of (counts ?? []) as Array<{ closer_id: string }>) {
      loadMap[row.closer_id] = (loadMap[row.closer_id] ?? 0) + 1;
    }

    chosenId = ids.reduce((best, id) =>
      (loadMap[id] ?? 0) < (loadMap[best] ?? 0) ? id : best,
    );
  }

  await assignCloser(leadId, chosenId, tipo);
  return chosenId;
}

export async function markLeadLostByCloser(
  leadId: string,
  closerId: string,
  motivo: string,
): Promise<void> {
  const sb = supabaseAdmin();

  await cancelPendingTasks(leadId);

  await sb
    .from("leads")
    .update({
      estado_cierre: "perdido",
      motivo_perdido: motivo,
    })
    .eq("id", leadId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "closer",
    content: `Marcado como perdido: ${motivo}`,
    metadata: { kind: "closer_marked_lost", closer_id: closerId, motivo },
  });
}
