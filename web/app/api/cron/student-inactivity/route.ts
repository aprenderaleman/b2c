import { NextResponse } from "next/server";
import { runStudentInactivity } from "@/lib/student-inactivity";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/student-inactivity — reactivación automática de alumnos
 * sin clases (Gelfis 2026-10-30). Diario 08:00 UTC (vercel.json).
 * `?dry=1` devuelve los candidatos sin enviar nada.
 */
function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const r = await runStudentInactivity({ dryRun: dry });
  return NextResponse.json({
    ok: true, dry, sent: r.sent,
    candidates: r.candidates.map(c => ({ name: c.name, email: c.email, kind: c.kind, last_class: c.lastCompletedAt?.toISOString().slice(0, 10) ?? null, remaining: c.remaining, teacher: c.teacher?.name ?? null })),
  });
}
