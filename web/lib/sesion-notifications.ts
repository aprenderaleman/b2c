/**
 * Notificaciones de Sesión de Plan (funnel /sesion-plan, 2026-08-13).
 *
 * Confirmación + recordatorios para las citas con CLOSERS (classes con
 * sesion_closer_id). Se invocan desde los MISMOS crons de trials
 * (send-trial-notifications, trial-reminders-24h/morning/15m) para
 * heredar sus schedules — la lógica de sesión vive aquí para no
 * engordar esos routes.
 *
 * A diferencia de los trials (política "no mencionar al profe"), aquí
 * el nombre del closer SÍ se menciona: la sesión es una cita personal
 * con el asesor y el nombre reduce no-shows.
 *
 * Canales:
 *   - Confirmación al lead: email (.ics) + WhatsApp
 *   - Recordatorios al lead: WhatsApp
 *   - Notificaciones al closer: WhatsApp (al agendarse + T-15m)
 *
 * Reglas AUTHORING_RULES vigentes (2026-08-14):
 *   - Handlers no envían mensajes directamente — SOLO los crons vía
 *     este helper. book-sesion-plan pasa notify_after_at=now() para
 *     que el próximo tick del cron dispare la confirmación.
 *   - Sin escasez inventada. CONFIRMO es señal, no condición.
 *   - Copy en español único (task #36).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsappText } from "./whatsapp";
import { sendRaw } from "./email/send";
import { buildTrialIcs } from "./ics";
import { buildLeadJoinUrl } from "./trial-token";

const PLATFORM_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const SESION_DURATION_MIN = 15;

type SB = SupabaseClient;

type SesionRow = {
  id: string;
  lead_id: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  short_code: string | null;
  notes_admin: string | null;
  lead: { name: string | null; email: string | null; whatsapp_normalized: string | null;
          status: string; ai_paused_until: string | null;
          qualification_answers: Record<string, unknown> | null;
          meta: Record<string, unknown> | null;
          reschedule_state: { phase?: string } | null; } |
        Array<{ name: string | null; email: string | null; whatsapp_normalized: string | null;
                status: string; ai_paused_until: string | null;
                qualification_answers: Record<string, unknown> | null;
                meta: Record<string, unknown> | null;
                reschedule_state: { phase?: string } | null; }>;
  closer: { full_name: string | null; email: string; phone: string | null } |
          Array<{ full_name: string | null; email: string; phone: string | null }>;
};

const flat = <T,>(x: T | T[] | null | undefined): T | null =>
  !x ? null : Array.isArray(x) ? x[0] ?? null : x;

function firstName(s: string | null | undefined): string {
  return (s ?? "").trim().split(/\s+/)[0] || "";
}

function fmtBerlin(iso: string): { full: string; day: string; time: string; hourNumber: number } {
  const d = new Date(iso);
  const hourStr = d.toLocaleString("en-US", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false });
  return {
    full: d.toLocaleString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
    day:  d.toLocaleString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" }),
    time: d.toLocaleString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }),
    hourNumber: parseInt(hourStr, 10),
  };
}

/**
 * Resuelve {meta} desde el lead: qualification_answers.goal (funnel
 * sesion-plan lo llena siempre) → meta.last_offered_objective → fallback.
 * Mapea los enums cortos ("job", "citizenship"...) a labels legibles.
 */
/**
 * Devuelve el label de meta pensado para el template "para lograr tu {meta}".
 * Los labels NO empiezan por "tu"/"el" (evita duplicación) y encajan con
 * un pronombre posesivo delante. Fallback "camino con el alemán" lee
 * natural: "para lograr tu camino con el alemán".
 */
