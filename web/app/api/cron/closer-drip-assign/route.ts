import { NextResponse } from "next/server";

/**
 * GET /api/cron/closer-drip-assign — DESACTIVADO PERMANENTEMENTE.
 *
 * Vivió del 2026-08-05 al 2026-08-13: goteaba el backlog de leads que
 * ASISTIERON al trial hacia los closers (1 por closer por pasada).
 *
 * Decisión Gelfis 2026-08-13: los closers ya NO reciben leads
 * post-trial — su cartera es exclusivamente el funnel /sesion-plan
 * (leads con sesion_plan_at). Este cron quedó obsoleto y se retiró
 * de vercel.json. Se conserva el archivo como tombstone para que
 * nadie lo reactive por accidente sin conocer la decisión.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "gone",
      reason: "Desactivado 2026-08-13: los closers solo reciben leads del funnel /sesion-plan.",
    },
    { status: 410 },
  );
}
