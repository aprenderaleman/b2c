import { NextResponse }   from "next/server";
import { supabaseAdmin }  from "@/lib/supabase";
import {
  sendDiagnosticoWelcomeEmail,
  sendDiagnosticoFollowupEmail,
  sendDiagnosticoFollowupPdfEmail,
} from "@/lib/email/send";
import { sendWhatsappText, sendWhatsappDocument } from "@/lib/whatsapp";
import { getSystemPauseStatus } from "@/lib/system-pause";
import { getActiveTemplate, renderTemplate } from "@/lib/message-stats";
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
 * Cadencia (Gelfis 2026-06-14, 8-msg drip):
 *
 *   msg 1 → T+5min  → WA + Email — Stiv saluda + pregunta motivacional
 *                     (1=Trabajo · 2=Estudios · 3=Pareja · 4=Otra).
 *                     Crea engagement con respuesta de bajo esfuerzo.
 *   msg 2 → T+4h    → WA (solo si NO respondió msg 1) — nudge bajo
 *                     esfuerzo "solo dime con un número".
 *   msg 3 → T+24h   → WA + Email — Regalo: PDF "10 errores comunes
 *                     hispanohablantes" adaptado al nivel + curiosity
 *                     gap del error #7.
 *   msg 4 → T+3d    → WA — invita al test de nivel.
 *   msg 5 → T+5d    → WA — pregunta objeciones (A/B/C/D).
 *   msg 6 → T+8d    → WA — mensaje motivacional honesto.
 *   msg 7 → T+11d   → Email — pregunta binaria sí/no.
 *   msg 8 → T+14d   → WA + Email final + status='lost'.
 *
 * Stop conditions (managed implicitly):
 *   - Si el lead agenda → book-trial cambia status a 'trial_scheduled'
 *     y la query lo deja fuera del cron.
 *   - Si el lead responde por WA con palabras de baja → mark needs_human
 *     (esto NO es responsabilidad de este cron; lo hacen los agentes
 *     Python o el handler del webhook de WhatsApp).
 *   - Msg 2 se SALTA (skip + bump last_drip_msg_n) si el lead respondió
 *     a msg 1 — para no parecer bot mientras Stiv ya está conversando.
 *   - Tras msg 8, el lead pasa a 'lost' y queda fuera del cron.
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
// Cadena de 8 mensajes (Gelfis 2026-06-14). Msg 2 es CONDICIONAL —
// se salta si el lead respondió al msg 1. La idea: si ya está
// conversando no necesita un nudge extra de "responde con 1/2/3/4".
const GATES_MS: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, number> = {
  1:   5 * MIN_MS,
  2:   4 * HOUR_MS,
  3:       DAY_MS,
  4:   3 * DAY_MS,
  5:   5 * DAY_MS,
  6:   8 * DAY_MS,
  7:  11 * DAY_MS,
  8:  14 * DAY_MS,
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
  last_drip_sent_at:        string | null;
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
  // Filtramos en SQL por last_drip_msg_n < 8 — los de 8 ya están 'lost'
  // pero defendemos en cliente igual.
  const { data, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, german_level, diagnostico_completed_at, last_drip_msg_n, last_drip_sent_at")
    .eq("status", "registered")
    .lt("last_drip_msg_n", 8)
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
  let runCapped  = 0;

  // ── Cap MAX_PER_RUN ─────────────────────────────────────────────
  // Limite duro de envios por ejecucion del cron para evitar avalanchas
  // (caso 2026-06-12 tras pausa de 6h: 25 leads acumulados saldrian de
  // golpe en el primer run y disparar otro ban WA). Con 5/run x 12 runs/h
  // = 60 msgs/h max, que es soportable. Cron cada 30 min: ~10 msgs/h.
  // Override via env var (sin redeploy si Vercel lo permite).
  const MAX_PER_RUN = Number(process.env.DIAGNOSTICO_FOLLOWUPS_MAX_PER_RUN ?? 5);

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

  // ── Drip CONTEXTUAL ─────────────────────────────────────────────
  // Antes de enviar el siguiente msg del drip a CADA lead, verificamos
  // que NO haya actividad relevante desde el último envío del drip:
  //   - lead_message_received   → el lead respondió, Stiv debe leerlo no spamear
  //   - agent_note autor gelfis → Gelfis tomó control manual
  //   - escalation              → ya está marcado needs_human
  // Si hay → SKIP el envío (lo dejamos en pause hasta intervención manual).
  //
  // Esto resuelve el caso documentado de Jenni (sat 13/06): respondió
  // al welcome con "Solo porque me gustaría aprender" pero el webhook
  // estaba caído. Aunque hayamos arreglado el webhook, este check
  // protege contra futuras caídas y contra ediciones manuales que el
  // sistema no ve (escenarios donde Gelfis escribe desde su WA personal).
  const blockedByActivity = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: recentActivity } = await sb
      .from("lead_timeline")
      .select("lead_id, type, author, timestamp")
      .in("lead_id", candidateIds)
      .in("type", ["lead_message_received", "agent_note", "escalation"])
      .order("timestamp", { ascending: false });
    // Para cada lead, comparamos el ultimo evento de ESTOS tipos con su
    // last_drip_sent_at. Si el evento es POSTERIOR al ultimo drip → bloquear.
    const lastActivityByLead = new Map<string, { ts: string; type: string; author: string | null }>();
    for (const r of (recentActivity ?? []) as Array<{ lead_id: string; type: string; author: string | null; timestamp: string }>) {
      // Solo conservar el más reciente por lead (rows ya ordenadas DESC).
      if (!lastActivityByLead.has(r.lead_id)) lastActivityByLead.set(r.lead_id, { ts: r.timestamp, type: r.type, author: r.author });
    }
    for (const lead of leads) {
      const activity = lastActivityByLead.get(lead.id);
      if (!activity) continue;
      const activityMs = new Date(activity.ts).getTime();
      // El cron almacena last_drip_sent_at; si no existe (primer envío
      // pendiente, msg #1), no hay drip previo que comparar.
      const lastDripMs = lead.last_drip_sent_at ? new Date(lead.last_drip_sent_at).getTime() : 0;
      // Si la actividad es posterior al último drip → bloquear.
      // Excepción: agent_note de author=system (auto-pause, trial events,
      // etc.) son ruido del propio sistema, no actividad humana real.
      if (activityMs > lastDripMs) {
        const isSystemNoise = activity.type === "agent_note" && activity.author === "system";
        if (!isSystemNoise) {
          blockedByActivity.add(lead.id);
        }
      }
    }
  }

  let contextSkipped = 0;
  for (const lead of leads) {
    // Cap por run — si ya enviamos el maximo, paramos. Los restantes
    // siguen pendientes y los procesa el proximo run del cron.
    if (sent >= MAX_PER_RUN) { runCapped++; skipped++; continue; }

    // Drip CONTEXTUAL: si hay actividad humana posterior al último drip
    // (lead respondió, Gelfis tomó control, escalado a needs_human),
    // saltamos el envío. Solo se reanuda cuando Gelfis explícitamente
    // reactiva (con el botón "Reactivar Stiv" o desde admin).
    if (blockedByActivity.has(lead.id)) {
      contextSkipped++;
      skipped++;
      continue;
    }

    const completedAt = new Date(lead.diagnostico_completed_at).getTime();
    const elapsed     = now - completedAt;
    const nextN       = (lead.last_drip_msg_n + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
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
    // intendedChannel: lo que el msg pretende mandar (lo que el copy supone).
    // actualWa/actualEmail: si realmente salio cada canal. Se calcula con
    // lo retornado por send*. El channel registrado en metadata debe ser
    // el REAL para no mentir (bug Tomas/Priscila/etc. 2026-06-16: WA
    // fallaba durante pausa global pero metadata decia channel="wa+email").
    let intendedChannel: "wa" | "email" | "wa+email" = "wa";
    let actualWa    = false;
    let actualEmail = false;
    // Body real del mensaje enviado — lo guardamos en lead_timeline.content
    // para que /admin/mensajes muestre el texto real, no un resumen.
    // Si se mandan ambos canales, priorizamos el WA (el lead lo ve igual).
    let sentBody = "";

    // Helper: ¿el lead respondió al msg 1?
    // Lo usamos para saltar msg 2 (nudge de baja fricción) si ya
    // está en conversación con Stiv.
    const leadResponded = async (): Promise<boolean> => {
      if (!lead.last_drip_sent_at) return false;
      const { data } = await sb
        .from("lead_timeline")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("type", "lead_message_received")
        .gte("timestamp", lead.last_drip_sent_at)
        .limit(1);
      return (data?.length ?? 0) > 0;
    };

    const levelLabel = lead.german_level ?? "A0";

    try {
      if (nextN === 1) {
        // T+5min — Pregunta abierta de motivación. Copy nuevo Gelfis
        // 2026-06-14: pide responder con 1/2/3/4 para crear engagement
        // bajo esfuerzo. No vende todavía — construye relación.
        intendedChannel = "wa+email";
        const welcomeTpl = await getActiveTemplate("diagnostico_followup", "whatsapp", 1);
        const waText = welcomeTpl
          ? renderTemplate(welcomeTpl.body, { firstName, bookUrl, level: levelLabel })
          : [
              `¡Hola ${firstName}! 👋`,
              ``,
              `Soy Stiv del equipo de Aprender-Aleman.de`,
              ``,
              `Vi que acabas de hacer tu diagnóstico. Por lo que veo estás en nivel ${levelLabel}.`,
              ``,
              `Pregunta rápida: ¿qué te motivó a aprender alemán?`,
              `1 Trabajo en Alemania o Suiza`,
              `2 Estudios universitarios`,
              `3 Pareja alemana`,
              `4 Otra razón`,
              ``,
              `Responde con el número para enviarte info útil para TU caso específico 👇`,
            ].join("\n");

        const sendEmail = lead.email
          ? sendDiagnosticoWelcomeEmail(lead.email, {
              leadName: firstName,
              bookUrl,
              language: lead.language,
            })
          : Promise.resolve({ ok: false as const, error: "no_email" });

        sentBody = waText;
        const [waRes, emailRes] = await Promise.allSettled([
          sendWA(lead.whatsapp_normalized, waText),
          sendEmail,
        ]);
        actualWa    = waRes.status === "fulfilled" && waRes.value.ok;
        actualEmail = emailRes.status === "fulfilled" &&
          (emailRes.value as { ok: boolean }).ok;
        ok = actualWa || actualEmail;

        if (!actualWa) {
          const err = waRes.status === "rejected"
            ? (waRes.reason instanceof Error ? waRes.reason.message : String(waRes.reason))
            : "send_failed";
          console.error(`[diagnostico-followups] welcome WA failed lead=${lead.id}:`, err);
        }
        if (!actualEmail) {
          const err = emailRes.status === "rejected"
            ? (emailRes.reason instanceof Error ? emailRes.reason.message : String(emailRes.reason))
            : (emailRes.value as { ok: false; error: string }).error;
          console.error(`[diagnostico-followups] welcome email failed lead=${lead.id}:`, err);
        }
      } else if (nextN === 2) {
        // T+4h — Nudge bajo esfuerzo (solo si NO respondió al msg 1).
        // Si ya está en conversación con Stiv, saltamos para no parecer
        // un bot. Si no respondió, repetimos con menos fricción.
        intendedChannel = "wa";
        if (await leadResponded()) {
          // Marcamos progreso pero NO enviamos. Avanza last_drip_msg_n
          // para que el cron pueda llegar al msg 3 en su gate.
          skipped++;
          await sb.from("leads").update({
            last_drip_msg_n: nextN,
            last_drip_sent_at: new Date().toISOString(),
          }).eq("id", lead.id);
          await sb.from("lead_timeline").insert({
            lead_id: lead.id,
            type:    "agent_note",
            author:  "system",
            content: `📨 Followup #2 saltado — lead ya respondió al msg 1`,
            metadata: { kind: "diagnostico_followup_skip", message_n: 2 },
          });
          continue;
        }
        // forceEmailOnly + msg #2 es WA-only → saltar para no quedarnos
        // pegados en deadlock (pausa global o cold-lead bloquean el WA
        // y no hay version email del nudge). Avanza last_drip_msg_n y
        // deja que msg #3 (T+24h, WA+email con PDF) tome el relevo.
        if (forceEmailOnly) {
          skipped++;
          await sb.from("leads").update({
            last_drip_msg_n: nextN,
            last_drip_sent_at: new Date().toISOString(),
          }).eq("id", lead.id);
          await sb.from("lead_timeline").insert({
            lead_id: lead.id,
            type:    "agent_note",
            author:  "system",
            content: `📨 Followup #2 saltado — ${waPaused ? "WA pausado" : "cold-lead cap"} y msg #2 es WA-only`,
            metadata: { kind: "diagnostico_followup_skip", message_n: 2, reason: waPaused ? "wa_paused" : "cold_cap" },
          });
          continue;
        }
        const text = [
          `Hola de nuevo ${firstName} 😊`,
          ``,
          `Sé que ahora estás ocupado. Solo dime con UN número (1, 2, 3 o 4) por qué quieres aprender alemán y te mando lo más útil para tu caso.`,
          ``,
          `Te tomará 3 segundos 👇`,
        ].join("\n");
        sentBody = text;
        const r = await sendWA(lead.whatsapp_normalized, text);
        ok = r.ok; actualWa = r.ok;
      } else if (nextN === 3) {
        // T+24h — Regalo: PDF adaptado al nivel + curiosity gap del #7.
        // Doble canal. WA = PDF adjunto con caption "te va a sorprender
        // el #7". Email = botón descargar + CTA secundario agendar.
        intendedChannel = "wa+email";

        const pdf = pdfForLead(lead.german_level);
        const captionWa = [
          `${firstName}, te mando esto que prometí:`,
          ``,
          `🎁 PDF GRATIS: "Los 10 errores más comunes de los hispanohablantes al aprender alemán" (adaptado a tu nivel ${pdf.level})`,
          ``,
          `Léelo cuando tengas 5 min. Te va a sorprender el #7.`,
          ``,
          `Y dime después si lo encontraste útil 📚`,
        ].join("\n");

        const fileUrl = `https://${process.env.R2_ACCOUNT_ID ?? ""}.r2.cloudflarestorage.com/${process.env.R2_BUCKET ?? "aprender-aleman-recordings"}/${pdf.r2Key}`;
        const signedUrl = await signRecordingUrl(fileUrl, 24 * 3600);
        const pdfBuffer = lead.email ? await downloadPdfBuffer(pdf.r2Key) : null;

        const sendWaTextThenDoc = async () => sendWADoc(
          lead.whatsapp_normalized, signedUrl, pdf.fileName,
          { caption: captionWa, kind: "diagnostico_pdf_t24h", leadId: lead.id },
        );

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
        actualWa    = waRes.status === "fulfilled" && waRes.value.ok;
        actualEmail = emailRes.status === "fulfilled" &&
          (emailRes.value as { ok: boolean }).ok;
        ok = actualWa || actualEmail;

        if (!actualWa)    console.error(`[diagnostico-followups] msg3 WA failed lead=${lead.id} pdf=${pdf.slug}`);
        if (!actualEmail) console.error(`[diagnostico-followups] msg3 email failed lead=${lead.id} pdf=${pdf.slug}`);
      } else if (nextN === 4) {
        // T+3d — WhatsApp invita al test de nivel.
        intendedChannel = "wa";
        const text = [
          `Hola ${firstName}, te dejo algo más:`,
          ``,
          `Descubre tu nivel de alemán real 👇`,
          ``,
          `Test de nivel: ${testUrl}`,
        ].join("\n");
        sentBody = text;
        const r = await sendWA(lead.whatsapp_normalized, text);
        ok = r.ok; actualWa = r.ok;
      } else if (nextN === 5) {
        // T+5d — WhatsApp pregunta de objeciones (A/B/C/D).
        intendedChannel = "wa";
        const text = [
          `${firstName}, una pregunta:`,
          ``,
          `¿Qué te ha frenado para agendar tu clase de prueba gratis? 🤔`,
          ``,
          `A) No tengo tiempo esta semana`,
          `B) Quiero pensarlo más`,
          `C) El precio`,
          `D) Otra razón`,
          ``,
          `Sea cual sea, te entiendo. Solo dime para ajustarme a ti 👇`,
        ].join("\n");
        sentBody = text;
        const r = await sendWA(lead.whatsapp_normalized, text);
        ok = r.ok; actualWa = r.ok;
      } else if (nextN === 6) {
        // T+8d — WhatsApp mensaje motivacional honesto.
        intendedChannel = "wa";
        const text = [
          `Hola ${firstName} 👋`,
          ``,
          `Voy a ser sincero contigo:`,
          ``,
          `He hablado con cientos de personas como tú que querían aprender alemán. La diferencia entre los que LO LOGRAN y los que NO, no es el dinero, ni el tiempo, ni el talento.`,
          ``,
          `Es la decisión.`,
          ``,
          `30 minutos de clase prueba gratis. Sin compromiso.`,
          `Tu agenda → ${bookUrl}`,
          ``,
          `Si después decides que no, no pasa nada. Pero al menos lo intentaste.`,
          ``,
          `Stiv`,
        ].join("\n");
        sentBody = text;
        const r = await sendWA(lead.whatsapp_normalized, text);
        ok = r.ok; actualWa = r.ok;
      } else if (nextN === 7) {
        // T+11d — Email pregunta binaria sí/no.
        intendedChannel = "email";
        if (!lead.email) { skipped++; continue; }
        const r = await sendDiagnosticoFollowupEmail(lead.email, {
          leadName: firstName,
          bookUrl,
          language: lead.language,
          variant:  "binary_question",
        });
        ok = r.ok; actualEmail = r.ok;
      } else if (nextN === 8) {
        // T+14d — Despedida WA + Email. Lead pasa a 'lost'.
        intendedChannel = "wa+email";
        const waText = [
          `${firstName}, último mensaje:`,
          ``,
          `Te voy a dejar de escribir porque entiendo que no es tu momento.`,
          ``,
          `Cuando estés listo, aquí estaré 👇`,
          `${bookUrl}`,
          ``,
          `Mucho éxito con el alemán, lo logres con nosotros o no.`,
          ``,
          `Stiv 🇩🇪`,
        ].join("\n");
        const sendEmail = lead.email
          ? sendDiagnosticoFollowupEmail(lead.email, {
              leadName: firstName,
              bookUrl,
              language: lead.language,
              variant:  "final_goodbye",
            })
          : Promise.resolve({ ok: false as const, error: "no_email" });
        sentBody = waText;
        const [waRes, emailRes] = await Promise.allSettled([
          sendWA(lead.whatsapp_normalized, waText),
          sendEmail,
        ]);
        actualWa    = waRes.status === "fulfilled" && waRes.value.ok;
        actualEmail = emailRes.status === "fulfilled" &&
          (emailRes.value as { ok: boolean }).ok;
        ok = actualWa || actualEmail;
        if (!actualWa)    console.error(`[diagnostico-followups] msg8 WA failed lead=${lead.id}`);
        if (!actualEmail) console.error(`[diagnostico-followups] msg8 email failed lead=${lead.id}`);
      }
    } catch (e) {
      console.error(`[diagnostico-followups] send failed lead=${lead.id} msg=${nextN}:`,
        e instanceof Error ? e.message : e);
      ok = false;
    }

    if (!ok) { errors++; continue; }

    // Marcar progreso. El msg 8 (último) además mueve a 'lost' —
    // Gelfis 2026-06-14: cambio de 'cold' a 'lost' porque tras 14 días
    // sin respuesta el lead ya no se puede recuperar via drip.
    const update: Record<string, unknown> = {
      last_drip_msg_n:   nextN,
      last_drip_sent_at: new Date().toISOString(),
    };
    if (nextN === 8) update.status = "lost";

    const { error: updErr } = await sb.from("leads").update(update).eq("id", lead.id);
    if (updErr) {
      // Mensaje SÍ salió pero no pudimos marcar — log pero NO contamos
      // como error (el envío fue exitoso). En la próxima corrida
      // podríamos reenviar; lo aceptamos para evitar perder leads.
      console.error(`[diagnostico-followups] mark progress failed lead=${lead.id}:`, updErr.message);
    }

    // Calcula channel REAL en base a lo que salio. NUNCA confiar en
    // intendedChannel — si el WA fallo durante una pausa global pero el
    // email paso, channel real es "email", no "wa+email" (mentir aqui
    // hace que /admin/mensajes y los stats sean ciegos al canal perdido).
    const actualChannel: "wa" | "email" | "wa+email" | "none" =
      actualWa && actualEmail ? "wa+email"
        : actualWa ? "wa"
          : actualEmail ? "email"
            : "none";

    const waPending = intendedChannel.includes("wa") && !actualWa;

    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "system_message_sent",
      author:  "system",
      // Body real del mensaje. Si por algún motivo no se setea (no
      // debería tras los assignments de cada nextN), caemos al summary
      // viejo para no romper la fila — pero las stats lo marcarán como
      // "resumen" en /admin/mensajes.
      content: sentBody || `📨 Followup #${nextN} (${actualChannel}) enviado`,
      metadata: {
        kind:             "diagnostico_followup",
        message_n:        nextN,
        channel:          actualChannel,
        intended_channel: intendedChannel,
        wa_pending:       waPending || undefined,
      },
    });

    // Si el WA fallo pero email paso, registramos un agent_note para que
    // /admin/leads/[id] muestre claramente "⚠ WA pendiente" y el operador
    // pueda usar el endpoint admin/leads/[id]/resend-drip-welcome-wa para
    // reintentar manualmente (caso Tomas/Priscila/Michelle/Angela 2026-06-16).
    if (waPending) {
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "agent_note",
        author:  "system",
        content: `⚠ WA del followup #${nextN} no salió (canal real: ${actualChannel}). Reintento manual disponible.`,
        metadata: { kind: "drip_wa_pending", message_n: nextN, intended_channel: intendedChannel, actual_channel: actualChannel },
      });
    }

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
  const { renderEmailOnlyNudge } = await import("@/lib/email/templates/email-only-nudge");

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
      // Renderizamos para enviar Y para guardar el body real en
      // lead_timeline. Renderizar dos veces seria caro, pero sendEmailOnlyNudge
      // tambien renderiza dentro — alternativa seria exportar una version
      // que acepte el RenderedEmail ya hecho. Por ahora: render una vez
      // para body, otra vez para send (idempotente y barato).
      const renderedForLog = await renderEmailOnlyNudge({
        leadName: firstName, funnelUrl, step: nextN,
      });
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
        // Body real del email (texto plano, sin HTML) para que el
        // editor de /admin/mensajes muestre lo que recibe el lead.
        content: `[Asunto: ${renderedForLog.subject}]\n\n${renderedForLog.text}`,
        metadata: { channel: "email", kind: "email_only_nudge", step: nextN, subject: renderedForLog.subject },
      });
      sent++;
    } catch (e) {
      console.error("[email-only-nudge] send failed:", e instanceof Error ? e.message : e);
      errors++;
    }
  }
  return { sent, errors, skipped };
}
