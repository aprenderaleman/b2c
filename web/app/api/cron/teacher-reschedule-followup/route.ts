import { NextResponse } from "next/server";

/**
 * GET/POST /api/cron/teacher-reschedule-followup
 *
 * Gelfis 2026-11-15: desactivado. El follow-up +24h tras "Reagendar"
 * lo gestiona ahora /api/cron/post-trial-followups-24h a través de la
 * cola post_trial_followups (con dedup por respuesta/conversión/
 * nueva acción). La entrada en vercel.json se puede quitar en un
 * commit de limpieza — por ahora el handler responde instantáneo.
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
  return NextResponse.json({ ok: true, disabled: true, replaced_by: "post-trial-followups-24h" });
}
