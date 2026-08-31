import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { rescheduleTrialForLead } from "@/lib/reschedule-trial";

/**
 * POST /api/admin/leads/[id]/reschedule-trial
 *
 * Disparado por el botón "Reagendar clase" en /admin/leads/[id].
 *
 * Body:
 *   {
 *     class_id:        "uuid",
 *     new_start_iso:   "2026-05-09T15:00:00Z",
 *     duration_minutes?: 30
 *   }
 *
 * La lógica (verificaciones, race-guard, patch GCal con rollback,
 * notificaciones, cierre de cadenas, timeline) vive en
 * lib/reschedule-trial.ts — compartida con el rol setter. Este route
 * solo hace la auth admin/cron y adapta la respuesta HTTP.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const Body = z.object({
  class_id:         z.string().uuid(),
  new_start_iso:    z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(180).optional(),
  // Optional teacher swap. Cuando se pasa, se reasigna la clase a ese
  // teacher_id y el race-guard se ejecuta contra el NUEVO teacher (no
  // el original). Añadido 2026-06-30 para casos "el profe no puede,
  // agéndalo con Gelfis". La UI no lo expone aún.
  new_teacher_id:   z.string().uuid().optional(),
});

/**
 * Auth flexible: session admin/superadmin (UI) O CRON_SECRET (curl
 * puntual para reagendados manuales). Añadido 2026-06-30.
 */
function isCronAuthd(req: Request): boolean {
  const e = process.env.CRON_SECRET;
  if (!e) return false;
  const b = req.headers.get("authorization");
  if (b && b.toLowerCase().startsWith("bearer ") && b.slice(7).trim() === e) return true;
  return req.headers.get("x-cron-secret") === e;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cronAuthd = isCronAuthd(req);
  const session   = cronAuthd ? null : await auth();
  if (!cronAuthd) {
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "admin" && role !== "superadmin") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const { id: leadId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const actorUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const actorEmail  = session?.user?.email ?? null;

  const result = await rescheduleTrialForLead({
    leadId,
    classId:         b.class_id,
    newStartIso:     b.new_start_iso,
    durationMinutes: b.duration_minutes,
    newTeacherId:    b.new_teacher_id,
    actor: {
      userId:         actorUserId,
      label:          cronAuthd ? "cron/curl" : (actorEmail ? `${actorEmail} (admin)` : "admin"),
      timelineAuthor: cronAuthd ? "system" : "admin",
    },
  });

  if (!result.ok) {
    const { status, ...rest } = result;
    return NextResponse.json({ ...rest }, { status });
  }
  return NextResponse.json(result);
}
