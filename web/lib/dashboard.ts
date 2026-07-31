import { supabaseAdmin } from "./supabase";

export type LeadRow = {
  id: string;
  created_at: string;
  name: string | null;
  // Now nullable: leads from the self-book trial funnel may give us
  // only an email. The legacy WhatsApp funnel still populates it.
  whatsapp_normalized: string | null;
  email: string | null;
  language: "es" | "de" | null;
  german_level: "A0" | "A1-A2" | "B1" | "B2+" | null;
  goal: string | null;
  urgency: string | null;
  budget: string | null;
  status: string;
  current_followup_number: number;
  next_contact_date: string | null;
  trial_scheduled_at: string | null;
  trial_zoom_link: string | null;
  gdpr_accepted: boolean;
  gdpr_accepted_at: string | null;
  source: string;
  last_message_seen_at: string | null;
  messages_seen_count: number;
  converted_to_user_id: string | null;
  // Respuesta del nuevo paso 1 del funnel (Q.Score). NULL para leads
  // previos al cambio.
  motivo_inicial: "particulares" | "intensivo" | "certificado" | "profesional" | "otro" | "direct" | null;
  // Timestamp de la última llamada fría hecha al lead. NULL = pendiente.
  // Lo togglea el botón de /admin/leads/[id].
  cold_call_done_at: string | null;
  // Slug de la landing/fuente origen (migration 058). Persistido por
  // /api/public/diagnostico/register y /api/public/book-trial.
  // Valores típicos: 'socialmedia', 'curso-online', 'particulares',
  // 'intensivo', 'certificado', 'b2-trabajar', 'clases-aleman-ciudades',
  // 'agendar-directo'. NULL para leads pre-058.
  landing_intent: string | null;
  // Última actividad — base del ordenamiento en /admin/leads y
  // /admin/funnel. NULL para leads legacy pre-trigger updated_at.
  updated_at: string | null;
  // Timestamps de asistencia a clase de prueba (migration 063).
  // Source de verdad para la tasa de asistencia en /admin/ads.
  trial_attended_at: string | null;
  trial_absent_at:   string | null;
  // Reserva Prioritaria (migration 086, 2026-07-24) — lead pagó los
  // 10€ del depósito. `reserva_prioritaria=true` ⇒ VIP dorado en CRM.
  reserva_prioritaria: boolean | null;
  reserva_prioritaria_paid_at: string | null;
  reserva_prioritaria_amount_cents: number | null;
  // Meta Ads Paid funnel (migration 088, 2026-07-28).
  qualification_answers: {
    goal?: string; level?: string; deadline?: string; pain?: string;
  } | null;
  deposit_intent_at: string | null;
  priority_deadline: string | null;
  fbclid: string | null;
};

export type TimelineRow = {
  id: string;
  lead_id: string;
  timestamp: string;
  type: string;
  content: string;
  author: string;
  metadata: Record<string, unknown>;
};

export type GelfisNote = {
  id: string;
  lead_id: string;
  created_at: string;
  note: string;
};

// ── "Today" view ──────────────────────────────────────────

