// Server-side helpers shared by the /api/admin/* routes.
// Every mutation also writes to lead_timeline so the dashboard has an audit trail.

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";
import { sendPostTrialFollowupEmail, sendPostTrialFollowupGenericEmail, sendTrialAttendedFollowupEmail, sendTrialAbsentFollowupEmail } from "./email/send";
import { getPack, getPackUrlWithOverride, type PackId, type PaymentType } from "./trial-packs";
import { getLeadTrialTeacher } from "./trial-compensation";
import { startChain, cancelActiveChain } from "./chain-engine";
import { OBJECTION_CHIP_TO_CHAIN, type ObjectionChip } from "./chain-definitions";
import { autoAssignToActiveCloser } from "./closer-actions";

/**
 * Tag interno: cuando se setea, Stiv debe escalar a `needs_human` la
 * próxima vez que el lead responda algo (porque le acabamos de mandar
 * el link de pago y cualquier respuesta — "sí", "ya pagué", "tuve un
 * problema" — requiere acción humana). El valor es el timestamp en
 * que se armó el envío.
 */
const AWAITING_PAYMENT_KEY = "awaiting_payment_confirmation_since";

export async function addGelfisNote(leadId: string, note: string): Promise<void> {
  const sb = supabaseAdmin();
  const clean = note.trim();
  if (!clean) return;
  await sb.from("gelfis_notes").insert({ lead_id: leadId, note: clean });
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "gelfis_note",
    author: "gelfis",
    content: clean,
  });
}

export async function markConverted(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("leads").update({ status: "converted", converted_at: new Date().toISOString(), next_contact_date: null }).eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "conversion",
    author: "gelfis",
    content: "Payment confirmed — lead converted.",
    metadata: { trigger_welcome: true },
  });
}

export async function markLost(leadId: string, reason = "Marked lost by admin"): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("leads").update({ status: "lost", next_contact_date: null }).eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: reason,
  });
}

export async function reactivate(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  // Moves the lead back into the pipeline — Agent 0 will pick it up on next tick.
  await sb
    .from("leads")
    .update({ status: "in_conversation", next_contact_date: new Date().toISOString() })
    .eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Reactivated — auto follow-up resumed.",
  });
}

/**
 * The lead attended their trial class. Move them back into the normal
 * conversation pipeline (Stiv can answer, agent_0 stays paused while
 * we figure out conversion) and ship a quick WhatsApp follow-up so
 * the lead has a clear next step. If they reply "sí, me interesa",
 * Gelfis takes over from /admin/leads/{id} → "Convertir en estudiante".
 */
export type AttendedOptions = {
  objective:   string;
  packId:      PackId;
  paymentType: PaymentType;
  nivel?:      string;
  fullUrl?:    string;
  packLabel?:  string;
  metaLabel?:  string;
  ritmoLabel?: string;
  fechaLlegada?: string;
  isOneTime?:  boolean;
};

