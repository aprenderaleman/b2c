/**
 * Alertas internas a Gelfis cuando un lead completa el paso 5 del
 * funnel (=registered). Orquesta los 3 canales:
 *   1. WhatsApp directo a +4915253409644 con datos + deep-link
 *   2. Email a aprenderaleman2026@gmail.com con tabla + botón WA
 *   3. In-app notification (campana del admin) para todos los
 *      superadmins, type=lead_new_urgent
 *
 * Diseñado para llamar dentro de `after()` desde el endpoint
 * /api/public/diagnostico/register — los 3 sends son fire-and-forget,
 * cualquier fallo se logea pero NO bloquea la respuesta al lead.
 *
 * Anti-spam:
 *   - Si el lead.email o lead.whatsapp_normalized coincide con el
 *     superadmin → no notifica (testing propio).
 *   - Si NEW_LEAD_ALERT_ENABLED no es "true" → silencio total
 *     (interruptor de vacaciones).
 *
 * Variables de entorno:
 *   NEW_LEAD_ALERT_ENABLED       "true" | "false"  — interruptor maestro
 *   NEW_LEAD_ALERT_WHATSAPP      "+4915253409644"  — destino WA
 *   NEW_LEAD_ALERT_EMAIL         "aprenderaleman2026@gmail.com"  — destino email
 */

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";
import { sendLeadNewUrgentEmail } from "./email/send";
import { createNotification } from "./notifications";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const MOTIVO_LABELS: Record<string, string> = {
  particulares: "Clases particulares",
  intensivo:    "Curso intensivo",
  certificado:  "Cursos con certificado",
  profesional:  "Alemán profesional",
  otro:         "Otro motivo",
};

type LeadForAlert = {
  id:                   string;
  name:                 string;
  email:                string | null;
  whatsapp_normalized:  string | null;
  language:             "es" | "de" | null;
  country:              string | null;
  motivo_inicial:       string | null;
  german_level:         string | null;
  goal:                 string | null;
  urgency:              string | null;
  budget:               string | null;
  diagnostico_answers:  Record<string, string> | null;   // texto literal del quiz
};

export function leadAlertsEnabled(): boolean {
  return (process.env.NEW_LEAD_ALERT_ENABLED ?? "false") === "true";
}

/**
 * Canales activos para la alerta de nuevo lead. Gelfis 2026-05-27:
 * sólo por email (desactivado WhatsApp + in-app). Configurable vía
 * env NEW_LEAD_ALERT_CHANNELS (CSV: "email,whatsapp,inapp"). Si la
 * env no está, el default es "email" únicamente.
 */
function alertChannels(): Set<string> {
  const raw = (process.env.NEW_LEAD_ALERT_CHANNELS ?? "email")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return new Set(raw);
}

/**
 * Dispara los 3 sends en paralelo. Llamar desde `after()`.
 * Devuelve un summary para logging; no lanza.
 */
