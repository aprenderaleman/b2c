import { supabaseAdmin } from "@/lib/supabase";
import { patchTrialEvent } from "@/lib/google-calendar";
import { sendTrialRescheduledEmail } from "@/lib/email/send";
import { notifyTeacherClassChanged } from "@/lib/assignee-notifications";
import { closeRescueChainsForRebook } from "@/lib/rescue-chains";
import { sendWhatsappText } from "@/lib/whatsapp";
import { formatBerlinFull } from "@/lib/time";
import { buildLeadJoinUrl } from "@/lib/trial-token";

/**
 * Core de la reagenda de clase de prueba — extraído de
 * /api/admin/leads/[id]/reschedule-trial (2026-08-31) para que el rol
 * setter reutilice EXACTAMENTE la misma lógica (race-guard, patch de
 * Google Calendar con rollback, notificación WA+email al lead, cierre
 * de cadenas de rescate, timeline). Los callers hacen su propia auth y
 * pasan quién actúa.
 *
 * Comportamiento idéntico al route original:
 *   1. Verifica que la clase existe, sigue scheduled, es trial y
 *      pertenece al lead.
 *   2. Race-guard contra el (nuevo) profe.
 *   3. UPDATE classes.scheduled_at + reset notes_admin.
 *   4. Patch GCal; si falla, ROLLBACK del UPDATE.
 *   5. WA + email al lead (fire-and-forget).
 *   6. closeRescueChainsForRebook(trial) + aviso al profe + timeline.
 */

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export type RescheduleTrialArgs = {
  leadId: string;
  classId: string;
  newStartIso: string;
  durationMinutes?: number;
  /** Cambio de profe opcional; el race-guard aplica al nuevo. */
  newTeacherId?: string;
  actor: {
    /** users.id del humano, o null (cron). */
    userId: string | null;
    /** Para el aviso al profe: "gelfis@… (admin)", "María (setter)", "cron/curl". */
    label: string;
    /** lead_timeline.author: "admin" | "system" | "setter". */
    timelineAuthor: string;
  };
};

export type RescheduleTrialResult =
  | {
      ok: true;
      class_id: string;
      new_start_iso: string;
      new_start_label: string;
      gcal_patched: boolean;
      email_sent: boolean | null;
      wa_sent: boolean | null;
      join_url: string;
    }
  | { ok: false; status: number; error: string; message?: string };

