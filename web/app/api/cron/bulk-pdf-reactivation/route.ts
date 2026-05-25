import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  sendDiagnosticoFollowupPdfEmail,
} from "@/lib/email/send";
import { sendWhatsappText, sendWhatsappDocument } from "@/lib/whatsapp";
import { signRecordingUrl } from "@/lib/r2";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * One-shot bulk reactivation: envía a TODOS los leads no convertidos
 * que no han recibido mensaje en las últimas 24h, el PDF gratis
 * adaptado a su nivel + texto unificado "Gelfis voice".
 *
 * Programación: Vercel Cron `0 6 * * *` = 08:00 CEST. La idempotencia
 * vive en `system_config.bulk_pdf_reactivation_sent_at` — si ya
 * corrió, los siguientes ticks retornan sin hacer nada.
 *
 * Modos:
 *   - ?mode=test → manda 7 PDFs (uno por nivel) al test recipient
 *                  (Gelfis: +4915253409544 / gelfis07@gmail.com).
 *                  NO marca idempotencia. NO actualiza leads.
 *   - sin param → producción. Marca idempotencia tras 1ª corrida.
 *
 * Cadencia anti-bloqueo: 5 segundos entre mensajes WhatsApp.
 * Orden: A1.1, A1.2, A2.1, A2.2, B1, B2, A0, unsure/null (Gelfis
 * pidió "Inicia con los nivel A1, luego A2 etc..").
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` o `X-Cron-Secret`.
 * Test mode adicionalmente requiere `?secret=<CRON_SECRET>` para
 * permitir invocación manual desde el browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min - cabe ~50 leads con 5s delay

// ── Config ────────────────────────────────────────────────────
const DELAY_MS = 5_000;   // 5s entre envíos WA (anti-bloqueo)
const TEST_PHONE = "+4915253409544";
const TEST_EMAIL = "gelfis07@gmail.com";
const IDEMP_KEY = "bulk_pdf_reactivation_sent_at";

// Orden de prioridad por nivel (Gelfis: A1 → A2 → B → A0).
const LEVEL_ORDER: Record<string, number> = {
  "A1.1": 1, "A1.2": 2,
  "A2.1": 3, "A2.2": 4,
  "B1":   5, "B2":   6,
  "A1-A2": 5,   // legacy → ordena con A2
  "B2+":   6,   // legacy
  "A0":    7,
  "unsure": 8,
};

type PdfMeta = {
  slug:     string;
  level:    string;
  title:    string;
  r2Key:    string;
  fileName: string;
};

// PDF_BY_LEVEL — keep in sync with diagnostico-followups/route.ts
const PDF_BY_LEVEL: Record<string, PdfMeta> = {
  "A0":   { slug: "a0",   level: "A0",   title: "Tus primeros pasos en alemán",         r2Key: "marketing/v1/a0-primeros-pasos.pdf",      fileName: "Aprender-Aleman-Guia-A0.pdf" },
  "A1.1": { slug: "a1-1", level: "A1.1", title: "Hablar de ti y tu día a día",          r2Key: "marketing/v1/a1-1-dia-a-dia.pdf",         fileName: "Aprender-Aleman-Guia-A1.1.pdf" },
  "A1.2": { slug: "a1-2", level: "A1.2", title: "Formar frases y hacer preguntas",      r2Key: "marketing/v1/a1-2-frases-preguntas.pdf",  fileName: "Aprender-Aleman-Guia-A1.2.pdf" },
  "A2.1": { slug: "a2-1", level: "A2.1", title: "Hablar del pasado: el Perfekt",        r2Key: "marketing/v1/a2-1-perfekt.pdf",           fileName: "Aprender-Aleman-Guia-A2.1.pdf" },
  "A2.2": { slug: "a2-2", level: "A2.2", title: "Planes y obligaciones: modales + futuro", r2Key: "marketing/v1/a2-2-modales-futuro.pdf", fileName: "Aprender-Aleman-Guia-A2.2.pdf" },
  // TODO: subir b1/b2 PDFs a R2 y restaurar las dos entradas siguientes.
  "B1":   { slug: "a2-2", level: "A2.2 (fallback B1)", title: "Planes y obligaciones: modales + futuro", r2Key: "marketing/v1/a2-2-modales-futuro.pdf", fileName: "Aprender-Aleman-Guia-A2.2.pdf" },
  "B2":   { slug: "a2-2", level: "A2.2 (fallback B2)", title: "Planes y obligaciones: modales + futuro", r2Key: "marketing/v1/a2-2-modales-futuro.pdf", fileName: "Aprender-Aleman-Guia-A2.2.pdf" },
  // legacy keys
  "A1-A2": { slug: "a1-1", level: "A1.1", title: "Hablar de ti y tu día a día",         r2Key: "marketing/v1/a1-1-dia-a-dia.pdf",         fileName: "Aprender-Aleman-Guia-A1.1.pdf" },
  "B2+":   { slug: "a2-2", level: "A2.2", title: "Planes y obligaciones: modales + futuro", r2Key: "marketing/v1/a2-2-modales-futuro.pdf", fileName: "Aprender-Aleman-Guia-A2.2.pdf" },
  "unsure":{ slug: "a0",   level: "A0",   title: "Tus primeros pasos en alemán",         r2Key: "marketing/v1/a0-primeros-pasos.pdf",      fileName: "Aprender-Aleman-Guia-A0.pdf" },
};

function pdfForLead(germanLevel: string | null | undefined): PdfMeta {
  if (!germanLevel) return PDF_BY_LEVEL["A0"];
  return PDF_BY_LEVEL[germanLevel] ?? PDF_BY_LEVEL["A0"];
}

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
    console.error("[bulk-pdf] R2 download failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

function authorised(req: Request, url: URL): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  if (req.headers.get("x-cron-secret") === expected) return true;
  // Allow ?secret= for test mode invocation from browser
  if (url.searchParams.get("secret") === expected) return true;
  return false;
}

// Copia unificada Gelfis voice.
function waText(name: string, level: string, language: "es" | "de"): string {
  const firstName = name.split(/\s+/)[0] || name;
  if (language === "de") {
    return [
      `Hallo ${firstName}!`,
      ``,
      `Ich weiß, du interessierst dich für Deutsch — deshalb habe ich dir etwas vorbereitet: ein kostenloses PDF mit Übungen für dein Niveau ${level}, damit du heute mit dem Üben anfangen kannst. Du findest es als Anhang in dieser Nachricht.`,
      ``,
      `Ich hoffe, es hilft dir! 💪`,
      ``,
      `Gelfis | Aprender-Aleman.de`,
    ].join("\n");
  }
  return [
    `¡Hola ${firstName}!`,
    ``,
    `Sé que estás interesado/a en aprender alemán, así que te he preparado algo: un PDF gratuito con ejercicios adaptados a tu nivel ${level} para que empieces a practicar desde hoy. Lo encuentras adjunto a este mensaje.`,
    ``,
    `¡Espero que te sea útil! 💪`,
    ``,
    `Gelfis | Aprender-Aleman.de`,
  ].join("\n");
}

type LeadRow = {
  id:                  string;
  name:                string;
  email:               string | null;
  whatsapp_normalized: string;
  language:            "es" | "de";
  german_level:        string | null;
  status:              string;
  last_drip_sent_at:   string | null;
};

type SendResult = {
  leadId:  string;
  level:   string;
  waOk:    boolean;
  docOk:   boolean;
  emailOk: boolean;
  error?:  string;
};

export async function GET(req: Request) { return runCron(req); }
export async function POST(req: Request) { return runCron(req); }

async function runCron(req: Request) {
  const url = new URL(req.url);
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req, url)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode = url.searchParams.get("mode") === "test" ? "test" : "live";
  const sb = supabaseAdmin();
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const bookUrl = `${baseUrl}/agendar/cuando`;

  // ── TEST MODE — 1 envío por nivel a Gelfis ──────────────────────
  if (mode === "test") {
    const results: SendResult[] = [];
    const ALL_LEVELS: Array<keyof typeof PDF_BY_LEVEL> =
      ["A0", "A1.1", "A1.2", "A2.1", "A2.2", "B1", "B2"];

    // Override del teléfono via ?phone=+49xxx (acepta espacios).
    const phoneParam = url.searchParams.get("phone");
    const phoneToUse = phoneParam
      ? phoneParam.replace(/\s+/g, "")
      : TEST_PHONE;
    const emailParam = url.searchParams.get("email");
    const emailToUse = emailParam || TEST_EMAIL;

    // Por defecto manda 1 solo PDF (A0) — basta para validar pipeline.
    // ?all=1 manda los 7 niveles. ?level=A2.1 manda solo ese.
    const levelParam = url.searchParams.get("level") as keyof typeof PDF_BY_LEVEL | null;
    const sendAll = url.searchParams.get("all") === "1";
    const testLevels: Array<keyof typeof PDF_BY_LEVEL> = sendAll
      ? ALL_LEVELS
      : levelParam && PDF_BY_LEVEL[levelParam]
        ? [levelParam]
        : ["A0"];

    for (const level of testLevels) {
      const pdf = PDF_BY_LEVEL[level];
      const text = waText("Gelfis", pdf.level, "es");
      const out: SendResult = { leadId: "test-" + level, level, waOk: false, docOk: false, emailOk: false };

      try {
        // 1) WhatsApp text
        const waRes = await sendWhatsappText(phoneToUse, text);
        out.waOk = waRes.ok;
        if (!waRes.ok) out.error = `wa_text:${waRes.reason}`;

        // 2) WhatsApp document
        const fileUrl = `https://${process.env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com/${process.env.R2_BUCKET ?? "aprender-aleman-recordings"}/${pdf.r2Key}`;
        const signedUrl = await signRecordingUrl(fileUrl, 24 * 3600);
        const docRes = await sendWhatsappDocument(
          phoneToUse, signedUrl, pdf.fileName,
          { caption: "", kind: "bulk_pdf_test", leadId: "test-" + level },
        );
        out.docOk = docRes.ok;
        if (!docRes.ok && !out.error) out.error = `wa_doc:${docRes.reason}`;

        // 3) Email
        const pdfBuffer = await downloadPdfBuffer(pdf.r2Key);
        if (pdfBuffer) {
          const emailRes = await sendDiagnosticoFollowupPdfEmail(emailToUse, {
            leadName: "Gelfis",
            level:    pdf.level,
            pdfTitle: pdf.title,
            language: "es",
            bookUrl,
          }, { fileName: pdf.fileName, buffer: pdfBuffer });
          out.emailOk = emailRes.ok;
        } else {
          out.error = "no_pdf_buffer";
        }
      } catch (e) {
        out.error = e instanceof Error ? e.message : "unknown";
      }

      results.push(out);
      await sleep(DELAY_MS);
    }

    return NextResponse.json(
      { ok: true, mode, sentLevels: results.length, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── LIVE MODE ───────────────────────────────────────────────
  // Idempotency check
  const { data: cfg } = await sb
    .from("system_config")
    .select("value")
    .eq("key", IDEMP_KEY)
    .maybeSingle();
  if (cfg?.value) {
    return NextResponse.json(
      { ok: true, mode, skipped: "already_sent_at_" + cfg.value },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Query eligible leads
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, german_level, status, last_drip_sent_at")
    .not("status", "in", "(converted,trial_scheduled,trial_reminded,trial_absent)")
    .not("whatsapp_normalized", "is", null)
    .or(`last_drip_sent_at.is.null,last_drip_sent_at.lt.${cutoff}`);

  if (error) {
    console.error("[bulk-pdf] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as LeadRow[];

  // Sort by user-requested level priority: A1.1 → A1.2 → A2.1 → A2.2 → B1 → B2 → A0
  leads.sort((a, b) => {
    const oa = LEVEL_ORDER[a.german_level || "A0"] ?? 9;
    const ob = LEVEL_ORDER[b.german_level || "A0"] ?? 9;
    return oa - ob;
  });

  const results: SendResult[] = [];
  let sent = 0;
  let errors = 0;

  for (const lead of leads) {
    const pdf = pdfForLead(lead.german_level);
    const firstName = lead.name.split(/\s+/)[0] || lead.name;
    const text = waText(firstName, pdf.level, lead.language);
    const out: SendResult = {
      leadId: lead.id, level: pdf.level,
      waOk: false, docOk: false, emailOk: false,
    };

    try {
      const waRes = await sendWhatsappText(lead.whatsapp_normalized, text);
      out.waOk = waRes.ok;

      const fileUrl = `https://${process.env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com/${process.env.R2_BUCKET ?? "aprender-aleman-recordings"}/${pdf.r2Key}`;
      const signedUrl = await signRecordingUrl(fileUrl, 24 * 3600);
      const docRes = await sendWhatsappDocument(
        lead.whatsapp_normalized, signedUrl, pdf.fileName,
        { caption: "", kind: "bulk_pdf_reactivation", leadId: lead.id },
      );
      out.docOk = docRes.ok;

      if (lead.email) {
        const pdfBuffer = await downloadPdfBuffer(pdf.r2Key);
        if (pdfBuffer) {
          const emailRes = await sendDiagnosticoFollowupPdfEmail(lead.email, {
            leadName: firstName,
            level:    pdf.level,
            pdfTitle: pdf.title,
            language: lead.language,
            bookUrl,
          }, { fileName: pdf.fileName, buffer: pdfBuffer });
          out.emailOk = emailRes.ok;
        }
      }

      const anySuccess = out.waOk || out.docOk || out.emailOk;
      if (anySuccess) {
        sent++;
        await sb.from("leads").update({
          last_drip_sent_at: new Date().toISOString(),
        }).eq("id", lead.id);
        await sb.from("lead_timeline").insert({
          lead_id: lead.id,
          type:    "system_message_sent",
          author:  "system",
          content: `📨 Bulk reactivation PDF enviado (nivel ${pdf.level})`,
          metadata: {
            kind: "bulk_pdf_reactivation",
            level: pdf.level,
            channels: { wa: out.waOk, doc: out.docOk, email: out.emailOk },
          },
        });
      } else {
        errors++;
        out.error = "all_channels_failed";
      }
    } catch (e) {
      errors++;
      out.error = e instanceof Error ? e.message : "unknown";
      console.error(`[bulk-pdf] lead ${lead.id} send failed:`, out.error);
    }

    results.push(out);
    // 5s anti-bloqueo entre WhatsApps. Si es el último, skip.
    if (leads.indexOf(lead) < leads.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Marca idempotencia tras corrida exitosa (haya o no errores per-lead).
  await sb.from("system_config").upsert({
    key:        IDEMP_KEY,
    value:      new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      ok: true, mode,
      scanned: leads.length,
      sent, errors,
      byLevel: countByLevel(results),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function countByLevel(rs: SendResult[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const r of rs) {
    acc[r.level] = (acc[r.level] ?? 0) + 1;
  }
  return acc;
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}
