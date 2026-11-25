import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * CRM Closer F5 (Gelfis 2026-11-25) — tarea automática post-trial.
 *
 * A las 24h de un trial ASISTIDO sin pago, crea en tareas_closer la
 * tarea "Llamar a [lead]" (tipo llamada_24h, prioridad alta) para el
 * closer asignado por la rotación de F2. Vence al terminar el bono
 * (asistencia + 48h, decisión B). Mientras tanto el lead se ve "en
 * espera" en /closer/urgentes y el closer NO debe contactar.
 *
 * Idempotente: una sola tarea llamada_24h por lead. Backstop de 72h
 * para no inundar con leads viejos en el primer arranque.
 */

export const dynamic = "force-dynamic";

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

const H = 3_600_000;

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = Date.now();
  const cutoff24h = new Date(now - 24 * H).toISOString();
  const backstop  = new Date(now - 72 * H).toISOString();

  const { data: candidates, error } = await sb
    .from("leads")
    .select("id, name, closer_id, trial_attended_at")
    .not("closer_id", "is", null)
    .is("sesion_plan_at", null)          // los de sesión-plan tienen su propio flujo
    .is("converted_to_user_id", null)
    .lte("trial_attended_at", cutoff24h)
    .gte("trial_attended_at", backstop)
    .in("estado_cierre", ["activo", "seguimiento_pactado"])
    .not("status", "in", "(converted,lost)")
    .limit(100);

  if (error) {
    return NextResponse.json({ error: "select_failed", detail: error.message }, { status: 500 });
  }

  let created = 0;
  const skipped: string[] = [];

  for (const r of (candidates ?? []) as Array<{
    id: string; name: string | null; closer_id: string; trial_attended_at: string;
  }>) {
    // Una sola tarea por lead (aunque esté completada: no re-crear).
    const { count } = await sb
      .from("tareas_closer")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", r.id)
      .eq("tipo", "llamada_24h");
    if ((count ?? 0) > 0) { skipped.push(r.id); continue; }

    const attendedMs = new Date(r.trial_attended_at).getTime();
    const firstName = (r.name ?? "").trim().split(/\s+/)[0] || "el lead";

    const { error: insErr } = await sb.from("tareas_closer").insert({
      closer_id: r.closer_id,
      lead_id: r.id,
      paso: 1,
      tipo: "llamada_24h",
      canal: "llamada",
      plantilla: `Llamar a ${firstName} — asistió al trial y no ha pagado. El bono vence a las 48h de la clase.`,
      prioridad: "alta",
      fecha_programada: new Date(attendedMs + 24 * H).toISOString(),
      fecha_vence: new Date(attendedMs + 48 * H).toISOString(),   // fin del bono
    });
    if (insErr) {
      console.error(`[closer-llamada-24h] insert failed for lead ${r.id}: ${insErr.message}`);
      continue;
    }
    created++;
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates?.length ?? 0,
    created,
    alreadyHad: skipped.length,
  });
}
