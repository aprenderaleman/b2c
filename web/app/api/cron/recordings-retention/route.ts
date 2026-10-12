import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { deleteRecordingObject } from "@/lib/r2";

/**
 * GET/POST /api/cron/recordings-retention
 *
 * Retención de grabaciones (Gelfis 2026-10-12, reducción de coste R2):
 * borra de R2 las grabaciones 'ready' con más de 90 días que NO estén
 * compartidas con profes (shared_with_teachers=false) y marca la fila
 * como status='deleted' (migración 139) conservándola para auditoría.
 *
 * Lotes de 40 por ejecución (cron diario — el backlog inicial de ~300
 * se drena en ~8 días). Si el borrado en R2 falla, la fila se queda
 * 'ready' y se reintenta mañana.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret (mismo patrón que el resto).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;
const BATCH = 40;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000).toISOString();

  const { data: rows, error } = await sb
    .from("recordings")
    .select("id, file_url")
    .eq("status", "ready")
    .eq("shared_with_teachers", false)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });

  let deleted = 0, failed = 0, skipped = 0;
  for (const r of (rows ?? []) as Array<{ id: string; file_url: string | null }>) {
    if (!r.file_url) {
      // Sin objeto que borrar — solo marcar.
      await sb.from("recordings").update({ status: "deleted", processed_at: new Date().toISOString() }).eq("id", r.id);
      skipped++;
      continue;
    }
    const ok = await deleteRecordingObject(r.file_url);
    if (!ok) { failed++; continue; }
    const { error: ue } = await sb
      .from("recordings")
      .update({ status: "deleted", file_url: null, processed_at: new Date().toISOString() })
      .eq("id", r.id);
    if (ue) { failed++; continue; }
    deleted++;
  }

  return NextResponse.json({ ok: true, checked: rows?.length ?? 0, deleted, skipped, failed });
}
