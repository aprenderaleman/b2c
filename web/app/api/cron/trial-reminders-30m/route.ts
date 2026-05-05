import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * GET/POST /api/cron/trial-reminders-30m
 *
 * Recordatorio WhatsApp ~30 min antes de la clase de prueba al lead.
 * Cubre el hueco que dejaba `class-reminders` (que solo procesa
 * estudiantes registrados via class_participants — los leads aún no
 * son estudiantes y no aparecen ahí).
 *
 * - Ventana: 25-35 min antes del start.
 * - Se ejecuta cada 5 min (vercel.json) — la ventana de 10 min absorbe
 *   cualquier deriva del cron.
 * - Idempotencia: marker en classes.notes_admin = "[trial_reminder_30m_sent]".
 * - Solo WhatsApp (el email matutino ya cubrió el resumen del día).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_30m_sent]";
const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const WINDOW_LOW_MS  = 25 * 60_000;
const WINDOW_HIGH_MS = 35 * 60_000;

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

  const nowMs = Date.now();
  // Pull anything starting in the next 40 min — wider than the window
  // so we can filter precisely below.
  const lo = new Date(nowMs).toISOString();
  const hi = new Date(nowMs + 40 * 60_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin,
      teacher:teachers!inner(users!inner(full_name, email)),
      lead:leads!inner(id, name, language, whatsapp_normalized, ai_paused_until)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null;
    teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
    lead: { id: string; name: string; language: "es" | "de"; whatsapp_normalized: string | null; ai_paused_until: string | null } |
          Array<{ id: string; name: string; language: "es" | "de"; whatsapp_normalized: string | null; ai_paused_until: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sent = 0, skipped = 0, failed = 0;
  for (const r of (classes ?? []) as Row[]) {
    // Filter to the precise 25-35 min window.
    const startMs = new Date(r.scheduled_at).getTime();
    const msUntil = startMs - nowMs;
    if (msUntil < WINDOW_LOW_MS || msUntil > WINDOW_HIGH_MS) { skipped++; continue; }
    if ((r.notes_admin ?? "").includes(REMINDER_TAG))         { skipped++; continue; }

    const lead = flat(r.lead);
    const teacherWrap = flat(r.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    if (!lead || !lead.whatsapp_normalized) { skipped++; continue; }

    // "Tomo yo desde aquí": admin pausó toda automatización para este lead.
    // Honramos la pausa también en los crons de recordatorios — caso Asmaa
    // 2026-05-04 que recibió WhatsApp 30min mientras Gelfis manejaba el
    // cambio de hora manualmente.
    if (lead.ai_paused_until) {
      const until = new Date(lead.ai_paused_until).getTime();
      if (until > nowMs) { skipped++; continue; }
    }

    const leadFirst   = (lead.name || "").split(/\s+/)[0] || lead.name || "";
    const teacherName = tu?.full_name ?? "tu profesor/a";
    const joinUrl     = `${PLATFORM_URL}/aula/${r.id}`;

    const text = lead.language === "de"
      ? `Hallo ${leadFirst}! 👋\n\n` +
        `Deine Deutsch-Probestunde mit ${teacherName} startet in 30 Minuten.\n\n` +
        `Zum Klassenzimmer:\n${joinUrl}\n\n` +
        `(Tipp: Mikro & Kamera 5 Min vorher testen — der Raum öffnet 15 Min vorher)`
      : `¡Hola ${leadFirst}! 👋\n\n` +
        `Tu clase de prueba de alemán con ${teacherName} empieza en 30 minutos.\n\n` +
        `Entrar al aula:\n${joinUrl}\n\n` +
        `(Tip: prueba el micro y la cámara 5 min antes — el aula abre 15 min antes)`;

    const res = await sendWhatsappText(lead.whatsapp_normalized, text);

    if (res.ok) {
      sent++;
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "trial_reminder",
        author:  "system",
        content: `💬 Recordatorio WhatsApp 30 min antes → lead (${lead.whatsapp_normalized})`,
        metadata: { channel: "whatsapp", kind: "30m_before", class_id: r.id, message_id: res.messageId },
      });
      await sb.from("classes")
        .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
        .eq("id", r.id);
    } else {
      failed++;
      console.error(`[trial-reminders-30m] WA send failed for ${r.id}: ${res.reason}`);
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "send_failed",
        author:  "system",
        content: `💬 Falló el envío WhatsApp del recordatorio 30 min antes`,
        metadata: { channel: "whatsapp", kind: "30m_before", class_id: r.id, error: res.reason },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: classes?.length ?? 0,
    sent,
    skipped,
    failed,
  });
}
