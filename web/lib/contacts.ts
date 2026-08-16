/**
 * Registro universal de contactos (fase 1 del sistema de estados globales,
 * Gelfis 2026-08-16).
 *
 * Toda acción humana de panel que toca al lead registra aquí UN contacto
 * con actor real. Los flujos automáticos (inbound del VPS, envíos de Stiv,
 * pagos) NO usan este helper: los captura el trigger espejo de la
 * migración 113 sobre lead_timeline.
 *
 * Reglas (spec sección 2):
 *   - nota_libre exige note >= 5 caracteres.
 *   - occurred_at editable al crear, máximo 48h hacia atrás y nunca futuro.
 *   - Los registros son inmutables (trigger en BD) — no hay update/delete.
 */

import { supabaseAdmin } from "./supabase";

export const CONTACT_ACTION_TYPES = [
  "agendar_prueba", "no_contesto", "enviar_info", "enviar_propuesta",
  "seguimiento_pactado", "enviar_enlace", "confirmar_pago", "reactivacion",
  "asistio", "no_show", "feedback_profesor", "nota_libre",
] as const;
export type ContactActionType = (typeof CONTACT_ACTION_TYPES)[number];

export const CONTACT_CHANNELS = ["whatsapp", "llamada", "email", "aula", "otro"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export type ContactActor = {
  type: "closer" | "profesor" | "admin";
  id: string;
  name: string;
};

const MAX_BACKDATE_MS = 48 * 3_600_000;

/**
 * Actor desde el user de sesión de los routes de panel (requireTeacherSession
 * / requireRole devuelven {id, email, role} sin nombre → lo resolvemos aquí).
 */
export async function actorFromPanelUser(user: {
  id: string;
  email?: string | null;
  role: string;
}): Promise<ContactActor> {
  const type: ContactActor["type"] =
    user.role === "closer" ? "closer" : user.role === "teacher" ? "profesor" : "admin";
  const sb = supabaseAdmin();
  const { data } = await sb.from("users").select("full_name").eq("id", user.id).maybeSingle();
  const name = ((data as { full_name: string | null } | null)?.full_name ?? user.email ?? "").trim();
  return { type, id: user.id, name };
}

export type RegisterContactArgs = {
  leadId: string;
  actor: ContactActor;
  direction?: "saliente" | "entrante";   // default saliente
  actionType: ContactActionType;
  channel: ContactChannel;
  note?: string | null;
  /** Cuándo ocurrió el contacto real. Default: ahora. Máx 48h atrás. */
  occurredAt?: string | null;
  /** Dedupe opcional (p.ej. "accion:<uuid>" si viene de un flujo con id). */
  eventId?: string | null;
};

export type RegisterContactResult =
  | { ok: true; id: string }
  | { ok: false; error: "nota_corta" | "occurred_at_invalido" | "db_error" };

export async function registerContact(args: RegisterContactArgs): Promise<RegisterContactResult> {
  const note = args.note?.trim() || null;

  if (args.actionType === "nota_libre" && (!note || note.length < 5)) {
    return { ok: false, error: "nota_corta" };
  }

  let occurredAt = new Date().toISOString();
  if (args.occurredAt) {
    const t = new Date(args.occurredAt).getTime();
    const now = Date.now();
    if (isNaN(t) || t > now + 60_000 || t < now - MAX_BACKDATE_MS) {
      return { ok: false, error: "occurred_at_invalido" };
    }
    occurredAt = new Date(t).toISOString();
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("lead_contacts")
    .insert({
      lead_id:     args.leadId,
      actor_type:  args.actor.type,
      actor_id:    args.actor.id,
      actor_name:  args.actor.name,
      direction:   args.direction ?? "saliente",
      action_type: args.actionType,
      note,
      channel:     args.channel,
      occurred_at: occurredAt,
      source:      "panel",
      event_id:    args.eventId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 (event_id duplicado) = ya registrado — idempotente, no es fallo.
    if (error.code === "23505") return { ok: true, id: "duplicate" };
    console.error("[contacts] insert failed:", error);
    return { ok: false, error: "db_error" };
  }
  return { ok: true, id: (data as { id: string }).id };
}

// ── Último contacto saliente por lead (spec 2f) ──────────────────────────

export type LastContact = {
  occurred_at: string;
  actor_type:  string;
  actor_name:  string | null;
  channel:     string;
  action_type: string;
};

/** Map<leadId, LastContact> para un lote de leads (listas, colas). */
export async function getLastContacts(leadIds: string[]): Promise<Map<string, LastContact>> {
  const out = new Map<string, LastContact>();
  if (leadIds.length === 0) return out;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("v_lead_last_contact")
    .select("lead_id, occurred_at, actor_type, actor_name, channel, action_type")
    .in("lead_id", leadIds);
  for (const r of (data ?? []) as Array<LastContact & { lead_id: string }>) {
    out.set(r.lead_id, r);
  }
  return out;
}

/** "hace 3h (Lorenz, WhatsApp)" — render compacto para fichas y listas. */
export function fmtLastContact(c: LastContact | null | undefined): string {
  if (!c) return "sin contactos registrados";
  const diff = Date.now() - new Date(c.occurred_at).getTime();
  const min = Math.floor(diff / 60_000);
  const ago = min < 60 ? `hace ${Math.max(1, min)} min`
    : min < 48 * 60 ? `hace ${Math.floor(min / 60)}h`
    : `hace ${Math.floor(min / 1440)}d`;
  const who = c.actor_type === "stiv" ? "Stiv" : (c.actor_name?.split(/\s+/)[0] ?? c.actor_type);
  const CHANNEL_LABEL: Record<string, string> = {
    whatsapp: "WhatsApp", llamada: "llamada", email: "email", aula: "aula", otro: "otro",
  };
  return `${ago} (${who}, ${CHANNEL_LABEL[c.channel] ?? c.channel})`;
}