function resolveMetaLabel(leadRow: { qualification_answers: Record<string, unknown> | null; meta: Record<string, unknown> | null } | null): string {
  if (!leadRow) return "camino con el alemán";
  const qa = leadRow.qualification_answers;
  const goal = (qa && typeof qa === "object" ? qa.goal : null) as string | null;
  const fromMeta = leadRow.meta?.last_offered_objective as string | undefined;
  const raw = goal || fromMeta || "";
  const LABEL: Record<string, string> = {
    job:         "objetivo laboral en Alemania",
    ausbildung:  "Ausbildung o carrera",
    citizenship: "ciudadanía",
    daily_life:  "día a día en alemán",
    moving:      "mudanza a un país germanohablante",
    work:        "objetivo laboral en Alemania",
    studies:     "objetivo académico",
    visa:        "trámite del visado",
    travel:      "día a día en alemán",
    already_in_dach: "día a día en alemán",
  };
  return LABEL[raw] || raw || "camino con el alemán";
}

/**
 * Referencia al closer en el copy. Si hay nombre → "con {Nombre}, tu asesor".
 * Si no → "con tu asesor" (evita duplicación "con tu asesor, tu asesor").
 */
function closerRef(closerFullName: string | null | undefined): string {
  const f = firstName(closerFullName ?? null);
  return f ? `con ${f}, tu asesor` : `con tu asesor`;
}

const SESION_SELECT = `
  id, lead_id, scheduled_at, duration_minutes, short_code, notes_admin,
  lead:leads!inner(name, email, whatsapp_normalized, status, ai_paused_until,
                    qualification_answers, meta, reschedule_state),
  closer:users!classes_sesion_closer_id_fkey(full_name, email, phone)
`;

