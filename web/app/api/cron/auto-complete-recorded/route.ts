import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logClassHoursAndRollup } from "@/lib/finance";

/**
 * GET /api/cron/auto-complete-recorded  (cada 15 min)
 *
 * Cierra solas las clases regulares que se dieron pero el profe no pulsó
 * "Terminar clase" (Jonathan/Catalina 2026-10-22). Solo con EVIDENCIA
 * objetiva: existe una grabación de la clase (lista o en proceso) de al
 * menos 15 minutos. Respeta la política no-auto-cancel (2026-08-02): sin
 * grabación no se toca nada, solo se notifica (close-stale-classes).
 *
 * Acción: status → completed, asistencia = true para los participantes,
 * actual_duration = duración de la grabación, facturación normal
 * (logClassHoursAndRollup → trigger de saldo). Trials excluidos.
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

async function run(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();

  const now = Date.now();
  const since = new Date(now - 7 * 24 * 3600_000).toISOString();
  const { data: stale } = await sb
    .from("classes")
    .select("id, teacher_id, scheduled_at, duration_minutes, is_content_recording, recordings(status, duration_seconds)")
    .eq("status", "scheduled").eq("is_trial", false)
    .gte("scheduled_at", since)
    .lt("scheduled_at", new Date(now - 90 * 60_000).toISOString())   // empezó hace > 90 min
    .order("scheduled_at");

  const closed: string[] = []; const errors: Array<{ id: string; error: string }> = [];
  for (const c of (stale ?? []) as Array<{ id: string; teacher_id: string; scheduled_at: string; duration_minutes: number; is_content_recording: boolean | null; recordings: Array<{ status: string; duration_seconds: number | null }> }>) {
    const rec = (c.recordings ?? []).find(r => r.status === "ready" || r.status === "processing");
    if (!rec) continue;
    const start = new Date(c.scheduled_at).getTime();
    // Esperamos a que haya pasado la duración prevista + 30 min.
    if (now < start + (c.duration_minutes || 50) * 60_000 + 30 * 60_000) continue;
    const recMin = rec.duration_seconds != null ? Math.round(rec.duration_seconds / 60) : null;
    if (recMin != null && recMin < 15) continue;                      // sala abierta sin clase real
    const minutes = Math.max(15, Math.min(240, recMin ?? c.duration_minutes ?? 50));
    const endedAt = new Date(start + minutes * 60_000).toISOString();

    const { error: pErr } = await sb.from("class_participants").update({ attended: true }).eq("class_id", c.id);
    const { error: uErr } = await sb.from("classes").update({
      status: "completed", ended_at: endedAt, actual_duration_minutes: minutes,
      notes_admin: `Cerrada automáticamente: grabación de ${minutes} min, el profe no pulsó Terminar (${new Date().toISOString().slice(0, 10)})`,
    }).eq("id", c.id).eq("status", "scheduled");
    if (pErr || uErr) { errors.push({ id: c.id, error: (pErr ?? uErr)!.message }); continue; }
    if (!c.is_content_recording) {
      try { await logClassHoursAndRollup({ classId: c.id, teacherId: c.teacher_id, durationMinutes: minutes }); }
      catch (e) { errors.push({ id: c.id, error: `rollup: ${e instanceof Error ? e.message : "unknown"}` }); }
    }
    closed.push(c.id);
  }
  return NextResponse.json({ ok: true, candidates: (stale ?? []).length, closed, errors });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
