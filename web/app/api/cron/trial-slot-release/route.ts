import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * GET/POST /api/cron/trial-slot-release
 *
 * ⚠️ DESHABILITADO 2026-08-02 tras incidente: la versión anterior
 * canceló ~15 trials futuras (algunas a 10 días vista) porque
 * filtraba por `notified_at > 12h` sin considerar la distancia al
 * `scheduled_at`. Corregido — ahora solo actúa sobre trials
 * INMINENTES (próximas 24h) que no confirmaron a tiempo.
 *
 * Kill switch: env `TRIAL_SLOT_RELEASE_ENABLED=true` requerida para
 * ejecutar. Sin la env el endpoint devuelve 200 no-op — el cron
 * puede seguir tocándolo sin efectos secundarios.
 *
 * Lógica corregida (SELECT):
 *   - classes.is_trial = true, status='scheduled', deleted_at IS NULL
 *   - classes.notified_at NOT NULL AND < NOW() - 12h  (mandamos WA
 *     confirmar hace >12h)
 *   - classes.scheduled_at > NOW()                    (aún no pasó)
 *   - **classes.scheduled_at < NOW() + 24h**          (INMINENTE —
 *     solo liberamos si la clase es en las próximas 24h; para
 *     agendas a semanas vista el lead sigue teniendo margen para
 *     responder CONFIRMO más tarde)
 *   - leads.trial_confirmed_at IS NULL                (no confirmó)
 *   - leads.reserva_prioritaria = false               (VIP intocable)
 *
 * Rate: cuando se re-habilite, 1 tick cada hora es suficiente
 * (window de 24h es amplia; cada tick pesca lo nuevo).
 *
 * Auth: CRON_SECRET.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOURS_UNCONFIRMED       = 12;
const HOURS_UNTIL_CLASS_MAX   = 24; // solo liberamos trials INMINENTES
const BATCH_LIMIT             = 20;
const PLATFORM_URL            = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const ENABLED                 = process.env.TRIAL_SLOT_RELEASE_ENABLED === "true";

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

  if (!ENABLED) {
    // Kill switch por env — el cron pega el endpoint pero no hace nada
    // hasta que Gelfis haga TRIAL_SLOT_RELEASE_ENABLED=true en Vercel.
    return NextResponse.json({ ok: true, released: 0, disabled: true, reason: "env_TRIAL_SLOT_RELEASE_ENABLED_not_true" });
  }

  const sb = supabaseAdmin();
  const nowIso            = new Date().toISOString();
  const cutoffNotifiedIso = new Date(Date.now() - HOURS_UNCONFIRMED * 3600_000).toISOString();
  const cutoffImminentIso = new Date(Date.now() + HOURS_UNTIL_CLASS_MAX * 3600_000).toISOString();

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
    .lt("notified_at", cutoffNotifiedIso)
    .gt("scheduled_at", nowIso)
    .lt("scheduled_at", cutoffImminentIso)  // ⚠️ solo trials INMINENTES (fix 2026-08-02)
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
