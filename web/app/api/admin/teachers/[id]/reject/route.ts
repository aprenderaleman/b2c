import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/teachers/[id]/reject
 *
 * Rechaza un profesor auto-registrado. Borra ambas filas (teachers +
 * users) — el candidato no recibe nada, simplemente desaparece del
 * sistema. Si en el futuro necesitas dejar trail, cambia a soft-
 * delete (users.deleted_at).
 *
 * Solo aceptamos rechazo en estado pending (registered_self=TRUE,
 * approved_at NULL) — no se puede "rechazar" a un profesor ya
 * aprobado por error.
 *
 * Auth: admin / superadmin.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id: teacherId } = await params;
  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("id, user_id, registered_self, approved_at")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher) {
    return NextResponse.json({ ok: false, error: "teacher_not_found" }, { status: 404 });
  }
  const t = teacher as { id: string; user_id: string; registered_self: boolean; approved_at: string | null };
  if (!t.registered_self || t.approved_at) {
    return NextResponse.json(
      { ok: false, error: "not_pending", message: "Solo se pueden rechazar profesores pendientes de aprobación." },
      { status: 409 },
    );
  }

  // Borra primero teachers (FK depende de users.id).
  await sb.from("teachers").delete().eq("id", t.id);
  await sb.from("users").delete().eq("id", t.user_id);

  return NextResponse.json({ ok: true });
}
