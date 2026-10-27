/**
 * "Mis atendidos" del setter (Gelfis 2026-10-27): todos los leads que ya
 * tocó, con buscador (nombre/número) y filtro por estado. Resuelve el
 * caso real del primer día: marcó "no contestó", el lead respondió
 * después, y ya no estaba en su cola — aquí lo encuentra siempre, y el
 * estado "💬 Respondió" lo sube arriba del todo.
 */

import { supabaseAdmin } from "./supabase";

const T = (iso: string) => new Date(iso).getTime();

export type AtendidoEstado =
  | "respondio"
  | "confirmado"
  | "no_contesto"
  | "enlace_enviado"
  | "reagendo"
  | "asistio"
  | "descartado"
  | "contactado";

export const ESTADO_LABEL: Record<AtendidoEstado, string> = {
  respondio: "💬 Respondió",
  confirmado: "✅ Confirmado",
  no_contesto: "📵 No contestó",
  enlace_enviado: "🔗 Enlace enviado",
  reagendo: "📅 Reagendó",
  asistio: "🎓 Asistió",
  descartado: "❌ Descartado",
  contactado: "Contactado",
};

export type AtendidoRow = {
  leadId: string;
  name: string | null;
  phone: string | null;
  estado: AtendidoEstado;
  /** Último contacto del setter con este lead. */
  lastActionAt: string;
  lastActionType: string;
  contactos: number;
  /** Si respondió: cuándo. */
  respondioAt: string | null;
  citaFutura: string | null;
};

type SetterContactRow = { lead_id: string; action_type: string; occurred_at: string };

export async function getSetterAtendidos(
  setterId: string,
  opts: { q?: string; estado?: string } = {},
): Promise<AtendidoRow[]> {
  const sb = supabaseAdmin();
  const now = Date.now();

  // 1) Todos sus contactos (los salientes definen "atendido").
  const { data: contactsData } = await sb
    .from("lead_contacts")
    .select("lead_id, action_type, occurred_at")
    .eq("actor_type", "setter")
    .eq("actor_id", setterId)
    .eq("direction", "saliente")
    .order("occurred_at", { ascending: true })
    .limit(4000);
  const contacts = (contactsData ?? []) as SetterContactRow[];
  if (contacts.length === 0) return [];

  const byLead = new Map<string, SetterContactRow[]>();
  for (const c of contacts) {
    const arr = byLead.get(c.lead_id) ?? [];
    arr.push(c);
    byLead.set(c.lead_id, arr);
  }
  const leadIds = [...byLead.keys()];

  // 2) Datos de los leads (+ buscador por nombre/número en SQL).
  const q = (opts.q ?? "").trim();
  const leadById = new Map<string, {
    id: string; name: string | null; whatsapp_normalized: string | null; whatsapp_raw: string | null;
    status: string; estado_cierre: string | null;
    trial_scheduled_at: string | null; trial_attended_at: string | null; sesion_plan_at: string | null;
  }>();
  for (let i = 0; i < leadIds.length; i += 200) {
    let query = sb
      .from("leads")
      .select("id, name, whatsapp_normalized, whatsapp_raw, status, estado_cierre, trial_scheduled_at, trial_attended_at, sesion_plan_at")
      .in("id", leadIds.slice(i, i + 200));
    if (q) {
      const safe = q.replace(/[%,()]/g, "");
      query = query.or(`name.ilike.%${safe}%,whatsapp_normalized.ilike.%${safe}%,whatsapp_raw.ilike.%${safe}%`);
    }
    const { data } = await query;
    for (const l of (data ?? []) as Array<{
      id: string; name: string | null; whatsapp_normalized: string | null; whatsapp_raw: string | null;
      status: string; estado_cierre: string | null;
      trial_scheduled_at: string | null; trial_attended_at: string | null; sesion_plan_at: string | null;
    }>) {
      leadById.set(l.id, l);
    }
  }

  // 3) Respuestas entrantes de esos leads (para "💬 Respondió").
  const matchedIds = [...leadById.keys()];
  const lastInboundByLead = new Map<string, string>();
  for (let i = 0; i < matchedIds.length; i += 200) {
    const { data } = await sb
      .from("lead_contacts")
      .select("lead_id, occurred_at")
      .eq("direction", "entrante")
      .eq("action_type", "mensaje_lead")
      .in("lead_id", matchedIds.slice(i, i + 200))
      .order("occurred_at", { ascending: true })
      .limit(2000);
    for (const c of (data ?? []) as Array<{ lead_id: string; occurred_at: string }>) {
      lastInboundByLead.set(c.lead_id, c.occurred_at);   // queda el más reciente
    }
  }

  const rows: AtendidoRow[] = [];
  for (const [leadId, leadContacts] of byLead) {
    const lead = leadById.get(leadId);
    if (!lead) continue;   // filtrado por el buscador

    const last = leadContacts[leadContacts.length - 1];
    const lastInbound = lastInboundByLead.get(leadId) ?? null;
    const respondio = !!lastInbound && T(lastInbound) > T(last.occurred_at);

    const citaFutura =
      (lead.trial_scheduled_at && T(lead.trial_scheduled_at) > now && lead.trial_scheduled_at) ||
      (lead.sesion_plan_at && T(lead.sesion_plan_at) > now && lead.sesion_plan_at) || null;

    let estado: AtendidoEstado;
    if (lead.status === "lost" || lead.estado_cierre === "perdido") estado = "descartado";
    else if (lead.trial_attended_at) estado = "asistio";
    else if (respondio) estado = "respondio";
    else if (last.action_type === "confirmar_cita") estado = "confirmado";
    else if (last.action_type === "agendar_prueba") estado = citaFutura ? "reagendo" : "enlace_enviado";
    else if (last.action_type === "no_contesto") estado = "no_contesto";
    else estado = "contactado";

    rows.push({
      leadId,
      name: lead.name,
      phone: lead.whatsapp_normalized ?? lead.whatsapp_raw,
      estado,
      lastActionAt: last.occurred_at,
      lastActionType: last.action_type,
      contactos: leadContacts.length,
      respondioAt: respondio ? lastInbound : null,
      citaFutura,
    });
  }

  const filtered = opts.estado && opts.estado in ESTADO_LABEL
    ? rows.filter(r => r.estado === opts.estado)
    : rows;

  // Los que respondieron, arriba del todo; el resto por último toque.
  filtered.sort((a, b) => {
    const aR = a.estado === "respondio" ? 1 : 0;
    const bR = b.estado === "respondio" ? 1 : 0;
    if (aR !== bR) return bR - aR;
    return T(b.respondioAt ?? b.lastActionAt) - T(a.respondioAt ?? a.lastActionAt);
  });

  return filtered.slice(0, 200);
}
