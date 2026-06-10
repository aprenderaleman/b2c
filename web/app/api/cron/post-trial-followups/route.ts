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
 *   Mensaje 2 → T+2 días  — escasez / "¿sigues interesado?" (WhatsApp).
 *   Mensaje 3 → T+3 días  — último, liberamos cupo (WhatsApp + Email)
 *                             → status pasa a 'cold'.
 *
 * Cómo identificamos un lead "post-attended":
 *   status='in_conversation' AND meta->>'awaiting_payment_confirmation_since'
 *   IS NOT NULL AND next_contact_date <= NOW().
 *
 * Cuántos mensajes lleva: contador en meta->>'post_trial_step'
 *   (0 = ninguno extra todavía → toca Mensaje 2)
 *   (1 = solo Mensaje 2 enviado → toca Mensaje 3)
 *   (>=2 = ya enviamos todo → no debería seleccionarse de nuevo)
 *
 * El agente Python `agent_0_watcher` saltea estos leads para no duplicar
 * (filtra in_conversation con awaiting_payment_confirmation_since).
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
    .eq("status", "in_conversation")
    .lte("next_contact_date", new Date().toISOString())
    .not("meta->>awaiting_payment_confirmation_since", "is", null)
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as Lead[];
  const results: Array<Record<string, unknown>> = [];

  for (const lead of leads) {
    const step = Number((lead.meta as Record<string, unknown> | null)?.post_trial_step ?? 0);
    if (step >= 2) {
      // No debería pasar (el último marca cold y vacía next_contact)
      // pero por defensividad: limpiamos y skip.
      await sb.from("leads")
        .update({ next_contact_date: null })
        .eq("id", lead.id);
      results.push({ lead_id: lead.id, action: "skipped_orphan" });
      continue;
    }
    if (step === 0) {
      await handleMessage2(sb, lead);
      results.push({ lead_id: lead.id, action: "msg2_sent" });
    } else { // step === 1
      await handleMessage3(sb, lead);
      results.push({ lead_id: lead.id, action: "msg3_sent_lead_cold" });
    }
  }

  return NextResponse.json({ ok: true, processed: leads.length, results });
}

function firstName(lead: Lead): string {
  const n = (lead.name ?? "").trim();
  return n.split(/\s+/)[0] || n || "";
}

async function handleMessage2(
  sb: ReturnType<typeof supabaseAdmin>,
  lead: Lead,
): Promise<void> {
  const name = firstName(lead);
  const text = lead.language === "de"
    ? `Hallo ${name}, alles gut bei dir? 😊\n\nIch schreibe dir, um dir mitzuteilen, dass uns die Plätze ausgehen und wir kurz vor dem Abschluss der Anmeldungen stehen. Hast du noch Interesse, Deutsch zu lernen?\n\nStiv | Aprender-Aleman.de`
    : `Hola ${name}, ¿todo bien? 😊\n\nTe escribo para avisarte de que nos estamos quedando sin cupos y estamos a punto de cerrar las inscripciones. ¿Sigues interesado/a en aprender alemán?\n\nStiv | Aprender-Aleman.de`;

  if (lead.whatsapp_normalized) {
    const wa = await sendWhatsappText(lead.whatsapp_normalized, text);
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    wa.ok ? "system_message_sent" : "send_failed",
      author:  "gelfis",
      content: wa.ok
        ? `💬 Post-trial msg 2 enviado a ${lead.whatsapp_normalized}`
        : `💬 Falló post-trial msg 2: ${wa.reason}`,
      metadata: { kind: "post_trial_msg2", channel: "whatsapp" },
    });
  }

  // Avanza al siguiente paso: msg 3 en +1 día (T+3 total desde marcar).
  const nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const newMeta = {
    ...(lead.meta ?? {}),
    post_trial_step: 1,
  };
  await sb.from("leads")
    .update({ next_contact_date: nextAt, meta: newMeta })
    .eq("id", lead.id);
}

async function handleMessage3(
  sb: ReturnType<typeof supabaseAdmin>,
  lead: Lead,
): Promise<void> {
  const name = firstName(lead);
  const text = lead.language === "de"
    ? `Hallo ${name}, das ist meine letzte Nachricht von meiner Seite.\n\nWir werden deinen Platz in der Akademie an einen anderen Schüler weitergeben. Falls du irgendwann wieder einsteigen möchtest, sind wir hier.\n\nViel Erfolg! 🍀\n\nStiv | Aprender-Aleman.de`
    : `Hola ${name}, último mensaje por mi parte.\n\nVamos a liberar tu espacio en la academia para dárselo a otro estudiante. Si en algún momento decides retomar, aquí estaremos.\n\n¡Mucho éxito! 🍀\n\nStiv | Aprender-Aleman.de`;

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
      metadata: { kind: "post_trial_msg3", channel: "whatsapp" },
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
      metadata: { kind: "post_trial_msg3", channel: "email" },
    });
  }

  // Cierra cadena: status='cold', limpia next_contact_date.
  const newMeta = {
    ...(lead.meta ?? {}),
    post_trial_step: 2,
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
    content: "Cold — cadena post-clase de prueba agotada (3 mensajes sin pago).",
  });
}
