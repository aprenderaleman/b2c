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
  q?: string;   // free text on name / phone
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
  if (filter.q) {
    const like = `%${filter.q.replace(/[%_]/g, "")}%`;
    query = query.or(`name.ilike.${like},whatsapp_normalized.ilike.${like}`);
  }

  query = query.order("created_at", { ascending: false });
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
