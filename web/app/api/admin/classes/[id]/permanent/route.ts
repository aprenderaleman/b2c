import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * DELETE /api/admin/classes/{id}/permanent — SOFT delete a class.
 *
 * Gelfis 2026-07-10 (post-incidente): antes hacía hard-delete y sin
 * logging → dos trials fueron borradas por accidente sin auditoría.
 * Ahora setea `deleted_at = NOW()` y loguea en lead_timeline. Recovery
 * trivial: `UPDATE classes SET deleted_at = NULL WHERE id = ...`.
 *
 * Guard nuevo (2026-07-10): rechaza `is_trial=true`. Los trials se
 * gestionan en /admin/clasedeprueba (endpoint /api/trial-classes/[id]
 * /delete que sí loguea y hace cleanup del lead). Este endpoint es
 * para clases regulares.
 *
 * Refuses to delete classes with status='completed' — those carry
 * attendance + billing history and should stay as audit trail. Cancelled
 * and scheduled classes are fair game.
 *
 * Optional `?whole=1` soft-deletes the WHOLE recurring series (this
 * anchor + every sibling sharing parent_class_id), again skipping any
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
    .select("id, status, parent_class_id, is_trial, lead_id, scheduled_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (anchorErr) {
    return NextResponse.json({ error: "lookup_failed", message: anchorErr.message }, { status: 500 });
  }
  if (!anchor) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const anchorRow = anchor as {
    id: string; status: string; parent_class_id: string | null;
    is_trial: boolean; lead_id: string | null; scheduled_at: string;
  };

  // ── Guard rail (Gelfis 2026-07-10): las clases de prueba NO se
  // borran desde este endpoint. Usa /admin/clasedeprueba → endpoint
  // /api/trial-classes/[id]/delete que loguea + hace cleanup del lead. ──
  if (anchorRow.is_trial) {
    return NextResponse.json(
      {
        error:   "is_trial_use_dedicated_endpoint",
        message: "Las clases de prueba se gestionan en /admin/clasedeprueba (loguea, hace cleanup del lead y solo superadmin puede eliminarlas). Este endpoint es para clases regulares.",
      },
      { status: 400 },
    );
  }

  // Build the candidate id list.
  let candidateIds: string[] = [anchorRow.id];
  if (whole) {
    const parentId = anchorRow.parent_class_id ?? anchorRow.id;
    const { data: siblings, error: sibErr } = await sb
      .from("classes")
      .select("id, status, is_trial, lead_id, scheduled_at")
      .is("deleted_at", null)
      .or(`id.eq.${parentId},parent_class_id.eq.${parentId}`);
    if (sibErr) {
      return NextResponse.json({ error: "siblings_lookup_failed", message: sibErr.message }, { status: 500 });
    }
    type Sibling = { id: string; status: string; is_trial: boolean; lead_id: string | null; scheduled_at: string };
    const rows = ((siblings ?? []) as Sibling[]);
    // El guard is_trial también aplica en whole=1: si algún sibling es
    // trial, cortamos (no se pierden trials mezclados en una serie).
    const trialSiblings = rows.filter(r => r.is_trial);
    if (trialSiblings.length > 0) {
      return NextResponse.json(
        {
          error:   "trial_in_series",
          message: `La serie contiene ${trialSiblings.length} clase(s) de prueba. Bórralas primero desde /admin/clasedeprueba.`,
        },
        { status: 400 },
      );
    }
    candidateIds = rows
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

  // ── SOFT-DELETE: UPDATE deleted_at (Gelfis 2026-07-10). Antes hacía
  // hard-delete + sin logging → 2 trials borradas por accidente sin
  // rastro. Recovery ahora es UPDATE deleted_at=NULL. ──
  const nowIso = new Date().toISOString();
  const { error: delErr } = await sb
    .from("classes")
    .update({ deleted_at: nowIso })
    .in("id", candidateIds);
  if (delErr) {
    return NextResponse.json({ error: "delete_failed", message: delErr.message }, { status: 500 });
  }

  // Audit log (si la clase tenía lead_id, loguea al timeline; si no,
  // vá al log del servidor). El actor es el admin logueado.
  const actor = (session.user as { email?: string }).email ?? "admin";
  if (anchorRow.lead_id) {
    await sb.from("lead_timeline").insert({
      lead_id: anchorRow.lead_id,
      type:    "status_change",
      author:  "admin",
      content: `🗑️ Clase eliminada por ${actor} (${new Date(anchorRow.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })}). Recuperable via UPDATE deleted_at=NULL.`,
      metadata: {
        kind:         "class_soft_deleted",
        class_id:     anchorRow.id,
        deleted_ids:  candidateIds,
        actor,
        whole:        whole,
        deleted_at:   nowIso,
      },
    });
  } else {
    console.log(`[admin/classes/permanent] soft-deleted ${candidateIds.length} class(es) by ${actor}: ${candidateIds.join(",")}`);
  }

  return NextResponse.json({ ok: true, deletedIds: candidateIds, softDeleted: true });
}
