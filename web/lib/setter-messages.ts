/**
 * Envíos del setter al lead (Gelfis 2026-10-26 / refactor 2026-11-14) —
 * brevísimos y directos, por WhatsApp + correo.
 *
 * REFACTOR 2026-11-14 (post-bans v5+v6): para bajar el riesgo de ban, el
 * WhatsApp YA NO lo envía Evolution automáticamente. La función devuelve
 * `waText` + `waLink` (wa.me con texto pre-rellenado) y la UI del setter
 * abre WhatsApp Web con el mensaje listo — la setter sólo pulsa Enviar.
 *
 * Copies Hormozi: cada mensaje tiene UN ángulo único (sin repetir "40 min
 * uno a uno con profe nativo" en todos). Firmados por la setter que acaba
 * de llamar.
 */

import { supabaseAdmin } from "./supabase";
import { sendSetterTrialAccessEmail } from "./email/send";
import { buildLeadJoinUrl } from "./trial-token";
import { formatBerlinFull } from "./time";
import { recordStudentConfirmation } from "./student-confirmation";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export type SetterSendResult = {
  ok: boolean;
  /** Siempre false ahora — se queda listo para envío manual. */
  waSent: boolean;
  emailSent: boolean;
  startLabel: string | null;
  /** Nuevo (2026-11-14): texto del mensaje a enviar manualmente por WA. */
  waText?: string;
  /** Nuevo (2026-11-14): wa.me link con el texto pre-rellenado — 1 clic abre
   *  WhatsApp Web con el chat del lead y el mensaje listo. */
  waLink?: string;
  /** Nuevo (2026-11-14): true indica a la UI que debe mostrar la caja de
   *  "copiar y enviar" en vez de un mensaje de éxito de envío auto. */
  pendingManual?: boolean;
  reason?: string;
};

/** Construye el link de WhatsApp con el texto pre-rellenado. Phone sin "+".
 *  Usamos api.whatsapp.com/send (en vez de wa.me) porque wa.me pasa por
 *  una redirección que a veces recodifica mal los emojis de 4 bytes
 *  (👋, 😊, 🙌 salían como "?"). Con api.whatsapp.com el UTF-8 se
 *  preserva íntegro. */
function buildWaLink(phoneE164: string, text: string): string {
  const phone = phoneE164.replace(/^\+/, "");
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}

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
  const setterFirst = setterName.trim().split(/\s+/)[0] || setterName;
  const startLabel = formatBerlinFull(cls.scheduled_at, lang);
  const joinUrl = buildLeadJoinUrl({
    classId: cls.id,
    leadId,
    shortCode: cls.short_code,
    baseUrl: PLATFORM_URL,
  });

  // Confirmación por teléfono: variant="confirmed" significa que el setter
  // obtuvo el "sí" en la llamada — lo registramos YA para que el profe lo
  // vea en su panel (Gelfis 2026-11-14). Idempotente.
  if (variant === "confirmed") {
    await recordStudentConfirmation({
      classId: cls.id, leadId, source: "setter_phone", actorName: setterName,
    }).catch(() => {});
  }

  // Copies Hormozi 2026-11-14:
  //   confirmed → agradecer + logística + micro-commitment (papel y lápiz)
  //   link      → entrega + tip concreto (computador/cámara/lugar)
  let waText: string;
  if (variant === "confirmed") {
    waText = lang === "de"
      ? `Super ${firstName}, danke für die Bestätigung! 🙌\n\nWir sehen uns am ${startLabel} hier:\n🔗 ${joinUrl}\n\nEin kleiner Tipp: Papier und Stift bereithalten, um den Plan zu notieren, den dir dein Lehrer vorbereitet.\n\n— ${setterFirst} · Aprender-Aleman.de`
      : `¡Perfecto ${firstName}, gracias por confirmar! 🙌\n\nNos vemos el ${startLabel} aquí:\n🔗 ${joinUrl}\n\nUn tip que marca la diferencia: ten papel y lápiz a mano para anotar el plan que te preparen.\n\n— ${setterFirst} · Aprender-Aleman.de`;
  } else {
    waText = lang === "de"
      ? `Hallo ${firstName}! Ich bin ${setterFirst} von Aprender-Aleman.de 👋\n\nHier dein Link zur Deutsch-Probestunde am ${startLabel}:\n🔗 ${joinUrl}\n\nAm besten vom Computer mit Kamera und Mikro, an einem ruhigen Ort. So nutzt ihr die 40 Minuten gut und du bekommst einen klaren Plan.\n\n— ${setterFirst} · Aprender-Aleman.de`
      : `¡Hola ${firstName}! Soy ${setterFirst} de Aprender-Alemán 👋\n\nAquí tu enlace para la clase del ${startLabel}:\n🔗 ${joinUrl}\n\nMejor desde un computador con cámara y micrófono + un lugar tranquilo. Así os cunden los 40 minutos y sales con un plan claro.\n\n— ${setterFirst} · Aprender-Aleman.de`;
  }

  // Email sí sale automático (no hay riesgo de ban).
  let emailSent = false;
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

  // WA link listo para envío manual por la setter.
  const waLink = lead.whatsapp_normalized ? buildWaLink(lead.whatsapp_normalized, waText) : undefined;

  // Timeline: dejamos constancia de que el mensaje quedó PREPARADO (no se
  // registra como enviado hasta que la setter confirme con el botón de la
  // UI). Author humano → el trigger espejo de lead_contacts lo ignora.
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "setter",
    content: variant === "confirmed"
      ? `✅ Gracias-por-confirmar preparado para ${setterName} — WA pendiente de envío manual · email: ${emailSent ? "✓" : "✗"}`
      : `🎓 Enlace de aula preparado para ${setterName} — WA pendiente de envío manual · email: ${emailSent ? "✓" : "✗"}`,
    metadata: { kind: "setter_wa_pending_manual", variant: `setter_${variant}`, class_id: cls.id, email_sent: emailSent },
  }).then(() => {}, () => {});

  return {
    ok: true,
    waSent: false,
    emailSent,
    startLabel,
    waText: waLink ? waText : undefined,
    waLink,
    pendingManual: !!waLink,
  };
}

