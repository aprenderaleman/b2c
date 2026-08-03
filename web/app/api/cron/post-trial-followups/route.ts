import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { sendPostTrialFinalEmail } from "@/lib/email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/post-trial-followups
 *
 * Cadena post-clase de prueba (cuando admin marca "✓ Asistió"):
 *
 *   Mensaje 1 → T+0       — disparado por markTrialAttendedAwaitingConversion
 *                             (WhatsApp + Email, con link al pack).
 *   Mensaje único de cierre → T+3 días — último recordatorio, liberamos
 *                             cupo (WhatsApp + Email) → status pasa a 'cold'.
 *
 * Consolidado 2026-08-01 (Gelfis): Msg 2 (T+2d) eliminado; el copy del
 * único mensaje final combina el tono "¿sigues interesado?" con el
 * cierre "vamos a liberar tu espacio".
 *
 * Cómo identificamos un lead "post-attended":
 *   status='in_conversation' AND meta->>'awaiting_payment_confirmation_since'
 *   IS NOT NULL AND next_contact_date <= NOW().
 *
 * Idempotencia: meta->>'post_trial_step'
 *   (0 = pendiente → toca mensaje único)
 *   (>=1 = ya enviado → skip defensivo)
 *
 * Stop conditions:
 *   - El lead responde por WhatsApp → handler entrante lo pasa a
 *     needs_human o resetea el contador → este cron lo deja fuera.
 *   - Lead convertido → status='converted' → fuera de la query.
 */
export async function GET()  { return run(); }
export async function POST() { return run(); }

type Lead = {
  id:                  string;
  name:                string | null;
  email:               string | null;
  whatsapp_normalized: string | null;
  language:            "es" | "de";
  meta:                Record<string, unknown> | null;
};

async function run() {
  const sb = supabaseAdmin();

  // Solo leads que YA tienen el flag puesto (i.e. fueron marcados
  // "Asistió" con o sin pack/objetivo en el modal) y con next_contact
  // vencido. La query de Python ya los exclude del flujo normal.
  const { data, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, meta")
    .in("status", ["trial_attended", "in_conversation"])
    .lte("next_contact_date", new Date().toISOString())
    .not("meta->>awaiting_payment_confirmation_since", "is", null)
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as Lead[];
  const results: Array<Record<string, unknown>> = [];

  // Skip leads that are already managed by the new chain engine (lead_chains table).
  // This allows the old cron to keep processing leads that were mid-sequence
  // before the chain engine was deployed, without duplicating messages.
  const leadIds = leads.map(l => l.id);
  const { data: activeChains } = await sb
    .from("lead_chains")
    .select("lead_id")
    .in("lead_id", leadIds)
    .is("completed_at", null);
  const chainedLeadIds = new Set((activeChains ?? []).map((c: { lead_id: string }) => c.lead_id));

  for (const lead of leads) {
    if (chainedLeadIds.has(lead.id)) {
      results.push({ lead_id: lead.id, action: "skipped_has_chain" });
      continue;
    }
    const step = Number((lead.meta as Record<string, unknown> | null)?.post_trial_step ?? 0);
    if (step >= 1) {
      // Ya enviamos el mensaje único de cierre — cleanup defensivo.
      await sb.from("leads")
        .update({ next_contact_date: null })
        .eq("id", lead.id);
      results.push({ lead_id: lead.id, action: "skipped_already_sent" });
      continue;
    }
    // step === 0 → único mensaje final (T+3d desde el marcado attended).
    await handleFinalMessage(sb, lead);
    results.push({ lead_id: lead.id, action: "final_sent_lead_cold" });
  }

  return NextResponse.json({ ok: true, processed: leads.length, results });
}

function firstName(lead: Lead): string {
  const n = (lead.name ?? "").trim();
  return n.split(/\s+/)[0] || n || "";
}

async function handleFinalMessage(
  sb: ReturnType<typeof supabaseAdmin>,
  lead: Lead,
): Promise<void> {
  const name = firstName(lead);
  // Copy consolidado 2026-08-01: escasez + cierre en un solo mensaje.
  const text = lead.language === "de"
    ? `Hallo ${name}, hast du noch Interesse, Deutsch bei uns zu lernen? 😊\n\nUns gehen die Plätze aus und wir schließen die Anmeldungen. Wenn du nicht antwortest, geben wir deinen Platz an einen anderen Schüler weiter.\n\nFalls du irgendwann wieder einsteigen möchtest, sind wir hier. Viel Erfolg! 🍀\n\nStiv | Aprender-Aleman.de`
    : `Hola ${name}, ¿sigues interesado/a en aprender alemán con nosotros? 😊\n\nNos estamos quedando sin cupos y vamos a cerrar las inscripciones. Si no me respondes, liberaré tu espacio para otro estudiante.\n\nSi en algún momento decides retomar, aquí estaremos. ¡Mucho éxito! 🍀\n\nStiv | Aprender-Aleman.de`;

  // WhatsApp
  if (lead.whatsapp_normalized) {
    const wa = await sendWhatsappText(lead.whatsapp_normalized, text);
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    wa.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: wa.ok
        ? `💬 Post-trial msg 3 (final) enviado a ${lead.whatsapp_normalized}`
        : `💬 Falló post-trial msg 3: ${wa.reason}`,
      metadata: { kind: "post_trial_final", channel: "whatsapp" },
    });
  }

  // Email espejo
  if (lead.email) {
    const email = await sendPostTrialFinalEmail(lead.email, {
      name,
      language: lead.language === "de" ? "de" : "es",
    });
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    email.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: email.ok
        ? `📧 Post-trial msg 3 (final) enviado por email a ${lead.email}`
        : `📧 Falló post-trial msg 3 email: ${email.error ?? "unknown"}`,
      metadata: { kind: "post_trial_final", channel: "email" },
    });
  }

  // Cierra cadena: status='cold', limpia next_contact_date.
  const newMeta = {
    ...(lead.meta ?? {}),
    post_trial_step: 1,
  };
  await sb.from("leads")
    .update({
      status:            "cold",
      next_contact_date: null,
      meta:              newMeta,
    })
    .eq("id", lead.id);
  await sb.from("lead_timeline").insert({
    lead_id: lead.id,
    type:    "status_change",
    author:  "gelfis",
    content: "Cold — cadena post-clase de prueba cerrada (mensaje final sin pago).",
  });
}