export async function markTrialAttendedAwaitingConversion(
  leadId: string,
  opts?: AttendedOptions,
): Promise<void> {
  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads")
    .select("name, language, whatsapp_normalized, email")
    .eq("id", leadId)
    .maybeSingle();
  const lead = (leadRow ?? null) as {
    name: string | null; language: "es" | "de" | null;
    whatsapp_normalized: string | null; email: string | null;
  } | null;

  // Seguimiento coherente:
  //   - Si el lead NO responde en 24 h tras recibir el link → el cron
  //     `tick_due_followups` lo re-toca y Stiv le manda un nudge según
  //     el contexto de la conversación.
  //   - Si el lead RESPONDE algo ("sí", "ya pagué", "tuve un problema")
  //     → el sistema lo marca como `needs_human` para que Gelfis cierre
  //     la venta a mano (es escalado, no auto-respuesta de Stiv). Esto
  //     se hace en el handler de mensajes entrantes leyendo el flag
  //     `awaiting_payment_confirmation_since` en lead_meta.
  // Gelfis 2026-08-01: chain2_link_sent (motor lead_chains) cubre los
  // follow-ups post-clase con enlace de pago. El cron legacy
  // post-trial-followups fue eliminado. next_contact_date se deja
  // seteado como sombrero para dashboards internos, pero no dispara
  // envío por sí solo (el chain-processor lo hace via lead_chains).
  const followupAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  // Cargamos la metadata existente para no pisarla.
  const { data: metaRow } = await sb
    .from("leads")
    .select("meta")
    .eq("id", leadId)
    .maybeSingle();
  const existingMeta = (metaRow?.meta && typeof metaRow.meta === "object") ? metaRow.meta as Record<string, unknown> : {};

  await sb
    .from("leads")
    .update({
      status: "trial_attended",
      // Timestamp explícito — fuente de verdad para la métrica de
      // asistencia en /admin/ads (migration 063). Antes el dashboard
      // contaba con substring match en lead_timeline; ahora lee este
      // campo directamente, sin riesgo de romperse por cambios de copy.
      trial_attended_at: new Date().toISOString(),
      next_contact_date: followupAt,
      meta: opts ? {
        ...existingMeta,
        [AWAITING_PAYMENT_KEY]: new Date().toISOString(),
        last_offered_pack:    opts.packId,
        last_offered_payment: opts.paymentType,
        last_offered_objective: opts.objective,
      } : existingMeta,
    })
    .eq("id", leadId);

  await autoAssignToActiveCloser(leadId, "tipo_a", "teacher_post_trial")
    .catch(err => console.warn("[markTrialAttendedAwaitingConversion] autoAssign error:", err));

  // FIX bug Saul 2026-06-13: si entre la "no asistencia" + reactivacion
  // y el "asistio" final se encolaron mensajes auto-generados (revival,
  // follow-ups Stiv pendientes, recordatorios atrasados), cancelarlos
  // todos AHORA. Asi solo sale el post_trial_followup con el link de
  // pago — no un "¿quedó alguna duda?" descontextualizado.
  try {
    const phone = lead?.whatsapp_normalized ?? null;
    if (phone) {
      const { error: cancelErr, count } = await sb
        .from("outbound_queue")
        .update({
          status: "failed_permanent",
          last_error: "Auto-cancelado: lead marcado attended posteriormente; el mensaje queda obsoleto",
          updated_at: new Date().toISOString(),
        }, { count: "exact" })
        .eq("phone_e164", phone)
        .eq("status", "queued")
        .neq("kind", "post_trial_followup");
      if (cancelErr) {
        console.warn(`[markTrialAttended] no pude cancelar queued de ${phone}: ${cancelErr.message}`);
      } else if ((count ?? 0) > 0) {
        console.log(`[markTrialAttended] cancelados ${count} mensajes obsoletos en cola para ${phone}`);
      }
    }
  } catch (e) {
    console.warn("[markTrialAttended] cleanup queue exception:", e instanceof Error ? e.message : e);
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: opts
      ? `Lead attended trial — pack: ${opts.packId}, payment: ${opts.paymentType}, objective: "${opts.objective}". Awaiting payment confirmation. Soft follow-up +24h. Escalate to needs_human on any reply.`
      : "Lead attended trial — awaiting conversion decision. Soft follow-up scheduled +24h.",
    metadata: opts ? { pack_id: opts.packId, payment_type: opts.paymentType, objective: opts.objective, awaiting_payment: true } : null,
  });

  // Best-effort follow-up. Skip silently if no WhatsApp on file.
  if (!lead?.whatsapp_normalized) return;
  const firstName = (lead.name || "").split(/\s+/)[0] || "";

  let text: string;

  if (opts && opts.fechaLlegada) {
    const packLink = opts.fullUrl || getPackUrlWithOverride(opts.packId, opts.paymentType);
    const metaLabel = opts.metaLabel || opts.packLabel || opts.packId;

    if (opts.isOneTime) {
      text = [
        `¡Hola ${firstName}! 😊`,
        ``,
        `Me alegra que hayas decidido dar el paso. Aquí tienes tu inscripción al programa ${metaLabel} (pago único: todas tus clases desbloqueadas desde el día 1) — a tu ritmo: con 2 clases por semana, tu ${metaLabel} llega en ${opts.fechaLlegada} 📅`,
        `Y con tu inscripción queda activada tu Garantía de Nivel por escrito.`,
        `👉 ${packLink || "(Te paso el enlace en breve.)"}`,
        ``,
        `Son 5 minutos. Cualquier duda durante el proceso, aquí estoy 😊`,
      ].join("\n");
    } else {
      text = [
        `¡Hola ${firstName}! 😊`,
        ``,
        `Me alegra que hayas decidido dar el paso. Aquí tienes tu inscripción al programa ${metaLabel} con ritmo ${opts.ritmoLabel || ""} — empezando esta semana, tu ${metaLabel} llega en ${opts.fechaLlegada} 📅`,
        `Y con tu inscripción queda activada tu Garantía de Nivel por escrito.`,
        `👉 ${packLink || "(Te paso el enlace en breve.)"}`,
        ``,
        `Son 5 minutos. Cualquier duda durante el proceso, aquí estoy 😊`,
      ].join("\n");
    }
  } else if (opts) {
    const packLink = opts.fullUrl || getPackUrlWithOverride(opts.packId, opts.paymentType);
    const packName = opts.packLabel || getPack(opts.packId)?.name || opts.packId;
    text = [
      `¡Hola ${firstName}! 😊`,
      ``,
      `Me alegra que hayas decidido dar el paso. Aquí tienes el enlace para formalizar tu inscripción en el ${packName}:`,
      `👉 ${packLink || "(Te paso el enlace en breve.)"}`,
      ``,
      `Son 5 minutos. Cualquier duda durante el proceso, aquí estoy 😊`,
    ].join("\n");
  } else {
    text = `¡Hola ${firstName}! 😊\n\n¡Gracias por asistir a tu clase de prueba de alemán!\n\n¿Qué te pareció? Si te interesa avanzar, te preparo un plan personalizado con horarios y precio exacto — dime cuando quieras seguir.\n\nStiv, Aprender-Aleman.de`;
  }

  const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
    kind: opts ? "trial_inscription_initial" : "trial_attended_initial",
  });
  if (res.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "system_message_sent",
      author: "gelfis",
      content: `💬 Follow-up post-clase enviado a ${lead.whatsapp_normalized}${opts ? ` (pack ${opts.packId} / ${opts.paymentType})` : ""}`,
      metadata: {
        kind: "post_trial_followup",
        channel: "whatsapp",
        ...(opts ? { pack_id: opts.packId, payment_type: opts.paymentType, objective: opts.objective } : {}),
      },
    });
  } else {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "send_failed",
      author: "gelfis",
      content: `💬 Falló el follow-up post-clase: ${res.reason}`,
      metadata: { kind: "post_trial_followup", channel: "whatsapp" },
    });
  }

  // ── Espejo por email ─────────────────────────────────────────────────
  // Mandamos el mismo follow-up por email cuando el lead nos dio email
  // en el funnel. Mismo wording que el WhatsApp (copy fijo de Gelfis),
  // con botón clickable al checkout del pack. Best-effort: si falla,
  // el WA ya fue suficiente — solo logueamos el fallo.
  if (lead?.email) {
    const langForEmail: "es" | "de" = "es";
    const ctaUrl = opts
      ? (opts.fullUrl || getPackUrlWithOverride(opts.packId, opts.paymentType) || `https://aprender-aleman.de/inscripciones?ref=${leadId}`)
      : `https://aprender-aleman.de/inscripciones?ref=${leadId}`;
    const packName = opts ? (opts.packLabel || getPack(opts.packId)?.name || opts.packId) : undefined;
    const emailRes = await sendTrialAttendedFollowupEmail(lead.email, {
      leadName: firstName || lead.name || "",
      language: langForEmail,
      ctaUrl,
      packName,
    });

    if (emailRes.ok) {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "system_message_sent",
        author:  "gelfis",
        content: `📧 Follow-up post-clase enviado por email a ${lead.email}${opts ? ` (pack ${opts.packId} / ${opts.paymentType})` : ""}`,
        metadata: {
          kind:    "post_trial_followup",
          channel: "email",
          ...(opts ? { pack_id: opts.packId, payment_type: opts.paymentType, objective: opts.objective } : {}),
        },
      });
    } else {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "send_failed",
        author:  "gelfis",
        content: `📧 Falló el follow-up post-clase por email: ${emailRes.error ?? "unknown"}`,
        metadata: { kind: "post_trial_followup", channel: "email" },
      });
    }
  }

  // Iniciar cadena de follow-ups post-enlace (chain2)
  await startChain(leadId, "chain2_link_sent", {
    ...(opts ? {
      packId: opts.packId,
      paymentType: opts.paymentType,
      objective: opts.objective,
      fullUrl: opts.fullUrl,
      packLabel: opts.packLabel,
    } : {}),
  }).catch(err => console.warn("[markTrialAttended] startChain error:", err));
}