/**
 * Mensaje tras "No contestó" (Gelfis 2026-10-26/27, refactor 2026-11-14).
 * Devuelve el texto + waLink para envío manual. Dos variantes:
 *
 *   - CON cita futura  → pedir el confirmo ("tu clase es el {fecha},
 *                        ¿me confirmas con un Sí?").
 *   - SIN cita futura  → no-show: enviar enlace de reagenda.
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
    .select("id, scheduled_at, status, sesion_closer_id, short_code")
    .eq("lead_id", leadId)
    .or("is_trial.eq.true,sesion_closer_id.not.is.null")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(5);
  const citas = (clsData ?? []) as Array<{
    id: string; scheduled_at: string; status: string; sesion_closer_id: string | null; short_code: string | null;
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
    // Variante "confirmo" — Hormozi: pedir el "Sí" + qué va a pasar.
    // Nuevo (Gelfis 2026-11-14): además del "responde Sí", mandamos un
    // enlace a /c/{code}/confirmar con un botón. 1-click y queda
    // registrado en la DB (classes.student_confirmed_at) para que el
    // profe lo vea en su panel.
    variant = "confirmo";
    classId = futura.id;
    startLabel = formatBerlinFull(futura.scheduled_at, lang);
    const claseES = futura.sesion_closer_id ? "sesión de plan" : "clase de prueba";
    const claseDE = futura.sesion_closer_id ? "Plan-Session" : "Probestunde";
    const confirmUrl = futura.short_code ? `${PLATFORM_URL}/c/${futura.short_code}/confirmar` : null;
    waText = lang === "de"
      ? `Hallo ${firstName}! 👋 Ich bin ${setterFirst} von Aprender-Aleman.de — ich habe gerade versucht, dich anzurufen 😊\n\nDeine Deutsch-${claseDE} ist am ${startLabel} — 40 Minuten 1:1 mit einem muttersprachlichen Lehrer, der Spanisch spricht. Ihr seht zusammen, wo du stehst und welcher Weg dich zu deinem Ziel führt.\n\n${confirmUrl ? `Bestätige deine Teilnahme mit 1 Klick:\n👉 ${confirmUrl}\n\n` : ""}So reserviere ich den Slot mit deinem Lehrer. 🙌\n\n— ${setterFirst} · Aprender-Aleman.de`
      : `¡Hola ${firstName}! 👋 Soy ${setterFirst} de Aprender-Alemán — acabo de intentar llamarte 😊\n\nTu ${claseES} de alemán es el ${startLabel} — 40 minutos uno a uno con un profe nativo que habla español. Van a ver dónde estás y qué camino te toca hasta tu meta.\n\n${confirmUrl ? `Confirma tu asistencia con 1 clic:\n👉 ${confirmUrl}\n\n` : ""}Así tu profe te prepara los 40 min 🙌\n\n— ${setterFirst} · Aprender-Aleman.de`;
  } else {
    // Variante "rescate" — Hormozi: empatía + reagenda rápida.
    variant = "rescate";
    classId = ultima!.id;
    const esSesion = !!ultima!.sesion_closer_id;
    const rescheduleUrl = esSesion
      ? `${PLATFORM_URL}/sesion-plan/funnel`
      : `${PLATFORM_URL}/agendar/cuando?lead=${leadId}&from=setter_reschedule`;
    waText = lang === "de"
      ? `Hallo ${firstName}! 👋 Ich bin ${setterFirst} von Aprender-Aleman.de — ich habe gerade versucht, dich anzurufen 😊\n\nWir haben dich vermisst und es hat nicht geklappt — kein Problem, das passiert den Besten. Dein Lehrer hat deine Stunde vorbereitet und hält sie für dich bereit.\n\nSuchen wir einen neuen Termin? In 3 Minuten hast du ihn:\n👉 ${rescheduleUrl}\n\n— ${setterFirst} · Aprender-Aleman.de`
      : `¡Hola ${firstName}! 👋 Soy ${setterFirst} de Aprender-Alemán — acabo de intentar llamarte 😊\n\nTe esperábamos y no coincidimos, pasa en las mejores familias. Tu profe tenía la clase preparada y te la guarda.\n\n¿Elegimos nuevo horario? En 3 minutos lo tienes:\n👉 ${rescheduleUrl}\n\n— ${setterFirst} · Aprender-Aleman.de`;
  }

  const waLink = buildWaLink(lead.whatsapp_normalized, waText);

  // Timeline: constancia de que el mensaje quedó PREPARADO para envío manual.
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "setter",
    content: variant === "confirmo"
      ? `📵→📋 No contestó la llamada de ${setterName} — WA de confirmo preparado para envío manual`
      : `📵→📋 No contestó la llamada de ${setterName} — WA de reagenda preparado para envío manual`,
    metadata: { kind: "setter_wa_pending_manual", variant: "setter_no_contesto", sub_variant: variant, class_id: classId },
  }).then(() => {}, () => {});

  return {
    ok: true,
    waSent: false,
    emailSent: false,
    startLabel,
    waText,
    waLink,
    pendingManual: true,
    variant,
  };
}