// ─────────────────────────────────────────────────────────
// Confirmación (desde el cron send-trial-notifications)
// ─────────────────────────────────────────────────────────
export async function sendSesionConfirmations(sb: SB): Promise<number> {
  const { data } = await sb
    .from("classes")
    .select(SESION_SELECT)
    .not("sesion_closer_id", "is", null)
    .eq("status", "scheduled")
    .is("notified_at", null)
    .not("notify_after_at", "is", null)
    .lte("notify_after_at", new Date().toISOString())
    .is("deleted_at", null)
    .limit(10);

  let sent = 0;
  for (const row of (data ?? []) as unknown as SesionRow[]) {
    // Lock atómico (mismo patrón que trials): solo procesa quien gana el UPDATE
    const { data: locked } = await sb
      .from("classes")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("notified_at", null)
      .select("id");
    if (!locked || locked.length === 0) continue;

    const lead = flat(row.lead);
    const closer = flat(row.closer);
    if (!lead || !row.lead_id) continue;

    const leadFirst = firstName(lead.name) || "¡Hola!";
    const closerFirst = firstName(closer?.full_name);          // "" si no hay
    const closerLabel = closerRef(closer?.full_name);          // "con Camila, tu asesor" | "con tu asesor"
    const closerForIcs = closerFirst || "tu asesor";
    const when = fmtBerlin(row.scheduled_at);
    const meta = resolveMetaLabel(lead);
    const joinUrl = buildLeadJoinUrl({ classId: row.id, leadId: row.lead_id, shortCode: row.short_code, baseUrl: PLATFORM_URL });

    let emailOk = false;
    let waOk = false;

    // Email con .ics (pone la cita en su calendario)
    if (lead.email) {
      const ics = buildTrialIcs({
        uid: row.id,
        startIso: row.scheduled_at,
        durationMin: row.duration_minutes ?? SESION_DURATION_MIN,
        summary: `${leadFirst} + Sesión de Plan de Alemán 📋`,
        description: `Videollamada de ${SESION_DURATION_MIN} minutos con ${closerForIcs} para armar tu plan de alemán.\n\nEntra aquí: ${joinUrl}`,
        organizerName: "Aprender-Aleman.de",
        organizerEmail: "info@aprender-aleman.de",
        attendeeName: lead.name ?? undefined,
        attendeeEmail: lead.email,
        location: joinUrl,
      });
      const subject = `${leadFirst}, tu Sesión de Plan está confirmada — ${when.full}`;
      const html = `
        <p>¡Hola ${leadFirst}!</p>
        <p>Tu <strong>Sesión de Plan</strong> está confirmada:</p>
        <p style="font-size:18px;">📅 <strong>${when.full}</strong> (hora de Berlín)</p>
        <p>🎥 Videollamada ${closerLabel} — ${SESION_DURATION_MIN} minutos</p>
        <p>En la sesión sales con tu nivel real, tu ruta exacta y <strong>tu fecha</strong> para lograr tu ${meta}. Sin examen y sin compromiso 😉</p>
        <p><a href="${joinUrl}" style="color:#059669;font-weight:bold;">👉 Entra a la videollamada aquí</a></p>
        <p style="color:#64748b;font-size:13px;">Adjuntamos la invitación de calendario. Si te surge algo, respóndenos y la movemos.</p>
        <p><em style="color:#64748b;">El equipo de Aprender-Aleman.de</em></p>
      `;
      const text = `¡Hola ${leadFirst}!\n\nTu Sesión de Plan está confirmada: ${when.full} (Berlín).\nVideollamada ${closerLabel} — ${SESION_DURATION_MIN} min.\nSales con tu nivel, tu ruta y tu fecha para lograr tu ${meta}.\n\nEntra aquí: ${joinUrl}\n\n— Aprender-Aleman.de`;
      const res = await sendRaw(lead.email, subject, html, text, [
        { filename: "sesion-de-plan.ics", content: Buffer.from(ics, "utf8"), contentType: "text/calendar" },
      ]);
      emailOk = res.ok;
    }

    // WhatsApp (copy Gelfis 2026-08-15: sin pitch de valor, con firma)
    if (lead.whatsapp_normalized) {
      const msg =
        `¡Hola ${leadFirst}! 😊 Tu Sesión de Plan-Alemán quedó agendada:\n\n` +
        `📅 ${when.day} a las ${when.time}\n` +
        `🎥 Videollamada ${closerLabel} — ${SESION_DURATION_MIN} minutos\n\n` +
        `👉 Link de acceso: ${joinUrl}\n\n` +
        `Responde CONFIRMO para asegurar tu sesión — y si te surge algo, dímelo y la movemos sin problema.\n\n` +
        `— Stiv · Aprender-Aleman.de`;
      const res = await sendWhatsappText(lead.whatsapp_normalized, msg, { kind: "sesion_confirmation" });
      waOk = res.ok;
    }

    await sb.from("lead_timeline").insert({
      lead_id: row.lead_id,
      type: emailOk || waOk ? "system_message_sent" : "send_failed",
      author: "system",
      content: emailOk || waOk
        ? `📋 Confirmación de Sesión de Plan enviada (email: ${emailOk ? "✓" : "✗"} · WA: ${waOk ? "✓" : "✗"})`
        : "✗ Falló la confirmación de Sesión de Plan en ambos canales",
      metadata: { kind: "sesion_confirmation", class_id: row.id, email_ok: emailOk, wa_ok: waOk },
    });

    if (!emailOk && !waOk) {
      // Rollback del lock para reintentar en el próximo tick
      await sb.from("classes").update({ notified_at: null }).eq("id", row.id);
      continue;
    }
    sent++;
  }
  return sent;
}

// ─────────────────────────────────────────────────────────
// Recordatorios al lead (desde los crons trial-reminders-*)
// ─────────────────────────────────────────────────────────
export type SesionReminderKind = "24h" | "morning" | "15m";

const REMINDER_MARKER: Record<SesionReminderKind, string> = {
  "24h":     "[sesion_reminder_24h_sent]",
  "morning": "[sesion_reminder_morning_sent]",
  "15m":     "[sesion_reminder_15m_sent]",
};

