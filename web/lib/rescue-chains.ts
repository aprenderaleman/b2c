import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cierra las cadenas de rescate transaccional activas de un lead
 * cuando este vuelve a agendar el compromiso que había roto
 * (Gelfis 2026-08-30, bug Johann).
 *
 * Categorías:
 *   "trial"  → cierra chain4_absent + chain6_cancel
 *              (rescate por no-asistencia / cancelación de clase de prueba)
 *   "sesion" → cierra sesion_absent
 *              (rescate por no-asistencia a Sesión de Plan-Alemán)
 *
 * NO cierra cadenas conversacionales (chain1_attended, chain2_link_sent,
 * welcome_week, sesion_attended, etc.) — esas siguen su ciclo aunque
 * el lead reagende un compromiso.
 *
 * Idempotente: si no hay chain activa, es NOOP. Silencioso ante errores
 * (loguea, no propaga) para no romper la operación principal (agendado).
 * También inserta timeline entry por cada chain cerrada, útil para
 * auditoría posterior.
 */
export async function closeRescueChainsForRebook(
  sb: SupabaseClient,
  leadId: string,
  category: "trial" | "sesion",
  reason: string = "trial_rebooked",
): Promise<number> {
  try {
    const chainTypes = category === "trial"
      ? ["chain4_absent", "chain6_cancel"]
      : ["sesion_absent"];

    const { data: closed, error } = await sb
      .from("lead_chains")
      .update({
        completed_at: new Date().toISOString(),
        cancel_reason: reason,
        updated_at:  new Date().toISOString(),
      })
      .eq("lead_id", leadId)
      .in("chain_type", chainTypes)
      .is("completed_at", null)
      .select("id, chain_type");
    if (error) {
      console.error("[rescue-chains] close error:", error.message);
      return 0;
    }
    const rows = (closed ?? []) as Array<{ id: string; chain_type: string }>;
    if (rows.length === 0) return 0;

    // Timeline audit per chain
    await sb.from("lead_timeline").insert(rows.map(r => ({
      lead_id: leadId,
      type:    "status_change",
      author:  "system",
      content: `Cadena cerrada: ${reason}`,
      metadata: {
        kind:       "chain_cancelled",
        chain_id:   r.id,
        chain_type: r.chain_type,
        reason,
      },
    })));
    return rows.length;
  } catch (err) {
    console.error("[rescue-chains] closeRescueChainsForRebook threw:", err);
    return 0;
  }
}