export async function getTodaysTrials(): Promise<LeadRow[]> {
  const sb = supabaseAdmin();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .in("status", ["trial_scheduled", "trial_reminded"])
    .gte("trial_scheduled_at", start.toISOString())
    .lt("trial_scheduled_at", end.toISOString())
    .order("trial_scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

export async function getLeadsNeedingHuman(): Promise<LeadRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .eq("status", "needs_human")
    .order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

export async function getStaleConversations(): Promise<LeadRow[]> {
  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .eq("status", "in_conversation")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

export type QuickStats = {
  newLeadsToday: number;
  activeConversations: number;
  conversionsThisWeek: number;
};

export async function getQuickStats(): Promise<QuickStats> {
  const sb = supabaseAdmin();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [{ count: newCount }, { count: inConv }, { count: conv }] = await Promise.all([
    sb.from("leads").select("*", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString()),
    sb.from("leads").select("*", { count: "exact", head: true })
      .in("status", ["in_conversation", "link_sent"]),
    sb.from("leads").select("*", { count: "exact", head: true })
      .eq("status", "converted").gte("updated_at", weekAgo.toISOString()),
  ]);

  return {
    newLeadsToday:       newCount ?? 0,
    activeConversations: inConv ?? 0,
    conversionsThisWeek: conv ?? 0,
  };
}

// ── "All leads" view — filter + paginate ──────────────────

export type LeadsFilter = {
  status?: string[];
  goal?: string[];
  urgency?: string[];
  german_level?: string[];
  language?: "es" | "de";
  has_trial?: "yes" | "no";
  // Filtro de llamada fría:
  //   "pending" = aún no se ha hecho (cold_call_done_at IS NULL)
  //   "done"    = ya se hizo (cold_call_done_at IS NOT NULL)
  cold_call?: "pending" | "done";
  // Motivo inicial (paso 0 del funnel diagnóstico). Si se filtra,
  // solo devuelve leads cuyo motivo_inicial está en el set.
  motivo?: string[];
  q?: string;   // free text on name / phone / email
  /** Filtra leads con created_at >= ISO. Usado por /admin/funnel para
   *  alinear la lista con el rango temporal de los KPIs. */
  createdSince?: string;
  /** Cómo ordenar:
   *  - 'updated' (default) → updated_at DESC, ideal para "actividad reciente"
   *  - 'created'           → created_at DESC, ideal para "orden de llegada" */
  sortBy?: "updated" | "created";
  limit?: number;
  offset?: number;
};

export async function getLeads(filter: LeadsFilter = {}): Promise<{ rows: LeadRow[]; total: number }> {
  const sb = supabaseAdmin();
  let query = sb.from("leads").select("*", { count: "exact" });

  if (filter.status?.length)       query = query.in("status", filter.status);
  if (filter.goal?.length)         query = query.in("goal", filter.goal);
  if (filter.urgency?.length)      query = query.in("urgency", filter.urgency);
  if (filter.german_level?.length) query = query.in("german_level", filter.german_level);
  if (filter.language)             query = query.eq("language", filter.language);
  if (filter.has_trial === "yes")  query = query.not("trial_scheduled_at", "is", null);
  if (filter.has_trial === "no")   query = query.is("trial_scheduled_at", null);
  if (filter.cold_call === "pending") query = query.is("cold_call_done_at", null);
  if (filter.cold_call === "done")    query = query.not("cold_call_done_at", "is", null);
  if (filter.motivo?.length)       query = query.in("motivo_inicial", filter.motivo);
  if (filter.createdSince)         query = query.gte("created_at", filter.createdSince);
  if (filter.q) {
    // Búsqueda libre — nombre, WhatsApp y email. Escapamos `%` y `_`
    // del input para evitar wildcards inyectados.
    const like = `%${filter.q.replace(/[%_]/g, "")}%`;
    query = query.or(`name.ilike.${like},whatsapp_normalized.ilike.${like},email.ilike.${like}`);
  }

  // Orden: por defecto "última actividad" (updated_at DESC) para /admin/leads,
  // útil cuando un lead viejo regresa a agendar y queremos verlo arriba.
  // /admin/funnel pide sortBy='created' para mostrar "orden de llegada".
  if (filter.sortBy === "created") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.order("updated_at", { ascending: false, nullsFirst: false });
  }
  query = query.range(
    filter.offset ?? 0,
    (filter.offset ?? 0) + (filter.limit ?? 50) - 1,
  );

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0 };
}

// ── Lead detail ───────────────────────────────────────────

export async function getLeadById(id: string): Promise<LeadRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as LeadRow | null;
}

export async function getTimeline(leadId: string): Promise<TimelineRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("lead_timeline")
    .select("*")
    .eq("lead_id", leadId)
    .order("timestamp", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as TimelineRow[];
}

export async function getGelfisNotes(leadId: string): Promise<GelfisNote[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("gelfis_notes")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as GelfisNote[];
}

// ── Reportes: distribución de motivo_inicial ─────────────
//
// Cuenta los leads agrupados por el motivo que escogieron en el paso 0
// del funnel diagnóstico, dentro de un rango de N días. Usado por
// /admin/reportes para entender el mix de demanda y orientar pricing
// y campañas Google Ads. Excluye leads sin motivo (los que entraron
// vía canales antiguos pre-funnel-paso-0).

export type MotivoBucket = {
  motivo: "particulares" | "intensivo" | "certificado" | "profesional" | "otro";
  count:  number;
};

export async function getMotivoDistribution(days: number): Promise<MotivoBucket[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("leads")
    .select("motivo_inicial")
    .gte("created_at", since)
    .not("motivo_inicial", "is", null);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ motivo_inicial: string }>) {
    counts.set(r.motivo_inicial, (counts.get(r.motivo_inicial) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([motivo, count]) => ({ motivo, count }) as MotivoBucket)
    .sort((a, b) => b.count - a.count);
}
