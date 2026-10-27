/**
 * Envíos del setter al lead (Gelfis 2026-10-26) — breves y directos,
 * por WhatsApp (Stiv) + correo, justo después de hablar por teléfono:
 *
 *   variant "link":      enlace de acceso al aula + instrucciones mínimas.
 *   variant "confirmed": "gracias por confirmar" + enlace + "Wir sehen
 *                        uns am {fecha}".
 *
 * Reglas: ambos canales best-effort (se intentan los dos; con que llegue
 * uno, ok). El envío se anota en lead_timeline con author='setter' —
 * autor humano, así que el trigger espejo de lead_contacts NO lo duplica
 * (el contacto del setter lo registra la route llamante).
 */

import { supabaseAdmin } from "./supabase";
import { sendWhatsappText } from "./whatsapp";
import { sendSetterTrialAccessEmail } from "./email/send";
import { buildLeadJoinUrl } from "./trial-token";
import { formatBerlinFull } from "./time";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export type SetterSendResult = {
  ok: boolean;
  waSent: boolean;
  emailSent: boolean;
  startLabel: string | null;
  reason?: string;
};

export async function sendSetterAccessMessage(
  leadId: string,
  variant: "link" | "confirmed",
  setterName: string,
): Promise<SetterSendResult> {
  const sb = supabaseAdmin();

  const { data: leadRow } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadRow as {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; language: "es" | "de" | null;
  } | null;
  if (!lead) return { ok: false, waSent: false, emailSent: false, startLabel: null, reason: "lead_not_found" };
  if (!lead.whatsapp_normalized && !lead.email) {
    return { ok: false, waSent: false, emailSent: false, startLabel: null, reason: "El lead no tiene WhatsApp ni email registrados." };
  }

  // La próxima cita agendada (trial o sesión) — sin ella no hay enlace.
  const { data: clsRow } = await sb
    .from("classes")
    .select("id, scheduled_at, short_code, sesion_closer_id")
    .eq("lead_id", leadId)
    .or("is_trial.eq.true,sesion_closer_id.not.is.null")
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const cls = clsRow as {
    id: string; scheduled_at: string; short_code: string | null; sesion_closer_id: string | null;
  } | null;
  if (!cls) {
    return { ok: false, waSent: false, emailSent: false, startLabel: null, reason: "El lead no tiene ninguna cita futura agendada." };
  }

  const lang = (lead.language === "de" ? "de" : "es") as "es" | "de";
  const citaTipo: "trial" | "sesion" = cls.sesion_closer_id ? "sesion" : "trial";
  const firstName = (lead.name ?? "").trim().split(/\s+/)[0] || "";
  const startLabel = formatBerlinFull(cls.scheduled_at, lang);
  const joinUrl = buildLeadJoinUrl({
    classId: cls.id,
    leadId,
    shortCode: cls.short_code,
    baseUrl: PLATFORM_URL,
  });

  const claseES = citaTipo === "sesion" ? "sesión de plan" : "clase de prueba";
  const claseDE = citaTipo === "sesion" ? "Plan-Session" : "Probestunde";

  const waText = variant === "confirmed"
    ? (lang === "de"
      ? `Danke für deine Bestätigung, ${firstName}! 🙌\n\n👉 Dein Link zur ${claseDE}: ${joinUrl}\n\nWir sehen uns am ${startLabel}! 🇩🇪\n\n— Aprender-Aleman.de`
      : `¡Gracias por confirmar, ${firstName}! 🙌\n\n👉 Tu enlace para unirte a la ${claseES}: ${joinUrl}\n\nWir sehen uns am ${startLabel}! 🇩🇪\n\n— Aprender-Aleman.de`)
    : (lang === "de"
      ? `Hallo ${firstName}! 👋\n\nHier ist dein Link zu deiner Deutsch-${claseDE}:\n\n👉 ${joinUrl}\n\n📅 ${startLabel}\n\nKlick einfach 2-3 Minuten vorher auf den Link — Handy oder Computer, ohne Installation.\n\n— Aprender-Aleman.de`
      : `¡Hola ${firstName}! 👋\n\nAquí tienes el enlace para entrar a tu ${claseES} de alemán:\n\n👉 ${joinUrl}\n\n📅 ${startLabel}\n\nEntra 2-3 minutos antes, desde el móvil o el ordenador — solo haz clic en el enlace, sin instalar nada.\n\n— Aprender-Aleman.de`);

  const waKind = variant === "confirmed" ? "setter_confirm_ack" : "setter_class_link";

  let waSent = false;
  let emailSent = false;

  if (lead.whatsapp_normalized) {
    const res = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: waKind, channel: "setter" })
      .catch(() => ({ ok: false as const }));
    waSent = res.ok === true;
  }
  if (lead.email) {
    const res = await sendSetterTrialAccessEmail(lead.email, {
      variant,
      leadName: firstName || "tú",
      startDate: startLabel,
      joinUrl,
      citaTipo,
      language: lang,
    }).catch(() => ({ ok: false as const }));
    emailSent = res.ok === true;
  }

  // Timeline para la ficha admin. Author humano → el trigger espejo de
  // lead_contacts lo ignora (no duplica el contacto del setter).
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: waSent || emailSent ? "system_message_sent" : "send_failed",
    author: "setter",
    content: variant === "confirmed"
      ? `✅ Gracias-por-confirmar + enlace enviados por ${setterName} (setter) — WA: ${waSent ? "✓" : "✗"} · email: ${emailSent ? "✓" : "✗"}`
      : `🎓 Enlace de acceso al aula enviado por ${setterName} (setter) — WA: ${waSent ? "✓" : "✗"} · email: ${emailSent ? "✓" : "✗"}`,
    metadata: { kind: `setter_${variant}`, class_id: cls.id, wa_sent: waSent, email_sent: emailSent },
  }).then(() => {}, () => {});

  if (!waSent && !emailSent) {
    return { ok: false, waSent, emailSent, startLabel, reason: "No se pudo enviar ni por WhatsApp ni por email." };
  }
  return { ok: true, waSent, emailSent, startLabel };
}

