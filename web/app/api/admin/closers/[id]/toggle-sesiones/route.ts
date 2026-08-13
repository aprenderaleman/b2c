import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/closers/[id]/toggle-sesiones — enciende/apaga el grifo
 * de Sesiones de Plan del closer (users.acepta_sesiones). Independiente
 * de flujo_activo (cadencias).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["superadmin", "admin"]);
  const { id } = await params;

  const sb = supabaseAdmin();

  const { data: user } = await sb
    .from("users")
    .select("id, acepta_sesiones, role")
    .eq("id", id)
    .single();

  if (!user || (user as { role: string }).role !== "closer") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const current = (user as { acepta_sesiones: boolean }).acepta_sesiones;
  const { error } = await sb
    .from("users")
    .update({ acepta_sesiones: !current })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, acepta_sesiones: !current });
}
