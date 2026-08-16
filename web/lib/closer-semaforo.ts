/**
 * Cola HOY del closer — construida sobre el SEMÁFORO GLOBAL
 * (lib/semaforo.ts, fase 3 del sistema de estados, Gelfis 2026-08-16).
 *
 * Este módulo ya no calcula colores propios: delega en las reglas
 * globales (R1-R5 / A1-A3 / V1-V3 con ventana hábil 08-22 Berlín) y
 * solo arma la vista del closer: sus leads, su tarea pendiente más
 * próxima (para [Registrar]) y el orden de cola.
 *
 * Orden: color → causa (💰 → 💬 → 🆕 → 🎓 → 📅) → 💰VIP → 🔥urgente →
 * antigüedad del disparador (el más viejo primero).
 */

import { supabaseAdmin } from "./supabase";
import { getCloserLeads } from "./closer-actions";
import { getSemaforoBatch, CAUSA_RANK, type SemaforoResult } from "./semaforo";

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
  /** Badge tipado con antigüedad: "💬 Respuesta 3h" / "📅 Vencida 2d" */
  badge: string;
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
  /** Rank de causa dentro del rojo (💰0 💬1 🆕2 🎓3 📅4; 99 sin causa) */
  causaRank: number;
};

export async function getCloserQueue(closerId: string): Promise<QueueItem[]> {
  const sb = supabaseAdmin();

  // Leads activos del closer (ya filtrados a funnel /sesion-plan)
  const allLeads = await getCloserLeads(closerId);
  const leads = allLeads.filter(
    (l) => l.estado_cierre !== "convertido" && l.estado_cierre !== "perdido",
  );
  if (leads.length === 0) return [];

  const leadIds = leads.map((l) => l.id);

  const [semaforos, tasksRes] = await Promise.all([
    getSemaforoBatch(leadIds),
    sb
      .from("tareas_closer")
      .select("id, lead_id, tipo, canal, plantilla, fecha_programada")
      .eq("closer_id", closerId)
      .in("lead_id", leadIds)
      .is("fecha_completada", null)
      .order("fecha_programada", { ascending: true }),
  ]);

  const tasksByLead = new Map<string, QueueTask[]>();
  for (const t of tasksRes.data ?? []) {
    const arr = tasksByLead.get(t.lead_id) ?? [];
    arr.push(t as QueueTask & { lead_id: string });
    tasksByLead.set(t.lead_id, arr);
  }

  const items: QueueItem[] = [];
  for (const lead of leads) {
    const s: SemaforoResult | undefined = semaforos.get(lead.id);
    if (!s || s.color === "fuera") continue;

    items.push({
      leadId: lead.id,
      leadName: lead.name ?? "Lead",
      leadPhone: lead.whatsapp_normalized ?? null,
      leadEmail: lead.email ?? null,
      estadoCierre: lead.estado_cierre,
      color: s.color as SemaforoColor,
      badge: s.badge,
      reason: s.detalle,
      triggerAt: s.triggerAt ?? lead.fecha_asignacion_closer ?? lead.created_at,
      vip: lead.reserva_prioritaria === true,
      urgente: lead.priority_deadline === "concrete",
      paidIntent: !lead.reserva_prioritaria && !!lead.deposit_intent_at,
      landingIntent: lead.landing_intent ?? null,
      trialScheduledAt: lead.trial_scheduled_at ?? null,
      trialAttended: !!lead.trial_attended_at,
      nextTask: tasksByLead.get(lead.id)?.[0] ?? null,
      qualification: lead.qualification_answers ?? null,
      causaRank: s.causa ? CAUSA_RANK[s.causa] : 99,
    });
  }

  // ── Orden: color → causa → 💰 → 🔥 → antigüedad ──
  const colorRank: Record<SemaforoColor, number> = { rojo: 0, amarillo: 1, verde: 2 };
  items.sort((a, b) => {
    const c = colorRank[a.color] - colorRank[b.color];
    if (c !== 0) return c;
    const cr = a.causaRank - b.causaRank;
    if (cr !== 0) return cr;
    if (a.vip !== b.vip) return a.vip ? -1 : 1;
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    return new Date(a.triggerAt).getTime() - new Date(b.triggerAt).getTime();
  });

  return items;
}