/**
 * Flujo 2: lead asistió pero NO le enviamos enlace de pago.
 * Mandamos un mensaje motivacional y programamos la misma cadena
 * de follow-ups del cron post-trial-followups (usa el mismo flag
 * awaiting_payment_confirmation_since).
 */
export async function markTrialAttendedNoLink(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads")
    .select("name, language, whatsapp_normalized, email")
    .eq("id", leadId)
    .maybeSingle();
  const lead = (leadRow ?? null) as {
    name: string | null; language: "es" | "de" | null;
    whatsapp_normalized: string | null; email: string | null;
  } | null;

  const followupAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data: metaRow } = await sb
    .from("leads")
    .select("meta")
    .eq("id", leadId)
    .maybeSingle();
  const existingMeta = (metaRow?.meta && typeof metaRow.meta === "object") ? metaRow.meta as Record<string, unknown> : {};

  await sb
    .from("leads")
    .update({
      status: "trial_attended",
      trial_attended_at: new Date().toISOString(),
      next_contact_date: followupAt,
      meta: {
        ...existingMeta,
        [AWAITING_PAYMENT_KEY]: new Date().toISOString(),
        post_trial_flow: "no_link",
      },
    })
    .eq("id", leadId);

  await autoAssignToActiveCloser(leadId, "tipo_a", "teacher_post_trial")
    .catch(err => console.warn("[markTrialAttendedNoLink] autoAssign error:", err));

  try {
    const phone = lead?.whatsapp_normalized ?? null;
    if (phone) {
      const { error: cancelErr, count } = await sb
        .from("outbound_queue")
        .update({
          status: "failed_permanent",
          last_error: "Auto-cancelado: lead marcado attended (no-link); mensaje obsoleto",
          updated_at: new Date().toISOString(),
        }, { count: "exact" })
        .eq("phone_e164", phone)
        .eq("status", "queued")
        .neq("kind", "post_trial_followup");
      if (cancelErr) {
        console.warn(`[markTrialAttendedNoLink] no pude cancelar queued de ${phone}: ${cancelErr.message}`);
      } else if ((count ?? 0) > 0) {
        console.log(`[markTrialAttendedNoLink] cancelados ${count} mensajes obsoletos en cola para ${phone}`);
      }
    }
  } catch (e) {
    console.warn("[markTrialAttendedNoLink] cleanup queue exception:", e instanceof Error ? e.message : e);
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead attended trial (no payment link sent). Motivational message sent. Follow-up chain active. Escalate to needs_human on any reply.",
    metadata: { flow: "no_link", awaiting_payment: true },
  });

  if (!lead?.whatsapp_normalized) return;
  const firstName = (lead.name || "").split(/\s+/)[0] || "";

  const text = lead.language === "de"
    ? [
        `Hallo ${firstName}! 😊`,
        ``,
        `Es war mir eine große Freude, dich heute in der Probestunde dabei zu haben. Du hast heute gezeigt, dass du es kannst. 💪`,
        ``,
        `Ich weiß, wie wichtig es für dich ist, Deutsch zu lernen. Was hält dich davon ab, heute den nächsten Schritt zu machen?`,
        ``,
        `Stiv | Aprender-Aleman.de`,
      ].join("\n")
    : [
        `¡Hola, ${firstName}! 😊`,
        ``,
        `Ha sido un placer tenerte hoy en la clase de prueba. ¡Hoy demostraste que puedes! 💪`,
        ``,
        `Aquí tienes el enlace para elegir el pack que más te encaje e inscribirte oficialmente:`,
        `👉 https://aprender-aleman.de/inscripciones?ref=${leadId}`,
        ``,
        `Desde el momento en que te inscribas recibirás toda la información de tus clases por correo.`,
        ``,
        `Quedo pendiente por si te surgen dudas 👨‍🏫`,
        ``,
        `Stiv | Aprender-Aleman.de`,
      ].join("\n");

  const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
    kind: "trial_attended_initial",
  });
  if (res.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "system_message_sent",
      author: "gelfis",
      content: `💬 Mensaje motivacional post-clase enviado a ${lead.whatsapp_normalized} (sin enlace de pago)`,
      metadata: { kind: "post_trial_followup", channel: "whatsapp", flow: "no_link" },
    });
  } else {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "send_failed",
      author: "gelfis",
      content: `💬 Falló el mensaje motivacional post-clase: ${res.reason}`,
      metadata: { kind: "post_trial_followup", channel: "whatsapp", flow: "no_link" },
    });
  }

  // Fix Gelfis 2026-06-23: añadir email espejo del WA motivacional. Si
  // el WA falla (Evolution caído / ban), el lead al menos tiene el email.
  // Reuso sendPostTrialFollowupGenericEmail (copy genérico — no menciona
  // pack porque este flow es "no link").
  if (lead?.email) {
    const langForEmail: "es" | "de" = "es";
    const emailRes = await sendTrialAttendedFollowupEmail(lead.email, {
      leadName: firstName || lead.name || "",
      language: langForEmail,
      ctaUrl:   `https://aprender-aleman.de/inscripciones?ref=${leadId}`,
    });
    if (emailRes.ok) {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "system_message_sent",
        author:  "gelfis",
        content: `📧 Email "fue un placer" enviado a ${lead.email} (sin enlace de pago)`,
        metadata: { kind: "post_trial_followup", channel: "email", flow: "no_link" },
      });
    } else {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "send_failed",
        author:  "gelfis",
        content: `📧 Falló el email post-clase: ${emailRes.error ?? "unknown"}`,
        metadata: { kind: "post_trial_followup", channel: "email", flow: "no_link" },
      });
    }
  }

  // Fix Gelfis 2026-08-04: pasar metaLabel mínimo desde leads.meta si
  // existe (setted por markTrialAttendedAwaitingConversion cuando el
  // profe eligió pack antes). Sin él, {meta} caía al fallback y salía
  // "aprender alemán" en el copy — sirve pero pierde personalización.
  const { data: metaRow2 } = await sb
    .from("leads")
    .select("meta")
    .eq("id", leadId)
    .maybeSingle();
  const priorMeta = (metaRow2?.meta && typeof metaRow2.meta === "object")
    ? metaRow2.meta as Record<string, unknown>
    : {};
  const chainMetadata: Record<string, unknown> = {};
  if (typeof priorMeta.last_offered_objective === "string") {
    chainMetadata.objective = priorMeta.last_offered_objective;
  }
  if (typeof priorMeta.last_offered_pack === "string") {
    chainMetadata.packId = priorMeta.last_offered_pack;
  }

  await startChain(leadId, "chain1_attended", chainMetadata)
    .catch(err => console.warn("[markTrialAttendedNoLink] startChain error:", err));
}

