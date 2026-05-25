import { NextResponse }   from "next/server";
import { supabaseAdmin }  from "@/lib/supabase";
import {
  sendDiagnosticoWelcomeEmail,
  sendDiagnosticoFollowupEmail,
  sendDiagnosticoFollowupPdfEmail,
  sendDiagnosticoTestFollowupEmail,
} from "@/lib/email/send";
import { sendWhatsappText, sendWhatsappDocument } from "@/lib/whatsapp";
import { signRecordingUrl } from "@/lib/r2";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
 *   msg 2   →  T+24h   →  WhatsApp + Email con PDF gratis adaptado al nivel
 *                          del lead (A0 / A1.1 / A2.1 / A2.2). Regalo de
 *                          valor sin pedir nada — convierte el follow-up
 *                          frío en touchpoint cálido. PDF servido desde R2,
 *                          descargado y adjuntado al email; WA recibe URL
 *                          firmada (Evolution descarga).
 *   msg 3   →  T+2d    →  WhatsApp — invita al test de nivel gratis
 *                          (https://schule.aprender-aleman.de/test-de-nivel).
 *                          Ofrece un descubrimiento personalizado para que
 *                          el lead vea exactamente en qué punto está.
 *   msg 4   →  T+3d    →  WhatsApp + Email — 24h después del test:
 *                          "¿descubriste tu nivel? ¿a qué hora hoy o
 *                          mañana para una breve llamada?" Doble canal
 *                          para maximizar respuesta — al menos uno cuenta.
 *   msg 5   →  T+5d    →  WhatsApp última llamada
 *   msg 6   →  T+8d    →  Email final_7d  + status='cold'
 *
 * Stop conditions (managed implicitly):
 *   - Si el lead agenda → book-trial cambia status a 'trial_scheduled'
 *     y la query lo deja fuera del cron.
 *   - Si el lead responde por WA con palabras de baja → mark needs_human
 *     (esto NO es responsabilidad de este cron; lo hacen los agentes
 *     Python o el handler del webhook de WhatsApp).
 *   - Tras msg 6, el lead pasa a 'cold' y queda fuera del cron.
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
const GATES_MS: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 15 * MIN_MS,
  2:      DAY_MS,
  3:  2 * DAY_MS,
  4:  3 * DAY_MS,
  5:  5 * DAY_MS,
  6:  8 * DAY_MS,
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
  german_level:             string | null;
  diagnostico_completed_at: string;
  last_drip_msg_n:          number;
};

// ── PDF mapping por nivel ────────────────────────────────────
// El R2 contiene los 5 PDFs en marketing/v1/<slug>.pdf. El cron firma
// la URL para WhatsApp (Evolution descarga) y descarga el buffer para
// adjuntar al email.
type PdfMeta = {
  slug:     string;
  level:    string;            // display label
  title:    string;
  r2Key:    string;
  fileName: string;
};

const PDF_BY_LEVEL: Record<string, PdfMeta> = {
  "A0": {
    slug: "a0", level: "A0",
    title: "Tus primeros pasos en alemán",
    r2Key: "marketing/v1/a0-primeros-pasos.pdf",
    fileName: "Aprender-Aleman-Guia-A0.pdf",
  },
  "A1-A2": {
    slug: "a1-1", level: "A1.1",
    title: "Hablar de ti y tu día a día",
    r2Key: "marketing/v1/a1-1-dia-a-dia.pdf",
    fileName: "Aprender-Aleman-Guia-A1.1.pdf",
  },
  "B1": {
    slug: "a2-1", level: "A2.1",
    title: "Hablar del pasado: el Perfekt",
    r2Key: "marketing/v1/a2-1-perfekt.pdf",
    fileName: "Aprender-Aleman-Guia-A2.1.pdf",
  },
  "B2+": {
    slug: "a2-2", level: "A2.2",
    title: "Planes y obligaciones: modales + futuro",
    r2Key: "marketing/v1/a2-2-modales-futuro.pdf",
    fileName: "Aprender-Aleman-Guia-A2.2.pdf",
  },
  "unsure": {
    slug: "a0", level: "A0",
    title: "Tus primeros pasos en alemán",
    r2Key: "marketing/v1/a0-primeros-pasos.pdf",
    fileName: "Aprender-Aleman-Guia-A0.pdf",
  },
};

function pdfForLead(germanLevel: string | null): PdfMeta {
  if (!germanLevel) return PDF_BY_LEVEL["A0"];
  return PDF_BY_LEVEL[germanLevel] ?? PDF_BY_LEVEL["A0"];
}

