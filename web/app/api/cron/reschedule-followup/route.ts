import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * GET/POST /api/cron/reschedule-followup
 *
 * Cuando el bot envía el link self-serve `/agendar/cuando` a un lead
 * que pidió cambiar/cancelar su trial, marca su `reschedule_state`
 * con `phase=AWAITING_REBOOK_*` + `link_sent_at`. Si pasan 24h sin
 * que el lead haya creado una clase nueva, este cron envía un
 * follow-up "quedan pocos slots, ¿necesitas ayuda?".
 *
 * Decisión Gelfis 2026-05-10: en vez de que el bot intente extraer
 * fecha/hora y validar disponibilidad, el lead reagenda solo y
 * recibe un único nudge a las 24h si no actuó.
 *
 * Schedule sugerido: cada 30 min (ya hay margen del DST porque no
 * comparamos contra hora local — usamos delta UTC).
 *
 * Idempotencia: tras enviar el follow-up, marca
 * `reschedule_state.followup_sent_at` y nunca más vuelve a enviarlo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const REBOOK_URL = `${PLATFORM_URL}/agendar/cuando`;

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
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorisedCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();

  // 1. Pull leads activos en flow self-serve cuyo link tiene 23-72h.
  //    Banda de 49h para tolerar gaps del cron y maximizar la
  //    probabilidad de pillar al lead aunque el endpoint estuvo caído.
  const { data: leads } = await sb
    .from("leads")
    .select(`
      id, name, language, whatsapp_normalized, ai_paused_until,
      reschedule_state
    `)
    .not("reschedule_state", "is", null);

  if (!leads || leads.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0 });
  }

  type RS = {
    phase: string; class_id?: string; original_scheduled_at?: string;
    link_sent_at?: string; followup_sent_at?: string | null;
  };

  const nowMs = Date.now();
  const lo = nowMs - 72 * 3600_000;
  const hi = nowMs - 23 * 3600_000;

  let sent = 0, skipped = 0, failed = 0;

  for (const l of leads) {
    const rs = (l as { reschedule_state: RS | null }).reschedule_state;
    if (!rs || !rs.phase?.startsWith("AWAITING_REBOOK_")) { skipped++; continue; }
    if (rs.followup_sent_at) { skipped++; continue; }
    if (!rs.link_sent_at)    { skipped++; continue; }

    const linkAt = new Date(rs.link_sent_at).getTime();
    if (linkAt < lo || linkAt > hi) { skipped++; continue; }

    // ¿El lead ya rebookeó? Detectamos comparando si tiene un trial
    // scheduled NUEVO (creado después de link_sent_at) — si sí, NO
    // mandamos followup y limpiamos el state.
    const { data: newClass } = await sb
      .from("classes")
      .select("id, scheduled_at")
      .eq("lead_id", l.id)
      .eq("is_trial", true)
      .eq("status", "scheduled")
      .gt("created_at", rs.link_sent_at)
      .limit(1)
      .maybeSingle();
    if (newClass) {
      // Rebookeó — limpiamos state y seguimos
      await sb.from("leads")
        .update({ reschedule_state: { ...rs, phase: "DONE", rebooked_class_id: (newClass as { id: string }).id } })
        .eq("id", l.id);
      await sb.from("lead_timeline").insert({
        lead_id: l.id,
        type: "agent_note",
        author: "system",
        content: "✓ Lead reagendó solo via link self-serve — flow cerrado",
        metadata: { kind: "reschedule_completed", new_class_id: (newClass as { id: string }).id },
      });
      skipped++;
      continue;
    }

    // Honrar pause manual
    if (l.ai_paused_until && new Date(l.ai_paused_until).getTime() > nowMs) {
      skipped++; continue;
    }
    if (!l.whatsapp_normalized) { skipped++; continue; }

    // Construir + enviar el followup
    const lang = (l.language ?? "es") as "es" | "de";
    const name = ((l.name ?? "").split(/\s+/)[0]) || (l.name ?? "");
    const text = lang === "de"
      ? `Hallo ${name}! 👋\n\n` +
        `Ich sehe, du hast noch keinen neuen Termin gebucht. Es bleiben nur noch wenige ` +
        `Probestunden frei diese Woche — falls du Probleme beim Buchen hast, sag mir Bescheid ` +
        `und ich helfe dir.\n\n` +
        `Hier nochmal der Link: ${REBOOK_URL}\n\n` +
        `— Stiv · Aprender-Aleman.de`
      : `¡Hola ${name}! 👋\n\n` +
        `Veo que aún no has reagendado. Quedan pocos slots libres esta semana — si has ` +
        `tenido algún problema para agendar, dímelo y te echo una mano.\n\n` +
        `Aquí el enlace de nuevo: ${REBOOK_URL}\n\n` +
        `— Stiv · Aprender-Aleman.de`;

    const res = await sendWhatsappText(l.whatsapp_normalized, text);
    if (res.ok) {
      sent++;
      await sb.from("lead_timeline").insert({
        lead_id: l.id,
        type:    "system_message_sent",
        author:  "system",
        content: `💬 Follow-up 24h sin rebook enviado a ${l.whatsapp_normalized}`,
        metadata: { kind: "reschedule_followup_24h", channel: "whatsapp", message_id: res.messageId },
      });
      await sb.from("leads")
        .update({ reschedule_state: { ...rs, followup_sent_at: new Date().toISOString() } })
        .eq("id", l.id);
    } else {
      failed++;
      console.error(`[reschedule-followup] WA send failed for ${l.id}: ${res.reason}`);
      await sb.from("lead_timeline").insert({
        lead_id: l.id,
        type: "send_failed",
        author: "system",
        content: `💬 Falló follow-up 24h sin rebook`,
        metadata: { kind: "reschedule_followup_24h", error: res.reason },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: leads.length,
    sent, skipped, failed,
  });
}
