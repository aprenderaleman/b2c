import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Manejo defensivo cuando `sendWhatsappText` falla (Gelfis 2026-10-02,
 * casos Maria/Fernando: sus números no estaban en WhatsApp pero el
 * sistema seguía intentándolos cada día, generando `exists:false` que
 * manchaba la reputación de la instancia).
 *
 * Comportamiento:
 *   1. Inserta `send_failed` en lead_timeline con reason completo —
 *      hace visible el fallo en el detalle del lead (antes solo
 *      console.error en Vercel = invisible al operador).
 *   2. Si el fallo es `exists:false` (número NO está en WhatsApp),
 *      desactiva el número del lead:
 *         - whatsapp_raw ← preservar valor original
 *         - whatsapp_normalized ← NULL (deja de reintentar)
 *      Esto rompe el loop de reintentos diarios.
 *
 * Uso: desde cualquier cron o endpoint que llame sendWhatsappText
 * sin pasar por el motor de chains (chain-engine ya tiene su propia
 * lógica de cancel chain con cancel_reason='invalid_whatsapp_number').
 */
export async function handleWaPermanentFail(
  sb: SupabaseClient,
  input: {
    leadId:     string;
    phone:      string;
    kind:       string;
    reason:     string | undefined;
    context?:   string;   // "trial_reminder_morning", etc.
  },
): Promise<{ wa_invalidated: boolean }> {
  const reason = input.reason ?? "unknown";
  const isInvalidNumber = /\"exists\"\s*:\s*false/.test(reason);

  try {
    await sb.from("lead_timeline").insert({
      lead_id: input.leadId,
      type:    "send_failed",
      author:  "system",
      content: `💬 WA fallo (${input.kind}): ${reason.slice(0, 300)}`,
      metadata: {
        kind:    input.kind,
        channel: "whatsapp",
        reason,
        context: input.context ?? null,
        invalid_number: isInvalidNumber,
      },
    });
  } catch (e) {
    console.error("[wa-permanent-fail] timeline insert failed:", e);
  }

  if (isInvalidNumber) {
    try {
      // Preservar raw si no está ya guardado, y limpiar normalized para
      // que los próximos crons no vuelvan a intentar.
      const { data: lead } = await sb
        .from("leads")
        .select("whatsapp_raw, whatsapp_normalized")
        .eq("id", input.leadId)
        .maybeSingle();
      const l = lead as { whatsapp_raw: string | null; whatsapp_normalized: string | null } | null;
      await sb.from("leads").update({
        whatsapp_normalized: null,
        whatsapp_raw:        l?.whatsapp_raw ?? input.phone,
      }).eq("id", input.leadId);

      await sb.from("lead_timeline").insert({
        lead_id: input.leadId,
        type:    "agent_note",
        author:  "system",
        content: `⚠️ Número WhatsApp desactivado automáticamente: "${input.phone}" devolvió exists:false. Preservado en whatsapp_raw. Corregir manualmente si el lead sí tiene WhatsApp.`,
        metadata: {
          kind:     "whatsapp_invalidated",
          raw:      input.phone,
          reason:   "exists_false",
          source:   input.context ?? input.kind,
        },
      });
      return { wa_invalidated: true };
    } catch (e) {
      console.error("[wa-permanent-fail] lead update failed:", e);
    }
  }

  return { wa_invalidated: false };
}