/**
 * Mensaje tras "No contestó" (Gelfis 2026-10-26/27): Stiv le escribe al
 * lead de parte del setter. Solo WhatsApp (acaba de no contestar una
 * llamada — el mensaje es el canal natural). Dos variantes:
 *
 *   - CON cita futura  → pedir el confirmo ("tu clase es el {fecha},
 *                        ¿me confirmas?").
 *   - SIN cita futura  → es un no-show: enviarle el enlace de reagenda
 *                        ("intenté llamarte… elige un nuevo horario
 *                        aquí"). Antes estos no recibían nada (Gelfis
 *                        2026-10-27: "varios en cola" sin mensaje).
 */
export async function sendSetterNoContestoMessage(
  leadId: string,
  setterName: string,
): Promise<SetterSendResult & { variant?: "confirmo" | "rescate" }> {
  const sb = supabaseAdmin();

  const { data: leadRow } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, language")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadRow as {
    id: string; name: string | null; whatsapp_normalized: string | null; language: "es" | "de" | null;
  } | null;
  if (!lead) return { ok: false, waSent: false, emailSent: false, startLabel: null, reason: "lead_not_found" };
  if (!lead.whatsapp_normalized) {
    return { ok: false, waSent: false, emailSent: false, startLabel: null, reason: "el lead no tiene WhatsApp" };
  }

  // Última cita del lead: la futura manda; si no hay, la más reciente
  // nos dice el TIPO (trial/sesión) para el enlace de reagenda.
  const { data: clsData } = await sb
    .from("classes")
    .select("id, scheduled_at, status, sesion_closer_id")
    .eq("lead_id", leadId)
    .or("is_trial.eq.true,sesion_closer_id.not.is.null")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(5);
  const citas = (clsData ?? []) as Array<{
    id: string; scheduled_at: string; status: string; sesion_closer_id: string | null;
  }>;
  const nowMs = Date.now();
  const futura = citas.find(c => c.status === "scheduled" && new Date(c.scheduled_at).getTime() > nowMs) ?? null;
  const ultima = citas[0] ?? null;
  if (!futura && !ultima) {
    return { ok: false, waSent: false, emailSent: false, startLabel: null, reason: "sin citas en el sistema" };
  }

  const lang = (lead.language === "de" ? "de" : "es") as "es" | "de";
  const firstName = (lead.name ?? "").trim().split(/\s+/)[0] || "";
  const setterFirst = setterName.trim().split(/\s+/)[0] || setterName;

  let waText: string;
  let variant: "confirmo" | "rescate";
  let startLabel: string | null = null;
  let classId: string;

  if (futura) {
    variant = "confirmo";
    classId = futura.id;
    startLabel = formatBerlinFull(futura.scheduled_at, lang);
    const claseES = futura.sesion_closer_id ? "sesión de plan" : "clase de prueba";
    const claseDE = futura.sesion_closer_id ? "Plan-Session" : "Probestunde";
    waText = lang === "de"
      ? `Hallo ${firstName}! 👋 Ich bin ${setterFirst} von Aprender-Aleman.de — ich habe gerade versucht, dich anzurufen 😊\n\nDeine Deutsch-${claseDE} ist am ${startLabel}.\n\nKannst du mir bitte mit einem "Ja" bestätigen, dass du dabei bist? 🙌\n\n— ${setterFirst} · Aprender-Aleman.de`
      : `¡Hola ${firstName}! 👋 Soy ${setterFirst}, de la academia Aprender-Aleman.de — acabo de intentar llamarte 😊\n\nTu ${claseES} de alemán es el ${startLabel}.\n\n¿Me confirmas con un "Sí" que podrás conectarte? 🙌\n\n— ${setterFirst} · Aprender-Aleman.de`;
  } else {
    // No-show: rescate con enlace de reagenda (nada se cancela — no hay
    // cita futura que tocar).
    variant = "rescate";
    classId = ultima!.id;
    const esSesion = !!ultima!.sesion_closer_id;
    const rescheduleUrl = esSesion
      ? `${PLATFORM_URL}/sesion-plan/funnel`
      : `${PLATFORM_URL}/agendar/cuando?lead=${leadId}&from=setter_reschedule`;
    const claseES = esSesion ? "sesión de plan" : "clase de prueba";
    const claseDE = esSesion ? "Plan-Session" : "Probestunde";
    waText = lang === "de"
      ? `Hallo ${firstName}! 👋 Ich bin ${setterFirst} von Aprender-Aleman.de — ich habe gerade versucht, dich anzurufen 😊\n\nDeine Deutsch-${claseDE} hat leider nicht geklappt. Möchtest du einen neuen Termin? Hier kannst du ihn in 3 Minuten wählen:\n\n👉 ${rescheduleUrl}\n\n— ${setterFirst} · Aprender-Aleman.de`
      : `¡Hola ${firstName}! 👋 Soy ${setterFirst}, de la academia Aprender-Aleman.de — acabo de intentar llamarte 😊\n\nTuvimos tu ${claseES} de alemán agendada y no pudiste conectarte. ¿Te busco un nuevo horario? Elígelo aquí en 3 minutos:\n\n👉 ${rescheduleUrl}\n\n— ${setterFirst} · Aprender-Aleman.de`;
  }

  const res = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: "setter_no_contesto", channel: "setter" })
    .catch(() => ({ ok: false as const }));
  const waSent = res.ok === true;

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: waSent ? "system_message_sent" : "send_failed",
    author: "setter",
    content: waSent
      ? (variant === "confirmo"
        ? `📵→💬 No contestó la llamada de ${setterName} (setter) — Stiv le pidió el confirmo por WA`
        : `📵→🔗 No contestó la llamada de ${setterName} (setter) — Stiv le envió el enlace de reagenda por WA`)
      : `📵 No contestó y el WA de seguimiento falló`,
    metadata: { kind: "setter_no_contesto", variant, class_id: classId, wa_sent: waSent },
  }).then(() => {}, () => {});

  return { ok: waSent, waSent, emailSent: false, startLabel, variant, reason: waSent ? undefined : "el WhatsApp no se pudo enviar" };
}
