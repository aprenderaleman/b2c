import { NextResponse } from "next/server";
import { sendRescheduleLinkMessage } from "@/lib/admin-actions";

/**
 * POST /api/admin/_manual/reschedule-backfill
 *
 * Endpoint one-shot para disparar la cadena "reagendar" en un lote
 * de leads concretos (backfill / rescate manual). Creado tras el
 * incidente trial-slot-release 2026-08-02.
 *
 * Auth: Bearer CRON_SECRET (no requiere sesión de usuario — se puede
 * curlear desde local con el env del cron).
 *
 * Body: { leadIds: string[] }
 *
 * Reutiliza sendRescheduleLinkMessage() de admin-actions, que hace:
 *   1. Cancela la clase futura del lead (si existe) — silencioso.
 *   2. Setea leads.status='rescheduling', trial_scheduled_at=null.
 *   3. Envía por WA el link reagendar.
 *   4. Timeline audit.
 *
 * Si el lead ya está en 'rescheduling' (nuestro caso), los pasos 1
 * y 2 son idempotentes; el paso 3 (WA) es lo que nos interesa.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function POST(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { leadIds?: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const ids = Array.isArray(body.leadIds) ? body.leadIds.filter(x => typeof x === "string" && x.length > 8) : [];
  if (ids.length === 0) return NextResponse.json({ error: "missing_leadIds" }, { status: 400 });
  if (ids.length > 20) return NextResponse.json({ error: "too_many_ids", max: 20 }, { status: 400 });

  const results: Array<{ leadId: string; ok: boolean; reason?: string }> = [];
  for (const leadId of ids) {
    try {
      const r = await sendRescheduleLinkMessage(leadId);
      results.push({ leadId, ok: r.ok, reason: r.reason });
      // pequeño delay para no saturar Evolution
      await new Promise(res => setTimeout(res, 3000));
    } catch (err) {
      results.push({ leadId, ok: false, reason: err instanceof Error ? err.message : "unknown" });
    }
  }

  const okCount = results.filter(r => r.ok).length;
  return NextResponse.json({ ok: true, sent: okCount, total: ids.length, results });
}
