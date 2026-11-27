// Server-side helpers shared by the /api/admin/* routes.
// Every mutation also writes to lead_timeline so the dashboard has an audit trail.

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";
import { sendPostTrialFollowupEmail, sendPostTrialFollowupGenericEmail, sendTrialAttendedFollowupEmail, sendTrialAbsentFollowupEmail } from "./email/send";
import { getPack, getPackUrlWithOverride, type PackId, type PaymentType } from "./trial-packs";
import { getLeadTrialTeacher } from "./trial-compensation";
import { assignCloserPostTrial } from "./closer-actions";
import { startChain, cancelActiveChain } from "./chain-engine";
import { schedulePostTrialFollowup } from "./post-trial-followups";
import { OBJECTION_CHIP_TO_CHAIN, type ObjectionChip } from "./chain-definitions";
import { buildTeacherRescheduleLeadMessage, teacherRescheduleReasonLabel, type TeacherRescheduleReason } from "./trial-reschedule-reason";
import { formatBerlinFull } from "./time";

/**
 * Tag interno: cuando se setea, Stiv debe escalar a `needs_human` la
 * próxima vez que el lead responda algo (porque le acabamos de mandar
 * el link de pago y cualquier respuesta — "sí", "ya pagué", "tuve un
 * problema" — requiere acción humana). El valor es el timestamp en
 * que se armó el envío.
 */
const AWAITING_PAYMENT_KEY = "awaiting_payment_confirmation_since";

/**
 * Cuando el envío WA del sistema falla por motivos "recuperables"
 * (cap diario del setter V6 agotado, night gate, hourly cap), guardamos
 * el texto exacto + waLink listo en un agent_note tipo "wa_manual_pending".
 * Gelfis puede ver la cola en /api/admin/wa/pending-manual y enviarlos
 * desde su WhatsApp Business sin tener que reconstruir nada.
 *
 * Gelfis 2026-11-17.
 */
function isCapFailure(reason: string | undefined): boolean {
  if (!reason) return false;
  return /^(setter_daily_cap|night_gate|hourly_cap_reached|daily_cap_reached)/.test(reason);
}

