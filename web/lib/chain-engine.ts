/**
 * Motor de cadenas de mensajes post-trial.
 *
 * Funciones principales:
 *   startChain()        — inicia una cadena nueva (cierra la anterior si existe)
 *   cancelActiveChain() — cierra la cadena activa de un lead
 *   pauseChain()        — pausa la cadena activa por 24h (lead respondió)
 *   advanceChain()      — ejecuta el siguiente step de una cadena
 *   hasLeadPaid()       — checa si el lead tiene un pago post-trial
 */

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText, sendWhatsappAudio } from "./whatsapp";
import { renderTemplate } from "./message-stats";
import { resolveChainVariables, isBonusAlive } from "./chain-variables";
import { pickTestimonial, markTestimonialSent, signTestimonialUrl } from "./audio-testimonials";
import {
  CHAIN_DEFINITIONS,
  type ChainType,
  type ChainStep,
  type CloserTaskDef,
  type ObjectionChip,
  OBJECTION_CHIP_TO_CHAIN,
} from "./chain-definitions";

type SupabaseClient = ReturnType<typeof supabaseAdmin>;

// ── Start a new chain ──────────────────────────────────────────────────

export async function startChain(
  leadId: string,
  chainType: ChainType,
  metadata: Record<string, unknown> = {},
  opts?: { objectionChip?: ObjectionChip; skipFirstStep?: boolean },
): Promise<string | null> {
  const sb = supabaseAdmin();
  const def = CHAIN_DEFINITIONS[chainType];
  if (!def || def.steps.length === 0) return null;

  // Close any active chain for this lead
  await cancelActiveChain(leadId, "new_chain");

  const firstStep = def.steps[0];
  const nextFireAt = new Date(Date.now() + firstStep.delayMs).toISOString();

  const { data, error } = await sb
    .from("lead_chains")
    .insert({
      lead_id: leadId,
      chain_type: chainType,
      objection_chip: opts?.objectionChip ?? null,
      current_step: 0,
      next_fire_at: opts?.skipFirstStep ? null : nextFireAt,
      metadata,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`[chain-engine] startChain error for lead ${leadId}:`, error.message);
    return null;
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "system",
    content: `Cadena iniciada: ${def.label}${opts?.objectionChip ? ` (chip: ${opts.objectionChip})` : ""}`,
    metadata: { kind: "chain_started", chain_type: chainType, chain_id: data.id },
  });

  return data.id;
}

// ── Cancel active chain ────────────────────────────────────────────────

export async function cancelActiveChain(
  leadId: string,
  reason: string,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("lead_chains")
    .update({
      completed_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("lead_id", leadId)
    .is("completed_at", null)
    .select("id, chain_type")
    .maybeSingle();

  if (error) {
    console.error(`[chain-engine] cancelActiveChain error:`, error.message);
    return false;
  }
  if (data) {
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "status_change",
      author: "system",
      content: `Cadena cerrada: ${reason}`,
      metadata: { kind: "chain_cancelled", chain_id: data.id, chain_type: data.chain_type, reason },
    });
    return true;
  }
  return false;
}

// ── Pause chain (lead replied) ─────────────────────────────────────────

export async function pauseChain(
  leadId: string,
  durationMs: number = 24 * 3_600_000,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const pauseUntil = new Date(Date.now() + durationMs).toISOString();
  const { data } = await sb
    .from("lead_chains")
    .update({ paused_until: pauseUntil, updated_at: new Date().toISOString() })
    .eq("lead_id", leadId)
    .is("completed_at", null)
    .select("id");

  return (data ?? []).length > 0;
}

/**
 * Silencia TODOS los envíos automáticos al lead hasta `pauseUntil`:
 *   - Pausa la chain activa (via pauseChain arriba)
 *   - Setea leads.ai_paused_until → los crons que lo respetan skip:
 *     trial-reminders-*, teacher-reschedule-followup, sesion-notifications,
 *     diagnostico-followups (tras el fix 2026-08-14), chain-processor
 *     (advanceChain lee ai_paused_until desde este mismo commit).
 *
 * Uso: cuando el lead agenda una sesión de plan, evita que le lleguen
 * mensajes de otras cadenas (chain1, chain8x) o del drip diagnóstico
 * mientras espera su sesión (+ 24h de gracia post-sesión).
 *
 * Gelfis 2026-08-14 — Opción B del análisis "garantía anti-bombardeo".
 */
