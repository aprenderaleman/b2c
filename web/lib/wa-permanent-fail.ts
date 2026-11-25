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

/**
 * Stashea un envío WA fallido por CAP (setter_daily_cap, night_gate,
 * hourly_cap, daily_cap) en un agent_note tipo "wa_manual_pending".
 *
 * El endpoint /api/admin/wa/pending-manual lo recoge y muestra en el panel
 * con botones Copiar / Abrir WhatsApp / Marcar enviado. Así ningún
 * mensaje bloqueado por cap queda invisible.
 *
 * Dedupe: no crea duplicado si ya hay un pending abierto para el mismo
 * lead + original_kind en las últimas 24h.
 *
 * Gelfis 2026-11-25: después del bug Esteban/Dina (13 leads sin WA
 * confirmación invisibles). Helper centralizado para todos los handlers
 * que mandan WA al lead.
 */
export async function stashWaManualPendingIfCap(
  sb: SupabaseClient,
  input: {
    leadId:        string;
    phone:         string | null;
    originalKind:  string;     // trial_confirmation, trial_reminder_2h, welcome_week_t0, etc.
    text:          string;
    reason:        string | undefined;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<{ stashed: boolean }> {
  const reason = input.reason ?? "";
  if (!/^(setter_daily_cap|night_gate|hourly_cap|daily_cap)/.test(reason)) return { stashed: false };
  if (!input.phone) return { stashed: false };

  // Dedupe
  const { data: existing } = await sb
    .from("lead_timeline")
    .select("id")
    .eq("lead_id", input.leadId)
    .eq("metadata->>kind", "wa_manual_pending")
    .eq("metadata->>original_kind", input.originalKind)
    .is("metadata->sent_manual_at", null)
    .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(1);
  if (((existing as unknown as Array<unknown>)?.length ?? 0) > 0) return { stashed: false };

  const phoneNoPlus = input.phone.replace(/^\+/, "");
  const waLink = `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${encodeURIComponent(input.text)}`;

  await sb.from("lead_timeline").insert({
    lead_id: input.leadId,
    type:    "agent_note",
    author:  "system",
    content: `📋 WA ${input.originalKind} bloqueado (${reason}) — preparado para envío manual`,
    metadata: {
      kind:          "wa_manual_pending",
      channel:       "whatsapp",
      original_kind: input.originalKind,
      phone:         input.phone,
      text:          input.text,
      wa_link:       waLink,
      reason,
      ...input.extraMetadata,
    },
  });
  return { stashed: true };
}
