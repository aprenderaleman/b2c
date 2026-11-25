import { supabaseAdmin } from "./supabase";
import { sendRescheduleLinkMessage } from "./admin-actions";
import { registerContact, actorFromPanelUser } from "./contacts";
import { createNotification } from "./notifications";
import {
  evaluateNoConfirm, noConfirmBlockMessage, validateTeacherNote,
  TEACHER_RESCHEDULE_REASONS, type TeacherRescheduleReason,
} from "./trial-reschedule-reason";

/**
 * "Reagendar" del profe en una clase de prueba, con motivo (Gelfis 2026-11-24).
 * Núcleo de /api/teacher/trial/[leadId]/send-reschedule-link, separado de la
 * ruta para poder probarlo de punta a punta sin sesión.
 *
 *   reason "lead_no_confirmo" → solo si el lead no confirmó por ninguna vía,
 *       el profe marcó su nota de voz y falta ≤ 1 h para la clase.
 *   reason "profe_no_puede"   → motivo escrito obligatorio; queda en el
 *       historial y avisa a los admins. No se le envía al lead.
 * El profe siempre indica el motivo; closer/admin pueden seguir sin él
 * (copy genérico de siempre).
 */

type PanelUser = { id: string; email: string; role: string };

export type TeacherRescheduleContext = {
  trial: { id: string; scheduled_at: string } | null;
  leadConfirmed: boolean;
  voiceNoteSent: boolean;
  leadName: string | null;
};

const hhmmBerlin = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

export async function loadTeacherRescheduleContext(leadId: string): Promise<TeacherRescheduleContext> {
  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();
  // Misma consulta que usa sendRescheduleLinkMessage para elegir la clase a liberar.
  const [{ data: cls }, { data: lead }] = await Promise.all([
    sb.from("classes")
      .select("id, scheduled_at, student_confirmed_at")
      .eq("lead_id", leadId).eq("is_trial", true).eq("status", "scheduled")
      .gte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(1).maybeSingle(),
    sb.from("leads").select("name, trial_confirmed_at").eq("id", leadId).maybeSingle(),
  ]);
  const c = cls as { id: string; scheduled_at: string; student_confirmed_at: string | null } | null;
  const l = lead as { name: string | null; trial_confirmed_at: string | null } | null;
  let voiceNoteSent = false;
  if (c) {
    const { data: script } = await sb.from("trial_class_scripts")
      .select("voice_note_sent_at").eq("class_id", c.id).maybeSingle();
    voiceNoteSent = !!(script as { voice_note_sent_at: string | null } | null)?.voice_note_sent_at;
  }
  return {
    trial: c ? { id: c.id, scheduled_at: c.scheduled_at } : null,
    leadConfirmed: !!(c?.student_confirmed_at || l?.trial_confirmed_at),
    voiceNoteSent,
    leadName: l?.name ?? null,
  };
}

function evaluate(ctx: TeacherRescheduleContext) {
  const ev = evaluateNoConfirm({
    nowMs: Date.now(),
    scheduledAt: ctx.trial?.scheduled_at ?? null,
    leadConfirmed: ctx.leadConfirmed,
    voiceNoteSent: ctx.voiceNoteSent,
  });
  const message = ev.blockedBy
    ? noConfirmBlockMessage(ev.blockedBy, ev.availableFrom ? hhmmBerlin(ev.availableFrom) : null)
    : null;
  return { ...ev, message };
}

/** Estado para la ventana del profe (GET). */
export async function getTeacherRescheduleStatus(leadId: string) {
  const ctx = await loadTeacherRescheduleContext(leadId);
  const ev = evaluate(ctx);
  return {
    ok: true as const,
    hasUpcomingTrial: !!ctx.trial,
    scheduledAt: ctx.trial?.scheduled_at ?? null,
    leadConfirmed: ctx.leadConfirmed,
    voiceNoteSent: ctx.voiceNoteSent,
    noConfirm: { allowed: ev.allowed, blockedBy: ev.blockedBy, message: ev.message },
  };
}

export type TeacherRescheduleResult = { status: number; body: Record<string, unknown> };

