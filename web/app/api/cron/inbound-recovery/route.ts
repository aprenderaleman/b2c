import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/admin-notifications";

/**
 * GET/POST /api/cron/inbound-recovery
 *
 * Recovery automático de mensajes perdidos durante un downtime de Evolution.
 *
 * Flow:
 *   1. Detecta transición state≠open → state=open en system_config (cuenta
 *      de health checks fallidos cae a 0 de >0 → señal de "Evolution volvió").
 *   2. Si el downtime fue ≥30 min → llama a Evolution /chat/findMessages
 *      para los últimos N horas + descubre inbound (fromMe=false) sin
 *      registro correspondiente en lead_timeline.
 *   3. Inserta lead_message_received por cada mensaje recuperado (timestamp
 *      original).
 *   4. Crea notificación in-app con resumen "Se recuperaron N mensajes
 *      de M leads — revisa".
 *
 * Importante: este cron NO llama directamente a Evolution (no tiene la
 * API key). Llama al agents server interno que sí la tiene
 * (/internal/whatsapp-history). Si ese endpoint no existe aún, este cron
 * loguea y sale sin hacer nada — el TODO queda anotado.
 *
 * Schedule: cada 10 min en vercel.json. Idempotente.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RECOVERY_KEY      = "inbound_recovery_last_run_at";
const DOWNTIME_FLAG_KEY = "evolution_was_down_at";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

async function run(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();

  // 1. ¿Hubo downtime registrado? (Lo deja el health-monitor cuando
  //    detecta fail_count > 0). Si NO hay → nada que recuperar.
  const { data: downRow } = await sb
    .from("system_config")
    .select("value")
    .eq("key", DOWNTIME_FLAG_KEY)
    .maybeSingle();
  const downAt = (downRow as { value?: string } | null)?.value;
  if (!downAt) {
    return NextResponse.json({ ok: true, skipped_reason: "no_downtime_recorded" });
  }

  // 2. Si Evolution sigue caído ahora (system_paused_until > now), esperar.
  const { data: pauseRow } = await sb
    .from("system_config")
    .select("value")
    .eq("key", "system_paused_until")
    .maybeSingle();
  const pauseUntil = (pauseRow as { value?: string } | null)?.value;
  if (pauseUntil && new Date(pauseUntil).getTime() > Date.now()) {
    return NextResponse.json({ ok: true, skipped_reason: "still_paused", until: pauseUntil });
  }

  // 3. Llamar al agents server para sacar el histórico.
  const agentsBase = (process.env.AGENTS_BASE_URL ?? "").replace(/\/$/, "");
  const secret     = process.env.AGENTS_INTERNAL_SECRET;
  if (!agentsBase || !secret) {
    return NextResponse.json({ error: "agents_env_missing" }, { status: 503 });
  }

  // Ventana = desde el downtime hasta ahora.
  const sinceMs = new Date(downAt).getTime();
  const hoursWindow = Math.min(48, Math.ceil((Date.now() - sinceMs) / 3600_000));

  let messages: Array<{ from: string; text: string; timestamp: number; messageId: string }> = [];
  try {
    const res = await fetch(`${agentsBase}/internal/whatsapp-history?hours=${hoursWindow}`, {
      method: "GET",
      headers: { "X-Internal-Secret": secret },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      // 404 = endpoint aún no implementado en agents (esperado en primer deploy).
      if (res.status === 404) {
        return NextResponse.json({
          ok: true,
          skipped_reason: "agents_history_endpoint_missing",
          note: "El agents server necesita implementar GET /internal/whatsapp-history?hours=N. Hasta entonces el recovery no opera — el bug NO se romperá nada, solo no recuperaremos automáticamente.",
        });
      }
      throw new Error(`agents history ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json() as { messages?: typeof messages };
    messages = data.messages ?? [];
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "fetch_history_failed",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 200 });
  }

  // 4. Para cada mensaje inbound (no fromMe), encontrar lead por número y
  //    revisar si ya tenemos esa entrada en timeline. Si no, insertar.
  let inserted = 0;
  let matchedLeads = new Set<string>();
  let unmatchedNumbers = new Set<string>();

  if (messages.length > 0) {
    // Pre-fetch leads cuyo phone matchee con cualquiera de los remitentes.
    const fromNumbers = Array.from(new Set(messages.map(m => `+${m.from}`)));
    const { data: leadsData } = await sb
      .from("leads")
      .select("id, whatsapp_normalized")
      .in("whatsapp_normalized", fromNumbers);
    const leadByPhone = new Map<string, string>();
    for (const r of (leadsData ?? []) as Array<{ id: string; whatsapp_normalized: string }>) {
      leadByPhone.set(r.whatsapp_normalized, r.id);
    }

    for (const m of messages) {
      const phone = `+${m.from}`;
      const leadId = leadByPhone.get(phone);
      if (!leadId) { unmatchedNumbers.add(phone); continue; }
      matchedLeads.add(leadId);

      // Dedup: ya existe un lead_message_received en ±2 min del msg?
      const ts = new Date(m.timestamp).toISOString();
      const tsMinus = new Date(m.timestamp - 120_000).toISOString();
      const tsPlus  = new Date(m.timestamp + 120_000).toISOString();
      const { data: existing } = await sb
        .from("lead_timeline")
        .select("id")
        .eq("lead_id", leadId)
        .eq("type", "lead_message_received")
        .gte("timestamp", tsMinus)
        .lte("timestamp", tsPlus)
        .limit(1);
      if (existing && existing.length > 0) continue;

      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type: "lead_message_received",
        author: "lead",
        content: m.text.slice(0, 2000),
        timestamp: ts,
        metadata: {
          channel: "whatsapp",
          message_id: m.messageId,
          recovered: true,
          recovered_at: new Date().toISOString(),
        },
      });
      inserted++;
    }
  }

  // 5. Limpiar flag de downtime + crear notification de resumen.
  await sb.from("system_config").delete().eq("key", DOWNTIME_FLAG_KEY);
  await sb.from("system_config").upsert({ key: RECOVERY_KEY, value: new Date().toISOString() });

  if (inserted > 0) {
    await createAdminNotification({
      type: "inbound_recovered",
      severity: "warning",
      title: `📥 Recuperados ${inserted} mensajes de ${matchedLeads.size} leads`,
      body: `Tras downtime de Evolution (desde ${new Date(downAt).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })}), se rescataron ${inserted} mensajes inbound que no se habían procesado. Revisa los timelines correspondientes para responder.`,
      action_url: "/admin/leads?filter=needs_human",
      metadata: { inserted, matched_leads: Array.from(matchedLeads), unmatched_numbers: Array.from(unmatchedNumbers), downtime_started: downAt },
      dedupeHours: false,
    });
  }

  return NextResponse.json({
    ok: true,
    downtime_started: downAt,
    hours_window: hoursWindow,
    messages_seen: messages.length,
    inserted,
    matched_leads: matchedLeads.size,
    unmatched_numbers: Array.from(unmatchedNumbers).slice(0, 20),
  });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
