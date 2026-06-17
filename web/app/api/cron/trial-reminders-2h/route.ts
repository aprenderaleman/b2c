import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { buildLeadJoinUrl } from "@/lib/trial-token";

/**
 * GET/POST /api/cron/trial-reminders-2h
 *
 * Recordatorio WhatsApp 2h antes de la clase de prueba al lead, con
 * consejos prácticos de preparación (cámara, micrófono, lugar tranquilo).
 *
 * Reemplaza el antiguo trial-reminders-30m (Gelfis 2026-06-14): 30 min
 * era muy tarde para "preparar el setup" — el lead ya estaba en el sofá
 * y no tenía tiempo de cambiar de cuarto si la cámara fallaba.
 *
 * - Ventana: 110-130 min antes del start.
 * - Se ejecuta cada 5 min (vercel.json) — la ventana de 20 min absorbe
 *   cualquier deriva del cron.
 * - Idempotencia: marker en classes.notes_admin = "[trial_reminder_2h_sent]".
 * - Solo WhatsApp.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_2h_sent]";
const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const WINDOW_LOW_MS  = 110 * 60_000;
const WINDOW_HIGH_MS = 130 * 60_000;

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
  // Pull anything starting in the next 140 min — wider than the precise
  // window so we can filter below.
  const lo = new Date(nowMs).toISOString();
  const hi = new Date(nowMs + 140 * 60_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin, short_code,
      lead:leads!inner(id, name, language, whatsapp_normalized, ai_paused_until)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null; short_code: string | null;
    lead: { id: string; name: string; language: "es" | "de"; whatsapp_normalized: string | null; ai_paused_until: string | null } |
          Array<{ id: string; name: string; language: "es" | "de"; whatsapp_normalized: string | null; ai_paused_until: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sent = 0, skipped = 0, failed = 0;
  for (const r of (classes ?? []) as Row[]) {
    const startMs = new Date(r.scheduled_at).getTime();
    const msUntil = startMs - nowMs;
    if (msUntil < WINDOW_LOW_MS || msUntil > WINDOW_HIGH_MS) { skipped++; continue; }
    if ((r.notes_admin ?? "").includes(REMINDER_TAG))         { skipped++; continue; }

    const lead = flat(r.lead);
    if (!lead || !lead.whatsapp_normalized) { skipped++; continue; }

    // "Tomo yo desde aquí": admin pausó toda automatización para este lead.
    if (lead.ai_paused_until) {
      const until = new Date(lead.ai_paused_until).getTime();
      if (until > nowMs) { skipped++; continue; }
    }

    // Usar shortcode (/c/{code}) — el bare /aula/{id} bouncea al lead a /login.
    const joinUrl = buildLeadJoinUrl({
      classId: r.id, leadId: lead.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });

    // Copy 2026-06-17 (Gelfis): "¿Estás listo/a?" en vez de "¿Me confirmas?"
    // — ya hubo CONFIRMO en T+0, esto es solo check-in cercano + tips.
    const text = lead.language === "de"
      ? `In 2 Stunden beginnt deine Deutsch-Stunde.\n\nIch empfehle dir:\n- Computer mit Kamera und Mikrofon bereit\n- Ruhiger Ort\n\nBist du bereit?\n\n🔗 Direktlink: ${joinUrl}`
      : `En 2 horas inicia tu clase de alemán.\n\nTe recomiendo:\n- Tener computador con cámara y micrófono\n- Lugar tranquilo\n\n¿Estás listo/a?\n\n🔗 Link directo: ${joinUrl}`;

    const res = await sendWhatsappText(lead.whatsapp_normalized, text);

    if (res.ok) {
      sent++;
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "trial_reminder",
        author:  "system",
        content: `💬 Recordatorio WhatsApp 2h antes (prep)`,
        metadata: { channel: "whatsapp", kind: "2h_before", class_id: r.id, message_id: res.messageId },
      });
      await sb.from("classes")
        .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
        .eq("id", r.id);
    } else {
      failed++;
      console.error(`[trial-reminders-2h] WA send failed for ${r.id}: ${res.reason}`);
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "send_failed",
        author:  "system",
        content: `💬 Falló el envío WhatsApp del recordatorio 2h antes`,
        metadata: { channel: "whatsapp", kind: "2h_before", class_id: r.id, error: res.reason },
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
