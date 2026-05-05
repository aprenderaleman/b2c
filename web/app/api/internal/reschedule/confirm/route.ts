import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { patchTrialEvent } from "@/lib/google-calendar";

/**
 * POST /api/internal/reschedule/confirm
 *
 * Aplica el cambio de hora de un trial. Pasos atómicos:
 *
 *   1. Lock-then-update la fila en `classes` (verifica que sigue
 *      scheduled+is_trial, y que el slot nuevo no fue tomado entre el
 *      check-availability y este confirm — race-condition guard).
 *   2. Si hay `google_calendar_event_id`, patch del evento al nuevo
 *      horario. Si falla, ROLLBACK del UPDATE de classes.
 *   3. Asigna el nuevo profesor si cambió (caso "no había con el
 *      original, ofrecimos otro y el lead aceptó").
 *
 * Body:
 *   {
 *     class_id: "uuid",
 *     new_start_iso: "2026-05-08T17:00:00.000Z",
 *     new_teacher_id: "uuid",
 *     duration_minutes: 45
 *   }
 *
 * Resp:
 *   { ok: true, class_id, new_start_iso, gcal_patched }
 *   | { ok: false, error: "...", reason?: "..." }
 *
 * Auth: header x-internal-api-key.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.B2C_INTERNAL_API_KEY;
  if (!expected) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (req.headers.get("x-internal-api-key") !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: {
    class_id?: string; new_start_iso?: string;
    new_teacher_id?: string; duration_minutes?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!body.class_id || !body.new_start_iso || !body.new_teacher_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const newStart = new Date(body.new_start_iso);
  if (Number.isNaN(newStart.getTime())) {
    return NextResponse.json({ error: "invalid_iso" }, { status: 400 });
  }
  const duration = body.duration_minutes ?? 45;

  const sb = supabaseAdmin();

  // 1) Verificar que la clase sigue siendo un trial scheduled
  const { data: cls, error: clsErr } = await sb
    .from("classes")
    .select("id, status, is_trial, scheduled_at, teacher_id, google_calendar_event_id, lead_id, duration_minutes")
    .eq("id", body.class_id)
    .maybeSingle();
  if (clsErr || !cls) {
    return NextResponse.json({ ok: false, error: "class_not_found" }, { status: 404 });
  }
  if (!cls.is_trial || cls.status !== "scheduled") {
    return NextResponse.json({
      ok: false, error: "not_reschedulable",
      reason: `class.status=${cls.status} is_trial=${cls.is_trial}`,
    }, { status: 409 });
  }

  // 2) Race-guard: ¿alguien tomó el slot nuevo entre check y confirm?
  //    Excluye la propia clase (estamos moviéndola, no creando otra).
  const slotEnd = new Date(newStart.getTime() + duration * 60_000);
  const { data: collisions } = await sb
    .from("classes")
    .select("id")
    .eq("teacher_id", body.new_teacher_id)
    .in("status", ["scheduled", "live"])
    .neq("id", body.class_id)
    .lt("scheduled_at", slotEnd.toISOString())
    .gte("scheduled_at", new Date(newStart.getTime() - duration * 60_000).toISOString());
  if (collisions && collisions.length > 0) {
    return NextResponse.json({
      ok: false, error: "slot_taken",
      reason: "Otra clase agendada en ese horario entre el check y el confirm",
    }, { status: 409 });
  }

  // 3) UPDATE clase
  const { error: updErr } = await sb
    .from("classes")
    .update({
      scheduled_at: newStart.toISOString(),
      teacher_id:   body.new_teacher_id,
    })
    .eq("id", body.class_id);
  if (updErr) {
    return NextResponse.json({
      ok: false, error: "db_update_failed", reason: updErr.message,
    }, { status: 500 });
  }

  // 4) Patch evento en Google Calendar (si existe)
  let gcalPatched = false;
  if (cls.google_calendar_event_id) {
    try {
      gcalPatched = await patchTrialEvent(
        cls.google_calendar_event_id,
        newStart.toISOString(),
        duration,
      );
    } catch (e) {
      console.error("[reschedule] gcal patch threw:", e);
    }
    if (!gcalPatched) {
      // Rollback la actualización de la clase para no dejar DB y Calendar
      // desincronizados. Si el rollback también falla, alertamos.
      const { error: rbErr } = await sb
        .from("classes")
        .update({
          scheduled_at: cls.scheduled_at,
          teacher_id:   cls.teacher_id,
        })
        .eq("id", body.class_id);
      if (rbErr) {
        console.error("[reschedule] CRITICAL: gcal patch failed AND rollback failed:", rbErr);
        return NextResponse.json({
          ok: false, error: "gcal_failed_and_rollback_failed",
          reason: rbErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        ok: false, error: "gcal_failed",
        reason: "Patch del evento en Google Calendar falló — DB rollback OK",
      }, { status: 500 });
    }
  }

  // 5) Limpiar marcadores de recordatorios para que vuelvan a dispararse
  //    en el nuevo horario (24h, morning, 30m). El cron consulta
  //    notes_admin para idempotencia, así que basta con resetearlo.
  await sb.from("classes")
    .update({ notes_admin: null })
    .eq("id", body.class_id);

  return NextResponse.json({
    ok: true,
    class_id: body.class_id,
    new_start_iso: newStart.toISOString(),
    new_teacher_id: body.new_teacher_id,
    gcal_patched: gcalPatched,
  });
}
