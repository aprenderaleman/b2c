// Server-side helpers shared by the /api/admin/* routes.
// Every mutation also writes to lead_timeline so the dashboard has an audit trail.

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";
import { sendPostTrialFollowupEmail, sendPostTrialFollowupGenericEmail, sendTrialAttendedFollowupEmail, sendTrialAbsentFollowupEmail } from "./email/send";
import { getPack, getPackUrlWithOverride, type PackId, type PaymentType } from "./trial-packs";
import { getLeadTrialTeacher } from "./trial-compensation";
import { renderTemplate } from "./message-stats";

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
  await sb.from("leads").update({ status: "converted", next_contact_date: null }).eq("id", leadId);
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
  objective:   string;      // free-text — lo que el lead nos contó en clase
  packId:      PackId;
  paymentType: PaymentType; // "single" (pago único) | "flexible" (mensualidades)
  nivel?:      string;      // nivel del pack (ej. "A1", "B1") — para el copy del WA
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
  // +2 días desde el envío del Mensaje 1. La cadena post-clase ahora
  // tiene 3 mensajes en total (1 inmediato + 2 en +2d y +3d) procesada
  // por /api/cron/post-trial-followups. Antes era +24h con un único
  // follow-up vía Python; ahora todo es TS para mantener el copy en un
  // solo sitio y poder mandar email en los pasos que lo necesitan.
  const followupAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

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

  if (opts) {
    const pack     = getPack(opts.packId);
    const packLink = getPackUrlWithOverride(opts.packId, opts.paymentType);
    const packName = pack?.name ?? opts.packId;

    // Si hay un override activo en message_templates para el kind
    // 'post_trial_followup' canal whatsapp, lo usamos. Si no, caemos
    // al copy hardcoded de abajo. Editor: /admin/mensajes.
    const { data: tplRow } = await sb
      .from("message_templates")
      .select("body, active")
      .eq("kind", "post_trial_followup")
      .eq("channel", "whatsapp")
      .eq("active", true)
      .maybeSingle();
    if (tplRow && (tplRow as { body?: string }).body) {
      text = renderTemplate((tplRow as { body: string }).body, {
        firstName,
        objective: opts.objective,
        packName,
        packLink: packLink || "",
      });
    } else {
    // Copy fijo aprobado por Gelfis. NO modificar el wording sin pedirle
    // antes — el equipo lo usa palabra por palabra.
    // Copy Mensaje 1 — aprobado por Gelfis 08/06.
    const nivelLabel = opts.nivel ? ` · Nivel ${opts.nivel}` : "";
    text = lead.language === "de"
      ? [
          `Hallo ${firstName}! 😊`,
          ``,
          `Schön, dass du den Schritt machst! Hier ist dein Anmeldelink für das ${packName}${nivelLabel}:`,
          `👉 ${packLink || "(Ich schicke dir den Link gleich nach.)"}`,
          ``,
          `Es dauert nur 5 Minuten. Sag mir Bescheid, sobald du fertig bist. 😊`,
          ``,
          `Stiv | Aprender-Aleman.de`,
        ].join("\n")
      : [
          `¡Hola ${firstName}! 😊`,
          ``,
          `Me alegra que hayas decidido dar el paso. Aquí tienes el enlace para formalizar tu inscripción en el ${packName}${nivelLabel}:`,
          `👉 ${packLink || "(Te paso el enlace en breve.)"}`,
          ``,
          `Solo tardará 5 minutos. Avísame cuando lo hayas completado. 😊`,
          ``,
          `Stiv | Aprender-Aleman.de`,
        ].join("\n");
    }  // fin del else del template-override
  } else {
    // Fallback (sin pack/objetivo seleccionado) — mensaje genérico de antes.
    text = lead.language === "de"
      ? `Hallo ${firstName}! 😊\n\nDanke, dass du in deiner Probestunde dabei warst! Wie hat es dir gefallen?\n\nWenn du weitermachen möchtest, kann ich dir einen persönlichen Plan mit Zeiten und Preis vorbereiten — sag mir einfach Bescheid.\n\nStiv, Aprender-Aleman.de`
      : `¡Hola ${firstName}! 😊\n\n¡Gracias por asistir a tu clase de prueba de alemán!\n\n¿Qué te pareció? Si te interesa avanzar, te preparo un plan personalizado con horarios y precio exacto — dime cuando quieras seguir.\n\nStiv, Aprender-Aleman.de`;
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
    const langForEmail: "es" | "de" = lead.language === "de" ? "de" : "es";
    const ctaUrl = opts
      ? (getPackUrlWithOverride(opts.packId, opts.paymentType) ?? "https://aprender-aleman.de/inscripciones")
      : "https://aprender-aleman.de/inscripciones";
    const packName = opts ? (getPack(opts.packId)?.name ?? opts.packId) : undefined;
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
        `👉 https://aprender-aleman.de/inscripciones`,
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
    const langForEmail: "es" | "de" = lead.language === "de" ? "de" : "es";
    const emailRes = await sendTrialAttendedFollowupEmail(lead.email, {
      leadName: firstName || lead.name || "",
      language: langForEmail,
      ctaUrl:   "https://aprender-aleman.de/inscripciones",
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
}

export async function markTrialAbsent(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  // Fix Gelfis 2026-07-21: NO seteamos next_contact_date. El cron
  // Python tick_absent_followups (agent_5_guardian.py) usa ese campo
  // para disparar la cadena legacy D+1/D+3/D+5/D+7, y esos mensajes
  // DUPLICAN el WA/email que ya mandamos aquí abajo (nuevo flow
  // absent-interest con botones SÍ/NO). Sin next_contact_date, el
  // cron nunca detecta al lead y no hay duplicado.
  await sb
    .from("leads")
    .update({
      status: "trial_absent",
      // Fuente de verdad para la métrica de asistencia (migration 063).
      trial_absent_at: new Date().toISOString(),
      next_contact_date: null,
    })
    .eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead did not attend trial — absent-interest flow initiated (SÍ/NO).",
  });

  // Email "no te vimos hoy" + WA inmediato con botón a /agendar/cuando.
  // Antes solo se mandaban 3 WA via cron tick_absent_followups — pero
  // con WA inestable y la migración a Cloud API en curso, el email
  // inmediato es el camino más confiable. El WA es uno de los 5
  // mensajes permitidos en modo restringido (kind=trial_absent_initial).
  const { data: leadInfo } = await sb
    .from("leads")
    .select("name, email, language, whatsapp_normalized")
    .eq("id", leadId)
    .maybeSingle();
  const linfo = leadInfo as { name: string | null; email: string | null; language: "es"|"de"|null; whatsapp_normalized: string | null } | null;
  const baseUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const rescheduleUrl = `${baseUrl}/agendar/cuando?lead=${leadId}&from=trial_absent`;

  // Gelfis 2026-07-16: nuevo flujo — NO enviamos link directo; primero
  // preguntamos si sigue interesado. Si responde SÍ → link, si NO →
  // cierre + lost. La detección de SÍ/NO la hace reschedule_flow.py
  // (Python) usando el state AWAITING_ABSENT_INTEREST que seteamos aquí.
  if (linfo?.whatsapp_normalized || linfo?.email) {
    const nowIso = new Date().toISOString();
    await sb.from("leads").update({
      reschedule_state: {
        phase: "AWAITING_ABSENT_INTEREST",
        lead_id: leadId,
        started_at: nowIso,
      },
    }).eq("id", leadId);
  }

  if (linfo?.whatsapp_normalized) {
    const firstName = (linfo.name || "").split(/\s+/)[0] || linfo.name || "";
    const waText = linfo.language === "de"
      ? `Hallo ${firstName}! 👋\n\nWir waren heute für deine Probestunde bereit, konnten dich aber nicht erreichen. Kein Stress — sowas passiert.\n\nHast du weiterhin echtes Interesse daran, Deutsch zu lernen? 🇩🇪\n\nWenn du mir mit JA antwortest, schicke ich dir den Link zum Umbuchen. Wenn du lieber Schluss machst, sag NEIN und ich schreibe dir nicht mehr.\n\n— Stiv · Aprender-Aleman.de`
      : `¡Hola ${firstName}! 👋\n\nHoy estábamos preparados para tu clase de prueba pero no pudimos conectarnos contigo. Sin problema — sé que pasan cosas.\n\n¿Sigues teniendo interés real en aprender alemán? 🇩🇪\n\nSi me dices que SÍ, te paso el enlace para que reagendemos y no perdamos la oportunidad. Si prefieres dejarlo aquí, dime NO y no te sigo escribiendo.\n\n— Stiv · Aprender-Aleman.de`;
    const waRes = await sendWhatsappText(linfo.whatsapp_normalized, waText, { kind: "trial_absent_initial" });
    if (waRes.ok) {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "system_message_sent",
        author:  "gelfis",
        content: `💬 WA "no te vimos hoy" enviado a ${linfo.whatsapp_normalized}`,
        metadata: { kind: "absent_followup", channel: "whatsapp" },
      });
    } else {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "send_failed",
        author:  "gelfis",
        content: `💬 Falló WA absent followup: ${waRes.reason ?? "unknown"}`,
        metadata: { kind: "absent_followup", channel: "whatsapp" },
      });
    }
  }

  if (linfo?.email) {
    const firstName = (linfo.name || "").split(/\s+/)[0] || linfo.name || "";
    const langForEmail: "es" | "de" = linfo.language === "de" ? "de" : "es";
    // Endpoints email-action nuevos — el token identifica al lead y
    // dispara el flow SÍ (envía WA con link) / NO (cierra + lost).
    const { buildEmailActionUrl } = await import("./email-action-token");
    const interestYesUrl = buildEmailActionUrl({ leadId, classId: "absent", action: "absent-interest-yes" });
    const interestNoUrl  = buildEmailActionUrl({ leadId, classId: "absent", action: "absent-interest-no" });
    const emailRes = await sendTrialAbsentFollowupEmail(linfo.email, {
      leadName: firstName,
      language: langForEmail,
      interestYesUrl,
      interestNoUrl,
    });
    if (emailRes.ok) {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "system_message_sent",
        author:  "gelfis",
        content: `📧 Email "no te vimos hoy" enviado a ${linfo.email}`,
        metadata: { kind: "absent_followup", channel: "email" },
      });
    } else {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "send_failed",
        author:  "gelfis",
        content: `📧 Falló el email absent followup: ${emailRes.error ?? "unknown"}`,
        metadata: { kind: "absent_followup", channel: "email" },
      });
    }
  }
}

