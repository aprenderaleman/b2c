import { NextResponse }   from "next/server";
import { supabaseAdmin }  from "@/lib/supabase";
import {
  sendDiagnosticoWelcomeEmail,
  sendDiagnosticoFollowupEmail,
  sendDiagnosticoFollowupPdfEmail,
  sendDiagnosticoTestFollowupEmail,
} from "@/lib/email/send";
import { sendWhatsappText, sendWhatsappDocument } from "@/lib/whatsapp";
import { getSystemPauseStatus } from "@/lib/system-pause";
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
//
// Nota: el cron corre cada 30 min (Vercel cron), así que el lead puede
// recibir el msg 1 entre T+5min y T+35min en el peor caso. Si quieres
// envío más cercano al instante exacto, habría que bajar el schedule
// del cron a cada 5 min en vercel.json.
const GATES_MS: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1:  5 * MIN_MS,
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
  whatsapp_normalized:      string | null;
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
  // Niveles granulares — el funnel los escribe directamente y cada
  // lead recibe el PDF más cercano a su nivel real.
  "A0": {
    slug: "a0", level: "A0",
    title: "Tus primeros pasos en alemán",
    r2Key: "marketing/v1/a0-primeros-pasos.pdf",
    fileName: "Aprender-Aleman-Guia-A0.pdf",
  },
  "A1.1": {
    slug: "a1-1", level: "A1.1",
    title: "Hablar de ti y tu día a día",
    r2Key: "marketing/v1/a1-1-dia-a-dia.pdf",
    fileName: "Aprender-Aleman-Guia-A1.1.pdf",
  },
  "A1.2": {
    slug: "a1-2", level: "A1.2",
    title: "Formar frases y hacer preguntas",
    r2Key: "marketing/v1/a1-2-frases-preguntas.pdf",
    fileName: "Aprender-Aleman-Guia-A1.2.pdf",
  },
  "A2.1": {
    slug: "a2-1", level: "A2.1",
    title: "Hablar del pasado: el Perfekt",
    r2Key: "marketing/v1/a2-1-perfekt.pdf",
    fileName: "Aprender-Aleman-Guia-A2.1.pdf",
  },
  "A2.2": {
    slug: "a2-2", level: "A2.2",
    title: "Planes y obligaciones: modales + futuro",
    r2Key: "marketing/v1/a2-2-modales-futuro.pdf",
    fileName: "Aprender-Aleman-Guia-A2.2.pdf",
  },
  // TODO(2026-05-25): los PDFs de B1 y B2 están generados pero aún no
  // subidos al R2 (necesitamos token nuevo de Cloudflare). Mientras
  // tanto, los leads B1/B2 reciben el PDF A2.2 (modales + futuro) que
  // sigue siendo útil. Cuando se suban a R2 cambiar las dos entradas
  // a los archivos b1-konjunktiv-ii.pdf y b2-pasiva-conectores.pdf
  // (los DOCX existen en materiales-marketing/B*.docx).
  "B1": {
    slug: "a2-2", level: "A2.2 (fallback B1)",
    title: "Planes y obligaciones: modales + futuro",
    r2Key: "marketing/v1/a2-2-modales-futuro.pdf",
    fileName: "Aprender-Aleman-Guia-A2.2.pdf",
  },
  "B2": {
    slug: "a2-2", level: "A2.2 (fallback B2)",
    title: "Planes y obligaciones: modales + futuro",
    r2Key: "marketing/v1/a2-2-modales-futuro.pdf",
    fileName: "Aprender-Aleman-Guia-A2.2.pdf",
  },

  // Legacy / fallback — leads viejos creados antes de migrar al enum
  // granular, o leads que escogieron "no estoy seguro".
  "A1-A2": {
    slug: "a1-1", level: "A1.1",
    title: "Hablar de ti y tu día a día",
    r2Key: "marketing/v1/a1-1-dia-a-dia.pdf",
    fileName: "Aprender-Aleman-Guia-A1.1.pdf",
  },
  "B2+": {
    slug: "b2", level: "B2",
    title: "Argumenta y convence: pasiva + conectores",
    r2Key: "marketing/v1/b2-pasiva-conectores.pdf",
    fileName: "Aprender-Aleman-Guia-B2.pdf",
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

  // ── PAUSA GLOBAL ─────────────────────────────────────────────────
  // Si Evolution esta banned o Gelfis pauso manualmente, este cron
  // hace SOLO emails y deja WhatsApp completamente quieto. Esto evita
  // que la cadena de followups extienda el ban actual o nos meta en
  // otro nuevo. Importado de lib/system-pause.ts.
  const pauseStatus = await getSystemPauseStatus();
  const waPaused = pauseStatus.paused;
  if (waPaused) {
    console.warn("[diagnostico-followups] WhatsApp PAUSADO hasta", pauseStatus.until,
      "— este run hace email-only.");
  }

  // ── PRE-PASE: Email-only nudge ───────────────────────────────────
  // Drip AGRESIVO para leads que llenaron el form pero NO dejaron
  // WhatsApp (form 2-pasos, pulsaron "Continuar sin WhatsApp"). Sin
  // WA no podemos agendarles la clase, así que escalamos en email
  // hasta convencerlos: T+30min, T+6h, T+24h, T+3d, T+7d.
  const nudgeResult = await runEmailOnlyNudges(sb, baseUrl, now);

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
  let coldCapped = 0;

  // ── Anti-spam: leads que ya recibieron 2+ msgs sin responder NUNCA
  // dejan de recibir WhatsApp (solo email a partir de ahora). El 86%
  // de los leads top-mensajeados pre-ban (12-jun) jamas respondieron
  // — perfil clasico que reporta "spam" en WA → ban.
  // Sacamos los lead_ids con 0 inbound entre los candidatos del run.
  const candidateIds = leads.map(l => l.id);
  const coldLeadIds = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: inboundRows } = await sb
      .from("lead_timeline")
      .select("lead_id")
      .eq("type", "lead_message_received")
      .in("lead_id", candidateIds);
    const withInbound = new Set((inboundRows ?? []).map(r => (r as { lead_id: string }).lead_id));
    for (const id of candidateIds) if (!withInbound.has(id)) coldLeadIds.add(id);
  }

  for (const lead of leads) {
    const completedAt = new Date(lead.diagnostico_completed_at).getTime();
    const elapsed     = now - completedAt;
    const nextN       = (lead.last_drip_msg_n + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    const gate        = GATES_MS[nextN];

    if (elapsed < gate) { skipped++; continue; }

    // Cold-lead cap: si ya van 2 msgs sin respuesta NUNCA, este lead
    // solo recibe email (no WA). Tras el msg #3 sin respuesta paramos
    // tambien el email. Reduce drasticamente el ratio "no responden"
    // que dispara reportes spam en WA.
    const isCold = coldLeadIds.has(lead.id);
    if (isCold && nextN >= 3) {
      coldCapped++;
      skipped++;
      continue;
    }
    const forceEmailOnly = waPaused || (isCold && nextN >= 2);

    // Wrappers locales que cortocircuitan WhatsApp cuando estamos en
    // modo email-only (pausa global o cold-lead cap). Devuelven el
    // mismo shape que las funciones reales para no romper callers.
    const sendWA: typeof sendWhatsappText = async (phone, text) => {
      if (forceEmailOnly) return { ok: false, reason: "force_email_only" };
      return sendWhatsappText(phone, text);
    };
    const sendWADoc: typeof sendWhatsappDocument = async (phone, url, fileName, opts) => {
      if (forceEmailOnly) return { ok: false, reason: "force_email_only" };
      return sendWADoc(phone, url, fileName, opts);
    };

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
        // Welcome v4 (Gelfis 2026-05-27): copy unificado en español
        // para TODOS los leads (incluso los marcados `language='de'`).
        // Decisión: en B2C aplicamos un único idioma para mantener
        // consistencia operativa — Stiv responde en español y el funnel
        // está en español. El campo lead.language sigue existiendo
        // pero ya no bifurca el copy.
        const waText = [
          `¡Hola, ${firstName}! 👋`,
          ``,
          `Soy Stiv de la academia Aprender-Aleman.de, un gusto saludarte.`,
          `Recibimos tu solicitud para aprender alemán. Para avanzar más rápido, te propongo hablar 15 minutos para conocer tus objetivos y diseñarte un plan personalizado.`,
          ``,
          `¿A qué hora te viene bien hoy o mañana? 🇩🇪`,
          ``,
          `Stiv | Aprender-Aleman.de`,
        ].join("\n");

        const sendEmail = lead.email
          ? sendDiagnosticoWelcomeEmail(lead.email, {
              leadName: firstName,
              bookUrl,
              language: lead.language,
            })
          : Promise.resolve({ ok: false as const, error: "no_email" });

        const [waRes, emailRes] = await Promise.allSettled([
          sendWA(lead.whatsapp_normalized, waText),
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
        // Copia unificada Gelfis voice 2026-05-25. PDF llega como
        // adjunto en WhatsApp (Evolution doc) y email — no link.
        const captionWa = lead.language === "de"
          ? [
              `Hallo ${firstName}!`,
              ``,
              `Ich weiß, du interessierst dich für Deutsch — deshalb habe ich dir etwas vorbereitet: ein kostenloses PDF mit Lektionen für dein Niveau ${pdf.level}, damit du heute mit dem Üben anfangen kannst. Du findest es als Anhang in dieser Nachricht.`,
              ``,
              `Ich hoffe, es hilft dir! 💪`,
              ``,
              `Stiv | Aprender-Aleman.de`,
            ].join("\n")
          : [
              `¡Hola ${firstName}!`,
              ``,
              `Sé que estás interesado/a en aprender alemán, así que te he preparado algo: un PDF gratuito con lecciones adaptadas a tu nivel ${pdf.level} para que empieces a practicar desde hoy. Lo encuentras adjunto a este mensaje.`,
              ``,
              `¡Espero que te sea útil! 💪`,
              ``,
              `Stiv | Aprender-Aleman.de`,
            ].join("\n");

        // 1) WhatsApp: firmamos URL R2 corta y la pasamos a Evolution.
        //    Buffer del PDF lo usaremos para email (en paralelo).
        const fileUrl = `https://${process.env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com/${process.env.R2_BUCKET ?? "aprender-aleman-recordings"}/${pdf.r2Key}`;
        const signedUrl = await signRecordingUrl(fileUrl, 24 * 3600);

        // 2) Email: descargamos PDF y lo adjuntamos.
        const pdfBuffer = lead.email ? await downloadPdfBuffer(pdf.r2Key) : null;

        const sendWaTextThenDoc = async () => {
          // 1 sola WhatsApp: documento PDF con el texto como CAPTION.
          // Evolution lo muestra como una sola tarjeta de archivo +
          // texto debajo. Antes mandábamos 2 (texto + doc) pero Gelfis
          // pidió consolidar en 1 para no parecer spam.
          return sendWADoc(
            lead.whatsapp_normalized, signedUrl, pdf.fileName,
            { caption: captionWa, kind: "diagnostico_pdf_t24h", leadId: lead.id },
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
        const r = await sendWA(lead.whatsapp_normalized, text);
        ok = r.ok;
      } else if (nextN === 4) {
        // T+3d — Follow-up tras PDF (msg 2). Pregunta si le sirvió y
        // pide hora para llamada de 15 min hoy/mañana. WhatsApp +
        // Email en paralelo. Al menos uno cuenta.
        kind = "wa+email";
        const waText = lead.language === "de"
          ? [
              `Hallo ${firstName}!`,
              ``,
              `Ich hoffe, dir hat das PDF geholfen. Sag mir: hast du noch Interesse, Deutsch zu lernen?`,
              ``,
              `Wann hättest du heute oder morgen 15 Minuten Zeit für ein Gespräch, damit wir dir einen maßgeschneiderten Plan erstellen?`,
              ``,
              `Stiv | Aprender-Aleman.de`,
            ].join("\n")
          : [
              `¡Hola ${firstName}!`,
              ``,
              `Espero que te haya servido el PDF. Cuéntame: ¿aún mantienes interés en aprender alemán?`,
              ``,
              `¿A qué hora tienes 15 minutos hoy o mañana para una llamada y diseñarte un plan a medida?`,
              ``,
              `Stiv | Aprender-Aleman.de`,
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
          sendWA(lead.whatsapp_normalized, waText),
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
        const r = await sendWA(lead.whatsapp_normalized, text);
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
    { ok: true, scanned: leads.length, sent, skipped, errors, nudge: nudgeResult },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── Email-only nudge — drip agresivo para leads sin WhatsApp ──────

const NUDGE_GATES_MS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 30 * MIN_MS,    // T+30min
  2:  6 * HOUR_MS,   // T+6h
  3:      DAY_MS,    // T+24h
  4:  3 * DAY_MS,    // T+3d
  5:  7 * DAY_MS,    // T+7d
};

type SB = ReturnType<typeof supabaseAdmin>;

async function runEmailOnlyNudges(sb: SB, baseUrl: string, nowMs: number) {
  const { sendEmailOnlyNudge } = await import("@/lib/email/send");

  const { data, error } = await sb
    .from("leads")
    .select("id, name, email, diagnostico_completed_at, created_at, email_only_nudge_count, last_email_only_nudge_at")
    .is("whatsapp_normalized", null)
    .eq("status", "registered")
    .not("email", "is", null)
    .not("diagnostico_completed_at", "is", null)
    .lt("email_only_nudge_count", 5);

  if (error) {
    console.error("[email-only-nudge] query failed:", error.message);
    return { sent: 0, errors: 1, skipped: 0 };
  }

  let sent = 0, errors = 0, skipped = 0;
  for (const row of (data ?? []) as Array<{
    id: string; name: string | null; email: string;
    diagnostico_completed_at: string;
    email_only_nudge_count: number;
    last_email_only_nudge_at: string | null;
  }>) {
    const nextN = (row.email_only_nudge_count + 1) as 1 | 2 | 3 | 4 | 5;
    if (nextN > 5) { skipped++; continue; }
    const gate = NUDGE_GATES_MS[nextN];
    const elapsed = nowMs - new Date(row.diagnostico_completed_at).getTime();
    if (elapsed < gate) { skipped++; continue; }
    // Anti-doble disparo: no enviar si el último nudge salió hace <gate
    if (row.last_email_only_nudge_at) {
      const sinceLast = nowMs - new Date(row.last_email_only_nudge_at).getTime();
      const minGap = nextN === 1 ? 25 * MIN_MS : 5 * HOUR_MS; // mínimo razonable
      if (sinceLast < minGap) { skipped++; continue; }
    }

    const firstName = (row.name ?? "").trim().split(/\s+/)[0] || "Lead";
    // Link al funnel con el lead_id en hash para auto-restaurar la
    // sesión. El componente cliente lee `?resume=` y rellena los
    // campos guardados.
    const funnelUrl = `${baseUrl}/?resume=${encodeURIComponent(row.id)}#wa`;

    try {
      const r = await sendEmailOnlyNudge(row.email, {
        leadName: firstName, funnelUrl, step: nextN,
      });
      if (!r.ok) { errors++; continue; }

      await sb.from("leads").update({
        email_only_nudge_count: nextN,
        last_email_only_nudge_at: new Date(nowMs).toISOString(),
      }).eq("id", row.id);

      await sb.from("lead_timeline").insert({
        lead_id: row.id,
        type:    "system_message_sent",
        author:  "system",
        content: `📧 Nudge #${nextN} (email-only) enviado a ${row.email}`,
        metadata: { channel: "email", kind: "email_only_nudge", step: nextN },
      });
      sent++;
    } catch (e) {
      console.error("[email-only-nudge] send failed:", e instanceof Error ? e.message : e);
      errors++;
    }
  }
  return { sent, errors, skipped };
}