export async function sendSesionReminders(sb: SB, kind: SesionReminderKind): Promise<number> {
  const now = Date.now();
  let fromIso: string;
  let toIso: string;
  if (kind === "24h") {
    fromIso = new Date(now + 23 * 3600_000).toISOString();
    toIso   = new Date(now + 25 * 3600_000).toISOString();
  } else if (kind === "morning") {
    fromIso = new Date(now).toISOString();
    toIso   = new Date(now + 24 * 3600_000).toISOString();
  } else {
    fromIso = new Date(now).toISOString();
    toIso   = new Date(now + 20 * 60_000).toISOString();
  }

  const { data } = await sb
    .from("classes")
    .select(SESION_SELECT)
    .not("sesion_closer_id", "is", null)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_at", fromIso)
    .lte("scheduled_at", toIso)
    .limit(30);

  const marker = REMINDER_MARKER[kind];
  let sent = 0;

  for (const row of (data ?? []) as unknown as SesionRow[]) {
    if ((row.notes_admin ?? "").includes(marker)) continue;

    // 15m: afinar a la ventana 12-18 min (el cron corre cada 5)
    if (kind === "15m") {
      const minsTo = (new Date(row.scheduled_at).getTime() - now) / 60_000;
      if (minsTo < 12 || minsTo > 18) continue;
    }

    const lead = flat(row.lead);
    const closer = flat(row.closer);
    if (!lead || !row.lead_id || !lead.whatsapp_normalized) continue;

    // Guards (Gelfis 2026-08-14, espejo de los recordatorios de trials):
    //   - lead converted → cerró, no molestar
    //   - reschedule pendiente → mensaje sería incoherente con el reagendamiento
    //   - ai_paused_until activo → "tomo yo desde aquí" del admin
    if (lead.status === "converted") continue;
    if (lead.reschedule_state?.phase?.startsWith("AWAITING_")) continue;
    if (lead.ai_paused_until && new Date(lead.ai_paused_until).getTime() > now) continue;

    const leadFirst = firstName(lead.name) || "¡Hola!";
    const closerFirst = firstName(closer?.full_name);          // "" si no hay
    // Referencia corta al closer para los recordatorios: "Camila" o
    // "tu asesor" (sin coma — el copy ya trae la preposición).
    const closerShort = closerFirst || "tu asesor";
    const when = fmtBerlin(row.scheduled_at);
    const meta = resolveMetaLabel(lead);
    const joinUrl = buildLeadJoinUrl({ classId: row.id, leadId: row.lead_id, shortCode: row.short_code, baseUrl: PLATFORM_URL });

    let msg: string;
    if (kind === "24h") {
      msg =
        `¡${leadFirst}! Mañana a las ${when.time} es tu Sesión de Plan con ${closerShort} 📅\n` +
        `En ${SESION_DURATION_MIN} minutos tendrás tu ruta y tu fecha para tu ${meta}.\n\n` +
        `👉 ${joinUrl}\n\n` +
        `Si no puedes, dímelo y la movemos — el hueco es tuyo.`;
    } else if (kind === "morning") {
      // Skip si la sesión es antes de las 10:00 Berlin — el T-15m ya
      // cubre esa ventana y evitamos duplicar en horario temprano.
      if (when.hourNumber < 10) continue;
      msg =
        `¡Buenos días, ${leadFirst}! Hoy a las ${when.time} tienes tu Sesión de Plan con ${closerShort} 🎥\n\n` +
        `Un consejo: tenla donde puedas hablar tranquilo/a 5 minutos — es corta pero vale oro.\n\n` +
        `Link: ${joinUrl}`;
    } else {
      msg =
        `⏰ ¡${leadFirst}! Tu sesión con ${closerShort} empieza en 15 minutos.\n\n` +
        `Entra aquí cuando quieras: ${joinUrl} — te está esperando 😊`;
    }

    const res = await sendWhatsappText(lead.whatsapp_normalized, msg, { kind: `sesion_reminder_${kind}` });
    if (!res.ok) continue;

    await sb.from("classes")
      .update({ notes_admin: `${row.notes_admin ?? ""} ${marker}`.trim() })
      .eq("id", row.id);

    await sb.from("lead_timeline").insert({
      lead_id: row.lead_id,
      type: "system_message_sent",
      author: "system",
      content: `📋 Recordatorio de Sesión de Plan (${kind}) enviado por WhatsApp`,
      metadata: { kind: `sesion_reminder_${kind}`, class_id: row.id },
    });
    sent++;
  }
  return sent;
}