export async function pauseAllOutbound(
  leadId: string,
  pauseUntil: Date,
): Promise<void> {
  const sb = supabaseAdmin();
  const ms = pauseUntil.getTime() - Date.now();
  if (ms <= 0) return;

  // 1. Pausa chains del motor
  await pauseChain(leadId, ms);

  // 2. Setea ai_paused_until en el lead — solo si el actual es menor
  //    (no acortar una pausa manual del admin que ya expira más tarde).
  const { data: cur } = await sb
    .from("leads")
    .select("ai_paused_until")
    .eq("id", leadId)
    .maybeSingle();
  const curTs = (cur as { ai_paused_until: string | null } | null)?.ai_paused_until;
  const curMs = curTs ? new Date(curTs).getTime() : 0;
  if (pauseUntil.getTime() > curMs) {
    await sb
      .from("leads")
      .update({ ai_paused_until: pauseUntil.toISOString() })
      .eq("id", leadId);
  }
}

// ── Actividad Hans / SCHULE (para celebrationIfUsed) ──────────────────
// STUB Gelfis 2026-08-14: los endpoints/tablas de actividad de Hans y
// SCHULE aún no existen en el repo. Retornan false hoy → el motor
// siempre servirá la variante base del welcome_week. Cuando integremos
// el tracking de actividad (webhooks Hans/SCHULE → columnas
// students.hans_first_used_at / schule_first_used_at o similar),
// reemplazar el `return false` por la consulta real.
export async function hasUsedHans(_leadId: string): Promise<boolean> {
  // TODO: consultar students.hans_first_used_at cuando exista, o hacer
  // fetch a endpoint interno de Hans que devuelva last_activity_at.
  return false;
}
export async function hasUsedSchule(_leadId: string): Promise<boolean> {
  // TODO: consultar exercise_results o schule_progress cuando exista.
  return false;
}

// ── Check if lead paid after chain started ─────────────────────────────

export async function hasLeadPaid(
  sb: SupabaseClient,
  leadId: string,
  since: string,
): Promise<boolean> {
  // Check via lead status
  const { data: lead } = await sb
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .maybeSingle();
  if (lead && (lead as { status: string }).status === "converted") return true;

  // Check via payments table (matched by lead email → student → payments)
  const { data: leadRow } = await sb
    .from("leads")
    .select("email")
    .eq("id", leadId)
    .maybeSingle();
  const email = (leadRow as { email: string | null } | null)?.email;
  if (!email) return false;

  const { data: student } = await sb
    .from("students")
    .select("id, users!inner(email)")
    .eq("users.email", email)
    .maybeSingle();
  if (!student) return false;

  const { data: payments } = await sb
    .from("payments")
    .select("id")
    .eq("student_id", (student as { id: string }).id)
    .eq("status", "paid")
    .gte("created_at", since)
    .limit(1);
  if (payments && payments.length > 0) return true;

  return false;
}

// ── Advance chain (called by cron) ─────────────────────────────────────

// R4: transactional chains bypass the 3h minimum spacing rule
const R4_EXEMPT_CHAINS = new Set(["chain2_link_sent", "chain5_reschedule"]);
const R4_MIN_GAP_MS = 3 * 3_600_000;

type ChainRow = {
  id: string;
  lead_id: string;
  chain_type: string;
  objection_chip: string | null;
  current_step: number;
  started_at: string;
  next_fire_at: string | null;
  paused_until: string | null;
  last_auto_sent_at: string | null;
  metadata: Record<string, unknown>;
};

