import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/trial-classes/{id}/delete
 *
 * Hard-deletes a trial class. Used by /admin/clasedeprueba and
 * /profesor/clasedeprueba.
 *
 * AUTHZ:
 *   - admin / superadmin → may delete any trial class.
 *   - teacher           → may delete only classes they teach.
 *
 * Side effects:
 *   1. Logs a `status_change` row to lead_timeline so the lead's
 *      timeline preserves an audit trail of the deletion.
 *   2. If after deletion the lead has NO remaining future trial
 *      classes, clears `lead.trial_scheduled_at` and rolls
 *      `lead.status` back from 'trial_scheduled' / 'trial_reminded'
 *      to 'in_conversation' so the lead doesn't sit in a stale
 *      booked-but-no-class state.
 */
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id?: string }).id;
  if (!role || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: classId } = await params;
  const sb = supabaseAdmin();

  // Pull the class so we can authorise + log + clean up the lead.
  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id, lead_id, is_trial, scheduled_at, title")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const c = cls as {
    id: string;
    teacher_id: string;
    lead_id: string | null;
    is_trial: boolean;
    scheduled_at: string;
    title: string | null;
  };
  if (!c.is_trial) {
    return NextResponse.json(
      { error: "not_a_trial", message: "Esta ruta solo borra clases marcadas como is_trial." },
      { status: 400 },
    );
  }

  // Teacher may only delete their own classes.
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

  // Audit row BEFORE the delete (so we still have the lead_id).
  if (c.lead_id) {
    await sb.from("lead_timeline").insert({
      lead_id: c.lead_id,
      type:    "status_change",
      author:  role === "teacher" ? "teacher" : "admin",
      content: `🗑️ Clase de prueba eliminada (${new Date(c.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })})`,
      metadata: { class_id: c.id, deleted_by_role: role },
    });
  }

  // Delete the class. classes has no inbound FK that would block.
  const { error: delErr } = await sb.from("classes").delete().eq("id", classId);
  if (delErr) {
    return NextResponse.json(
      { error: "delete_failed", message: delErr.message },
      { status: 500 },
    );
  }

  // If the lead has no more upcoming trial classes, roll their state
  // back so they don't sit in a stale `trial_scheduled` status.
  if (c.lead_id) {
    const nowIso = new Date().toISOString();
    const { data: remaining } = await sb
      .from("classes")
      .select("id")
      .eq("lead_id", c.lead_id)
      .eq("is_trial", true)
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
