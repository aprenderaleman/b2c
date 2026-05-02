import { NextResponse }   from "next/server";
import { supabaseAdmin }  from "@/lib/supabase";
import {
  sendDiagnosticoWelcomeEmail,
  sendDiagnosticoFollowupEmail,
} from "@/lib/email/send";
import { sendWhatsappText }             from "@/lib/whatsapp";

/**
 * GET/POST /api/cron/diagnostico-followups
 *
 * Drip de leads que completaron el quiz (status='registered') pero no
 * llegaron a agendar la clase de prueba. Vercel Cron lo dispara cada
 * 30 min — la cadena se queda corta si pasa varias horas sin correr,
 * pero los gates por tiempo aseguran que cada mensaje sale lo más
 * pronto que pueda.
 *
 * Cadencia (referencia: tiempo desde diagnostico_completed_at):
 *
 *   msg 1   →  T+15min →  Welcome — WhatsApp + Email (en paralelo).
 *                          Reemplaza al welcome inmediato que antes
 *                          mandaba register: damos 15 min de margen
 *                          para que el lead pueda completar el booking
 *                          sin recibir mensajes redundantes.
 *   msg 2   →  T+24h   →  Email reminder_24h (recordatorio)
 *   msg 3   →  T+3d    →  WhatsApp última llamada
 *   msg 4   →  T+7d    →  Email final_7d  + status='cold'
 *
 * Stop conditions (managed implicitly):
 *   - Si el lead agenda → book-trial cambia status a 'trial_scheduled'
 *     y la query lo deja fuera del cron.
 *   - Si el lead responde por WA con palabras de baja → mark needs_human
 *     (esto NO es responsabilidad de este cron; lo hacen los agentes
 *     Python o el handler del webhook de WhatsApp).
 *   - Tras msg 4, el lead pasa a 'cold' y queda fuera del cron.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` o `X-Cron-Secret`.
 *
 * Idempotencia: `last_drip_msg_n` aumenta solo cuando un mensaje sale
 * exitosamente. Si el envío falla, lo reintentaremos en la próxima
 * ejecución del cron — el mismo gate de tiempo seguirá cumpliéndose.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_MS  = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS  = 24 * HOUR_MS;

// Gates por mensaje — tiempo MÍNIMO desde diagnostico_completed_at
// para que el mensaje N pueda salir.
const GATES_MS: Record<1 | 2 | 3 | 4, number> = {
  1: 15 * MIN_MS,
  2:      DAY_MS,
  3:  3 * DAY_MS,
  4:  7 * DAY_MS,
};

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

type LeadRow = {
  id:                       string;
  name:                     string;
  email:                    string | null;
  whatsapp_normalized:      string;
  language:                 "es" | "de";
  diagnostico_completed_at: string;
  last_drip_msg_n:          number;
};

export async function GET(req: Request) { return runCron(req); }
export async function POST(req: Request) { return runCron(req); }

async function runCron(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb       = supabaseAdmin();
  const baseUrl  = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const bookUrl  = `${baseUrl}/agendar/cuando`;
  const now      = Date.now();

  // Pulla leads en status 'registered' con menos de 4 mensajes enviados.
  // Filtramos en SQL por last_drip_msg_n < 4 — los de 4 ya están 'cold'
  // pero defendemos en cliente igual.
  const { data, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, diagnostico_completed_at, last_drip_msg_n")
    .eq("status", "registered")
    .lt("last_drip_msg_n", 4)
    .not("diagnostico_completed_at", "is", null);

  if (error) {
    console.error("[diagnostico-followups] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as LeadRow[];
  let sent      = 0;
  let skipped   = 0;
  let errors    = 0;

  for (const lead of leads) {
    const completedAt = new Date(lead.diagnostico_completed_at).getTime();
    const elapsed     = now - completedAt;
    const nextN       = (lead.last_drip_msg_n + 1) as 1 | 2 | 3 | 4;
    const gate        = GATES_MS[nextN];

    if (elapsed < gate) { skipped++; continue; }

    const firstName = lead.name.split(/\s+/)[0] || lead.name;
    let ok = false;
    let kind: "wa" | "email" | "wa+email" = "wa";

    try {
      if (nextN === 1) {
        // Welcome — WhatsApp + Email en paralelo. Si AL MENOS UNO de
        // los dos sale, contamos el msg como entregado y avanzamos
        // last_drip_msg_n. Loguamos los fallos individuales en
        // timeline para diagnóstico.
        kind = "wa+email";
        const waText = lead.language === "de"
          ? [
              `Hallo ${firstName}, hier ist Stiv von Aprender-Aleman.de 👋`,
              ``,
              `Dein persönlicher Deutschplan ist fertig. Um ihn zu starten, lade ich dich zu einer kostenlosen 30-Min-Probestunde mit einer muttersprachlichen Lehrkraft ein.`,
              ``,
              `📅 Hier buchen: ${bookUrl}`,
              ``,
              `Bei Fragen schreib mir einfach hier.`,
              `— Stiv`,
            ].join("\n")
          : [
              `Hola ${firstName}, soy Stiv de Aprender-Aleman.de 👋`,
              ``,
              `Tu plan personalizado de alemán está listo. Para activarlo te invito a una clase de prueba GRATIS de 30 min con un profesor nativo certificado.`,
              ``,
              `📅 Agenda aquí: ${bookUrl}`,
              ``,
              `Cualquier duda, escríbeme por aquí.`,
              `— Stiv`,
            ].join("\n");

        const sendEmail = lead.email
          ? sendDiagnosticoWelcomeEmail(lead.email, {
              leadName: firstName,
              bookUrl,
              language: lead.language,
            })
          : Promise.resolve({ ok: false as const, error: "no_email" });

        const [waRes, emailRes] = await Promise.allSettled([
          sendWhatsappText(lead.whatsapp_normalized, waText),
          sendEmail,
        ]);
        const waOk = waRes.status === "fulfilled" && waRes.value.ok;
        const emailOk = emailRes.status === "fulfilled" &&
          (emailRes.value as { ok: boolean }).ok;
        ok = waOk || emailOk;

        if (!waOk) {
          const err = waRes.status === "rejected"
            ? (waRes.reason instanceof Error ? waRes.reason.message : String(waRes.reason))
            : "send_failed";
          console.error(`[diagnostico-followups] welcome WA failed lead=${lead.id}:`, err);
        }
        if (!emailOk) {
          const err = emailRes.status === "rejected"
            ? (emailRes.reason instanceof Error ? emailRes.reason.message : String(emailRes.reason))
            : (emailRes.value as { ok: false; error: string }).error;
          console.error(`[diagnostico-followups] welcome email failed lead=${lead.id}:`, err);
        }
      } else if (nextN === 2) {
        // Email reminder 24h
        kind = "email";
        if (!lead.email) { skipped++; continue; }
        const r = await sendDiagnosticoFollowupEmail(lead.email, {
          leadName: firstName,
          bookUrl,
          language: lead.language,
          variant:  "reminder_24h",
        });
        ok = r.ok;
      } else if (nextN === 3) {
        // WhatsApp última llamada
        kind = "wa";
        const text = lead.language === "de"
          ? `Hallo ${firstName}, letzte Nachfrage. Buchen wir deine Probestunde oder lieber später?  ${bookUrl}`
          : `Hola ${firstName}, última llamada por si te interesa. ¿Agendamos tu clase o lo dejamos para más adelante?  ${bookUrl}`;
        const r = await sendWhatsappText(lead.whatsapp_normalized, text);
        ok = r.ok;
      } else if (nextN === 4) {
        // Email final + cold
        kind = "email";
        if (!lead.email) { skipped++; continue; }
        const r = await sendDiagnosticoFollowupEmail(lead.email, {
          leadName: firstName,
          bookUrl,
          language: lead.language,
          variant:  "final_7d",
        });
        ok = r.ok;
      }
    } catch (e) {
      console.error(`[diagnostico-followups] send failed lead=${lead.id} msg=${nextN}:`,
        e instanceof Error ? e.message : e);
      ok = false;
    }

    if (!ok) { errors++; continue; }

    // Marcar progreso. El msg 4 además mueve a 'cold'.
    const update: Record<string, unknown> = {
      last_drip_msg_n:   nextN,
      last_drip_sent_at: new Date().toISOString(),
    };
    if (nextN === 4) update.status = "cold";

    const { error: updErr } = await sb.from("leads").update(update).eq("id", lead.id);
    if (updErr) {
      // Mensaje SÍ salió pero no pudimos marcar — log pero NO contamos
      // como error (el envío fue exitoso). En la próxima corrida
      // podríamos reenviar; lo aceptamos para evitar perder leads.
      console.error(`[diagnostico-followups] mark progress failed lead=${lead.id}:`, updErr.message);
    }

    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "system_message_sent",
      author:  "system",
      content: `📨 Followup #${nextN} (${kind}) enviado`,
      metadata: { kind: "diagnostico_followup", message_n: nextN, channel: kind },
    });

    sent++;
  }

  return NextResponse.json(
    { ok: true, scanned: leads.length, sent, skipped, errors },
    { headers: { "Cache-Control": "no-store" } },
  );
}
