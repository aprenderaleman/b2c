// Server-side helpers shared by the /api/admin/* routes.
// Every mutation also writes to lead_timeline so the dashboard has an audit trail.

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";
import { sendPostTrialFollowupEmail, sendPostTrialFollowupGenericEmail } from "./email/send";
import { getPack, getPackUrlWithOverride, type PackId, type PaymentType } from "./trial-packs";
import { payTrialBase, getLeadTrialTeacher } from "./trial-compensation";
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

  // ─── BASE 15€ al profesor que dió el trial ─────────────────────────
  // El profe cobra 15€ por trial cuando confirmamos asistencia.
  // Si el admin marca "No asistió" → 0€.
  // Idempotente: si ya se pagó el base (re-clic accidental), no
  // insertamos otra fila.
  try {
    const trial = await getLeadTrialTeacher(leadId);
    if (trial) {
      const paid = await payTrialBase({
        classId:   trial.classId,
        teacherId: trial.teacherId,
      });
      if (paid !== null) {
        await sb.from("lead_timeline").insert({
          lead_id: leadId,
          type:    "agent_note",
          author:  "system",
          content: `💰 Pagado 15€ base de trial al profesor (class ${trial.classId.slice(0,8)})`,
          metadata: { kind: "trial_base_paid", class_id: trial.classId, teacher_id: trial.teacherId, amount_cents: paid },
        });
      }
    }
  } catch (e) {
    console.error("[markTrialAttended] payTrialBase failed:", e instanceof Error ? e.message : e);
  }

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
    text = lead.language === "de"
      ? [
          `Hallo ${firstName}! 😊`,
          ``,
          `Es war mir eine Freude, dich heute in der Probestunde dabei zu haben — schön, dass es dir gefallen hat.`,
          ``,
          `Basierend auf deinem Ziel (${opts.objective}) passt das Paket ${packName} am besten zu dir.`,
          ``,
          `Hier dein Anmeldelink:`,
          `👉 ${packLink || "(Ich schicke dir den Link gleich nach.)"}`,
          ``,
          `Sag mir Bescheid, sobald du die Zahlung abgeschlossen hast. Bei Fragen bin ich da.`,
          ``,
          `Gelfis | Aprender-Aleman.de`,
        ].join("\n")
      : [
          `¡Hola ${firstName}! 😊`,
          ``,
          `Ha sido un placer tenerte en la clase de prueba de hoy — qué bueno que la hayas disfrutado.`,
          ``,
          `Según tu objetivo (${opts.objective}), el pack que mejor se adapta a ti es el ${packName}.`,
          ``,
          `Aquí tienes el enlace para formalizar tu inscripción:`,
          `👉 ${packLink || "(Te paso el enlace en breve.)"}`,
          ``,
          `Avísame cuando hayas realizado el pago. Cualquier duda, aquí estoy.`,
          ``,
          `Gelfis | Aprender-Aleman.de`,
        ].join("\n");
    }  // fin del else del template-override
  } else {
    // Fallback (sin pack/objetivo seleccionado) — mensaje genérico de antes.
    text = lead.language === "de"
      ? `Hallo ${firstName}! 😊\n\nDanke, dass du in deiner Probestunde dabei warst! Wie hat es dir gefallen?\n\nWenn du weitermachen möchtest, kann ich dir einen persönlichen Plan mit Zeiten und Preis vorbereiten — sag mir einfach Bescheid.\n\nStiv, Aprender-Aleman.de`
      : `¡Hola ${firstName}! 😊\n\n¡Gracias por asistir a tu clase de prueba de alemán!\n\n¿Qué te pareció? Si te interesa avanzar, te preparo un plan personalizado con horarios y precio exacto — dime cuando quieras seguir.\n\nStiv, Aprender-Aleman.de`;
  }

  const res = await sendWhatsappText(lead.whatsapp_normalized, text);
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
    const emailRes = opts
      ? await sendPostTrialFollowupEmail(lead.email, {
          name:      firstName || lead.name || "",
          objective: opts.objective,
          packName:  getPack(opts.packId)?.name ?? opts.packId,
          packUrl:   getPackUrlWithOverride(opts.packId, opts.paymentType) ?? "",
          language:  langForEmail,
        })
      : await sendPostTrialFollowupGenericEmail(lead.email, {
          name:     firstName || lead.name || "",
          language: langForEmail,
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

export async function markTrialAbsent(leadId: string): Promise<void> {
  const sb = supabaseAdmin();
  // Politica Gelfis 2026-06-15: primer follow-up 60 min después de
  // marcar "no asistio" (en vez de inmediato). Da margen al lead que
  // quizá tuvo un problema técnico de último minuto y aparece tarde,
  // y evita parecer agobiantes mandando justo después de la hora a la
  // que NO se presento.
  //
  // El cron tick_absent_followups corre cada hora; por eso el envio
  // REAL puede caer entre +60 y +120 min. Si necesitamos precision
  // exacta (~+60 min ±5), bajar el cron a cada 5 min — change pequeño
  // en agents/scheduler.py.
  const nextContact = new Date(Date.now() + 60 * 60_000).toISOString();
  await sb
    .from("leads")
    .update({ status: "trial_absent", next_contact_date: nextContact })
    .eq("id", leadId);
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "gelfis",
    content: "Lead did not attend trial — first absent follow-up scheduled for T+60min.",
  });
}
