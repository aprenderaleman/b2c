import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendSetterNoContestoMessage } from "@/lib/setter-messages";

/**
 * POST /api/cron/setter-no-contesto-backfill?limit=2 — one-off (Gelfis
 * 2026-10-27).
 *
 * Los "no contestó" que la setter marcó ANTES del fix 5e518b8 (no-shows)
 * no recibieron ningún mensaje. Este endpoint los drena DESPACIO: en
 * cada invocación envía como máximo `limit` (default 2) mensajes de
 * rescate, para no lanzar ráfagas desde el número en warm-up. Se invoca
 * a mano varias veces espaciadas hasta que devuelva pending=0.
 *
 * Idempotente: sendSetterNoContestoMessage escribe el timeline con
 * kind=setter_no_contesto, y aquí se excluye a todo lead que ya lo
 * tenga posterior a su "no contestó". Auth: CRON_SECRET.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(3, Math.max(1, parseInt(url.searchParams.get("limit") ?? "2", 10) || 2));

  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 72 * 3600_000).toISOString();

  // Último "no contestó" de setter por lead en 72h.
  const { data: contactsData } = await sb
    .from("lead_contacts")
    .select("lead_id, actor_name, occurred_at")
    .eq("actor_type", "setter")
    .eq("action_type", "no_contesto")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: true })
    .limit(500);
  const latestByLead = new Map<string, { actor_name: string | null; occurred_at: string }>();
  for (const c of (contactsData ?? []) as Array<{ lead_id: string; actor_name: string | null; occurred_at: string }>) {
    latestByLead.set(c.lead_id, { actor_name: c.actor_name, occurred_at: c.occurred_at });
  }
  if (latestByLead.size === 0) return NextResponse.json({ ok: true, sent: [], pending: 0 });

  const leadIds = [...latestByLead.keys()];
  const { data: leadsData } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, status, estado_cierre, trial_attended_at")
    .in("id", leadIds);

  // Candidatos: con WhatsApp, activos, sin mensaje setter_no_contesto
  // posterior a su "no contestó".
  const candidates: Array<{ leadId: string; name: string | null; setterName: string }> = [];
  for (const l of (leadsData ?? []) as Array<{
    id: string; name: string | null; whatsapp_normalized: string | null;
    status: string; estado_cierre: string | null; trial_attended_at: string | null;
  }>) {
    if (!l.whatsapp_normalized) continue;
    if (l.status === "converted" || l.status === "lost") continue;
    if (l.estado_cierre === "convertido" || l.estado_cierre === "perdido") continue;
    if (l.trial_attended_at) continue;
    const mark = latestByLead.get(l.id)!;
    const { data: already } = await sb
      .from("lead_timeline")
      .select("id")
      .eq("lead_id", l.id)
      .gte("timestamp", mark.occurred_at)
      .filter("metadata->>kind", "eq", "setter_no_contesto")
      .limit(1);
    if (already && already.length > 0) continue;
    candidates.push({ leadId: l.id, name: l.name, setterName: mark.actor_name ?? "el equipo" });
  }

  const batch = candidates.slice(0, limit);
  const sent: Array<{ lead: string | null; wa_sent: boolean; variant?: string; reason?: string }> = [];
  for (const c of batch) {
    const res = await sendSetterNoContestoMessage(c.leadId, c.setterName);
    sent.push({ lead: c.name, wa_sent: res.waSent, variant: res.variant, reason: res.reason });
  }

  return NextResponse.json({
    ok: true,
    sent,
    pending: candidates.length - batch.length,
  });
}