/**
 * markTrialAbsent — handler cuando el profe pulsa "No asistió".
 *
 * REGLA AUTHORING_RULES (Gelfis 2026-08-01): los handlers NUNCA envían
 * mensajes directamente. Este handler solo:
 *   1. Cambia el status a trial_absent.
 *   2. Autoasigna closer.
 *   3. Arranca chain4_absent con el flag reserva_prioritaria en metadata.
 *
 * El primer mensaje sale ~20 min después via chain-processor (step 1
 * de chain4_absent, variante deposit/nodeposit). La lag es deliberada
 * — el rescate a 20-30 min convierte mejor que el instantáneo (el
 * lead aún está en lo que le impidió venir) y coincide con la spec
 * del panel closer.
 */
export async function markTrialAbsent(leadId: string): Promise<void> {
  const sb = supabaseAdmin();

  await sb
    .from("leads")
    .update({
      status: "trial_absent",
      // Fuente de verdad para la métrica de asistencia (migration 063).
      trial_absent_at: new Date().toISOString(),
      next_contact_date: null,
    })
    .eq("id", leadId);

  await autoAssignToActiveCloser(leadId, "tipo_b", "teacher_post_trial")
    .catch(err => console.warn("[markTrialAbsent] autoAssign error:", err));

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead did not attend trial — chain4_absent iniciada (T+20min).",
  });

  // Arrancar chain4_absent con flag reserva_prioritaria en metadata.
  // El motor resuelve la variante deposit/nodeposit en resolveTemplateKind.
  const { data: reservaRow } = await sb
    .from("leads")
    .select("reserva_prioritaria")
    .eq("id", leadId)
    .maybeSingle();
  const hasReserva = (reservaRow as { reserva_prioritaria?: boolean } | null)?.reserva_prioritaria === true;
  await startChain(leadId, "chain4_absent", { reserva_prioritaria: hasReserva })
    .catch(err => console.warn("[markTrialAbsent] startChain error:", err));
}