export async function notifyNewLeadUrgent(lead: LeadForAlert): Promise<{
  skipped?: string;
  wa?:      { ok: boolean; reason?: string };
  email?:   { ok: boolean; error?: string };
  inApp?:   { ok: boolean; count?: number; error?: string };
}> {
  if (!leadAlertsEnabled()) {
    return { skipped: "NEW_LEAD_ALERT_ENABLED=false" };
  }

  const channels   = alertChannels();
  // Sólo consideramos cada destino si su canal está activo.
  const adminWa    = channels.has("whatsapp")
    ? (process.env.NEW_LEAD_ALERT_WHATSAPP ?? "").trim() : "";
  const adminEmail = channels.has("email")
    ? (process.env.NEW_LEAD_ALERT_EMAIL ?? "").trim().toLowerCase() : "";
  if (!adminWa && !adminEmail && !channels.has("inapp")) {
    return { skipped: "no_channels_active" };
  }

  // Anti-spam: si el lead es el propio admin (testing), saltamos.
  if (adminEmail && lead.email && lead.email.toLowerCase() === adminEmail) {
    return { skipped: "lead_is_self_email" };
  }
  if (adminWa && lead.whatsapp_normalized && lead.whatsapp_normalized === adminWa) {
    return { skipped: "lead_is_self_whatsapp" };
  }

  const firstName  = (lead.name ?? "").trim().split(/\s+/)[0] || lead.name || "Lead";
  const motivoLab  = lead.motivo_inicial ? (MOTIVO_LABELS[lead.motivo_inicial] ?? lead.motivo_inicial) : null;
  // Preferimos los textos literales del quiz (más legibles que los enums).
  const levelText   = lead.diagnostico_answers?.level   ?? lead.german_level ?? null;
  const goalText    = lead.diagnostico_answers?.goal    ?? lead.goal         ?? null;
  const urgencyText = lead.diagnostico_answers?.urgency ?? lead.urgency      ?? null;
  const budgetText  = lead.diagnostico_answers?.budget  ?? lead.budget       ?? null;

  const adminProfileUrl = `${PLATFORM_URL}/admin/leads/${lead.id}`;
  const waDigits        = (lead.whatsapp_normalized ?? "").replace(/\D/g, "");
  const waPreText       = (lead.language === "de")
    ? `Hallo ${firstName}, hier ist Stiv von Aprender-Aleman.de 👋 Wir haben deinen Probestunden-Antrag erhalten.`
    : `Hola ${firstName}, soy Stiv de Aprender-Aleman.de 👋 Acabo de ver que has empezado a agendar tu clase de prueba. ¿Tienes alguna pregunta?`;
  // Gmail/Outlook 2026 empezaron a bloquear el redirect wa.me → api.whatsapp.com
  // (ERR_BLOCKED_BY_RESPONSE). web.whatsapp.com/send apunta directo sin pasar
  // por api. En móvil sigue abriendo la app nativa.
  const waLeadUrl = waDigits ? `https://web.whatsapp.com/send?phone=${waDigits}&text=${encodeURIComponent(waPreText)}` : null;

  // ── 1. WhatsApp a Gelfis ──────────────────────────────────
  const result: Awaited<ReturnType<typeof notifyNewLeadUrgent>> = {};
  if (adminWa) {
    const lines: string[] = [
      `🚨 IMPORTANTE: Nuevo Lead`,
      ``,
      `👤 *${lead.name}*`,
      `📧 ${lead.email ?? "—"}`,
      `📱 ${lead.whatsapp_normalized ?? "—"}`,
      `🌐 ${lead.country ?? "—"} · ${(lead.language ?? "es").toUpperCase()}`,
      ``,
      motivoLab   ? `🎯 Motivo:    ${motivoLab}`     : null,
      levelText   ? `📊 Nivel:     ${levelText}`     : null,
      goalText    ? `🎓 Objetivo:  ${goalText}`      : null,
      urgencyText ? `⚡ Urgencia:  ${urgencyText}`   : null,
      budgetText  ? `💶 Presup.:   ${budgetText}`    : null,
      ``,
      `📞 *Escribir al lead AHORA:*`,
      waLeadUrl ?? "(sin WhatsApp en perfil)",
      ``,
      `🔗 Ver perfil:`,
      adminProfileUrl,
      ``,
      `⏱ Tienes ~5 min para contactarle.`,
    ].filter(Boolean) as string[];
    try {
      const r = await sendWhatsappText(adminWa, lines.join("\n"));
      result.wa = r.ok ? { ok: true } : { ok: false, reason: r.reason };
    } catch (e) {
      result.wa = { ok: false, reason: e instanceof Error ? e.message : "unknown" };
    }
  }

  // ── 2. Email a Gelfis ─────────────────────────────────────
  if (adminEmail) {
    try {
      const r = await sendLeadNewUrgentEmail(adminEmail, {
        leadId:        lead.id,
        fullName:      lead.name,
        email:         lead.email ?? "—",
        whatsappE164:  lead.whatsapp_normalized ?? "—",
        country:       lead.country ?? "—",
        language:      lead.language ?? "es",
        motivoInicial: lead.motivo_inicial,
        motivoLabel:   motivoLab,
        germanLevel:   levelText,
        goal:          goalText,
        urgency:       urgencyText,
        budget:        budgetText,
        trialStartIso: null,           // siempre null en paso 5
        trialTeacher:  null,
        adminProfileUrl,
      });
      result.email = r.ok ? { ok: true } : { ok: false, error: r.error };
    } catch (e) {
      result.email = { ok: false, error: e instanceof Error ? e.message : "unknown" };
    }
  }

  // ── 3. In-app a todos los superadmins ─────────────────────
  if (!channels.has("inapp")) {
    result.inApp = { ok: true, count: 0 };
    return result;
  }
  try {
    const sb = supabaseAdmin();
    const { data: supers } = await sb
      .from("users")
      .select("id")
      .eq("role", "superadmin")
      .eq("active", true);
    let created = 0;
    for (const s of (supers ?? []) as Array<{ id: string }>) {
      const id = await createNotification({
        user_id: s.id,
        type:    "lead_new_urgent",
        title:   `🚨 IMPORTANTE: Nuevo Lead · ${lead.name}`,
        body:    [
          motivoLab ? `Motivo: ${motivoLab}` : null,
          levelText ? `Nivel: ${levelText}` : null,
          `${lead.country ?? "—"} · ${(lead.language ?? "es").toUpperCase()}`,
        ].filter(Boolean).join(" · "),
        link:    `/admin/leads/${lead.id}`,
      });
      if (id) created++;
    }
    result.inApp = { ok: true, count: created };
  } catch (e) {
    result.inApp = { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }

  return result;
}