async function stashPendingManualWa(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  leadId: string;
  phone: string;
  text: string;
  kind: string;
  reason: string;
}): Promise<void> {
  // Dedupe: si ya hay un wa_manual_pending no enviado para este lead +
  // original_kind en las últimas 24h, no crear otro (evita que el cron
  // genere 5 duplicados por lead al reintentar).
  const existing = await args.sb
    .from("lead_timeline")
    .select("id")
    .eq("lead_id", args.leadId)
    .eq("metadata->>kind", "wa_manual_pending")
    .eq("metadata->>original_kind", args.kind)
    .is("metadata->sent_manual_at", null)
    .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(1);
  if ((existing.data?.length ?? 0) > 0) return;
  const phoneNoPlus = args.phone.replace(/^\+/, "");
  const waLink = `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${encodeURIComponent(args.text)}`;
  await args.sb.from("lead_timeline").insert({
    lead_id: args.leadId,
    type:    "agent_note",
    author:  "gelfis",
    content: `📋 WA auto bloqueado (${args.reason}) — preparado para envío manual desde WhatsApp Business`,
    metadata: {
      kind: "wa_manual_pending",
      channel: "whatsapp",
      original_kind: args.kind,
      phone: args.phone,
      text: args.text,
      wa_link: waLink,
      reason: args.reason,
    },
  });
}

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
    .select("name, language, whatsapp_normalized, email, trial_attended_at")
    .eq("id", leadId)
    .maybeSingle();
  const lead = (leadRow ?? null) as {
    name: string | null; language: "es" | "de" | null;
    whatsapp_normalized: string | null; email: string | null;
    trial_attended_at: string | null;
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
      // NO se pisa si ya existe: el bono de 48h y la rotación del closer
      // cuelgan de la hora original (un re-envío de oferta la reseteaba).
      trial_attended_at: lead?.trial_attended_at ?? new Date().toISOString(),
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

  // CRM Closer F2 (Gelfis 2026-11-25, revierte la regla 2026-08-13):
  // rotación automática SIN cadencia; el closer espera a la tarea de 24h.
  await assignCloserPostTrial(leadId, "trial_attended").catch((e) =>
    console.warn("[markTrialAttended] assignCloserPostTrial:", e instanceof Error ? e.message : e));

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

  // Copy Gelfis 2026-11-15 — Msg 1 "Enviar enlace de inscripción".
  // Tono directo (lead ya pidió el link) + bono 134€ como refuerzo.
  // Unificamos las 3 variantes: el enlace puede venir de opts (pack
  // específico del profe) o del fallback (/inscripciones?ref=leadId).
  const packLink = opts
    ? (opts.fullUrl || getPackUrlWithOverride(opts.packId, opts.paymentType) || `https://aprender-aleman.de/inscripciones?ref=${leadId}`)
    : `https://aprender-aleman.de/inscripciones?ref=${leadId}`;
  const text = [
    `Hola ${firstName} 🙌`,
    ``,
    `Aquí tienes el enlace para inscribirte oficialmente`,
    `en la academia Aprender-Aleman.de:`,
    `👉 ${packLink}`,
    ``,
    `Si te inscribes en las próximas 48 horas,`,
    `activas tu 🎁 BONUS DE ACCIÓN RÁPIDA (valor 120 €):`,
    ``,
    `✅ Clase extra de conversación`,
    `✅ Acceso a la Serie (10 capítulos exclusivos)`,
    `✅ Guía "Tus primeras 30 frases en alemán"`,
    ``,
    `⏱️ Los que deciden rápido, avanzan rápido.`,
    ``,
    `¿Dudas con el pago o alguna opción? Escríbenos`,
    `por aquí y te ayudamos 😊`,
  ].join("\n");

  // Gelfis 2026-11-05 (Fase 1.5 migración v6): el follow-up post-clase
  // lleva el enlace de inscripción y es el disparador de chain2_link_sent.
  // Sale por el número setter calentado (v6) — bypassa el kill switch del
  // v5 castigado y mantiene la conversación en el mismo hilo en el que ya
  // le llegó la confirmación / recordatorios del trial.
  const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
    kind: opts ? "trial_inscription_initial" : "trial_attended_initial",
    channel: "setter",
    leadId,
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
      metadata: { kind: "post_trial_followup", channel: "whatsapp", reason: res.reason },
    });
    if (isCapFailure(res.reason) && lead.whatsapp_normalized) {
      await stashPendingManualWa({
        sb, leadId, phone: lead.whatsapp_normalized, text,
        kind: opts ? "trial_inscription_initial" : "trial_attended_initial",
        reason: res.reason ?? "unknown",
      }).catch(() => {});
    }
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

  // Gelfis 2026-11-15: chain2_link_sent desactivada. En su lugar,
  // agendamos UN ÚNICO follow-up +24h (post_trial_followups queue)
  // con dedup por respuesta del lead / conversión / nueva acción.
  await schedulePostTrialFollowup({
    leadId,
    kind: "enviar_enlace",
    context: opts ? {
      packId: opts.packId,
      paymentType: opts.paymentType,
      packLink,
    } : { packLink },
  }).catch(err => console.warn("[markTrialAttended] schedule followup error:", err));
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

  // CRM Closer F2 (Gelfis 2026-11-25): rotación automática sin cadencia.
  await assignCloserPostTrial(leadId, "trial_attended").catch((e) =>
    console.warn("[markTrialAttendedNoLink] assignCloserPostTrial:", e instanceof Error ? e.message : e));

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

  // Copy Gelfis 2026-11-15 — Msg 1 "Asistió" (bono acción rápida).
  // Enlace al plan personalizado + stack Grand Slam + CTA soft.
  const planUrl = `https://aprender-aleman.de/inscripciones?ref=${leadId}`;
  const text = lead.language === "de"
    ? [
        `Hallo ${firstName} 🎉`,
        ``,
        `Mir wurde gesagt, dass deine Probestunde ein Erfolg war.`,
        ``,
        `Wie versprochen: Du hast 48 Stunden, um deinen`,
        `🎁 BONUS FÜR SCHNELL ENTSCHLOSSENE zu aktivieren — alles GRATIS,`,
        `wenn du dich für deinen Plan entscheidest:`,
        ``,
        `✅ Zusätzliche Konversationsstunde`,
        `✅ Zugang zur Serie (10 exklusive Kapitel)`,
        `✅ Leitfaden "Deine ersten 30 Sätze auf Deutsch"`,
        ``,
        `Gesamtwert: 120 € — gratis, wenn du innerhalb von 48 h entscheidest.`,
        ``,
        `⏱️ Wer schnell entscheidet, kommt schnell voran.`,
        ``,
        `Hier siehst du alle Infos, wählst die passende Option und schreibst dich offiziell ein:`,
        `👉 ${planUrl}`,
        ``,
        `Brauchst du Hilfe oder hast Fragen? Schreib uns hier 😊`,
      ].join("\n")
    : [
        `Hola ${firstName} 🎉`,
        ``,
        `Me cuentan que tu clase de prueba fue un éxito.`,
        ``,
        `Lo prometido: tienes 48 horas para activar tu`,
        `🎁 BONUS DE ACCIÓN RÁPIDA — todo esto GRATIS si`,
        `decides continuar con tu plan:`,
        ``,
        `✅ Clase extra de conversación`,
        `✅ Acceso a la Serie (10 capítulos exclusivos)`,
        `✅ Guía "Tus primeras 30 frases en alemán"`,
        ``,
        `Valor total: 120 € — gratis si decides en 48 h.`,
        ``,
        `⏱️ Los que deciden rápido, avanzan rápido.`,
        ``,
        `Aquí puedes ver toda la información, decidir cuál opción te encaja mejor e inscribirte oficialmente:`,
        `👉 ${planUrl}`,
        ``,
        `¿Necesitas ayuda o tienes dudas? Escríbenos por aquí 😊`,
      ].join("\n");

  // Gelfis 2026-11-05 (Fase 1.5 migración v6): mismo criterio que el
  // follow-up con link — sale por el número setter (v6) para bypassar el
  // kill switch del v5 y mantener la conversación en un solo hilo.
  const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
    kind: "trial_attended_initial",
    channel: "setter",
    leadId,
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
      metadata: { kind: "post_trial_followup", channel: "whatsapp", flow: "no_link", reason: res.reason },
    });
    if (isCapFailure(res.reason) && lead.whatsapp_normalized) {
      await stashPendingManualWa({
        sb, leadId, phone: lead.whatsapp_normalized, text,
        kind: "trial_attended_initial",
        reason: res.reason ?? "unknown",
      }).catch(() => {});
    }
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

  // Gelfis 2026-11-15: chain1_attended desactivada. Reemplazada por
  // un único follow-up +24h en post_trial_followups.
  await schedulePostTrialFollowup({
    leadId,
    kind: "asistio",
    context: { planUrl },
  }).catch(err => console.warn("[markTrialAttendedNoLink] schedule followup error:", err));
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

  const { data: leadRow } = await sb
    .from("leads")
    .select("name, language, whatsapp_normalized, email, reserva_prioritaria")
    .eq("id", leadId)
    .maybeSingle();
  const lead = (leadRow ?? null) as {
    name: string | null; language: "es" | "de" | null;
    whatsapp_normalized: string | null; email: string | null;
    reserva_prioritaria: boolean | null;
  } | null;

  await sb
    .from("leads")
    .update({
      status: "trial_absent",
      // Fuente de verdad para la métrica de asistencia (migration 063).
      trial_absent_at: new Date().toISOString(),
      next_contact_date: null,
    })
    .eq("id", leadId);

  // CRM Closer F2 (Gelfis 2026-11-25): los no-shows entran por la misma
  // rotación al marcarse la ausencia.
  await assignCloserPostTrial(leadId, "trial_absent").catch((e) =>
    console.warn("[markTrialAbsent] assignCloserPostTrial:", e instanceof Error ? e.message : e));

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead did not attend trial — WA inmediato + chain4 desactivada (Gelfis 2026-11-15).",
  });

  // Copy Gelfis 2026-11-15 — Msg 1 "No asistió" (envío inmediato,
  // no esperamos los 20 min que usaba chain4). Enlace de reagenda +
  // puerta de salida educada.
  if (lead?.whatsapp_normalized) {
    const firstName = (lead.name || "").split(/\s+/)[0] || "";
    const baseUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
    const rescheduleUrl = `${baseUrl}/agendar/cuando?lead=${leadId}&from=no_show`;
    const text = [
      `Hola ${firstName} 👋`,
      ``,
      `No pudimos conectarnos contigo hoy en la clase.`,
      ``,
      `Sin problema — pasan cosas. Elige otra fecha aquí`,
      `y te mantenemos el espacio:`,
      `👉 ${rescheduleUrl}`,
      ``,
      `Si prefieres cancelar, dímelo por aquí y lo gestiono.`,
    ].join("\n");
    const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
      kind: "trial_absent_initial",
      channel: "setter",
      leadId,
    });
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    res.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: res.ok
        ? `💬 Msg "No asistió" enviado a ${lead.whatsapp_normalized}`
        : `💬 Falló Msg "No asistió": ${res.reason}`,
      metadata: { kind: "trial_absent_initial", channel: "whatsapp", reason: res.ok ? undefined : res.reason },
    });
    if (!res.ok && isCapFailure(res.reason)) {
      await stashPendingManualWa({
        sb, leadId, phone: lead.whatsapp_normalized, text,
        kind: "trial_absent_initial",
        reason: res.reason ?? "unknown",
      }).catch(() => {});
    }
  }

  // Gelfis 2026-11-15: chain4_absent desactivada. Follow-up único +24h
  // via post_trial_followups queue (dedup si lead responde/convierte).
  const baseUrlForQueue = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  await schedulePostTrialFollowup({
    leadId,
    kind: "no_asistio",
    context: { rescheduleUrl: `${baseUrlForQueue}/agendar/cuando?lead=${leadId}&from=no_show` },
  }).catch(err => console.warn("[markTrialAbsent] schedule followup error:", err));
  void lead?.reserva_prioritaria;
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
  opts?: {
    actorName?: string;
    /** "setter": copy "como hablamos, aquí te envío el enlace…" — el
     *  setter acaba de hablar con el lead por teléfono (Gelfis 2026-10-24).
     *  "closer": copy editable desde system_config (CRM Closer F4,
     *  clave closer_copy_reagenda — ver lib/config-copys.ts). */
    copy?: "setter" | "closer";
    /** Si true: no enviar por Evolution. Devolver waText + waLink para
     *  que el setter lo mande manualmente desde su WhatsApp Web (post-bans
     *  v5/v6, Gelfis 2026-11-14). El email fallback sigue activo. */
    manualWa?: boolean;
    /** Motivo elegido por el profe al pulsar "Reagendar" (Gelfis 2026-11-24).
     *  Cambia el mensaje al lead y queda en el historial y en la clase.
     *  `note` (motivo escrito de "no puedo dar la clase") NO viaja al lead. */
    teacherReason?: {
      reason: TeacherRescheduleReason;
      note?: string | null;
      teacherFirstName?: string | null;
    };
  },
): Promise<{ ok: boolean; reason?: string; waSent?: boolean; emailSent?: boolean; pendingManual?: boolean; waText?: string; waLink?: string }> {
  const actorName = opts?.actorName ?? "teacher";
  const sb = supabaseAdmin();
  const { data: leadInfo } = await sb
    .from("leads")
    .select("name, whatsapp_normalized, email, language")
    .eq("id", leadId)
    .maybeSingle();
  const linfo = leadInfo as {
    name: string | null; whatsapp_normalized: string | null;
    email: string | null; language: "es" | "de" | null;
  } | null;
  // Caso 2026-09-09 (número sin WhatsApp, Evolution exists:false): el
  // link debe poder viajar por email como fallback — solo abortamos si
  // el lead no tiene NINGÚN canal.
  if (!linfo?.whatsapp_normalized && !linfo?.email) {
    return { ok: false, reason: "El lead no tiene WhatsApp ni email registrados." };
  }

  const nowIso = new Date().toISOString();
  const { data: currentTrial } = await sb
    .from("classes")
    .select("id, scheduled_at, teacher_id, google_calendar_event_id")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const trial = currentTrial as { id: string; scheduled_at: string; teacher_id: string | null; google_calendar_event_id: string | null } | null;
  const tr = opts?.teacherReason ?? null;
  const trNote = tr?.note?.trim() || null;
  if (trial) {
    const motivoTxt = tr
      ? ` — motivo: ${teacherRescheduleReasonLabel(tr.reason)}${trNote ? ` («${trNote}»)` : ""}`
      : "";
    await sb.from("classes")
      .update({
        status: "cancelled", updated_at: nowIso,
        ...(tr ? { notes_admin: `Reagendada por ${actorName} el ${nowIso.slice(0, 10)}${motivoTxt}` } : {}),
      })
      .eq("id", trial.id);
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "status_change",
      author:  actorName,
      content: `🚫 Clase de prueba cancelada por reagendamiento (${actorName}) (${new Date(trial.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })} Berlín)${motivoTxt}`,
      metadata: {
        class_id: trial.id, kind: "trial_cancelled_for_reschedule", actor: actorName,
        ...(tr ? { reschedule_reason: tr.reason, reschedule_note: trNote } : {}),
      },
    });

    // Eliminar espejos de Google Calendar (central + profe). El helper
    // borra ambos y limpia las columnas — cubre teacher_gcal_event_id
    // que el deleteTrialEvent inline no tocaba (Gelfis 2026-09-02).
    {
      const { removeTeacherCalendarEvents } = await import("./teacher-calendar-sync");
      // AWAITED (fix Ricardo 2026-10-26): fire-and-forget muere congelado
      // en Vercel y el evento queda huérfano en el calendario del profe.
      await removeTeacherCalendarEvents([trial.id]).catch(() => {});
    }

    // Notificar al profesor in-app si el que reagenda NO es el propio profesor
    if (trial.teacher_id) {
      const { data: teacherRow } = await sb
        .from("teachers")
        .select("user_id")
        .eq("id", trial.teacher_id)
        .maybeSingle();
      const teacherUserId = (teacherRow as { user_id: string } | null)?.user_id;
      if (teacherUserId) {
        const leadName = (linfo.name || "").split(/\s+/)[0] || linfo.name || "Lead";
        const whenTxt = new Date(trial.scheduled_at).toLocaleString("es-ES", {
          timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit",
        });
        await sb.from("notifications").insert({
          user_id:  teacherUserId,
          type:     "class_cancelled",
          title:    `Clase de ${leadName} reagendada`,
          body:     `${actorName} reagendó la clase del ${whenTxt} (Berlín). El lead recibirá un link para elegir nuevo horario.`,
          link:     "/profesor/clasedeprueba",
          class_id: trial.id,
        }).then(() => {}, () => {});
      }
    }
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

  // Copy Gelfis 2026-11-15 — Msg 1 "Reagendar" (profe/setter marca).
  // Tono corto, directo al link + cierre con dream outcome.
  // Desde 2026-11-24, si el profe indicó el motivo (y había una clase
  // futura que liberar), el lead recibe el copy de ese motivo.
  const waText = tr && trial
    ? buildTeacherRescheduleLeadMessage({
        reason:           tr.reason,
        leadFirstName:    firstName,
        teacherFirstName: tr.teacherFirstName ?? null,
        whenText:         formatBerlinFull(trial.scheduled_at, "es"),
        rescheduleUrl,
      })
    : opts?.copy === "closer"
    ? await (async () => {
        const { getCloserReagendaCopy } = await import("./config-copys");
        return getCloserReagendaCopy({ nombre: firstName, enlace: rescheduleUrl });
      })()
    : [
    `Hola ${firstName} 👋`,
    ``,
    `Tu clase quedó liberada. Elige nueva fecha aquí`,
    `y te mantenemos el espacio:`,
    `👉 ${rescheduleUrl}`,
    ``,
    `Mientras antes agendes, más pronto sales con`,
    `tu plan personalizado para alcanzar tus`,
    `objetivos con el alemán.`,
  ].join("\n");

  let waOk = false;
  let waReason: string | null = null;
  // Manual-WA (Gelfis 2026-11-14): el setter copia el texto y lo manda
  // desde su propio WhatsApp Web. No llamamos a Evolution.
  const manualWa = opts?.manualWa === true;
  let waLink: string | null = null;
  if (manualWa && linfo.whatsapp_normalized) {
    const phone = linfo.whatsapp_normalized.replace(/^\+/, "");
    waLink = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(waText)}`;
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "agent_note",
      author:  opts?.actorName ?? "setter",
      content: `✍️ Reagendamiento preparado para enviar manualmente por WhatsApp a ${linfo.whatsapp_normalized}`,
      metadata: { kind: "setter_wa_pending_manual", channel: "whatsapp" },
    });
  } else if (linfo.whatsapp_normalized) {
    const waRes = await sendWhatsappText(linfo.whatsapp_normalized, waText, {
      kind: "trial_reschedule_link",
      // El setter envía por su propio canal (número en warm-up).
      ...(opts?.copy === "setter" ? { channel: "setter" as const } : {}),
      leadId,
    });
    waOk = waRes.ok;
    waReason = waRes.ok ? null : (waRes.reason ?? "unknown");
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    waRes.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: waRes.ok
        ? `💬 Reagendamiento enviado a ${linfo.whatsapp_normalized} — lead pasa a 'rescheduling'`
        : `💬 Falló envío del link reagendar: ${waReason}`,
      metadata: { kind: "trial_reschedule_link", channel: "whatsapp", reason: waReason ?? undefined },
    });
    if (!waRes.ok && isCapFailure(waReason ?? undefined)) {
      await stashPendingManualWa({
        sb, leadId, phone: linfo.whatsapp_normalized, text: waText,
        kind: "trial_reschedule_link",
        reason: waReason ?? "unknown",
      }).catch(() => {});
    }
  }

  // Fallback a email si el WA falló o no hay número (caso 2026-09-09:
  // número sin cuenta de WhatsApp — la clase ya está cancelada y el
  // lead en 'rescheduling', así que el link TIENE que llegarle).
  // En flujo manual: el email SIEMPRE se envía automático (respaldo
  // por si el setter no llega a mandar el WA).
  let emailOk = false;
  if ((!waOk || manualWa) && linfo.email) {
    try {
      const { sendTrialCancelledEmail, sendRaw } = await import("./email/send");
      // Con motivo del profe (Gelfis 2026-11-27): el email lleva el mismo
      // mensaje que el WhatsApp de ese motivo. Sin motivo → el genérico.
      const res = tr && trial
        ? await (async () => {
            const { renderTeacherRescheduleEmail } = await import("./email/templates/trial-teacher-reschedule");
            const m = renderTeacherRescheduleEmail({
              reason:           tr.reason,
              leadName:         firstName,
              teacherFirstName: tr.teacherFirstName ?? null,
              whenText:         formatBerlinFull(trial.scheduled_at, "es"),
              rescheduleUrl,
            });
            return sendRaw(linfo.email!, m.subject, m.html, m.text);
          })()
        : await sendTrialCancelledEmail(linfo.email, {
            leadName: firstName,
            language: linfo.language === "de" ? "de" : "es",
            rescheduleUrl,
          });
      emailOk = res.ok;
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    res.ok ? "system_message_sent" : "send_failed",
        author:  "gelfis",
        content: res.ok
          ? `📧 Link de reagendar enviado por email a ${linfo.email} (fallback — WA: ${waReason ?? "sin número"})`
          : `📧 Falló también el email del link reagendar: ${"error" in res ? res.error : "unknown"}`,
        metadata: { kind: "trial_reschedule_link", channel: "email" },
      });
    } catch (e) {
      console.error("[sendRescheduleLinkMessage] email fallback failed:", e);
    }
  }

  // Cancelar cualquier cadena activa (el lead está reagendando, no necesita más follow-ups)
  await cancelActiveChain(leadId, "reschedule")
    .catch(err => console.warn("[sendRescheduleLinkMessage] cancelActiveChain error:", err));

  // Gelfis 2026-11-15: agendar follow-up +24h "reagendar" en la cola nueva.
  // Si el lead eligió nueva fecha, el cron detectará reply/booking y cancelará.
  await schedulePostTrialFollowup({
    leadId,
    kind: "reagendar",
    context: { rescheduleUrl },
  }).catch(err => console.warn("[sendRescheduleLinkMessage] schedule followup error:", err));

  if (manualWa) {
    return {
      ok: true,
      waSent: false,
      emailSent: emailOk,
      pendingManual: !!waLink,
      waText,
      waLink: waLink ?? undefined,
    };
  }
  if (waOk || emailOk) return { ok: true, waSent: waOk, emailSent: emailOk };
  const noWa = !linfo.whatsapp_normalized;
  const waMsg = /exists.*false|http_400/i.test(waReason ?? "")
    ? "el número no tiene cuenta de WhatsApp"
    : `WhatsApp falló (${waReason ?? "sin número"})`;
  return {
    ok: false,
    reason: `No se pudo enviar el link: ${noWa ? "sin número de WhatsApp" : waMsg}` +
            (linfo.email ? " y el email también falló." : " y el lead no tiene email."),
  };
}

/**
 * Reagendar una Sesión de Plan-Alemán (videollamada con closer).
 *
 * Gemelo de sendRescheduleLinkMessage pero para sesiones del closer:
 *   1. Cancela la sesión actual (classes con sesion_closer_id).
 *   2. Elimina evento de Google Calendar del closer.
 *   3. Envía WA con link a /sesion-plan/funnel para re-agendar.
 *   4. Cancela cadenas activas.
 *
 * El funnel hace upsert por email/WhatsApp — el lead no se duplica.
 */
export async function sendSesionRescheduleLinkMessage(
  leadId: string,
  opts?: {
    actorName?: string;
    /** "setter": copy "como hablamos…" — el setter acaba de llamar al lead. */
    copy?: "setter";
  },
): Promise<{ ok: boolean; reason?: string; waSent?: boolean; emailSent?: boolean }> {
  const actorName = opts?.actorName ?? "closer";
  const sb = supabaseAdmin();

  const { data: leadInfo } = await sb
    .from("leads")
    .select("name, whatsapp_normalized")
    .eq("id", leadId)
    .maybeSingle();
  const linfo = leadInfo as { name: string | null; whatsapp_normalized: string | null } | null;
  if (!linfo?.whatsapp_normalized) return { ok: false, reason: "no_whatsapp" };

  const nowIso = new Date().toISOString();
  const { data: currentSesion } = await sb
    .from("classes")
    .select("id, scheduled_at, sesion_closer_id, closer_gcal_event_id")
    .eq("lead_id", leadId)
    .not("sesion_closer_id", "is", null)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const sesion = currentSesion as {
    id: string; scheduled_at: string;
    sesion_closer_id: string | null; closer_gcal_event_id: string | null;
  } | null;

  if (sesion) {
    await sb.from("classes")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("id", sesion.id);
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "status_change",
      author:  actorName,
      content: `🚫 Sesión de plan cancelada por reagendamiento (${actorName}) (${new Date(sesion.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })} Berlín)`,
      metadata: { class_id: sesion.id, kind: "sesion_cancelled_for_reschedule", actor: actorName },
    });

    if (sesion.closer_gcal_event_id && sesion.sesion_closer_id) {
      const { deleteSesionEventForCloser } = await import("./closer-calendar-sync");
      deleteSesionEventForCloser(sesion.sesion_closer_id, sesion.closer_gcal_event_id).catch(() => {});
    }

    // Aviso al closer asignado del cancel (Gelfis 2026-08-19). No
    // tenemos user_id del actor aquí — solo el nombre; el helper no
    // puede filtrar por identidad. Aceptable: si el closer se cancela
    // a sí mismo, recibe un email confirmando lo que acaba de hacer.
    const { notifyCloserSesionChanged } = await import("./assignee-notifications");
    void notifyCloserSesionChanged({
      sesionId:     sesion.id,
      kind:         "cancelled",
      previousDate: sesion.scheduled_at,
      actorUserId:  null,
      actorLabel:   `${actorName} (via link reagenda)`,
    });
  }

  await sb.from("leads").update({
    sesion_plan_at: null,
  }).eq("id", leadId);

  const firstName = (linfo.name || "").split(/\s+/)[0] || linfo.name || "";
  const baseUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const sesionUrl = `${baseUrl}/sesion-plan/funnel`;

  const waText = opts?.copy === "setter"
    ? `¡Hola ${firstName}! 👋\n\nComo hablamos, aquí te envío el enlace para que reagendes tu sesión de plan de alemán — eliges tu nuevo horario en un momento:\n\n👉 ${sesionUrl}\n\nEs una videollamada de 25 minutos donde veremos tu plan personalizado. Avísame cuando lo tengas. 😊\n\n— Aprender-Aleman.de`
    : sesion
    ? `¡Hola ${firstName}! 👋\n\nHe cancelado tu sesión de plan actual. Puedes elegir un nuevo horario con este enlace:\n\n👉 ${sesionUrl}\n\nEs una videollamada de 25 minutos donde veremos tu plan personalizado de alemán. Avísame cuando hayas elegido tu nuevo horario. 😊\n\n— Aprender-Aleman.de`
    : `¡Hola ${firstName}! 👋\n\nTe comparto el enlace para agendar tu sesión de plan de alemán — eliges tu horario en un momento:\n\n👉 ${sesionUrl}\n\nEs una videollamada de 25 minutos donde veremos tu plan personalizado. 😊\n\n— Aprender-Aleman.de`;

  const waRes = await sendWhatsappText(linfo.whatsapp_normalized, waText, {
    kind: "sesion_reschedule_link",
    // El setter envía por su propio canal (número en warm-up).
    ...(opts?.copy === "setter" ? { channel: "setter" as const } : {}),
    leadId,
  });
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    waRes.ok ? "system_message_sent" : "send_failed",
    author:  actorName,
    content: waRes.ok
      ? `💬 Reagendamiento de sesión enviado a ${linfo.whatsapp_normalized}`
      : `💬 Falló envío del link reagendar sesión: ${waRes.reason ?? "unknown"}`,
    metadata: { kind: "sesion_reschedule_link", channel: "whatsapp" },
  });

  await cancelActiveChain(leadId, "sesion_reschedule")
    .catch(err => console.warn("[sendSesionRescheduleLinkMessage] cancelActiveChain error:", err));

  return waRes.ok
    ? { ok: true, waSent: true, emailSent: false }
    : { ok: false, reason: waRes.reason ?? "send_failed", waSent: false, emailSent: false };
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

  // CRM Closer F2 (Gelfis 2026-11-25): rotación automática sin cadencia.
  await assignCloserPostTrial(leadId, "trial_attended").catch((e) =>
    console.warn("[markTrialAttendedWithObjection] assignCloserPostTrial:", e instanceof Error ? e.message : e));

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "teacher",
    content: `Lead asistió a trial con objeción: ${chip}`,
    metadata: { kind: "trial_attended_objection", chip },
  });

  const chainType = OBJECTION_CHIP_TO_CHAIN[chip];
  await startChain(leadId, chainType, { objection_chip: chip }, { objectionChip: chip, bypassGateOnStart: true })
    .catch(err => console.warn("[markTrialAttendedWithObjection] startChain error:", err));
}