export async function rescheduleTrialForLead(args: RescheduleTrialArgs): Promise<RescheduleTrialResult> {
  const { leadId } = args;
  const newStart = new Date(args.newStartIso);
  if (isNaN(newStart.getTime())) {
    return { ok: false, status: 400, error: "invalid_date" };
  }
  if (newStart.getTime() < Date.now()) {
    return { ok: false, status: 400, error: "in_the_past", message: "La nueva fecha debe ser en el futuro." };
  }

  const sb = supabaseAdmin();

  // 1) Verify class belongs to this lead, is trial, scheduled.
  const { data: cls, error: clsErr } = await sb
    .from("classes")
    .select("id, status, is_trial, scheduled_at, teacher_id, lead_id, duration_minutes, google_calendar_event_id, short_code")
    .eq("id", args.classId)
    .is("deleted_at", null) // soft-delete guard 2026-07-10
    .maybeSingle();
  if (clsErr || !cls) {
    return { ok: false, status: 404, error: "class_not_found" };
  }
  type ClassRow = {
    id: string; status: string; is_trial: boolean; scheduled_at: string;
    teacher_id: string; lead_id: string | null; duration_minutes: number;
    google_calendar_event_id: string | null; short_code: string | null;
  };
  const c = cls as ClassRow;
  if (c.lead_id !== leadId) {
    return { ok: false, status: 409, error: "class_not_for_this_lead" };
  }
  if (!c.is_trial || c.status !== "scheduled") {
    return { ok: false, status: 409, error: "not_reschedulable", message: `status=${c.status} is_trial=${c.is_trial}` };
  }

  const duration = args.durationMinutes ?? c.duration_minutes ?? 40;
  const slotEnd  = new Date(newStart.getTime() + duration * 60_000);
  const slotPrev = new Date(newStart.getTime() - duration * 60_000);
  // Si se pide cambio de profe, el race-guard aplica al NUEVO profe.
  const targetTeacherId = args.newTeacherId ?? c.teacher_id;
  const teacherChanged  = !!args.newTeacherId && args.newTeacherId !== c.teacher_id;

  // 2) Race-guard: ¿alguien tomó el slot nuevo entre el check y este confirm?
  //    Excluimos la propia clase (estamos moviéndola).
  const { data: collisions } = await sb
    .from("classes")
    .select("id")
    .is("deleted_at", null) // soft-delete guard 2026-07-10
    .eq("teacher_id", targetTeacherId)
    .in("status", ["scheduled", "live"])
    .neq("id", c.id)
    .lt("scheduled_at", slotEnd.toISOString())
    .gte("scheduled_at", slotPrev.toISOString());
  if (collisions && collisions.length > 0) {
    return {
      ok: false, status: 409, error: "slot_taken",
      message: "El profesor ya tiene una clase agendada en ese horario. Elige otro.",
    };
  }

  // 3) UPDATE classes (opcional: reasigna teacher si new_teacher_id)
  const { error: updErr } = await sb
    .from("classes")
    .update({
      scheduled_at: newStart.toISOString(),
      // Reset markers de recordatorios — los crons (24h/morning/30m)
      // consultan notes_admin para idempotencia, así que basta con
      // limpiarlo para que re-disparen en el nuevo horario.
      notes_admin:  null,
      ...(teacherChanged ? { teacher_id: targetTeacherId } : {}),
    })
    .eq("id", c.id);
  if (updErr) {
    return { ok: false, status: 500, error: "db_update_failed", message: updErr.message };
  }

  // 4) Patch evento en Google Calendar (si existe)
  let gcalPatched = false;
  if (c.google_calendar_event_id) {
    try {
      gcalPatched = await patchTrialEvent(
        c.google_calendar_event_id,
        newStart.toISOString(),
        duration,
      );
    } catch (e) {
      console.error("[reschedule-trial] gcal patch threw:", e);
    }
    if (!gcalPatched) {
      // Rollback para no dejar BD y Calendar desincronizados.
      const { error: rbErr } = await sb
        .from("classes")
        .update({ scheduled_at: c.scheduled_at })
        .eq("id", c.id);
      if (rbErr) {
        console.error("[reschedule-trial] CRITICAL: gcal patch failed AND rollback failed:", rbErr);
        return { ok: false, status: 500, error: "gcal_failed_and_rollback_failed", message: rbErr.message };
      }
      return {
        ok: false, status: 500, error: "gcal_failed",
        message: "El patch del evento en Google Calendar falló. La clase NO fue movida.",
      };
    }
  }

  // 5) Lead info para mensajes
  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language")
    .eq("id", leadId)
    .maybeSingle();
  type LeadRow = {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; language: "es" | "de" | null;
  };
  const lr        = (lead ?? {}) as LeadRow;
  const lang      = (lr.language === "de" ? "de" : "es") as "es" | "de";
  const leadFirst = (lr.name ?? "").trim().split(/\s+/)[0] || "";
  const startDate = formatBerlinFull(newStart, lang);
  const joinUrl   = buildLeadJoinUrl({
    classId:   c.id,
    leadId:    leadId,
    shortCode: c.short_code,
    baseUrl:   PLATFORM_URL,
  });

  // 6) Notificar — email + WA en paralelo, fire-and-forget.
  const waText = lang === "de"
    ? [
        `${leadFirst}, deine kostenlose Probestunde DEUTSCH wurde verschoben.`,
        ``,
        `📅 Neuer Termin: ${startDate}`,
        `🔗 ZUM UNTERRICHTSRAUM: ${joinUrl}`,
        ``,
        `Bitte bestätige mit "Ja", dass du dabei bist 🙌`,
        ``,
        `— Aprender-Aleman.de`,
      ].join("\n")
    : [
        `${leadFirst}, hemos reagendado tu clase de prueba GRATUITA de ALEMÁN.`,
        ``,
        `📅 Nueva fecha: ${startDate}`,
        `🔗 ENLACE A LA CLASE: ${joinUrl}`,
        ``,
        `¿Me confirmas con un "Sí" que asistirás? 🙌`,
        ``,
        `— Aprender-Aleman.de`,
      ].join("\n");

  const tasks: Promise<unknown>[] = [];
  if (lr.email) {
    tasks.push(
      sendTrialRescheduledEmail(lr.email, {
        leadName:     leadFirst || "tú",
        newStartDate: startDate,
        durationMin:  duration,
        joinUrl,
        language:     lang,
      }),
    );
  }
  if (lr.whatsapp_normalized) {
    tasks.push(sendWhatsappText(lr.whatsapp_normalized, waText));
  }
  const results = await Promise.allSettled(tasks);
  const settledOk = (r: PromiseSettledResult<unknown> | undefined): boolean | null => {
    if (!r) return null;
    if (r.status !== "fulfilled") return false;
    return (r.value as { ok?: boolean }).ok === true;
  };
  const emailOk = lr.email               ? settledOk(results[0]) : null;
  const waOk    = lr.whatsapp_normalized ? settledOk(results[lr.email ? 1 : 0]) : null;

  // Cerrar chains de rescate — el lead ya tiene nueva fecha, no
  // necesita mensajes "¿te agendo la clase?".
  await closeRescueChainsForRebook(sb, leadId, "trial");

  // Notificar al teacher que su clase cambió. Si hubo swap de profe,
  // solo notificamos al NUEVO — el viejo se entera por el evento GCal
  // borrado y por el cambio en su panel (edge case poco frecuente).
  void notifyTeacherClassChanged({
    classId:      c.id,
    kind:         "rescheduled",
    previousDate: c.scheduled_at,
    newDate:      newStart,
    actorUserId:  args.actor.userId,
    actorLabel:   args.actor.label,
  });

  // 7) Timeline
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  args.actor.timelineAuthor,
    content: `📅 Clase de prueba reagendada a ${startDate}${teacherChanged ? ` (profe cambiado)` : ""} por ${args.actor.label}.`,
    metadata: {
      kind:              "trial_rescheduled",
      class_id:          c.id,
      old_start_iso:     c.scheduled_at,
      new_start_iso:     newStart.toISOString(),
      old_teacher_id:    c.teacher_id,
      new_teacher_id:    targetTeacherId,
      teacher_changed:   teacherChanged,
      gcal_patched:      gcalPatched,
      email_sent:        emailOk,
      wa_sent:           waOk,
    },
  });

  return {
    ok:              true,
    class_id:        c.id,
    new_start_iso:   newStart.toISOString(),
    new_start_label: startDate,
    gcal_patched:    gcalPatched,
    email_sent:      emailOk,
    wa_sent:         waOk,
    join_url:        joinUrl,
  };
}
