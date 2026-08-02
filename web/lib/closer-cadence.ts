import { supabaseAdmin } from "./supabase";

export type CadenciaType = "tipo_a" | "tipo_b";

export type TareaCloser = {
  id: string;
  closer_id: string;
  lead_id: string;
  paso: number;
  tipo: string;
  canal: string;
  plantilla: string;
  fecha_programada: string;
  fecha_completada: string | null;
  resultado: string | null;
  notas: string | null;
  created_at: string;
  lead_name?: string;
  lead_phone?: string;
  lead_email?: string;
  lead_status?: string;
  lead_estado_cierre?: string;
  lead_qualification?: { goal?: string; level?: string; deadline?: string } | null;
  prioridad?: string | null;
  fecha_vence?: string | null;
  origen?: string | null;
  lead_reserva_prioritaria?: boolean;
  lead_priority_deadline?: string | null;
  lead_deposit_intent_at?: string | null;
  lead_created_at?: string;
  lead_fecha_asignacion_closer?: string | null;
  lead_source?: string | null;
  lead_landing_intent?: string | null;
  lead_trial_scheduled_at?: string | null;
  lead_trial_attended_at?: string | null;
  lead_trial_absent_at?: string | null;
};

export type TaskResult =
  | "contactado"
  | "no_contesto"
  | "buzon"
  | "no_interesado"
  | "reagendado"
  | "venta";

export async function generateTasks(
  closerId: string,
  leadId: string,
  tipo: CadenciaType,
): Promise<number> {
  const sb = supabaseAdmin();

  const { data: pasos } = await sb
    .from("config_cadencia")
    .select("paso, dias_offset, canal, plantilla")
    .eq("tipo", tipo)
    .eq("activo", true)
    .order("paso");

  if (!pasos || pasos.length === 0) return 0;

  const now = new Date();
  const rows = pasos.map((p) => ({
    closer_id: closerId,
    lead_id: leadId,
    paso: p.paso,
    tipo,
    canal: p.canal,
    plantilla: p.plantilla,
    fecha_programada: new Date(
      now.getTime() + p.dias_offset * 86_400_000,
    ).toISOString(),
  }));

  const { error } = await sb.from("tareas_closer").insert(rows);
  if (error) {
    console.error("[closer-cadence] generateTasks failed:", error.message);
    return 0;
  }
  return rows.length;
}

export async function completeTask(
  taskId: string,
  resultado: TaskResult,
  notas?: string,
): Promise<void> {
  const sb = supabaseAdmin();
  await sb
    .from("tareas_closer")
    .update({
      fecha_completada: new Date().toISOString(),
      resultado,
      notas: notas ?? null,
    })
    .eq("id", taskId);
}

export type TaskFilter = "hoy" | "atrasadas" | "proximas" | "pendientes";

export async function getCloserTasks(
  closerId: string,
  filter: TaskFilter,
): Promise<TareaCloser[]> {
  const sb = supabaseAdmin();
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const todayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();

  let query = sb
    .from("tareas_closer")
    .select("*, leads!inner(name, whatsapp_normalized, email, status, estado_cierre, qualification_answers, reserva_prioritaria, priority_deadline, deposit_intent_at, created_at, fecha_asignacion_closer, source, landing_intent, trial_scheduled_at, trial_attended_at, trial_absent_at)")
    .eq("closer_id", closerId)
    .is("fecha_completada", null);

  if (filter === "hoy") {
    query = query.gte("fecha_programada", todayStart).lt("fecha_programada", todayEnd);
  } else if (filter === "atrasadas") {
    query = query.lt("fecha_programada", todayStart);
  } else if (filter === "proximas") {
    query = query.gte("fecha_programada", todayEnd);
  }
  // "pendientes" → no date filter, returns all pending tasks

  query = query.order("fecha_programada", { ascending: true });
  const { data } = await query;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const lead = row.leads as {
      name?: string;
      whatsapp_normalized?: string;
      email?: string;
      status?: string;
      estado_cierre?: string;
      qualification_answers?: { goal?: string; level?: string; deadline?: string } | null;
      reserva_prioritaria?: boolean;
      priority_deadline?: string;
      deposit_intent_at?: string;
      created_at?: string;
      fecha_asignacion_closer?: string;
      source?: string;
      landing_intent?: string;
      trial_scheduled_at?: string;
      trial_attended_at?: string;
      trial_absent_at?: string;
    } | null;
    const { leads: _, ...rest } = row;
    return {
      ...rest,
      lead_name: lead?.name ?? "",
      lead_phone: lead?.whatsapp_normalized ?? "",
      lead_email: lead?.email ?? "",
      lead_status: lead?.status ?? "",
      lead_estado_cierre: lead?.estado_cierre ?? "",
      lead_qualification: lead?.qualification_answers ?? null,
      lead_reserva_prioritaria: lead?.reserva_prioritaria ?? false,
      lead_priority_deadline: lead?.priority_deadline ?? null,
      lead_deposit_intent_at: lead?.deposit_intent_at ?? null,
      lead_created_at: lead?.created_at ?? "",
      lead_fecha_asignacion_closer: lead?.fecha_asignacion_closer ?? null,
      lead_source: lead?.source ?? null,
      lead_landing_intent: lead?.landing_intent ?? null,
      lead_trial_scheduled_at: lead?.trial_scheduled_at ?? null,
      lead_trial_attended_at: lead?.trial_attended_at ?? null,
      lead_trial_absent_at: lead?.trial_absent_at ?? null,
    } as unknown as TareaCloser;
  });
}

export async function getLeadTasks(leadId: string): Promise<TareaCloser[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("tareas_closer")
    .select("*")
    .eq("lead_id", leadId)
    .order("paso");
  return (data ?? []) as TareaCloser[];
}

export async function cancelPendingTasks(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb
    .from("tareas_closer")
    .update({ fecha_completada: new Date().toISOString(), resultado: "no_interesado", notas: "Cancelado automaticamente" })
    .eq("lead_id", leadId)
    .is("fecha_completada", null);
}
