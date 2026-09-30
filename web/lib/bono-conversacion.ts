import { supabaseAdmin } from "./supabase";

/**
 * Bono de clase de conversación 48h (migración 136, Gelfis 2026-09-30).
 *
 * Marca la clase del bono como dada (o lo deshace). La clase es
 * ADICIONAL: al darla se consume 1 clase del balance como cualquier
 * clase normal, así que compensamos con +1 en classes_adjustment para
 * que el paquete pagado quede intacto. El undo revierte el ajuste.
 *
 * Idempotente: marcar dos veces (o deshacer sin marcar) no duplica el
 * ajuste. Lo usan el botón del dashboard /admin y el del profe en la
 * ficha del estudiante (Gelfis 2026-09-30: "que sea el mismo profesor
 * el que la marque — no puedo estar pendiente de todos").
 */
export type BonoMarkResult =
  | { ok: true; used: boolean; already?: boolean }
  | { ok: false; error: "student_not_found" | "no_bono" | "update_failed"; message?: string };

export async function markBonoConversacion(studentId: string, undo: boolean): Promise<BonoMarkResult> {
  const sb = supabaseAdmin();
  const { data: stu } = await sb
    .from("students")
    .select("id, bono_conversacion_at, bono_conversacion_usada_at, classes_adjustment")
    .eq("id", studentId)
    .maybeSingle();
  if (!stu) return { ok: false, error: "student_not_found" };
  const row = stu as {
    bono_conversacion_at: string | null;
    bono_conversacion_usada_at: string | null;
    classes_adjustment: number | null;
  };
  if (!row.bono_conversacion_at) return { ok: false, error: "no_bono" };
  if (!undo && row.bono_conversacion_usada_at) return { ok: true, used: true, already: true };
  if (undo && !row.bono_conversacion_usada_at) return { ok: true, used: false, already: true };

  const delta = undo ? -1 : 1;
  const { error } = await sb
    .from("students")
    .update({
      bono_conversacion_usada_at: undo ? null : new Date().toISOString(),
      classes_adjustment: (row.classes_adjustment ?? 0) + delta,
    })
    .eq("id", studentId);
  if (error) return { ok: false, error: "update_failed", message: error.message };
  return { ok: true, used: !undo };
}