/**
 * Reagendar iniciado por el profesor desde /clasedeprueba (2026-07-24):
 *
 *   1. Cancela la clase de prueba scheduled/futura del lead (silencioso
 *      — sin enviar el mensaje de cancelación del endpoint standard, lo
 *      hacemos con un WA combinado abajo).
 *   2. Envía por WhatsApp un mensaje: cancelé tu clase, elige uno nuevo
 *      aquí <link>.
 *   3. Setea lead.status='rescheduling' — estado limbo hasta que el
 *      lead pase por /agendar/cuando (book-trial vuelve a
 *      status='trial_scheduled' automático).
 *
 * Whitelisted en whatsapp.ts como "trial_reschedule_link".
 * Returns { ok, reason? } — el caller decide qué hacer con el fallo.
 */
export async function sendRescheduleLinkMessage(
  leadId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const sb = supabaseAdmin();
  const { data: leadInfo } = await sb
    .from("leads")
    .select("name, whatsapp_normalized")
    .eq("id", leadId)
    .maybeSingle();
  const linfo = leadInfo as { name: string | null; whatsapp_normalized: string | null } | null;
  if (!linfo?.whatsapp_normalized) return { ok: false, reason: "no_whatsapp" };

  // Cancelar la clase de prueba activa (futura) del lead — si existe.
  // Silencioso (sin mandar el WA cancel standard); el mensaje combinado
  // de abajo cubre la comunicación.
  const nowIso = new Date().toISOString();
  const { data: currentTrial } = await sb
    .from("classes")
    .select("id, scheduled_at")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const trial = currentTrial as { id: string; scheduled_at: string } | null;
  if (trial) {
    await sb.from("classes")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("id", trial.id);
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "status_change",
      author:  "teacher",
      content: `🚫 Clase de prueba cancelada por reagendamiento del profesor (${new Date(trial.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })} Berlín)`,
      metadata: { class_id: trial.id, kind: "trial_cancelled_for_reschedule" },
    });
  }

  // Setear status → rescheduling (nuevo enum value migration 087).
  // book-trial devuelve a 'trial_scheduled' cuando el lead reagenda.
  //
  // reschedule_state: source='teacher' + link_sent_at para que el cron
  // teacher-reschedule-followup dispare FU1 (+8h) y FU2 (+24h).
  const linkSentAt = new Date().toISOString();
  await sb.from("leads").update({
    status:             "rescheduling",
    trial_scheduled_at: null,
    next_contact_date:  null,
    reschedule_state: {
      phase:            "AWAITING_TEACHER_REBOOK",
      source:           "teacher",
      link_sent_at:     linkSentAt,
      started_at:       linkSentAt,
      followup2_sent_at: null,
    },
  }).eq("id", leadId);

  const firstName = (linfo.name || "").split(/\s+/)[0] || linfo.name || "";
  const baseUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const rescheduleUrl = `${baseUrl}/agendar/cuando?lead=${leadId}&from=teacher_reschedule`;

  const waText = `¡Hola ${firstName}! 👋\n\nHe cancelado tu clase de prueba actual. Puedes elegir un nuevo horario con este enlace, tardarás solo 3 minutos:\n\n👉 ${rescheduleUrl}\n\nAvísame cuando hayas elegido tu nuevo horario. 😊\n\n— Stiv · Aprender-Aleman.de`;

  const waRes = await sendWhatsappText(linfo.whatsapp_normalized, waText, { kind: "trial_reschedule_link" });
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    waRes.ok ? "system_message_sent" : "send_failed",
    author:  "gelfis",
    content: waRes.ok
      ? `💬 Reagendamiento enviado a ${linfo.whatsapp_normalized} — lead pasa a 'rescheduling'`
      : `💬 Falló envío del link reagendar: ${waRes.reason ?? "unknown"}`,
    metadata: { kind: "trial_reschedule_link", channel: "whatsapp" },
  });
  // Cancelar cualquier cadena activa (el lead está reagendando, no necesita más follow-ups)
  await cancelActiveChain(leadId, "reschedule")
    .catch(err => console.warn("[sendRescheduleLinkMessage] cancelActiveChain error:", err));

  return waRes.ok ? { ok: true } : { ok: false, reason: waRes.reason ?? "send_failed" };
}

