import { supabaseAdmin } from "./supabase";

export type CadenciaType = "tipo_a" | "tipo_b";

export type TareaCloser = {
  id: string;
  closer_id: string;
  lead_id: string;
  paso: number;
  tipo: CadenciaType;
  canal: string;
  plantilla: string;
  fecha_programada: string;
  fecha_completada: string | null;
  resultado: string | null;
  notas: string | null;
  created_at: string;
  lead_name?: string;
  lead_phone?: string;
};

export type TaskResult =
  | "contactado"
  | "no_contesto"
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

export type TaskFilter = "hoy" | "atrasadas" | "proximas";

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
    .select("*, leads!inner(full_name, whatsapp_normalized)")
    .eq("closer_id", closerId)
    .is("fecha_completada", null);

  if (filter === "hoy") {
    query = query.gte("fecha_programada", todayStart).lt("fecha_programada", todayEnd);
  } else if (filter === "atrasadas") {
    query = query.lt("fecha_programada", todayStart);
  } else {
    query = query.gte("fecha_programada", todayEnd);
  }

  query = query.order("fecha_programada", { ascending: true });
  const { data } = await query;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const lead = row.leads as { full_name?: string; whatsapp_normalized?: string } | null;
    const { leads: _, ...rest } = row;
    return {
      ...rest,
      lead_name: lead?.full_name ?? "",
      lead_phone: lead?.whatsapp_normalized ?? "",
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
