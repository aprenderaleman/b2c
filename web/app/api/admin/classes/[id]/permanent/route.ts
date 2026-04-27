import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * DELETE /api/admin/classes/{id}/permanent — HARD delete a class.
 *
 * Versus the soft DELETE on /api/admin/classes/{id} (which sets
 * status='cancelled' and preserves the row), this nukes the class row
 * itself. Cascades take care of:
 *   - class_participants (FK CASCADE)
 *   - notifications, recordings, homework, chat threads, finance
 *     invoices (all FK CASCADE on classes.id)
 *
 * Refuses to delete classes with status='completed' — those carry
 * attendance + billing history and should stay as audit trail. Cancelled
 * and scheduled classes are fair game.
 *
 * Optional `?whole=1` deletes the WHOLE recurring series (this anchor
 * + every sibling sharing parent_class_id), again skipping any
 * completed sibling.
 *
 * Admin-only.
 */
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const whole = url.searchParams.get("whole") === "1";

  const sb = supabaseAdmin();

  const { data: anchor, error: anchorErr } = await sb
    .from("classes")
    .select("id, status, parent_class_id")
    .eq("id", id)
    .maybeSingle();
  if (anchorErr) {
    return NextResponse.json({ error: "lookup_failed", message: anchorErr.message }, { status: 500 });
  }
  if (!anchor) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const anchorRow = anchor as { id: string; status: string; parent_class_id: string | null };

  // Build the candidate id list.
  let candidateIds: string[] = [anchorRow.id];
  if (whole) {
    const parentId = anchorRow.parent_class_id ?? anchorRow.id;
    const { data: siblings, error: sibErr } = await sb
      .from("classes")
      .select("id, status")
      .or(`id.eq.${parentId},parent_class_id.eq.${parentId}`);
    if (sibErr) {
      return NextResponse.json({ error: "siblings_lookup_failed", message: sibErr.message }, { status: 500 });
    }
    candidateIds = ((siblings ?? []) as Array<{ id: string; status: string }>)
      .filter(r => r.status !== "completed")
      .map(r => r.id);

    if (anchorRow.status !== "completed" && !candidateIds.includes(anchorRow.id)) {
      candidateIds.push(anchorRow.id);
    }
  } else if (anchorRow.status === "completed") {
    return NextResponse.json(
      {
        error:   "class_completed",
        message: "No puedes borrar una clase ya completada (afectaría asistencia y facturación). Si quieres ocultarla, cancélala.",
      },
      { status: 400 },
    );
  }

  if (candidateIds.length === 0) {
    return NextResponse.json(
      {
        error:   "all_completed",
        message: "Toda la serie ya está completada. No se borra nada para preservar el histórico.",
      },
      { status: 400 },
    );
  }

  const { error: delErr } = await sb
    .from("classes")
    .delete()
    .in("id", candidateIds);
  if (delErr) {
    return NextResponse.json({ error: "delete_failed", message: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedIds: candidateIds });
}
