import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/admin-notifications";

/**
 * GET /api/cron/duplicate-monitor
 *
 * Capa-2 anti-duplicados (Gelfis 2026-10-23). Cron cada 15 minutos.
 * Agrupa system_message_sent de las últimas 24h por (lead_id, primer
 * trozo de content) y detecta cualquier combo con count >= 3 — señal
 * clara de que un chain está en loop (como el incidente del preludio
 * testimonial).
 *
 * Para cada combo repetido:
 *   1. Pausa TODAS las chains activas del lead (paused_until = +24h) para
 *      cortar el goteo en seco.
 *   2. Crea notificación admin critical con detalle.
 *   3. Deja nota en el timeline del lead para contexto.
 *
 * Idempotencia: una notif por combo detectado por ciclo. Si el combo
 * sigue vigente en el próximo ciclo, se vuelve a notificar — señal de
 * que la pausa no bastó.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNIPPET_LEN  = 60;
const WINDOW_HOURS = 24;
const THRESHOLD    = 3;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  if (req.headers.get("x-cron-secret") === expected) return true;
  return false;
}

type TimelineRow = {
  lead_id:   string;
  content:   string | null;
  timestamp: string;
};

async function runMonitor(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  // Capa de query: traemos los últimos 2000 system_message_sent y
  // agrupamos en memoria. No usamos función SQL para no requerir migración.
  const { data, error } = await sb
    .from("lead_timeline")
    .select("lead_id, content, timestamp")
    .eq("type", "system_message_sent")
    .gte("timestamp", sinceIso)
    .order("timestamp", { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as TimelineRow[];
  const groups = new Map<string, { lead_id: string; snippet: string; count: number; last_at: string }>();

  for (const r of rows) {
    const snippet = (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, SNIPPET_LEN);
    if (!snippet) continue;
    const key = `${r.lead_id}::${snippet}`;
    const cur = groups.get(key);
    if (cur) {
      cur.count += 1;
      if (r.timestamp > cur.last_at) cur.last_at = r.timestamp;
    } else {
      groups.set(key, { lead_id: r.lead_id, snippet, count: 1, last_at: r.timestamp });
    }
  }

  const offenders = [...groups.values()].filter(g => g.count >= THRESHOLD);
  const results: Array<Record<string, unknown>> = [];

  for (const o of offenders) {
    // Lead info (nombre + whatsapp)
    const { data: lead } = await sb
      .from("leads")
      .select("id, name, whatsapp_normalized, status")
      .eq("id", o.lead_id)
      .maybeSingle();
    const name  = (lead as { name?: string } | null)?.name ?? "?";
    const phone = (lead as { whatsapp_normalized?: string } | null)?.whatsapp_normalized ?? "?";

    // Pausar TODAS las chains activas del lead +24h.
    const pauseUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { data: pausedChains } = await sb
      .from("lead_chains")
      .update({ paused_until: pauseUntil })
      .is("completed_at", null)
      .is("cancel_reason", null)
      .eq("lead_id", o.lead_id)
      .select("id, chain_type");
    const pausedList = (pausedChains ?? []) as Array<{ id: string; chain_type: string }>;

    // Timeline note (hunting trail)
    await sb.from("lead_timeline").insert({
      lead_id: o.lead_id,
      type: "agent_note",
      author: "duplicate_monitor",
      content: `⚠️ Duplicado detectado: "${o.snippet}" se envió ${o.count}× en últimas ${WINDOW_HOURS}h. ${pausedList.length} chain(s) pausada(s) +24h.`,
      metadata: {
        kind:  "duplicate_detection",
        count: o.count,
        snippet: o.snippet,
        paused_chains: pausedList.map(c => c.id),
      },
    });

    // Admin notification critical
    await createAdminNotification({
      type:       "duplicate_messages_detected",
      severity:   "critical",
      title:      `${name} recibió el mismo mensaje ${o.count}× en 24h`,
      body:       `"${o.snippet}" — ${pausedList.length} chain(s) pausada(s) +24h. Revisa y arregla raíz.`,
      lead_id:    o.lead_id,
      action_url: `/admin/leads/${o.lead_id}`,
      dedupeHours: 6,
    });

    results.push({
      lead_id: o.lead_id,
      name,
      phone,
      count: o.count,
      snippet: o.snippet,
      paused_chains: pausedList.length,
    });
  }

  return NextResponse.json({
    ok: true,
    scanned_rows:     rows.length,
    groups_total:     groups.size,
    offenders_total:  offenders.length,
    actioned:         results,
  });
}

export async function GET(req: Request)  { return runMonitor(req); }
export async function POST(req: Request) { return runMonitor(req); }
