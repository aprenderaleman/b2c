import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET/POST /api/cron/funnel-progress-retention
 *
 * Weekly (domingos 04:00 UTC) — borra filas de funnel_progress más
 * viejas que 90 días. Sin retention la tabla crece indefinidamente
 * (~60/min/IP × N landings × N leads → ya 500k rows en 2 meses).
 *
 * 90 días cubre el análisis operativo (/admin/funnel usa rangos
 * de hasta 90d). Para análisis histórico más largo, mover primero
 * a una tabla `funnel_progress_archive` — no lo hacemos por ahora
 * (no se pide en operación).
 *
 * Batches de 10k para no bloquear la tabla. Loop hasta drenar.
 * Auth: CRON_SECRET.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;
const BATCH_SIZE     = 10_000;
const MAX_BATCHES    = 20;      // cap ~200k rows / run — más se hace en el siguiente tick

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
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

  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000).toISOString();

  let totalDeleted = 0;
  let batches = 0;
  const t0 = Date.now();

  for (let i = 0; i < MAX_BATCHES; i++) {
    // Supabase JS no soporta DELETE ... LIMIT directo. Truco: selecciona
    // los IDs a borrar en un batch, luego delete IN (ids).
    const { data: victims, error: selErr } = await sb
      .from("funnel_progress")
      .select("id")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (selErr) {
      console.error("[funnel-retention] select failed:", selErr.message);
      return NextResponse.json({ error: "select_failed", detail: selErr.message }, { status: 500 });
    }
    if (!victims || victims.length === 0) break;

    const ids = (victims as Array<{ id: string | number }>).map(v => v.id);
    const { error: delErr } = await sb.from("funnel_progress").delete().in("id", ids);
    if (delErr) {
      console.error("[funnel-retention] delete failed:", delErr.message);
      return NextResponse.json({ error: "delete_failed", detail: delErr.message, deleted_so_far: totalDeleted }, { status: 500 });
    }

    totalDeleted += ids.length;
    batches += 1;
    if (ids.length < BATCH_SIZE) break; // drenado
  }

  const elapsedMs = Date.now() - t0;
  console.log(`[funnel-retention] deleted=${totalDeleted} batches=${batches} elapsed=${elapsedMs}ms cutoff=${cutoff}`);

  return NextResponse.json({
    ok:            true,
    deleted:       totalDeleted,
    batches,
    cutoff,
    elapsed_ms:    elapsedMs,
    retention_days: RETENTION_DAYS,
  });
}