export async function advanceChain(chain: ChainRow): Promise<{
  action: "sent" | "skipped_paid" | "completed" | "error";
  templateKind?: string;
}> {
  const sb = supabaseAdmin();
  const def = CHAIN_DEFINITIONS[chain.chain_type as ChainType];
  if (!def) return { action: "error" };

  const stepIndex = chain.current_step;
  if (stepIndex >= def.steps.length) {
    // All steps done — shouldn't happen but close it
    await completeChain(sb, chain, def.steps[def.steps.length - 1]);
    return { action: "completed" };
  }

  const step = def.steps[stepIndex];

  // Skip if paid (for chain2 payment triggers)
  if (step.skipIfPaid) {
    const paid = await hasLeadPaid(sb, chain.lead_id, chain.started_at);
    if (paid) {
      await cancelActiveChain(chain.lead_id, "payment_received");
      return { action: "skipped_paid" };
    }
  }

  // Resolve template — orden de precedencia:
  //   1. Celebration variant (si step.celebrationIfUsed y el usuario ya usó)
  //   2. Bonus variant _bonus_vivo/_bonus_vencido (si aplica)
  //   3. Base kind
  const baseTemplateKind = resolveTemplateKind(chain, step);
  let templateKind = baseTemplateKind;
  let tplRow: { body?: string } | null = null;

  // (1) Celebration variant — welcome_week Hans/SCHULE
  if (step.celebrationIfUsed) {
    const used = step.celebrationIfUsed === "hans"
      ? await hasUsedHans(chain.lead_id)
      : await hasUsedSchule(chain.lead_id);
    if (used) {
      const celebrationKind = `${baseTemplateKind}_celebration`;
      const { data } = await sb
        .from("message_templates")
        .select("body")
        .eq("kind", celebrationKind)
        .eq("sub_n", step.templateSubN)
        .eq("channel", "whatsapp")
        .eq("active", true)
        .maybeSingle();
      if (data && (data as { body?: string }).body) {
        templateKind = celebrationKind;
        tplRow = data;
      }
    }
  }

  // (2) Bonus variant — post-trial chains
  if (!tplRow) {
    const bonusAlive = isBonusAlive(chain.started_at, chain.metadata);
    const bonusSuffix = bonusAlive ? "_bonus_vivo" : "_bonus_vencido";
    const bonusKind = `${baseTemplateKind}${bonusSuffix}`;
    const { data: bonusTpl } = await sb
      .from("message_templates")
      .select("body")
      .eq("kind", bonusKind)
      .eq("sub_n", step.templateSubN)
      .eq("channel", "whatsapp")
      .eq("active", true)
      .maybeSingle();
    if (bonusTpl && (bonusTpl as { body?: string }).body) {
      templateKind = bonusKind;
      tplRow = bonusTpl;
    }
  }

  // (3) Fallback: base kind
  if (!tplRow) {
    const { data: baseTpl } = await sb
      .from("message_templates")
      .select("body")
      .eq("kind", baseTemplateKind)
      .eq("sub_n", step.templateSubN)
      .eq("channel", "whatsapp")
      .eq("active", true)
      .maybeSingle();
    tplRow = baseTpl;
  }

  if (!tplRow || !(tplRow as { body?: string }).body) {
    console.error(`[chain-engine] No template found: ${templateKind} sub_n=${step.templateSubN}`);
    return { action: "error", templateKind };
  }

  // Resolve variables
  const vars = await resolveChainVariables(chain.lead_id, chain.metadata, chain.started_at);
  const text = renderTemplate((tplRow as { body: string }).body, vars);

  // Get lead's WhatsApp + ai_paused_until
  const { data: lead } = await sb
    .from("leads")
    .select("whatsapp_normalized, language, ai_paused_until")
    .eq("id", chain.lead_id)
    .maybeSingle();
  const phone = (lead as { whatsapp_normalized: string | null } | null)?.whatsapp_normalized;
  const pausedUntil = (lead as { ai_paused_until: string | null } | null)?.ai_paused_until;

  // Guard Gelfis 2026-08-14: si el lead tiene ai_paused_until activa
  // (típicamente por haber agendado una sesión de plan), posponer la
  // chain hasta que expire — evita bombardear al lead con múltiples
  // cadenas mientras espera su sesión.
  if (pausedUntil && new Date(pausedUntil).getTime() > Date.now()) {
    await sb.from("lead_chains").update({
      next_fire_at: pausedUntil,
      updated_at: new Date().toISOString(),
    }).eq("id", chain.id);
    return { action: "skipped_paid", templateKind };
  }

  if (phone) {
    // R4: 3h minimum between automatic messages (transactional chains exempt)
    if (!R4_EXEMPT_CHAINS.has(chain.chain_type) && chain.last_auto_sent_at) {
      const elapsed = Date.now() - new Date(chain.last_auto_sent_at).getTime();
      if (elapsed < R4_MIN_GAP_MS) {
        const postponeTo = new Date(new Date(chain.last_auto_sent_at).getTime() + R4_MIN_GAP_MS).toISOString();
        await sb.from("lead_chains").update({
          next_fire_at: postponeTo,
          updated_at: new Date().toISOString(),
        }).eq("id", chain.id);
        return { action: "skipped_paid", templateKind };
      }
    }

    // Send window check: 09:00-21:00 Berlin
    if (!isWithinSendWindow()) {
      const next9am = getNext9amBerlin();
      await sb.from("lead_chains").update({
        next_fire_at: next9am.toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", chain.id);
      return { action: "skipped_paid", templateKind };
    }

    // Preludio testimonial (Gelfis 2026-08-14): antes del texto del
    // step, envía el mensaje de contexto + audio del estudiante.
    // Si no hay testimonials disponibles, el step envía solo el texto
    // (fallback gracioso — no bloquea la cadena).
    // Instrumentado con logs persistentes en lead_timeline para atrapar
    // cualquier fallo silencioso (Gelfis 2026-08-15).
    if (step.preludeTestimonial) {
      const logDebug = async (note: string, extra: Record<string, unknown> = {}) => {
        try {
          await sb.from("lead_timeline").insert({
            lead_id: chain.lead_id,
            type: "agent_note",
            author: "system",
            content: `🔍 preludeTestimonial: ${note}`,
            metadata: { kind: "prelude_debug", chain_id: chain.id, ...extra },
          });
        } catch { /* nunca fallar por el log */ }
      };
      try {
        await logDebug("start");
        const t = await pickTestimonial(chain.lead_id);
        if (!t) {
          await logDebug("no_testimonial_available");
        } else {
          await logDebug(`picked: ${t.nombre_estudiante}`, { testimonial_id: t.id });
          // ⚠️ DEBUG TEMPORAL: firmar URL antes que enviar y persistir completa.
          //    Así aunque kill switch bloquee el send, tenemos la URL para probarla manual.
          const signed = await signTestimonialUrl(t);
          await logDebug("signed url", { signed_url_full: signed });

          const introVars = { ...vars, nombre_estudiante: t.nombre_estudiante };
          const introTpl = `Hola {nombre}, oye — antes de que le des más vueltas, escúchate esto de {nombre_estudiante}. Le pasó igual que a ti 👂`;
          const introText = renderTemplate(introTpl, introVars);
          const introRes = await sendWhatsappText(phone, introText, { kind: "testimonial_chain2" });
          await logDebug(`intro: ok=${introRes.ok} reason=${(introRes as { reason?: string }).reason ?? ""}`);

          if (introRes.ok) {
            const audioRes = await sendWhatsappAudio(phone, signed, { kind: "testimonial_chain2" });
            await logDebug(`audio: ok=${audioRes.ok} reason=${(audioRes as { reason?: string }).reason ?? ""}`);
            if (audioRes.ok) {
              await markTestimonialSent(t.id, chain.lead_id, chain.chain_type, stepIndex);
              await sb.from("lead_timeline").insert({
                lead_id: chain.lead_id,
                type: "system_message_sent",
                author: "system",
                content: `🎤 Testimonial de ${t.nombre_estudiante} enviado (chain ${chain.chain_type} paso ${stepIndex + 1})`,
                metadata: { kind: "testimonial_chain2", testimonial_id: t.id, chain_id: chain.id, channel: "whatsapp" },
              });
            }
          }
        }
      } catch (e) {
        await logDebug(`EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const res = await sendWhatsappText(phone, text, { kind: templateKind });

    // R4: update last_auto_sent_at after successful send
    if (res.ok) {
      await sb.from("lead_chains").update({
        last_auto_sent_at: new Date().toISOString(),
      }).eq("id", chain.id);
    }

    await sb.from("lead_timeline").insert({
      lead_id: chain.lead_id,
      type: res.ok ? "system_message_sent" : "send_failed",
      author: "system",
      content: res.ok
        ? `💬 Cadena ${chain.chain_type} paso ${stepIndex + 1} enviado`
        : `💬 Falló cadena ${chain.chain_type} paso ${stepIndex + 1}: ${res.reason}`,
      metadata: { kind: templateKind, channel: "whatsapp", chain_id: chain.id },
    });
  }

  // Create closer task if defined for this step
  if (step.closerTask) {
    await createCloserTask(sb, chain.lead_id, step.closerTask);
  }

  // Setear phase en reschedule_state si el step lo define. Esto lo
  // usa Python (reschedule_flow) para reconocer respuestas contextuales
  // — ej: welcome_week step 4 setea AWAITING_WELCOME_CHECKIN para que
  // el handler capture "1"/"2"/"3" solo en ese estado.
  if (step.setStatePhase) {
    await sb.from("leads").update({
      reschedule_state: {
        phase: step.setStatePhase,
        chain_type: chain.chain_type,
        chain_step: stepIndex,
        started_at: new Date().toISOString(),
      },
    }).eq("id", chain.lead_id);
  }

  // Advance to next step or complete
  const nextStepIndex = stepIndex + 1;
  if (nextStepIndex >= def.steps.length) {
    await completeChain(sb, chain, step);
    return { action: "completed", templateKind };
  }

  const nextStep = def.steps[nextStepIndex];
  const nextFireAt = new Date(new Date(chain.started_at).getTime() + nextStep.delayMs).toISOString();

  await sb.from("lead_chains").update({
    current_step: nextStepIndex,
    next_fire_at: nextFireAt,
    updated_at: new Date().toISOString(),
  }).eq("id", chain.id);

  return { action: "sent", templateKind };
}

// ── Helpers ────────────────────────────────────────────────────────────

function resolveTemplateKind(chain: ChainRow, step: ChainStep): string {
  // For chain4, step 1 has deposit/no-deposit variants
  if (chain.chain_type === "chain4_absent" && step.templateSubN === 1) {
    const hasDeposit = chain.metadata.reserva_prioritaria === true;
    return hasDeposit ? "chain4_absent_deposit" : "chain4_absent_nodeposit";
  }
  return step.templateKind;
}

async function completeChain(
  sb: SupabaseClient,
  chain: ChainRow,
  lastStep: ChainStep,
): Promise<void> {
  await sb.from("lead_chains").update({
    completed_at: new Date().toISOString(),
    cancel_reason: null,
    next_fire_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", chain.id);

  if (lastStep.onComplete?.setStatus) {
    // Gelfis 2026-08-01: si la cadena cierra en `en_reactivacion`, agendar
    // el siguiente contacto en +30d para que el motor de reactivación
    // (chain8g_reactivacion) lo tome. Antes lo dejábamos en null y el
    // lead quedaba huérfano.
    const nextContactDate = lastStep.onComplete.setStatus === "en_reactivacion"
      ? new Date(Date.now() + 30 * 24 * 3_600_000).toISOString()
      : null;
    await sb.from("leads").update({
      status: lastStep.onComplete.setStatus,
      next_contact_date: nextContactDate,
    }).eq("id", chain.lead_id);

    await sb.from("lead_timeline").insert({
      lead_id: chain.lead_id,
      type: "status_change",
      author: "system",
      content: `Cadena ${chain.chain_type} completada → status: ${lastStep.onComplete.setStatus}`,
      metadata: { kind: "chain_completed", chain_type: chain.chain_type },
    });
  }
}

function isWithinSendWindow(): boolean {
  const berlinNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const hour = berlinNow.getHours();
  const day = berlinNow.getDay();
  if (day === 0) return false; // No Sundays
  return hour >= 9 && hour < 21;
}

function getNext9amBerlin(): Date {
  const now = new Date();
  const berlinStr = now.toLocaleString("en-US", { timeZone: "Europe/Berlin" });
  const berlinNow = new Date(berlinStr);
  const tomorrow9am = new Date(berlinNow);
  tomorrow9am.setDate(tomorrow9am.getDate() + 1);
  tomorrow9am.setHours(9, 0, 0, 0);
  // Skip Sunday
  if (tomorrow9am.getDay() === 0) {
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
  }
  // Convert back to UTC-ish by calculating the offset
  const offset = now.getTime() - berlinNow.getTime();
  return new Date(tomorrow9am.getTime() + offset);
}

// ── Closer task creation ──────────────────────────────────────────────

async function createCloserTask(
  sb: SupabaseClient,
  leadId: string,
  taskDef: CloserTaskDef,
): Promise<void> {
  const { data: lead } = await sb
    .from("leads")
    .select("closer_id")
    .eq("id", leadId)
    .maybeSingle();
  const closerId = (lead as { closer_id: string | null } | null)?.closer_id;
  if (!closerId) return;

  const fechaProgramada = new Date(Date.now() + taskDef.delayHours * 3_600_000).toISOString();
  const fechaVence = new Date(Date.now() + (taskDef.delayHours + taskDef.venceEnHours) * 3_600_000).toISOString();

  await sb.from("tareas_closer").insert({
    closer_id: closerId,
    lead_id: leadId,
    paso: 1,
    tipo: taskDef.tipo,
    canal: "llamada",
    plantilla: taskDef.description,
    fecha_programada: fechaProgramada,
    prioridad: taskDef.prioridad,
    fecha_vence: fechaVence,
  });
}

// ── Get pending chains for cron ────────────────────────────────────────

export async function getPendingChains(): Promise<ChainRow[]> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("lead_chains")
    .select("id, lead_id, chain_type, objection_chip, current_step, started_at, next_fire_at, paused_until, last_auto_sent_at, metadata")
    .is("completed_at", null)
    .lte("next_fire_at", now)
    .or(`paused_until.is.null,paused_until.lte.${now}`)
    .limit(50);

  if (error) {
    console.error("[chain-engine] getPendingChains error:", error.message);
    return [];
  }

  return (data ?? []) as ChainRow[];
}
