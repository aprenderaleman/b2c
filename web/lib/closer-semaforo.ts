/**
 * Semáforo del CRM closer (Gelfis 2026-08-03).
 *
 * Campo CALCULADO en cada render — nunca se almacena ni se edita:
 *
 *   🔴 rojo     = tarea vencida · enlace/venta sin pagar >3h ·
 *                 respuesta del lead sin atender >2h
 *   🟡 amarillo = próxima tarea vence hoy
 *   🟢 verde    = próxima tarea futura / cadena corriendo
 *
 * Orden dentro de cada color: 💰 VIP → 🔥 urgente → antigüedad
 * (el disparador más viejo primero).
 */

import { supabaseAdmin } from "./supabase";
import { getCloserLeads } from "./closer-actions";

export type SemaforoColor = "rojo" | "amarillo" | "verde";

export type QueueTask = {
  id: string;
  tipo: string;
  canal: string;
  plantilla: string;
  fecha_programada: string;
};

export type QueueItem = {
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  estadoCierre: string;
  color: SemaforoColor;
  /** Por qué está aquí — visible en la card */
  reason: string;
  /** Fecha del disparador (para orden por antigüedad) */
  triggerAt: string;
  vip: boolean;
  urgente: boolean;
  paidIntent: boolean;
  landingIntent: string | null;
  trialScheduledAt: string | null;
  trialAttended: boolean;
  /** Tarea pendiente más próxima (la que abre [Registrar]) */
  nextTask: QueueTask | null;
  qualification: { goal?: string; level?: string; deadline?: string } | null;
};

const H = 3_600_000;
const ENLACE_SIN_PAGAR_MS = 3 * H;
const RESPUESTA_SIN_ATENDER_MS = 2 * H;

function fmtAgo(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const h = Math.floor(diff / H);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}min`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtHoy(iso: string): string {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function fmtFuturo(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

export async function getCloserQueue(closerId: string): Promise<QueueItem[]> {
  const sb = supabaseAdmin();

  // Leads activos del closer (ya filtrados a post-trial en getCloserLeads)
  const allLeads = await getCloserLeads(closerId);
  const leads = allLeads.filter(
    (l) => l.estado_cierre !== "convertido" && l.estado_cierre !== "perdido",
  );
  if (leads.length === 0) return [];

  const leadIds = leads.map((l) => l.id);

  const [tasksRes, ventasRes, inboundRes, accionesRes] = await Promise.all([
    sb
      .from("tareas_closer")
      .select("id, lead_id, tipo, canal, plantilla, fecha_programada")
      .eq("closer_id", closerId)
      .in("lead_id", leadIds)
      .is("fecha_completada", null)
      .order("fecha_programada", { ascending: true }),
    sb
      .from("ventas")
      .select("lead_id, created_at")
      .in("lead_id", leadIds)
      .eq("estado", "pendiente"),
    sb
      .from("lead_timeline")
      .select("lead_id, timestamp")
      .in("lead_id", leadIds)
      .eq("type", "lead_message_received")
      .order("timestamp", { ascending: false })
      .limit(500),
    sb
      .from("acciones_closer")
      .select("lead_id, created_at")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  // Agrupar por lead
  const tasksByLead = new Map<string, QueueTask[]>();
  for (const t of tasksRes.data ?? []) {
    const arr = tasksByLead.get(t.lead_id) ?? [];
    arr.push(t as QueueTask & { lead_id: string });
    tasksByLead.set(t.lead_id, arr);
  }

  const ventaPendienteAt = new Map<string, string>();
  for (const v of ventasRes.data ?? []) {
    const prev = ventaPendienteAt.get(v.lead_id);
    if (!prev || v.created_at < prev) ventaPendienteAt.set(v.lead_id, v.created_at);
  }

  const lastInboundAt = new Map<string, string>();
  for (const r of inboundRes.data ?? []) {
    if (!lastInboundAt.has(r.lead_id)) lastInboundAt.set(r.lead_id, r.timestamp);
  }

  const lastAccionAt = new Map<string, string>();
  for (const r of accionesRes.data ?? []) {
    if (!lastAccionAt.has(r.lead_id)) lastAccionAt.set(r.lead_id, r.created_at);
  }

  const now = Date.now();
  const d = new Date();
  const tomorrowStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();

  const items: QueueItem[] = leads.map((lead) => {
    const tasks = tasksByLead.get(lead.id) ?? [];
    const nextTask = tasks[0] ?? null;

    // ── Disparadores rojos (prioridad: respuesta > enlace > vencida) ──
    let color: SemaforoColor = "verde";
    let reason = "Cadena corriendo — sin acción pendiente";
    let triggerAt = lead.fecha_asignacion_closer ?? lead.created_at;

    const inbound = lastInboundAt.get(lead.id);
    const accion = lastAccionAt.get(lead.id);
    const inboundUnattended =
      inbound &&
      (!accion || inbound > accion) &&
      now - new Date(inbound).getTime() > RESPUESTA_SIN_ATENDER_MS;

    const venta = ventaPendienteAt.get(lead.id);
    const ventaSinPagar = venta && now - new Date(venta).getTime() > ENLACE_SIN_PAGAR_MS;

    const overdueTask = nextTask && new Date(nextTask.fecha_programada).getTime() < now
      ? nextTask
      : null;

    if (inboundUnattended && inbound) {
      color = "rojo";
      reason = `Respondió hace ${fmtAgo(inbound, now)} — sin atender`;
      triggerAt = inbound;
    } else if (ventaSinPagar && venta) {
      color = "rojo";
      reason = `Enlace sin pagar desde hace ${fmtAgo(venta, now)}`;
      triggerAt = venta;
    } else if (overdueTask) {
      color = "rojo";
      reason = `Tarea vencida hace ${fmtAgo(overdueTask.fecha_programada, now)} — ${overdueTask.plantilla}`;
      triggerAt = overdueTask.fecha_programada;
    } else if (nextTask && new Date(nextTask.fecha_programada).getTime() < tomorrowStart) {
      color = "amarillo";
      reason = `Vence hoy ${fmtHoy(nextTask.fecha_programada)} — ${nextTask.plantilla}`;
      triggerAt = nextTask.fecha_programada;
    } else if (nextTask) {
      color = "verde";
      reason = `Próxima: ${fmtFuturo(nextTask.fecha_programada)} — ${nextTask.plantilla}`;
      triggerAt = nextTask.fecha_programada;
    }

    return {
      leadId: lead.id,
      leadName: lead.name ?? "Lead",
      leadPhone: lead.whatsapp_normalized ?? null,
      leadEmail: lead.email ?? null,
      estadoCierre: lead.estado_cierre,
      color,
      reason,
      triggerAt,
      vip: lead.reserva_prioritaria === true,
      urgente: lead.priority_deadline === "concrete",
      paidIntent: !lead.reserva_prioritaria && !!lead.deposit_intent_at,
      landingIntent: lead.landing_intent ?? null,
      trialScheduledAt: lead.trial_scheduled_at ?? null,
      trialAttended: !!lead.trial_attended_at,
      nextTask,
      qualification: lead.qualification_answers ?? null,
    };
  });

  // ── Orden: color → 💰 → 🔥 → antigüedad ──
  const colorRank: Record<SemaforoColor, number> = { rojo: 0, amarillo: 1, verde: 2 };
  items.sort((a, b) => {
    const c = colorRank[a.color] - colorRank[b.color];
    if (c !== 0) return c;
    if (a.vip !== b.vip) return a.vip ? -1 : 1;
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    return new Date(a.triggerAt).getTime() - new Date(b.triggerAt).getTime();
  });

  return items;
}
