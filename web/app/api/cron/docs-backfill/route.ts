import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createStudentNotesDoc, getTeacherEmail } from "@/lib/google-docs";

/**
 * GET /api/cron/docs-backfill — diario (vercel.json).
 *
 * Crea el Google Doc "Apuntes de Clase" a los alumnos activos que no lo
 * tengan (p. ej. porque GOOGLE_SERVICE_ACCOUNT_JSON estaba vacía al
 * convertirlos — sept 2026, 7 alumnos). Idempotente: solo toca
 * students.document_url IS NULL. Si la clave sigue mal, no hace nada y
 * lo dice en la respuesta.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorisedCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return NextResponse.json({ ok: false, reason: "GOOGLE_SERVICE_ACCOUNT_JSON vacía — nada que hacer" });
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("students")
    .select("id, current_level, trial_teacher_id, users!inner(full_name, active)")
    .is("document_url", null)
    .eq("users.active", true);

  type Row = { id: string; current_level: string | null; trial_teacher_id: string | null;
    users: { full_name: string | null } | Array<{ full_name: string | null }> };
  const results: Array<{ name: string; ok: boolean; url?: string }> = [];

  for (const raw of (data ?? []) as Row[]) {
    const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
    const name = u?.full_name ?? "Estudiante";
    let teacherName = "Profesor";
    let teacherEmail: string | null = null;
    if (raw.trial_teacher_id) {
      teacherEmail = await getTeacherEmail(raw.trial_teacher_id);
      const { data: t } = await sb.from("teachers").select("users!inner(full_name)").eq("id", raw.trial_teacher_id).maybeSingle();
      const tuRaw = (t as { users?: unknown } | null)?.users;
      const tu = (Array.isArray(tuRaw) ? tuRaw[0] : tuRaw) as { full_name?: string | null } | undefined;
      teacherName = tu?.full_name ?? "Profesor";
    }
    const doc = await createStudentNotesDoc(name, raw.current_level ?? "A1", teacherName, teacherEmail);
    if (!doc) { results.push({ name, ok: false }); continue; }
    await sb.from("students").update({ document_url: doc.url }).eq("id", raw.id);
    const { data: g } = await sb
      .from("student_group_members")
      .select("group_id, student_groups!inner(active)")
      .eq("student_id", raw.id)
      .eq("student_groups.active", true)
      .limit(1);
    const gid = (g?.[0] as { group_id?: string } | undefined)?.group_id;
    if (gid) await sb.from("student_groups").update({ document_url: doc.url }).eq("id", gid);
    results.push({ name, ok: true, url: doc.url });
  }

  return NextResponse.json({ ok: true, created: results.filter(r => r.ok).length, results });
}