// Cliente R2 perezoso — solo se crea cuando se necesita descargar el PDF
// para adjuntarlo al email.
function r2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** Descarga el PDF de R2 y devuelve el Buffer. null si R2 no configurado. */
async function downloadPdfBuffer(r2Key: string): Promise<Buffer | null> {
  const c = r2Client();
  const bucket = process.env.R2_BUCKET || "aprender-aleman-recordings";
  if (!c) return null;
  try {
    const r = await c.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    const stream = r.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    console.error("[diagnostico-followups] R2 download failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

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
  const testUrl  = "https://schule.aprender-aleman.de/test-de-nivel";
  const now      = Date.now();

  // Pulla leads en status 'registered' con menos de 6 mensajes enviados.
  // Filtramos en SQL por last_drip_msg_n < 6 — los de 6 ya están 'cold'
  // pero defendemos en cliente igual.
  const { data, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, german_level, diagnostico_completed_at, last_drip_msg_n")
    .eq("status", "registered")
    .lt("last_drip_msg_n", 6)
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
    const nextN       = (lead.last_drip_msg_n + 1) as 1 | 2 | 3 | 4 | 5 | 6;
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
        //
        // Cambio 2026-05-14: en lugar de empujar al lead al funnel de
        // agendar clase de prueba, le ofrecemos una llamada de 15 min
        // con Gelfis. La respuesta del lead la maneja agent_4 con un
        // handler nuevo (`_handle_call_time_proposal`) que parsea la
        // hora vía Claude y la agenda en Google Calendar si está libre.
        kind = "wa+email";
        const waText = lead.language === "de"
          ? [
              `Hallo ${firstName}! 👋`,
              ``,
              `Schön, dich kennenzulernen, ich bin Stiv von der Akademie Aprender-Aleman.de.`,
              ``,
              `Wir haben dein Interesse am Deutschlernen erhalten. Hast du Lust auf ein 15-Minuten-Gespräch, damit ich dir erkläre, wie wir dir helfen können?`,
              ``,
              `Wann würde es dir heute oder morgen passen, dass ich dich anrufe?`,
            ].join("\n")
          : [
              `¡Hola ${firstName}!`,
              ``,
              `Es un gusto saludarte, soy Stiv de la academia Aprender-Aleman.de. 👋`,
              ``,
              `Recibimos tu interés para aprender alemán. ¿Te parece si hablamos 15 minutos para contarte cómo podemos ayudarte a lograrlo?`,
              ``,
              `¿A qué hora te vendría bien que te llame hoy o mañana?`,
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
        // T+24h — Regalo: PDF adaptado al nivel del lead.
        // Doble canal: WhatsApp (con documento adjunto) + Email (PDF
        // attached). Si AL MENOS UNO sale, contamos como entregado.
        kind = "wa+email";

        const pdf = pdfForLead(lead.german_level);
        const captionWa = lead.language === "de"
          ? [
              `Hallo ${firstName}! 👋  Stiv nochmal.`,
              ``,
              `Da wir uns noch nicht gesprochen haben, hier ein kleines Geschenk:`,
              `📄 „${pdf.title}“ — ein 5-Seiten-Guide für dein Niveau ${pdf.level}.`,
              ``,
              `Wenn du danach Lust auf ein 15-Min-Gespräch hast, schreib mir hier.`,
              ``,
              `Bis bald! 🇩🇪`,
            ].join("\n")
          : [
              `¡Hola ${firstName}! 👋  Stiv otra vez.`,
              ``,
              `Como aún no pudimos hablar, te dejo un regalo:`,
              `📄 «${pdf.title}» — una guía de 5 páginas para tu nivel ${pdf.level}.`,
              ``,
              `Si después de leerla te animas a una llamada de 15 min, escríbeme aquí. Sin presión.`,
              ``,
              `Bis bald! 🇩🇪`,
            ].join("\n");

        // 1) WhatsApp: firmamos URL R2 corta y la pasamos a Evolution.
        //    Buffer del PDF lo usaremos para email (en paralelo).
        const fileUrl = `https://${process.env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com/${process.env.R2_BUCKET ?? "aprender-aleman-recordings"}/${pdf.r2Key}`;
        const signedUrl = await signRecordingUrl(fileUrl, 24 * 3600);

        // 2) Email: descargamos PDF y lo adjuntamos.
        const pdfBuffer = lead.email ? await downloadPdfBuffer(pdf.r2Key) : null;

        const sendWaTextThenDoc = async () => {
          // Primero el texto de contexto (sin link), luego el documento.
          // Si el texto falla pero el documento sale, el contexto se pierde
          // pero el lead recibe el PDF — aceptable.
          await sendWhatsappText(lead.whatsapp_normalized, captionWa);
          return sendWhatsappDocument(
            lead.whatsapp_normalized, signedUrl, pdf.fileName,
            { caption: "", kind: "diagnostico_pdf_t24h", leadId: lead.id },
          );
        };

        const sendEmailWithPdf = async () => {
          if (!lead.email || !pdfBuffer) {
            return { ok: false as const, error: "no_email_or_pdf" };
          }
          return sendDiagnosticoFollowupPdfEmail(lead.email, {
            leadName: firstName,
            level:    pdf.level,
            pdfTitle: pdf.title,
            language: lead.language,
            bookUrl,
          }, { fileName: pdf.fileName, buffer: pdfBuffer });
        };

        const [waRes, emailRes] = await Promise.allSettled([
          sendWaTextThenDoc(),
          sendEmailWithPdf(),
        ]);
        const waOk = waRes.status === "fulfilled" && waRes.value.ok;
        const emailOk = emailRes.status === "fulfilled" &&
          (emailRes.value as { ok: boolean }).ok;
        ok = waOk || emailOk;

        if (!waOk) {
          const err = waRes.status === "rejected"
            ? (waRes.reason instanceof Error ? waRes.reason.message : String(waRes.reason))
            : "send_failed";
          console.error(`[diagnostico-followups] msg2 WA failed lead=${lead.id} pdf=${pdf.slug}:`, err);
        }
        if (!emailOk) {
          const err = emailRes.status === "rejected"
            ? (emailRes.reason instanceof Error ? emailRes.reason.message : String(emailRes.reason))
            : (emailRes.value as { ok: false; error: string }).error;
          console.error(`[diagnostico-followups] msg2 email failed lead=${lead.id} pdf=${pdf.slug}:`, err);
        }
      } else if (nextN === 3) {
        // T+2d — WhatsApp invita al test de nivel gratis.
        // Mensaje corto, una sola línea de copy + URL clickable.
        kind = "wa";
        const text = lead.language === "de"
          ? [
              `Hallo ${firstName} 👋`,
              ``,
              `Eine Idee: möchtest du dein aktuelles Deutsch-Niveau in 5 Min herausfinden? Wir haben einen kostenlosen Test, der dir genau sagt, wo du stehst:`,
              ``,
              `${testUrl}`,
              ``,
              `Danach erzähl mir das Ergebnis und ich sage dir, was der nächste Schritt für dich wäre. 🇩🇪`,
            ].join("\n")
          : [
              `Hola ${firstName} 👋`,
              ``,
              `Una idea: ¿quieres descubrir tu nivel real de alemán en 5 minutos? Tenemos un test gratuito que te dice exactamente en qué punto estás:`,
              ``,
              `${testUrl}`,
              ``,
              `Cuando termines, cuéntame tu resultado y te digo cuál sería tu siguiente paso. 🇩🇪`,
            ].join("\n");
        const r = await sendWhatsappText(lead.whatsapp_normalized, text);
        ok = r.ok;
      } else if (nextN === 4) {
        // T+3d — 24h después del test: ¿descubriste tu nivel? + hora.
        // WhatsApp + Email en paralelo. Al menos uno cuenta.
        kind = "wa+email";
        const waText = lead.language === "de"
          ? [
              `Hallo ${firstName}!`,
              ``,
              `Konntest du gestern den Niveau-Test machen? Falls ja, würde ich gern 15 Min mit dir sprechen, um dir zu erklären, welcher Weg dir am meisten hilft.`,
              ``,
              `Wann passt es dir heute oder morgen, dass ich dich anrufe?`,
              ``,
              `Falls du den Test noch nicht gemacht hast: ${testUrl}`,
            ].join("\n")
          : [
              `¡Hola ${firstName}!`,
              ``,
              `¿Pudiste hacer el test de nivel ayer? Si ya tienes tu resultado, me encantaría hablar 15 minutos contigo para explicarte qué camino te conviene más desde ahí.`,
              ``,
              `¿A qué hora te vendría bien hoy o mañana que te llame?`,
              ``,
              `Si aún no hiciste el test: ${testUrl}`,
            ].join("\n");

        const sendEmail = lead.email
          ? sendDiagnosticoTestFollowupEmail(lead.email, {
              leadName: firstName,
              language: lead.language,
              testUrl,
              bookUrl,
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
          console.error(`[diagnostico-followups] msg4 WA failed lead=${lead.id}:`, err);
        }
        if (!emailOk) {
          const err = emailRes.status === "rejected"
            ? (emailRes.reason instanceof Error ? emailRes.reason.message : String(emailRes.reason))
            : (emailRes.value as { ok: false; error: string }).error;
          console.error(`[diagnostico-followups] msg4 email failed lead=${lead.id}:`, err);
        }
      } else if (nextN === 5) {
        // T+5d — WhatsApp última llamada.
        kind = "wa";
        const text = lead.language === "de"
          ? `Hallo ${firstName}, letzte Nachfrage. Buchen wir deine Probestunde oder lieber später?  ${bookUrl}`
          : `Hola ${firstName}, última llamada por si te interesa. ¿Agendamos tu clase o lo dejamos para más adelante?  ${bookUrl}`;
        const r = await sendWhatsappText(lead.whatsapp_normalized, text);
        ok = r.ok;
      } else if (nextN === 6) {
        // T+8d — Email final + cold.
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

    // Marcar progreso. El msg 6 (último) además mueve a 'cold'.
    const update: Record<string, unknown> = {
      last_drip_msg_n:   nextN,
      last_drip_sent_at: new Date().toISOString(),
    };
    if (nextN === 6) update.status = "cold";

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
