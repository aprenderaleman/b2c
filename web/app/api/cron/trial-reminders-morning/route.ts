import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialReminderEmail } from "@/lib/email/send";
import { buildLeadJoinUrl, buildTrialClassUrl } from "@/lib/trial-token";

/**
 * GET/POST /api/cron/trial-reminders-morning
 *
 * Vercel Cron lo dispara dos veces (06:00 y 07:00 UTC) para cubrir
 * DST. El endpoint solo procesa si la hora local Berlin es 08:00
 * (= 06:00 UTC en CEST verano, 07:00 UTC en CET invierno). El otro
 * tick devuelve `skipped_dst` y termina sin trabajar.
 *
 * Para cada trial class scheduled hoy (Berlin), envía un EMAIL "tu
 * clase es hoy" tanto al lead como al profesor.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 *
 * Idempotencia: marker en classes.notes_admin para evitar duplicados.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_morning_email_sent]";
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

  // DST guard: el cron Vercel dispara a 06:00 y 07:00 UTC. Solo procesar
  // si la hora local Berlin es exactamente 08. Esto cubre verano (CEST,
  // 06:00 UTC = 08:00 Berlin) e invierno (CET, 07:00 UTC = 08:00 Berlin)
  // sin requerir reconfigurar cron al cambio de DST.
  // Bypass para testing manual: pasar ?force=1 al endpoint.
  const url = new URL(req.url);
  const forceFlag = url.searchParams.get("force");
  if (forceFlag !== "1") {
    const berlinHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Berlin",
        hour:     "numeric",
        hour12:   false,
      }).format(new Date()),
      10,
    );
    if (berlinHour !== 8) {
      return NextResponse.json({
        ok:      true,
        skipped: "dst_guard",
        berlin_hour: berlinHour,
        note:    "Endpoint solo dispara cuando hora Berlin = 08. Otros ticks UTC se ignoran.",
      });
    }
  }

  // "Today" in Berlin — `now` until tomorrow 00:00 Berlin. We don't
  // include classes that have already started a few minutes ago to
  // avoid sending a "today" reminder right before/during the trial
  // (the 30-min WhatsApp covers that case).
  const nowMs = Date.now();
  const lo = new Date(nowMs).toISOString();
  // End of today in Berlin → compute by formatting tomorrow's 00:00 Berlin
  // back to UTC. We just use `nowMs + 24h` as an upper bound; the cron
  // only fires at 08:00 so this naturally caps at "later today" except
  // for trials very late tonight (still acceptable).
  const hi = new Date(nowMs + 24 * 3600_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin, short_code,
      teacher:teachers!inner(users!inner(full_name, email)),
      lead:leads!inner(id, name, language, email, ai_paused_until)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null; short_code: string | null;
    teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
    lead: { id: string; name: string; language: "es" | "de"; email: string | null; ai_paused_until: string | null } |
          Array<{ id: string; name: string; language: "es" | "de"; email: string | null; ai_paused_until: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sentLead = 0, sentTeacher = 0, skipped = 0;
  for (const r of (classes ?? []) as Row[]) {
    if ((r.notes_admin ?? "").includes(REMINDER_TAG)) { skipped++; continue; }

    const lead = flat(r.lead);
    const teacherWrap = flat(r.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    if (!lead) { skipped++; continue; }

    // Honra ai_paused_until ("Tomo yo desde aquí" del admin).
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

    // Lead: shortcode / token URL — bare /aula/{id} bouncea a /login.
    // Bug reportado 2026-05-11.
    const leadJoinUrl    = buildLeadJoinUrl({
      classId:   r.id, leadId: lead.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });
    // Profesor recibe también `/c/{short_code}` para que todos los
    // canales de un trial usen el MISMO link. Bug reportado 2026-05-12
    // por Gelfis: recibía bare /aula/{id} en el email de su trial.
    const teacherJoinUrl = buildTrialClassUrl({
      classId: r.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });

    let leadDelivered = false;
    if (lead.email) {
      const res = await sendTrialReminderEmail(lead.email, {
        audience:        "lead",
        tone:            "morning_of",
        recipientName:   leadFirst,
        counterpartName: teacherName,
        startDate,
        durationMin:     r.duration_minutes ?? 45,
        joinUrl:         leadJoinUrl,
        language:        lead.language,
      });
      if (res.ok) { sentLead++; leadDelivered = true; }
      else console.error(`[trial-reminders-morning] lead email failed for ${r.id}: ${res.error}`);
    }

    let teacherDelivered = false;
    if (tu?.email) {
      const res = await sendTrialReminderEmail(tu.email, {
        audience:        "teacher",
        tone:            "morning_of",
        recipientName:   teacherFirst,
        counterpartName: lead.name || leadFirst,
        startDate,
        durationMin:     r.duration_minutes ?? 45,
        joinUrl:         teacherJoinUrl,
        language:        "es",
      });
      if (res.ok) { sentTeacher++; teacherDelivered = true; }
      else console.error(`[trial-reminders-morning] teacher email failed for ${r.id}: ${res.error}`);
    }

    // ── Timeline entry for /admin/leads/{id}
    if (leadDelivered || teacherDelivered) {
      const recipients: string[] = [];
      if (leadDelivered)    recipients.push(`lead (${lead.email})`);
      if (teacherDelivered) recipients.push(`profesor (${tu?.email})`);
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "trial_reminder",
        author:  "system",
        content: `📧 Recordatorio email mañana del día → ${recipients.join(" + ")}`,
        metadata: { channel: "email", kind: "morning_of", class_id: r.id },
      });
    } else if (lead.email || tu?.email) {
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "send_failed",
        author:  "system",
        content: `📧 Falló el envío del recordatorio email de la mañana`,
        metadata: { channel: "email", kind: "morning_of", class_id: r.id },
      });
    }

    await sb.from("classes")
      .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
      .eq("id", r.id);
  }

  return NextResponse.json({
    ok: true,
    candidates: classes?.length ?? 0,
    sent_lead: sentLead,
    sent_teacher: sentTeacher,
    skipped,
  });
}
