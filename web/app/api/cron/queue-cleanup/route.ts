import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET/POST /api/cron/queue-cleanup
 *
 * Limpia outbound_queue de filas viejas para que la tabla no crezca
 * sin límite. Caso real Gelfis 2026-05-10: 456k filas acumuladas en
 * 7 días por un loop del productor.
 *
 * Reglas:
 *   - status='failed_permanent' con created_at > 7 días → DELETE
 *   - status='sent'             con sent_at    > 7 días → DELETE
 *   - status='queued'           con created_at > 30 días → DELETE
 *     (filas zombie que ningún drainer va a tocar)
 *
 * Schedule: una vez al día. Idempotente.
 *
 * Auth: CRON_SECRET via Bearer o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const now = Date.now();

  const cutoff7d  = new Date(now - 7  * 24 * 3600_000).toISOString();
  const cutoff30d = new Date(now - 30 * 24 * 3600_000).toISOString();

  const [r1, r2, r3] = await Promise.all([
    sb.from("outbound_queue")
      .delete({ count: "exact" })
      .eq("status", "failed_permanent")
      .lt("created_at", cutoff7d),
    sb.from("outbound_queue")
      .delete({ count: "exact" })
      .eq("status", "sent")
      .lt("sent_at", cutoff7d),
    sb.from("outbound_queue")
      .delete({ count: "exact" })
      .eq("status", "queued")
      .lt("created_at", cutoff30d),
  ]);

  return NextResponse.json({
    ok: true,
    failed_permanent_deleted: r1.count ?? 0,
    sent_deleted:             r2.count ?? 0,
    zombie_queued_deleted:    r3.count ?? 0,
  });
}