/**
 * Flujo 3b: lead asistió pero tiene una objeción (precio, pensarlo,
 * pareja/familia, tiempo). Arranca la cadena chain3_obj_* correspondiente.
 */
export async function markTrialAttendedWithObjection(
  leadId: string,
  chip: ObjectionChip,
): Promise<void> {
  const sb = supabaseAdmin();

  const { data: metaRow } = await sb
    .from("leads")
    .select("meta")
    .eq("id", leadId)
    .maybeSingle();
  const existingMeta = (metaRow?.meta && typeof metaRow.meta === "object") ? metaRow.meta as Record<string, unknown> : {};

  await sb
    .from("leads")
    .update({
      status: "trial_attended",
      trial_attended_at: new Date().toISOString(),
      meta: {
        ...existingMeta,
        [AWAITING_PAYMENT_KEY]: new Date().toISOString(),
        post_trial_flow: "objection",
        objection_chip: chip,
      },
    })
    .eq("id", leadId);

  await autoAssignToActiveCloser(leadId, "tipo_a", "teacher_post_trial")
    .catch(err => console.warn("[markTrialAttendedWithObjection] autoAssign error:", err));

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "teacher",
    content: `Lead asistió a trial con objeción: ${chip}`,
    metadata: { kind: "trial_attended_objection", chip },
  });

  const chainType = OBJECTION_CHIP_TO_CHAIN[chip];
  await startChain(leadId, chainType, { objection_chip: chip }, { objectionChip: chip })
    .catch(err => console.warn("[markTrialAttendedWithObjection] startChain error:", err));
}
