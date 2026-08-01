import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["superadmin", "admin"]);
  const { id } = await params;

  const sb = supabaseAdmin();

  const { data: user } = await sb
    .from("users")
    .select("id, flujo_activo, role")
    .eq("id", id)
    .single();

  if (!user || (user as { role: string }).role !== "closer") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const current = (user as { flujo_activo: boolean }).flujo_activo;
  const { error } = await sb
    .from("users")
    .update({ flujo_activo: !current })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, flujo_activo: !current });
}
