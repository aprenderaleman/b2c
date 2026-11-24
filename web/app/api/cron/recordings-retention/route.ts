import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { deleteRecordingObject } from "@/lib/r2";

/**
 * GET/POST /api/cron/recordings-retention
 *
 * Retención de grabaciones (reescrito Gelfis 2026-11-26, Bono de Acción
 * Rápida). Reglas, por tipo de grabación:
 *
 *   1. TRIAL cuyo lead NO convirtió (o convirtió sin bono):
 *      borrar a los TRIAL_SIN_CONVERSION_DIAS (14).
 *   2. TRIAL cuyo lead convirtió en alumno con recordings_enabled:
 *      es su "primera grabación" — sigue las reglas de alumno (3).
 *   3. Grabación de alumno con recordings_enabled:
 *      se conserva mientras su usuario esté ACTIVO. Si el usuario se
 *      desactiva (fin/cancelación del plan), se borra cuando su última
 *      clase quede a más de POST_PLAN_DIAS (30) — "plan activo + 30 días".
 *   4. Resto (legado del muestreo interno, clases sin alumno con bono):
 *      regla clásica de LEGACY_DIAS (30).
 *
 *   `shared_with_teachers=true` nunca se borra (igual que antes).
 *
 * Si el borrado en R2 falla, la fila queda 'ready' y se reintenta mañana.
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRIAL_SIN_CONVERSION_DIAS = 14;
const POST_PLAN_DIAS = 30;
const LEGACY_DIAS = 30;
const BATCH = 100;
const D = 24 * 3600_000;

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

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const sb = supabaseAdmin();
  const now = Date.now();
  // Horizonte mínimo: nada con menos de 14 días se toca nunca.
  const minCutoff = new Date(now - TRIAL_SIN_CONVERSION_DIAS * D).toISOString();

  // Paginamos por cursor: las grabaciones de alumnos con bono activo se
  // CONSERVAN y envejecen, así que un solo lote por created_at ascendente
  // se atascaría en ellas. Hasta 10 páginas de BATCH por ejecución.
  type Row = {
    id: string; file_url: string | null; created_at: string;
    class: { id: string; is_trial: boolean | null; lead_id: string | null }
         | Array<{ id: string; is_trial: boolean | null; lead_id: string | null }>;
  };
  const collected: Row[] = [];
  let cursor = "1970-01-01";
  for (let page = 0; page < 10; page++) {
    const { data: rows, error } = await sb
      .from("recordings")
      .select("id, file_url, created_at, class:classes!inner(id, is_trial, lead_id)")
      .eq("status", "ready")
      .eq("shared_with_teachers", false)
      .gt("created_at", cursor)
      .lt("created_at", minCutoff)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });
    const batch = (rows ?? []) as Row[];
    collected.push(...batch);
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].created_at;
  }
  const recs = collected.map(r => ({
    ...r,
    cls: Array.isArray(r.class) ? r.class[0] : r.class,
  }));
  if (recs.length === 0) return NextResponse.json({ ok: true, checked: 0, deleted: 0, kept: 0, failed: 0 });

  // ── Datos de apoyo en lote ──
  const classIds = [...new Set(recs.map(r => r.cls.id))];
  const leadIds  = [...new Set(recs.map(r => r.cls.lead_id).filter((x): x is string => !!x))];

  // Alumnos con bono por clase (participantes).
  const partsByClass = new Map<string, string[]>(); // class_id → student_ids
  {
    const { data } = await sb
      .from("class_participants").select("class_id, student_id").in("class_id", classIds);
    for (const p of (data ?? []) as Array<{ class_id: string; student_id: string }>) {
      const arr = partsByClass.get(p.class_id) ?? [];
      arr.push(p.student_id);
      partsByClass.set(p.class_id, arr);
    }
  }

  // Leads de trials → alumno convertido.
  const studentByLead = new Map<string, string>(); // lead_id → student user_id… (student id)
  if (leadIds.length > 0) {
    const { data } = await sb
      .from("students").select("id, lead_id").in("lead_id", leadIds);
    for (const s of (data ?? []) as Array<{ id: string; lead_id: string | null }>) {
      if (s.lead_id) studentByLead.set(s.lead_id, s.id);
    }
  }

  // Estado de cada student relevante: recordings_enabled + user activo.
  const allStudentIds = [...new Set([
    ...[...partsByClass.values()].flat(),
    ...studentByLead.values(),
  ])];
  const studentState = new Map<string, { enabled: boolean; active: boolean }>();
  if (allStudentIds.length > 0) {
    const { data } = await sb
      .from("students")
      .select("id, recordings_enabled, users!inner(active)")
      .in("id", allStudentIds);
    for (const s of (data ?? []) as Array<{ id: string; recordings_enabled: boolean; users: { active: boolean } | Array<{ active: boolean }> }>) {
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      studentState.set(s.id, { enabled: Boolean(s.recordings_enabled), active: Boolean(u?.active) });
    }
  }

  // Última clase por student (solo para los inactivos con bono — decide
  // el "plan + 30 días").
  const inactiveEnabled = allStudentIds.filter(id => {
    const st = studentState.get(id);
    return st?.enabled && !st.active;
  });
  const lastClassByStudent = new Map<string, number>();
  for (const sid of inactiveEnabled) {
    const { data: pcs } = await sb
      .from("class_participants").select("class_id").eq("student_id", sid).limit(1000);
    const ids = ((pcs ?? []) as Array<{ class_id: string }>).map(p => p.class_id);
    if (ids.length === 0) continue;
    const { data: cls } = await sb
      .from("classes").select("scheduled_at").in("id", ids)
      .order("scheduled_at", { ascending: false }).limit(1);
    const top = (cls ?? [])[0] as { scheduled_at: string } | undefined;
    if (top) lastClassByStudent.set(sid, new Date(top.scheduled_at).getTime());
  }

  /** ¿Este student (con bono) aún retiene sus grabaciones? */
  const studentRetains = (sid: string): boolean => {
    const st = studentState.get(sid);
    if (!st?.enabled) return false;
    if (st.active) return true;                      // plan activo → conservar
    const last = lastClassByStudent.get(sid);
    return last != null && now - last < POST_PLAN_DIAS * D;  // +30 días de gracia
  };

  let deleted = 0, kept = 0, failed = 0;
  const legacyCutoff = now - LEGACY_DIAS * D;

  for (const r of recs) {
    let shouldDelete: boolean;

    if (r.cls.is_trial) {
      const sid = r.cls.lead_id ? studentByLead.get(r.cls.lead_id) : undefined;
      // Regla 2/3: convertido con bono → retención de alumno.
      // Regla 1: no convertido (o sin bono) → ya pasó los 14 días del batch.
      shouldDelete = !(sid && studentRetains(sid));
    } else {
      const sids = partsByClass.get(r.cls.id) ?? [];
      const bonoRetains = sids.some(studentRetains);
      if (bonoRetains) {
        shouldDelete = false;                        // regla 3
      } else if (sids.some(sid => studentState.get(sid)?.enabled)) {
        shouldDelete = true;                         // bono terminado +30d
      } else {
        // Regla 4 (legado): 30 días.
        shouldDelete = new Date(r.created_at).getTime() < legacyCutoff;
      }
    }

    if (!shouldDelete) { kept++; continue; }
    if (dryRun) { deleted++; continue; }

    if (!r.file_url) {
      await sb.from("recordings").update({ status: "deleted", processed_at: new Date().toISOString() }).eq("id", r.id);
      deleted++;
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

  return NextResponse.json({ ok: true, dry_run: dryRun, checked: recs.length, deleted, kept, failed });
}
