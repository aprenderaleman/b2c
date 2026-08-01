import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * GET/POST /api/cron/trial-slot-release
 *
 * Libera slots de trials NO CONFIRMADAS 12h después del envío del
 * mensaje "confirma tu asistencia" (send-trial-notifications).
 *
 * Cumple la promesa del copy del WA T+0 ("sin tu respuesta en 12h,
 * tu slot se libera para otro estudiante en lista de espera"), que
 * hasta ahora era escasez falsa (Gelfis 2026-07-28).
 *
 * Criterios (SELECT):
 *   - classes.is_trial = true
 *   - classes.status   = 'scheduled'
 *   - classes.deleted_at IS NULL
 *   - classes.notified_at IS NOT NULL AND < NOW() - 12h
 *   - classes.scheduled_at > NOW()  (aún no ha llegado la clase)
 *   - leads.trial_confirmed_at IS NULL  (no confirmó)
 *   - leads.reserva_prioritaria = false  (respetamos VIP — sus plazas
 *     no se liberan aunque no confirmen a tiempo)
 *
 * Acciones (por cada match):
 *   1. classes.status = 'cancelled', updated_at = NOW
 *   2. leads.status ← 'in_conversation' (para que Stiv/closers puedan
 *      re-engancharlo si sigue interesado), trial_scheduled_at = null
 *   3. WhatsApp al lead con opción de reagendar
 *   4. lead_timeline entry (audit)
 *
 * Rate: 1 tick cada 15min (Vercel Cron). LIMIT 20 por tick.
 * Auth: CRON_SECRET (Bearer o X-Cron-Secret).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOURS_UNCONFIRMED = 12;
const BATCH_LIMIT       = 20;
const PLATFORM_URL      = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function authorised(req: Request): boolean {
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
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const nowIso  = new Date().toISOString();
  const cutoff  = new Date(Date.now() - HOURS_UNCONFIRMED * 3600_000).toISOString();

  // Select trials sin confirmar. JOIN a leads para excluir VIP + verificar
  // trial_confirmed_at. Nota: no podemos filtrar por trial_confirmed_at IS NULL
  // en el JOIN con !inner porque la nested query es "any", así que
  // post-filtramos en memoria.
  const { data: candidates, error } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, notified_at, lead_id, teacher_id,
      lead:leads!inner(id, name, whatsapp_normalized, language, trial_confirmed_at, reserva_prioritaria, status)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .not("notified_at", "is", null)
    .lt("notified_at", cutoff)
    .gt("scheduled_at", nowIso)
    .limit(BATCH_LIMIT);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, released: 0 });
  }

  type Row = {
    id: string; scheduled_at: string; notified_at: string; lead_id: string; teacher_id: string;
    lead: {
      id: string; name: string | null; whatsapp_normalized: string | null;
      language: "es" | "de" | null; trial_confirmed_at: string | null;
      reserva_prioritaria: boolean | null; status: string;
    } | Array<{
      id: string; name: string | null; whatsapp_normalized: string | null;
      language: "es" | "de" | null; trial_confirmed_at: string | null;
      reserva_prioritaria: boolean | null; status: string;
    }>;
  };
  const flat = <T,>(x: T | T[] | null): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const results: Array<{ classId: string; released: boolean; reason?: string }> = [];

  for (const raw of (candidates as Row[])) {
    const lead = flat(raw.lead);
    if (!lead) continue;

    // Skip si ya confirmó o si es VIP (respetamos su plaza pagada).
    if (lead.trial_confirmed_at) { results.push({ classId: raw.id, released: false, reason: "confirmed" }); continue; }
    if (lead.reserva_prioritaria) { results.push({ classId: raw.id, released: false, reason: "vip" });        continue; }

    // Cancelar clase (libera el slot para trial-slots endpoint).
    const { error: updErr } = await sb.from("classes")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", raw.id)
      .eq("status", "scheduled"); // guard idempotente
    if (updErr) {
      console.warn(`[trial-slot-release] cancel class ${raw.id} failed:`, updErr.message);
      continue;
    }

    // Rollback status del lead solo si sigue en trial_scheduled/reminded
    // (no queremos pisar un estado más avanzado tipo needs_human).
    const currentStatus = lead.status;
    if (currentStatus === "trial_scheduled" || currentStatus === "trial_reminded") {
      await sb.from("leads").update({
        status:             "in_conversation",
        trial_scheduled_at: null,
        next_contact_date:  null,
      }).eq("id", lead.id);
    }

    // Timeline entry.
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "status_change",
      author:  "system",
      content: `⏱️ Clase de prueba liberada — no confirmó en ${HOURS_UNCONFIRMED}h desde el envío. Slot devuelto a la lista de espera.`,
      metadata: {
        kind:            "trial_slot_auto_released",
        class_id:        raw.id,
        scheduled_at:    raw.scheduled_at,
        notified_at:     raw.notified_at,
        hours_threshold: HOURS_UNCONFIRMED,
      },
    });

    // WhatsApp — le decimos que el slot se liberó y le damos link para reagendar.
    if (lead.whatsapp_normalized) {
      const firstName = (lead.name ?? "").split(/\s+/)[0] || (lead.name ?? "");
      const rescheduleUrl = `${PLATFORM_URL}/agendar/cuando?lead=${lead.id}&from=slot_released`;
      const waText = `¡Hola ${firstName}! 👋\n\nComo no confirmaste tu clase de prueba en ${HOURS_UNCONFIRMED}h, hemos liberado tu plaza para otro estudiante en lista de espera.\n\nSi aún quieres tomar tu clase, puedes agendar una nueva aquí en 3 minutos:\n\n👉 ${rescheduleUrl}\n\n— Stiv · Aprender-Aleman.de`;
      const r = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: "trial_reschedule_link" });
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    r.ok ? "system_message_sent" : "send_failed",
        author:  "system",
        content: r.ok
          ? `💬 WA liberación de slot enviado a ${lead.whatsapp_normalized}`
          : `💬 Falló WA liberación: ${r.reason ?? "unknown"}`,
        metadata: { kind: "trial_slot_released_notice", channel: "whatsapp", class_id: raw.id },
      });
    }

    results.push({ classId: raw.id, released: true });
  }

  const releasedCount = results.filter(r => r.released).length;
  console.log(`[trial-slot-release] processed=${results.length} released=${releasedCount}`);
  return NextResponse.json({ ok: true, processed: results.length, released: releasedCount, results });
}
