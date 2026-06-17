import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialReminderEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { buildLeadJoinUrl, buildTrialClassUrl } from "@/lib/trial-token";

/**
 * GET/POST /api/cron/trial-reminders-24h
 *
 * Vercel Cron hits this hourly. For every trial class scheduled
 * roughly 24h from now (window: 23-25h), fires an EMAIL reminder
 * to BOTH the lead and the teacher. WhatsApp is reserved for the
 * 30-min-before nudge (handled by the Python scheduler).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> or X-Cron-Secret.
 *
 * Idempotency: marker on classes.notes_admin so the cron can run
 * hourly without duplicating sends.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_24h_email_sent]";
const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const lo  = new Date(now + 23 * 3600_000).toISOString();
  const hi  = new Date(now + 25 * 3600_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin, short_code,
      teacher:teachers!inner(users!inner(full_name, email)),
      lead:leads!inner(id, name, language, email, whatsapp_normalized, ai_paused_until)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null; short_code: string | null;
    teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
    lead: { id: string; name: string; language: "es" | "de"; email: string | null; whatsapp_normalized: string | null; ai_paused_until: string | null } |
          Array<{ id: string; name: string; language: "es" | "de"; email: string | null; whatsapp_normalized: string | null; ai_paused_until: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sentLead = 0, sentTeacher = 0, sentLeadWa = 0, skipped = 0;
  for (const r of (classes ?? []) as Row[]) {
    if ((r.notes_admin ?? "").includes(REMINDER_TAG)) { skipped++; continue; }

    const lead = flat(r.lead);
    const teacherWrap = flat(r.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;

    if (!lead) { skipped++; continue; }

    // Honra ai_paused_until ("Tomo yo desde aquí" del admin) para que las
    // automatizaciones no escriban al lead mientras Gelfis lo gestiona.
    if (lead.ai_paused_until && new Date(lead.ai_paused_until).getTime() > Date.now()) {
      skipped++; continue;
    }

    const leadFirst    = (lead.name || "").split(/\s+/)[0] || lead.name || "";
    const teacherName  = tu?.full_name ?? tu?.email ?? "tu profesor/a";
    const teacherFirst = teacherName.split(/\s+/)[0] || teacherName;

    const startDate = new Date(r.scheduled_at).toLocaleString(
      lead.language === "de" ? "de-DE" : "es-ES",
      {
        timeZone: "Europe/Berlin",
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      },
    ) + (lead.language === "de" ? " (Berlin)" : " (Berlín)");

    // Para trials, todos los recipients reciben /c/{short_code} —
    // unificación de link a petición de Gelfis (2026-05-12).
    const leadJoinUrl    = buildLeadJoinUrl({
      classId:   r.id, leadId: lead.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });
    const teacherJoinUrl = buildTrialClassUrl({
      classId: r.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });

    // ── Lead email
    let leadDelivered = false;
    if (lead.email) {
      const res = await sendTrialReminderEmail(lead.email, {
        audience:        "lead",
        tone:            "24h_before",
        recipientName:   leadFirst,
        counterpartName: teacherName,
        startDate,
        durationMin:     r.duration_minutes ?? 45,
        joinUrl:         leadJoinUrl,
        language:        lead.language,
      });
      if (res.ok) { sentLead++; leadDelivered = true; }
      else console.error(`[trial-reminders-24h] lead email failed for ${r.id}: ${res.error}`);
    }

    // ── Lead WhatsApp (NUEVO 2026-06-14 — antes solo email)
    // Copy "última confirmación" Gelfis: prompt para responder "sí" con
    // mención explícita de la lista de espera, refuerza el compromiso
    // de asistencia + reduce no-shows.
    let leadWaDelivered = false;
    if (lead.whatsapp_normalized) {
      // Cálculo del día (mañana / pasado mañana / nombre del día) en
      // tiempo Berlin para que no diga "mañana" si la clase es hoy más
      // tarde por desfase de zona.
      const dayLabel = new Date(r.scheduled_at).toLocaleDateString(
        lead.language === "de" ? "de-DE" : "es-ES",
        { timeZone: "Europe/Berlin", weekday: "long" },
      );
      const timeLabel = new Date(r.scheduled_at).toLocaleString(
        lead.language === "de" ? "de-DE" : "es-ES",
        { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" },
      );
      // Copy 2026-06-17 (Gelfis): minimalista — sin pedir confirmacion
      // ya hubo CONFIRMO/CAMBIAR/CANCELAR en T+0, sin mencionar al profesor
      // (politica Gelfis 2026-04-30). Solo recordatorio + link.
      const waText = lead.language === "de"
        ? `RECORDATORIO:\n\nHallo ${leadFirst}!\nMorgen ${dayLabel} um ${timeLabel} ist deine Deutsch-Stunde.\n\n🔗 Hier kommst du rein:\n${leadJoinUrl}`
        : `RECORDATORIO:\n\n¡Hola ${leadFirst}!\nMañana ${dayLabel} a las ${timeLabel} es tu clase de alemán.\n\n🔗 Aquí entras a la clase:\n${leadJoinUrl}`;
      const wa = await sendWhatsappText(lead.whatsapp_normalized, waText);
      if (wa.ok) { sentLeadWa++; leadWaDelivered = true; }
      else console.error(`[trial-reminders-24h] lead WA failed for ${r.id}: ${wa.reason}`);
    }

    // ── Teacher email (only if we have one)
    let teacherDelivered = false;
    if (tu?.email) {
      const res = await sendTrialReminderEmail(tu.email, {
        audience:        "teacher",
        tone:            "24h_before",
        recipientName:   teacherFirst,
        counterpartName: lead.name || leadFirst,
        startDate,
        durationMin:     r.duration_minutes ?? 45,
        joinUrl:         teacherJoinUrl,
        language:        "es",   // teachers see Spanish copy
      });
      if (res.ok) { sentTeacher++; teacherDelivered = true; }
      else console.error(`[trial-reminders-24h] teacher email failed for ${r.id}: ${res.error}`);
    }

    // ── Timeline entry — admin sees in /admin/leads/{id} that this
    // reminder fired (and to whom). One row per cron tick that
    // delivered something; failures land as `send_failed`.
    if (leadDelivered || teacherDelivered || leadWaDelivered) {
      const recipients: string[] = [];
      if (leadDelivered)    recipients.push(`✉️ lead (${lead.email})`);
      if (leadWaDelivered)  recipients.push(`💬 lead WA (${lead.whatsapp_normalized})`);
      if (teacherDelivered) recipients.push(`✉️ profesor (${tu?.email})`);
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "trial_reminder",
        author:  "system",
        content: `Recordatorio 24h antes → ${recipients.join(" + ")}`,
        metadata: { channel: "multi", kind: "24h_before", class_id: r.id },
      });
    } else if (lead.email || tu?.email) {
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "send_failed",
        author:  "system",
        content: `📧 Falló el envío del recordatorio email 24h antes`,
        metadata: { channel: "email", kind: "24h_before", class_id: r.id },
      });
    }

    await sb.from("classes")
      .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
      .eq("id", r.id);
  }

  return NextResponse.json({
    ok: true,
    candidates:    classes?.length ?? 0,
    sent_lead:     sentLead,
    sent_lead_wa:  sentLeadWa,
    sent_teacher:  sentTeacher,
    skipped,
  });
}
