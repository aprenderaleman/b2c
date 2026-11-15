/**
 * post-trial-followups — Gelfis 2026-11-15
 *
 * Cola de +24h follow-ups post-trial. Una acción del profe = una fila.
 *
 * Reglas:
 *  - Al agendar una fila, cancelamos cualquier otra pendiente del mismo
 *    lead (reemplaza — cada nueva acción sustituye a la anterior).
 *  - La fila se cancela si el lead responde (lead_message_received en
 *    timeline > reference_at), convierte (status=converted), o el profe
 *    marca otra acción.
 *  - due_at tiene jitter ±15 min desde reference_at+24h para suavizar
 *    picos (anti-ban).
 */

import { supabaseAdmin } from "./supabase";

export type FollowupKind = "asistio" | "no_asistio" | "reagendar" | "enviar_enlace";

const FOLLOWUP_BASE_MS = 24 * 60 * 60 * 1000;    // 24h
const FOLLOWUP_JITTER_MS = 15 * 60 * 1000;        // ±15 min

function computeDueAt(ref: Date = new Date()): string {
  const jitter = Math.round((Math.random() * 2 - 1) * FOLLOWUP_JITTER_MS);
  return new Date(ref.getTime() + FOLLOWUP_BASE_MS + jitter).toISOString();
}

/**
 * Cancela toda fila pendiente de follow-up para este lead.
 * Devuelve el número de filas afectadas.
 */
export async function cancelPendingFollowups(
  leadId: string,
  reason: string,
): Promise<number> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("post_trial_followups")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("lead_id", leadId)
    .is("cancelled_at", null)
    .is("sent_at", null)
    .select("id");
  if (error) {
    console.warn("[post-trial-followups] cancel error:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Agenda un follow-up a +24h (con jitter). Primero cancela los
 * pendientes del mismo lead (reemplaza).
 */
export async function schedulePostTrialFollowup(opts: {
  leadId: string;
  kind: FollowupKind;
  context?: Record<string, unknown>;
}): Promise<{ ok: boolean; id?: string; dueAt?: string; reason?: string }> {
  const sb = supabaseAdmin();

  await cancelPendingFollowups(opts.leadId, `replaced_by:${opts.kind}`);

  const now = new Date();
  const row = {
    lead_id: opts.leadId,
    kind: opts.kind,
    due_at: computeDueAt(now),
    reference_at: now.toISOString(),
    context: opts.context ?? {},
  };
  const { data, error } = await sb
    .from("post_trial_followups")
    .insert(row)
    .select("id, due_at")
    .maybeSingle();
  if (error || !data) {
    console.error("[post-trial-followups] schedule error:", error?.message);
    return { ok: false, reason: error?.message ?? "insert_failed" };
  }
  return { ok: true, id: (data as { id: string }).id, dueAt: (data as { due_at: string }).due_at };
}

/**
 * ¿El lead respondió por WhatsApp después de reference_at?
 * Si sí, el follow-up queda obsoleto.
 */
export async function leadRepliedSince(leadId: string, since: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("lead_timeline")
    .select("id")
    .eq("lead_id", leadId)
    .eq("type", "lead_message_received")
    .gt("timestamp", since)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Copies de los 4 Msg 2 (+24h). Alineados con los Msg 1 ya desplegados
 * en lib/admin-actions.ts + cron/send-trial-notifications. Gelfis 2026-11-15.
 */
export function buildFollowupText(kind: FollowupKind, args: {
  firstName: string;
  rescheduleUrl?: string;
  planUrl?: string;
}): string {
  const name = args.firstName || "";
  switch (kind) {
    case "asistio":
      // Bono vence mañana. Reuso del enlace plan.
      return [
        `Hola ${name} 👋`,
        ``,
        `Tu BONUS DE ACCIÓN RÁPIDA (valor 134 €) vence`,
        `mañana a esta hora.`,
        ``,
        `Si quieres aprovecharlo + empezar con tu plan,`,
        `aquí sigue disponible:`,
        `👉 ${args.planUrl ?? "https://aprender-aleman.de/inscripciones"}`,
        ``,
        `¿Alguna duda que pueda resolverte? 🙌`,
      ].join("\n");

    case "no_asistio":
      return [
        `Hola ${name} 👋`,
        ``,
        `¿Seguimos con la clase de prueba de alemán?`,
        ``,
        `Es gratis, dura 40 min y sales con un plan`,
        `personalizado para alcanzar tus objetivos con`,
        `el alemán.`,
        ``,
        `Agenda la que te venga bien:`,
        `👉 ${args.rescheduleUrl ?? ""}`,
        ``,
        `Si ya no te interesa, dime y cerramos sin problema 🙌`,
      ].join("\n");

    case "reagendar":
      return [
        `Hola ${name} 👋`,
        ``,
        `Vi que aún no has elegido fecha para tu clase.`,
        ``,
        `Todavía tienes el espacio reservado. Agenda`,
        `cuando te venga bien:`,
        `👉 ${args.rescheduleUrl ?? ""}`,
        ``,
        `¿Hay algo que pueda resolverte? Dime por aquí 🙌`,
      ].join("\n");

    case "enviar_enlace":
      return [
        `Hola ${name} 👋`,
        ``,
        `Vi que aún no has completado tu inscripción.`,
        ``,
        `Tu 🎁 BONUS DE ACCIÓN RÁPIDA (valor 134 €) sigue`,
        `disponible, pero vence mañana a esta hora.`,
        ``,
        `El enlace sigue activo aquí:`,
        `👉 ${args.planUrl ?? "https://aprender-aleman.de/inscripciones"}`,
        ``,
        `Si algo te está frenando (duda con el precio, el plan,`,
        `cómo funciona el pago…), dime por aquí y lo resolvemos`,
        `en 2 minutos 🙌`,
      ].join("\n");
  }
}

/**
 * Kind de WhatsApp (whitelist ALLOWED_WA_KINDS) por tipo de follow-up.
 */
export function waKindFor(kind: FollowupKind): string {
  switch (kind) {
    case "asistio":       return "trial_asistio_fu24h";
    case "no_asistio":    return "trial_absent_fu24h";
    case "reagendar":     return "trial_reagendar_fu24h";
    case "enviar_enlace": return "trial_inscription_fu24h";
  }
}
