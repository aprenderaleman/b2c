import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRole } from "@/lib/rbac";
import { parseCommissionPct, setTeacherCommissionPct } from "@/lib/teacher-commission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_RANKS = ["starter", "pro", "elite", "master"];

/**
 * PATCH /api/admin/teachers/[id]/rank
 *
 * Body (uno o ambos):
 *   { rango: "starter" | "pro" | "elite" | "master" }
 *   { comision_pct: number | null }   ← comisión ACORDADA, número libre 0–100
 *                                        (2026-11-26). null = quitar el acuerdo
 *                                        y volver al % del rango.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(["superadmin", "admin"]);

  const { id: teacherId } = await params;

  let body: { rango?: string; comision_pct?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const hasRank = body.rango !== undefined;
  const hasPct = Object.prototype.hasOwnProperty.call(body, "comision_pct");
  if (!hasRank && !hasPct) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }
  if (hasRank && (!body.rango || !VALID_RANKS.includes(body.rango))) {
    return NextResponse.json({ error: "invalid_rank", valid: VALID_RANKS }, { status: 400 });
  }
  let pct: number | null = null;
  if (hasPct && body.comision_pct !== null) {
    pct = parseCommissionPct(body.comision_pct);
    if (pct === null) return NextResponse.json({ error: "La comisión debe ser un número entre 0 y 100." }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher) {
    return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
  }
  const userId = (teacher as { user_id: string }).user_id;

  if (hasRank) {
    const { error } = await sb.from("users").update({ rango: body.rango }).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (hasPct) {
    const r = await setTeacherCommissionPct(userId, pct);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...(hasRank ? { rango: body.rango } : {}), ...(hasPct ? { comision_pct: pct } : {}) });
}