// ─────────────────────────────────────────────────────────
// Notificaciones al CLOSER
// ─────────────────────────────────────────────────────────

/**
 * Al agendarse una sesión — WhatsApp inmediato al closer con lead,
 * meta y hora. Espejo de la notificación al profesor en trials.
 * Llamado desde book-sesion-plan (dentro de after()).
 */
export async function notifyCloserOnBooking(sb: SB, classId: string): Promise<boolean> {
  const { data } = await sb
    .from("classes")
    .select(SESION_SELECT)
    .eq("id", classId)
    .maybeSingle();
  const row = data as unknown as SesionRow | null;
  if (!row) return false;

  const lead = flat(row.lead);
  const closer = flat(row.closer);
  if (!closer?.phone || !lead) return false;

  const closerFirst = firstName(closer.full_name) || "asesor";
  const leadFirst = firstName(lead.name) || "un lead";
  const when = fmtBerlin(row.scheduled_at);
  const meta = resolveMetaLabel(lead);

  const msg =
    `📋 ${closerFirst}, nueva Sesión de Plan agendada:\n\n` +
    `👤 ${lead.name ?? leadFirst}\n` +
    `🎯 Meta: ${meta}\n` +
    `📅 ${when.full} (Berlín)\n\n` +
    `Tienes tu tarea sesion_plan en la cola HOY del panel closer.`;

  const res = await sendWhatsappText(closer.phone, msg, { kind: "sesion_closer_booked" });
  return res.ok;
}

/**
 * T-15m — WhatsApp al closer para que se prepare. Llamado desde el mismo
 * cron trial-reminders-15m, DESPUÉS de sendSesionReminders. Marca
 * idempotente separado del recordatorio al lead.
 */
const CLOSER_PRE_15M_MARKER = "[sesion_closer_pre_15m_sent]";

export async function notifyCloserPreSession(sb: SB): Promise<number> {
  const now = Date.now();
  const fromIso = new Date(now).toISOString();
  const toIso   = new Date(now + 20 * 60_000).toISOString();

  const { data } = await sb
    .from("classes")
    .select(SESION_SELECT)
    .not("sesion_closer_id", "is", null)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_at", fromIso)
    .lte("scheduled_at", toIso)
    .limit(30);

  let sent = 0;
  for (const row of (data ?? []) as unknown as SesionRow[]) {
    if ((row.notes_admin ?? "").includes(CLOSER_PRE_15M_MARKER)) continue;
    const minsTo = (new Date(row.scheduled_at).getTime() - now) / 60_000;
    if (minsTo < 12 || minsTo > 18) continue;

    const lead = flat(row.lead);
    const closer = flat(row.closer);
    if (!closer?.phone || !lead || !row.lead_id) continue;

    const closerFirst = firstName(closer.full_name) || "asesor";
    const leadFirst = firstName(lead.name) || "el lead";
    const when = fmtBerlin(row.scheduled_at);
    const meta = resolveMetaLabel(lead);
    const joinUrl = buildLeadJoinUrl({ classId: row.id, leadId: row.lead_id, shortCode: row.short_code, baseUrl: PLATFORM_URL });

    const msg =
      `⏰ ${closerFirst}, tu Sesión de Plan con ${lead.name ?? leadFirst} empieza en 15 min.\n\n` +
      `🎯 Meta: ${meta}\n` +
      `📅 ${when.time} (Berlín)\n\n` +
      `Entra aquí: ${joinUrl}`;

    const res = await sendWhatsappText(closer.phone, msg, { kind: "sesion_closer_pre_15m" });
    if (!res.ok) continue;

    await sb.from("classes")
      .update({ notes_admin: `${row.notes_admin ?? ""} ${CLOSER_PRE_15M_MARKER}`.trim() })
      .eq("id", row.id);
    sent++;
  }
  return sent;
}
