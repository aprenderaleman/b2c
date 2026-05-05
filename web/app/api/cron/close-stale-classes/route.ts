import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/close-stale-classes
 *
 * Cierra automáticamente las clases `scheduled` cuyo `scheduled_at` ya
 * pasó hace más de 12 horas. Esto cubre dos casos:
 *
 *   1) La clase tuvo grabación pero el cron de matching no la cerró
 *      (raro). El sistema tiene 12h para hacerlo.
 *
 *   2) NO hubo grabación: el profe abrió la sala, no entró nadie y
 *      por eso no hay grabación. Igual hay que pagarle al profe y
 *      descontar la sesión a los alumnos asignados (no-show).
 *
 * Acción por clase stale:
 *   - status: 'scheduled' → 'completed'
 *   - actual_duration_minutes := duration_minutes (asumido)
 *   - billed_hours: 0 → calcular según duración (15-90→1, >90→2)
 *   - notes_admin += "; auto_closed_no_show=true"
 *   - class_participants.attended := false (todos)
 *
 * Solo procesa clases cuyo scheduled_at esté en los últimos 30 días
 * (no toca cosas muy viejas).
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  if (xh && xh === expected) return true;
  return false;
}

function billedHours(min: number): number {
  if (min < 15) return 0;
  if (min <= 90) return 1;
  return 2;
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const cutoffOld = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const cutoffMax = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: stale, error } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, title, billed_hours, notes_admin")
    .eq("status", "scheduled")
    .lt("scheduled_at", cutoffOld)
    .gt("scheduled_at", cutoffMax)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const closed: Array<{ id: string; scheduled_at: string; bill: number }> = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const c of stale ?? []) {
    const dur = (c as { duration_minutes?: number }).duration_minutes ?? 0;
    const bill = billedHours(dur);
    const newNotes = ((c as { notes_admin?: string | null }).notes_admin || "").length > 0
      ? `${(c as { notes_admin?: string | null }).notes_admin}; auto_closed_no_show=true`
      : `auto_closed_no_show=true`;

    const startedAt = new Date((c as { scheduled_at: string }).scheduled_at).toISOString();
    const endedAt   = new Date(new Date(startedAt).getTime() + dur * 60 * 1000).toISOString();

    const { error: uerr } = await sb
      .from("classes")
      .update({
        status: "completed",
        actual_duration_minutes: dur,
        billed_hours: bill,
        started_at: startedAt,
        ended_at:   endedAt,
        notes_admin: newNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (c as { id: string }).id);

    if (uerr) {
      errors.push({ id: (c as { id: string }).id, error: uerr.message });
      continue;
    }

    // Marcar todos los participants como attended=false (no_show)
    await sb
      .from("class_participants")
      .update({ attended: false, cancellation_type: "no_show" })
      .eq("class_id", (c as { id: string }).id)
      .is("attended", null);   // solo los que no estaban marcados aún

    closed.push({
      id:           (c as { id: string }).id,
      scheduled_at: (c as { scheduled_at: string }).scheduled_at,
      bill,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: (stale ?? []).length,
    closed:    closed.length,
    errors:    errors.length,
    detail:    { closed, errors },
  });
}

export const POST = GET;
