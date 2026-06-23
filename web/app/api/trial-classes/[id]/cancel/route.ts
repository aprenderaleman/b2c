import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/trial-classes/{id}/cancel
 *
 * Cancela una clase de prueba sin borrarla (status='cancelled').
 * Reemplaza el "Eliminar" del profesor por una opción NO destructiva
 * — mantiene historial completo y permite reportar/auditar. Solo el
 * superadmin puede eliminar definitivamente (endpoint /delete separado).
 *
 * NO envía mensaje al lead (decisión Gelfis 2026-06-23).
 *
 * AUTHZ:
 *   - teacher → solo sus propias clases.
 *   - admin / superadmin → cualquier clase.
 *
 * Side effects:
 *   - classes.status = 'cancelled'
 *   - lead_timeline: agent_note de auditoría
 *   - Si lead no tiene otra trial futura → rollback de status del lead
 *     a 'in_conversation' (igual que el endpoint /delete).
 */
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id?: string }).id;
  if (!role || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: classId } = await params;
  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id, lead_id, is_trial, status, scheduled_at")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const c = cls as {
    id: string;
    teacher_id: string;
    lead_id: string | null;
    is_trial: boolean;
    status: string;
    scheduled_at: string;
  };
  if (!c.is_trial) {
    return NextResponse.json(
      { error: "not_a_trial", message: "Esta ruta solo cancela clases marcadas como is_trial." },
      { status: 400 },
    );
  }
  if (c.status === "cancelled") {
    return NextResponse.json({ ok: true, already_cancelled: true });
  }

  if (role === "teacher") {
    const { data: teacher } = await sb
      .from("teachers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!teacher || (teacher as { id: string }).id !== c.teacher_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Audit en timeline antes de cancelar (para mantener la traza).
  if (c.lead_id) {
    await sb.from("lead_timeline").insert({
      lead_id: c.lead_id,
      type:    "status_change",
      author:  role === "teacher" ? "teacher" : "admin",
      content: `🚫 Clase de prueba cancelada (${new Date(c.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })} Berlín)`,
      metadata: { class_id: c.id, cancelled_by_role: role, kind: "trial_cancelled" },
    });
  }

  const { error: updErr } = await sb
    .from("classes")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", classId);
  if (updErr) {
    return NextResponse.json({ error: "cancel_failed", message: updErr.message }, { status: 500 });
  }

  // Si el lead ya no tiene otra trial futura, rollback status.
  if (c.lead_id) {
    const nowIso = new Date().toISOString();
    const { data: remaining } = await sb
      .from("classes")
      .select("id")
      .eq("lead_id", c.lead_id)
      .eq("is_trial", true)
      .eq("status", "scheduled")
      .gte("scheduled_at", nowIso)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      const { data: leadRow } = await sb
        .from("leads")
        .select("id, status")
        .eq("id", c.lead_id)
        .maybeSingle();
      const currentStatus = (leadRow as { status?: string } | null)?.status;
      const update: Record<string, unknown> = { trial_scheduled_at: null };
      if (currentStatus === "trial_scheduled" || currentStatus === "trial_reminded") {
        update.status = "in_conversation";
      }
      await sb.from("leads").update(update).eq("id", c.lead_id);
    }
  }

  return NextResponse.json({ ok: true });
}