/** Ejecuta el reagendamiento (POST). Devuelve el código HTTP y el cuerpo de la respuesta. */
export async function teacherRescheduleTrial(args: {
  leadId: string;
  user: PanelUser;
  reason?: unknown;
  note?: unknown;
}): Promise<TeacherRescheduleResult> {
  const { leadId, user } = args;
  const rawReason = typeof args.reason === "string" && args.reason ? args.reason : null;
  if (rawReason && !TEACHER_RESCHEDULE_REASONS.includes(rawReason as TeacherRescheduleReason)) {
    return { status: 400, body: { ok: false, reason: "Motivo de reagendamiento no válido." } };
  }
  const reason = rawReason as TeacherRescheduleReason | null;

  if (user.role === "teacher" && !reason) {
    return { status: 400, body: { ok: false, reason: "Elige el motivo del reagendamiento." } };
  }

  const sb = supabaseAdmin();
  const { data: userRow } = await sb.from("users").select("full_name").eq("id", user.id).maybeSingle();
  const actorName = (userRow as { full_name: string | null } | null)?.full_name || user.email;

  let note: string | null = null;
  let ctx: TeacherRescheduleContext | null = null;
  if (reason) {
    ctx = await loadTeacherRescheduleContext(leadId);
    if (!ctx.trial) {
      return { status: 400, body: { ok: false, blockedBy: "no_upcoming_trial", reason: noConfirmBlockMessage("no_upcoming_trial") } };
    }
    if (reason === "lead_no_confirmo") {
      const ev = evaluate(ctx);
      if (!ev.allowed) return { status: 400, body: { ok: false, blockedBy: ev.blockedBy, reason: ev.message } };
    } else {
      const v = validateTeacherNote(args.note);
      if (!v.ok) return { status: 400, body: { ok: false, reason: v.error } };
      note = v.note;
    }
  }

  const result = await sendRescheduleLinkMessage(leadId, {
    actorName,
    // CRM Closer F4: el closer envía el copy editable de system_config
    // (clave closer_copy_reagenda), no el genérico del profe.
    ...(user.role === "closer" ? { copy: "closer" as const } : {}),
    ...(reason ? { teacherReason: { reason, note, teacherFirstName: actorName.split(/\s+/)[0] || null } } : {}),
  });
  if (!result.ok) return { status: 400, body: { ok: false, reason: result.reason } };

  if (user.role === "closer") {
    // El closer registra en acciones_closer (la atribución de comisión
    // lee esa tabla; el trigger espejo crea la fila en lead_contacts).
    const { logCloserAction } = await import("./closer-actions");
    await logCloserAction({
      closerId: user.id,
      leadId,
      tipo: "whatsapp",
      contenido: "Enlace de reagenda de la clase de prueba enviado al lead",
      resultado: "reagendado",
    }).catch((e) => console.warn("[teacher-reschedule] logCloserAction:", e instanceof Error ? e.message : e));
  } else {
    await registerContact({
      leadId,
      actor: await actorFromPanelUser(user),
      actionType: "agendar_prueba",
      channel: "whatsapp",
      note: reason === "lead_no_confirmo" ? "Reagendado por el profe: el lead no confirmó. Enlace enviado"
          : reason === "profe_no_puede"   ? `Reagendado por el profe: no puede dar la clase (${note}). Enlace enviado`
          : "Enlace de agendar clase de prueba enviado",
    });
  }

  // "No puedo dar la clase" → aviso a los admins: ven el motivo y pueden
  // detectar si un profe lo usa mucho. Best-effort.
  if (reason === "profe_no_puede" && ctx?.trial) {
    try {
      const { data: admins } = await sb.from("users").select("id").in("role", ["superadmin", "admin"]).eq("active", true);
      const cuando = new Date(ctx.trial.scheduled_at).toLocaleString("es-ES", {
        timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      const leadFirst = (ctx.leadName ?? "").split(/\s+/)[0] || "un lead";
      for (const ad of (admins ?? []) as Array<{ id: string }>) {
        await createNotification({
          user_id: ad.id,
          type:    "generic",
          title:   `${actorName.split(/\s+/)[0]} no puede dar la prueba de ${leadFirst}`,
          body:    `Clase del ${cuando} (Berlín) reagendada. Motivo: ${note}`,
          link:    `/admin/leads/${leadId}`,
        }).catch(() => null);
      }
    } catch (e) {
      console.error("[teacher-reschedule] aviso a admins falló:", e instanceof Error ? e.message : e);
    }
  }

  return { status: 200, body: { ok: true, ...(reason ? { rescheduleReason: reason } : {}) } };
}