/**
 * Enviar por WhatsApp el link de reagendar a un lead que TODAVÍA tiene
 * su trial programada (no marcada como absent aún). Uso típico: el
 * profe pide reagendar antes de la clase porque el lead avisa que no
 * puede — evita marcar absent y disparar todo el flow de recuperación.
 *
 * NO cambia el estado del lead ni cancela la clase — solo envía el
 * mensaje. El profe cancela después manualmente cuando el lead
 * confirme el nuevo horario.
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

  const firstName = (linfo.name || "").split(/\s+/)[0] || linfo.name || "";
  const baseUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const rescheduleUrl = `${baseUrl}/agendar/cuando?lead=${leadId}&from=teacher_reschedule`;

  const waText = `¡Hola ${firstName}! 👋\n\nCon gusto puedes reagendar tu clase de prueba con este enlace, solo tardarás 3 minutos:\n\n👉 ${rescheduleUrl}\n\nAvísame cuando hayas elegido tu nuevo horario. 😊\n\n— Stiv · Aprender-Aleman.de`;

  const waRes = await sendWhatsappText(linfo.whatsapp_normalized, waText, { kind: "trial_reschedule_link" });
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    waRes.ok ? "system_message_sent" : "send_failed",
    author:  "gelfis",
    content: waRes.ok
      ? `💬 Link reagendar enviado a ${linfo.whatsapp_normalized} (acción del profesor)`
      : `💬 Falló envío del link reagendar: ${waRes.reason ?? "unknown"}`,
    metadata: { kind: "trial_reschedule_link", channel: "whatsapp" },
  });
  return waRes.ok ? { ok: true } : { ok: false, reason: waRes.reason ?? "send_failed" };
}
