import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/students/{id}/recordings-enabled — toggle manual de
 * grabaciones por alumno (Bono de Acción Rápida, Gelfis 2026-11-26).
 * Body: { enabled: boolean }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["admin", "superadmin"]);
  const { id } = await params;

  let body: { enabled?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("students")
    .update({ recordings_enabled: body.enabled })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, enabled: body.enabled });
}
