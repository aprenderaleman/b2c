/**
 * Notificaciones in-app para el admin shell. Punto único de alta:
 * cualquier código del sistema que detecte un evento operativo
 * relevante crea una notification y aparece en el bell del header.
 *
 * Categorías estandarizadas (campo type):
 *   'system_paused_auto'    — health monitor disparó pausa global
 *   'evolution_recovered'   — Evolution volvió de un downtime largo
 *   'ai_paused_phone_edit'  — auto-pausa Stiv tras editar WA del lead
 *   'lead_needs_human'      — escalation
 *   'inbound_recovered'     — recovery post-incidente insertó N mensajes
 *   'inbound_silent'        — leads que escribieron y nadie respondió
 *   custom                  — cualquier string del caller
 *
 * Nota: hay otro archivo lib/notifications.ts para recordatorios de
 * clase — son cosas distintas, no relacionadas.
 */

import { supabaseAdmin } from "./supabase";

export type AdminSeverity = "info" | "warning" | "critical";

export type AdminNotification = {
  id:          string;
  type:        string;
  severity:    AdminSeverity;
  title:       string;
  body:        string | null;
  lead_id:     string | null;
  action_url:  string | null;
  metadata:    Record<string, unknown> | null;
  read_at:     string | null;
  created_at:  string;
};

export async function createAdminNotification(input: {
  type:        string;
  severity:    AdminSeverity;
  title:       string;
  body?:       string | null;
  lead_id?:    string | null;
  action_url?: string | null;
  metadata?:   Record<string, unknown> | null;
  /** Si existe otra notif del mismo type sin leer en últimas N horas → ignorar.
   *  Evita spam (health monitor que se dispara cada 5 min). Default 1h. false = no dedup. */
  dedupeHours?: number | false;
}): Promise<AdminNotification | null> {
  const sb = supabaseAdmin();
  const dedupeHours = input.dedupeHours === false ? null : (input.dedupeHours ?? 1);
  if (dedupeHours) {
    const since = new Date(Date.now() - dedupeHours * 3600_000).toISOString();
    const { data: existing } = await sb
      .from("admin_notifications")
      .select("id")
      .eq("type", input.type)
      .is("read_at", null)
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) return null;
  }
  const { data, error } = await sb
    .from("admin_notifications")
    .insert({
      type:       input.type,
      severity:   input.severity,
      title:      input.title.slice(0, 200),
      body:       input.body ?? null,
      lead_id:    input.lead_id ?? null,
      action_url: input.action_url ?? null,
      metadata:   input.metadata ?? null,
    })
    .select("*")
    .single();
  if (error) {
    console.warn("[admin-notifications] insert failed:", error.message);
    return null;
  }
  return data as AdminNotification;
}

export async function listUnreadAdminNotifications(limit = 20): Promise<AdminNotification[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("admin_notifications")
    .select("*")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AdminNotification[];
}

export async function listRecentAdminNotifications(limit = 50): Promise<AdminNotification[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("admin_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AdminNotification[];
}

export async function markAdminNotificationsRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("admin_notifications")
    .update({ read_at: new Date().toISOString() }, { count: "exact" })
    .in("id", ids)
    .is("read_at", null);
  return count ?? 0;
}

export async function markAllAdminNotificationsRead(): Promise<number> {
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("admin_notifications")
    .update({ read_at: new Date().toISOString() }, { count: "exact" })
    .is("read_at", null);
  return count ?? 0;
}

export async function adminUnreadCount(): Promise<number> {
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("admin_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}
