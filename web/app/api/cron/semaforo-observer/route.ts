import { NextResponse } from "next/server";
import { observeTransitions } from "@/lib/semaforo-observer";

/**
 * GET/POST /api/cron/semaforo-observer — cada 10 min (vercel.json).
 *
 * Recalcula el semáforo de los leads activos y registra los cambios
 * en semaforo_transitions (append-only). NUNCA ejecuta acciones sobre
 * leads — regla de la casa: automatismos notifican, humanos deciden.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
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

  const result = await observeTransitions();
  return NextResponse.json({ ok: true, ...result });
}
