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

  // ═══ Política no-auto-cancel 2026-08-02 (Gelfis) ═══
  // ANTES: auto-cerraba clases scheduled +12h como 'completed' +
  // marcaba TODOS los participants como no_show. Silencioso. Un profe
  // que olvidaba marcar attended perdía las horas y los alumnos
  // aparecían con no_show falso.
  // AHORA: solo NOTIFICA (timeline entry + email digest al admin).
  // La corrección la hace un humano desde /admin o /profesor.
  const notified: Array<{ id: string; scheduled_at: string }> = [];
  const errors:   Array<{ id: string; error: string }> = [];

  const todayIso = new Date().toISOString().slice(0, 10);
  for (const c of stale ?? []) {
    const cls = c as { id: string; scheduled_at: string; duration_minutes?: number; notes_admin?: string | null };

    // Skip si ya tiene el badge de hoy (evita spam en el timeline).
    if ((cls.notes_admin ?? "").includes(`[stale_class_notified_${todayIso}]`)) continue;

    // Marca el badge en notes_admin (idempotencia por día).
    const newNotes = ((cls.notes_admin ?? "").length > 0
      ? `${cls.notes_admin} [stale_class_notified_${todayIso}]`
      : `[stale_class_notified_${todayIso}]`);
    const { error: uerr } = await sb.from("classes")
      .update({ notes_admin: newNotes })
      .eq("id", cls.id);
    if (uerr) {
      errors.push({ id: cls.id, error: uerr.message });
      continue;
    }

    notified.push({ id: cls.id, scheduled_at: cls.scheduled_at });
  }

  return NextResponse.json({
    ok:         true,
    processed:  (stale ?? []).length,
    notified:   notified.length,
    errors:     errors.length,
    pattern:    "notify_only_no_action",
    policy_doc: "docs/no-auto-cancel-policy.md",
    detail:     { notified, errors },
  });
}

export const POST = GET;
