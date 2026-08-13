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
 * Canales: confirmación = email (.ics) + WhatsApp; recordatorios =
 * WhatsApp (el .ics de la confirmación ya puso la cita en su calendario).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsappText } from "./whatsapp";
import { sendRaw } from "./email/send";
import { buildTrialIcs } from "./ics";
import { buildLeadJoinUrl } from "./trial-token";

const PLATFORM_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

type SB = SupabaseClient;

type SesionRow = {
  id: string;
  lead_id: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  short_code: string | null;
  notes_admin: string | null;
  lead: { name: string | null; email: string | null; whatsapp_normalized: string | null; status: string } |
        Array<{ name: string | null; email: string | null; whatsapp_normalized: string | null; status: string }>;
  closer: { full_name: string | null; email: string } |
          Array<{ full_name: string | null; email: string }>;
};

const flat = <T,>(x: T | T[] | null | undefined): T | null =>
  !x ? null : Array.isArray(x) ? x[0] ?? null : x;

function firstName(s: string | null | undefined): string {
  return (s ?? "").trim().split(/\s+/)[0] || "";
}

function fmtBerlin(iso: string): { full: string; day: string; time: string } {
  const d = new Date(iso);
  return {
    full: d.toLocaleString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
    day:  d.toLocaleString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" }),
    time: d.toLocaleString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }),
  };
}

const SESION_SELECT = `
  id, lead_id, scheduled_at, duration_minutes, short_code, notes_admin,
  lead:leads!inner(name, email, whatsapp_normalized, status),
  closer:users!classes_sesion_closer_id_fkey(full_name, email)
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
    const closerFirst = firstName(closer?.full_name) || "tu asesor";
    const when = fmtBerlin(row.scheduled_at);
    const joinUrl = buildLeadJoinUrl({ classId: row.id, leadId: row.lead_id, shortCode: row.short_code, baseUrl: PLATFORM_URL });

    let emailOk = false;
    let waOk = false;

    // Email con .ics (pone la cita en su calendario)
    if (lead.email) {
      const ics = buildTrialIcs({
        uid: row.id,
        startIso: row.scheduled_at,
        durationMin: row.duration_minutes ?? 20,
        summary: `${leadFirst} + Sesión de Plan de Alemán 📋`,
        description: `Videollamada de 20 minutos con ${closerFirst} para armar tu plan de alemán.\n\nEntra aquí: ${joinUrl}`,
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
        <p style="font-size:18px;"><strong>${when.full}</strong> (hora de Berlín) · 20 minutos · videollamada</p>
        <p>Hablarás con <strong>${closerFirst}</strong>, tu asesor: definiréis tu nivel real, tu meta y el camino más corto para lograrla — con fechas y precio claros.</p>
        <p><a href="${joinUrl}" style="color:#059669;font-weight:bold;">👉 Entra a la videollamada aquí</a></p>
        <p style="color:#64748b;font-size:13px;">Adjuntamos la invitación de calendario. Si el horario no te viene bien, responde a este correo y lo cambiamos.</p>
        <p><em style="color:#64748b;">El equipo de Aprender-Aleman.de</em></p>
      `;
      const text = `¡Hola ${leadFirst}!\n\nTu Sesión de Plan está confirmada: ${when.full} (hora de Berlín) · 20 min · videollamada con ${closerFirst}.\n\nEntra aquí: ${joinUrl}\n\nEl equipo de Aprender-Aleman.de`;
      const res = await sendRaw(lead.email, subject, html, text, [
        { filename: "sesion-de-plan.ics", content: Buffer.from(ics, "utf8"), contentType: "text/calendar" },
      ]);
      emailOk = res.ok;
    }

    // WhatsApp
    if (lead.whatsapp_normalized) {
      const msg =
        `¡Hola ${leadFirst}! Soy Stiv de la academia Aprender-Aleman.de 👋\n\n` +
        `📋 Tu *Sesión de Plan* está confirmada para *${when.full}* (hora de Berlín) con ${closerFirst}, tu asesor.\n\n` +
        `Son 20 minutos por videollamada para armar tu plan de alemán: nivel, meta y precio claros.\n\n` +
        `🔗 Entras aquí el día de la sesión: ${joinUrl}\n\n` +
        `Responde CONFIRMO para asegurar tu plaza 😊`;
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
// Recordatorios (desde los crons trial-reminders-*)
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
    if (lead.status === "converted") continue;

    const leadFirst = firstName(lead.name) || "¡Hola!";
    const closerFirst = firstName(closer?.full_name) || "tu asesor";
    const when = fmtBerlin(row.scheduled_at);
    const joinUrl = buildLeadJoinUrl({ classId: row.id, leadId: row.lead_id, shortCode: row.short_code, baseUrl: PLATFORM_URL });

    let msg: string;
    if (kind === "24h") {
      msg = `¡Hola ${leadFirst}! Mañana ${when.day} a las *${when.time}* (Berlín) es tu *Sesión de Plan* con ${closerFirst} 📋\n\n20 minutos por videollamada — sales con tu plan de alemán listo.\n\n🔗 Entras aquí: ${joinUrl}`;
    } else if (kind === "morning") {
      msg = `¡Buenos días ${leadFirst}! Hoy a las *${when.time}* (Berlín) tienes tu *Sesión de Plan* con ${closerFirst} 📋\n\nSolo necesitas 20 minutos y un lugar tranquilo.\n\n🔗 Entras aquí: ${joinUrl}`;
    } else {
      msg = `⏰ ¡${leadFirst}! Tu *Sesión de Plan* con ${closerFirst} empieza en 15 minutos.\n\nÚnete ahora: ${joinUrl}`;
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
