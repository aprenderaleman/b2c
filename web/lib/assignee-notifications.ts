import { supabaseAdmin } from "@/lib/supabase";
import {
  sendTrialTeacherUpdatedEmail,
  sendSesionCloserUpdatedEmail,
} from "@/lib/email/send";

/**
 * Notificaciones al asignado (teacher trial / closer sesión) cuando
 * SU clase o sesión es reagendada o cancelada por un tercero
 * (Gelfis 2026-08-19). Un solo entry point para los 5 endpoints:
 *
 *   trial reagenda:   admin/leads/[id]/reschedule-trial
 *                     internal/reschedule/confirm
 *   trial cancel:     trial-classes/[id]/cancel
 *   sesión reagenda:  public/book-sesion-plan (rama rescheduled)
 *   sesión cancel:    lib/admin-actions.sendSesionRescheduleLinkMessage
 *
 * Regla clave: si `actorUserId` == asignado, NO enviamos (ya lo sabe).
 * Fallos de envío se loguean pero no rompen la operación principal.
 */

type FormatBerlinInput = string | Date | null | undefined;

/** "viernes, 22 de agosto, 17:00 (Berlín)". */
function formatBerlinLong(when: FormatBerlinInput): string {
  if (!when) return "(sin fecha)";
  const d = typeof when === "string" ? new Date(when) : when;
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Berlin",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${fmt.format(d)} (Berlín)`;
}

const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://b2c.aprender-aleman.de";

/**
 * Emite el email al teacher asignado a `classes.teacher_id`.
 * Silencioso si: no hay teacher, no hay email, o el actor es el mismo teacher.
 */
export async function notifyTeacherClassChanged(input: {
  classId:        string;
  kind:           "rescheduled" | "cancelled";
  previousDate:   FormatBerlinInput;
  newDate?:       FormatBerlinInput;   // solo rescheduled
  actorUserId?:   string | null;       // quien hizo el cambio
  actorLabel:     string;              // "Gelfis (admin)", "María (lead)", "cron"
}): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data: cls } = await sb
      .from("classes")
      .select("teacher_id, lead_id, users:teacher_id(full_name, email), leads:lead_id(name)")
      .eq("id", input.classId)
      .maybeSingle();
    const row = cls as unknown as {
      teacher_id: string | null;
      users: { full_name: string | null; email: string | null } | null;
      leads: { name: string | null } | null;
    } | null;
    if (!row?.teacher_id) return;
    if (row.teacher_id === input.actorUserId) return;
    const email = row.users?.email;
    if (!email) return;

    const firstName = (row.users?.full_name ?? "").split(/\s+/)[0] || "profe";
    const leadName  = row.leads?.name ?? "el estudiante";

    await sendTrialTeacherUpdatedEmail(email, {
      kind:         input.kind,
      teacherName:  firstName,
      leadName,
      previousDate: formatBerlinLong(input.previousDate),
      newDate:      input.newDate ? formatBerlinLong(input.newDate) : undefined,
      panelUrl:     `${PLATFORM_URL}/teacher`,
      actorLabel:   input.actorLabel,
    });
  } catch (err) {
    console.error("[assignee-notifications] notifyTeacherClassChanged failed:", err);
  }
}

/**
 * Emite el email al closer asignado a `classes.sesion_closer_id`.
 * Silencioso si: no hay closer, no hay email, o el actor es el mismo closer.
 */
export async function notifyCloserSesionChanged(input: {
  sesionId:      string;
  kind:          "rescheduled" | "cancelled";
  previousDate:  FormatBerlinInput;
  newDate?:      FormatBerlinInput;
  actorUserId?:  string | null;
  actorLabel:    string;
}): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data: cls } = await sb
      .from("classes")
      .select("sesion_closer_id, lead_id, users:sesion_closer_id(full_name, email), leads:lead_id(name)")
      .eq("id", input.sesionId)
      .maybeSingle();
    const row = cls as unknown as {
      sesion_closer_id: string | null;
      users: { full_name: string | null; email: string | null } | null;
      leads: { name: string | null } | null;
    } | null;
    if (!row?.sesion_closer_id) return;
    if (row.sesion_closer_id === input.actorUserId) return;
    const email = row.users?.email;
    if (!email) return;

    const firstName = (row.users?.full_name ?? "").split(/\s+/)[0] || "closer";
    const leadName  = row.leads?.name ?? "el lead";

    await sendSesionCloserUpdatedEmail(email, {
      kind:         input.kind,
      closerName:   firstName,
      leadName,
      previousDate: formatBerlinLong(input.previousDate),
      newDate:      input.newDate ? formatBerlinLong(input.newDate) : undefined,
      panelUrl:     `${PLATFORM_URL}/closer`,
      actorLabel:   input.actorLabel,
    });
  } catch (err) {
    console.error("[assignee-notifications] notifyCloserSesionChanged failed:", err);
  }
}
