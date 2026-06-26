/**
 * WhatsApp bridge — sends one-off messages (welcome, notifications) by
 * POST-ing to the internal endpoint that lives on the agents VPS
 * (webhook_server.py). The agents VPS is the only host that can talk to
 * Evolution API, so this keeps the bridge out of Vercel's attack surface.
 *
 * Env:
 *   AGENTS_BASE_URL        e.g. https://agents.aprender-aleman.de
 *   AGENTS_INTERNAL_SECRET shared secret, must match AGENTS_INTERNAL_SECRET
 *                          on the Python side.
 *
 * Behaves gracefully if the env is missing: returns ok=false with a
 * clear reason so callers can log the intent and move on.
 */

export type WhatsappResult =
  | { ok: true;  messageId: string | null }
  | { ok: false; reason: string };

/**
 * Lista de bloqueo de números que NUNCA deben recibir mensajes
 * automáticos (alertas admin, drip de followups, recordatorios, etc).
 *
 * Caso Gelfis 2026-05-27: su número personal +491607530948 se usó como
 * destino de alertas y para testing; pidió que dejara de recibir
 * mensajes automáticos. Cualquier número en esta lista se silencia al
 * nivel más bajo del sender, así que ningún flujo lo alcanza.
 *
 * Se puede ampliar vía env WHATSAPP_BLOCKLIST (lista separada por comas).
 * Los números se comparan por sus dígitos (ignorando +, espacios, etc).
 */
const HARDCODED_BLOCKLIST = [
  "+491607530948",
];
function blocklistDigits(): Set<string> {
  const fromEnv = (process.env.WHATSAPP_BLOCKLIST ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const all = [...HARDCODED_BLOCKLIST, ...fromEnv];
  return new Set(all.map(n => n.replace(/\D/g, "")));
}
export function isWhatsappBlocked(phoneE164: string): boolean {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  if (!digits) return false;
  return blocklistDigits().has(digits);
}

/**
 * Kill switch global de WhatsApp. Lee `system_config.whatsapp_disabled`:
 *  - "true" / true / "1" → modo "full": bloquea TODO envío sin
 *    excepción (uso tras bans repetidos a v3 — Gelfis 2026-06-25).
 *  - "partial"            → bloquea TODO excepto los 5 kinds de
 *    `ALLOWED_WA_KINDS` (modo "WA mínimo" pre-Cloud API).
 *  - cualquier otra cosa  → modo "off" (sistema normal).
 *
 * Cachea 30s en memoria — los crons no llaman tantas veces.
 */
export type WhatsappDisableMode = "off" | "partial" | "full";
let _waDisabledCache: { v: WhatsappDisableMode; ts: number } | null = null;
const WA_DISABLED_TTL_MS = 30_000;

export async function getWhatsappDisableMode(): Promise<WhatsappDisableMode> {
  const now = Date.now();
  if (_waDisabledCache && now - _waDisabledCache.ts < WA_DISABLED_TTL_MS) {
    return _waDisabledCache.v;
  }
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("system_config")
      .select("value")
      .eq("key", "whatsapp_disabled")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    let mode: WhatsappDisableMode = "off";
    if (raw === "partial") mode = "partial";
    else if (raw === true || raw === "true" || raw === "1") mode = "full";
    _waDisabledCache = { v: mode, ts: now };
    return mode;
  } catch {
    return "off";
  }
}

/**
 * Tipos de mensaje permitidos cuando el kill switch global está on.
 * Cualquier kind que no esté aquí es silenciado mientras el sistema
 * funciona en modo "WhatsApp mínimo" (post-ban v3 — Gelfis 2026-06-25).
 *
 * Los 5 únicos puntos donde el lead recibe WA en este modo:
 *  - trial_confirmation       → al agendar trial
 *  - trial_reminder_2h        → 2h antes de la clase
 *  - trial_attended_initial   → profesor marca asistió
 *  - trial_inscription_initial→ profesor envía enlace inscripción
 *  - trial_absent_initial     → profesor marca no asistió
 *
 * Drips (24h, morning, 15m, post-trial-followup, absent-followup,
 * summer-promo, comunicados, alertas admin, etc.) quedan silenciados.
 */
const ALLOWED_WA_KINDS = new Set([
  "trial_confirmation",
  "trial_reminder_2h",
  "trial_attended_initial",
  "trial_inscription_initial",
  "trial_absent_initial",
  "admin_manual",  // bypass para Gelfis desde endpoints admin
]);

/**
 * Rate limit cliente: no permite dos envíos en menos de 15s para evitar
 * que ráfagas (varios crons disparando a la vez) parezcan bot a WA.
 * Estado en memoria — al ser un único Vercel worker por request,
 * actúa como per-request guard, no como lock global. Para spike
 * sostenido, el agente Python en el VPS aplica su propio rate-limit.
 */
const MIN_GAP_MS = 15_000;
let _lastWaSentAt = 0;

export type SendWaOpts = {
  /** Etiqueta de propósito. Si el kill switch está on y este kind NO
   *  está en `ALLOWED_WA_KINDS`, el envío se silencia. */
  kind?: string;
  /** Bypass total del kill switch (uso interno admin). */
  bypassKillSwitch?: boolean;
};

/**
 * Send a plain-text WhatsApp message to a phone number in E.164 format.
 * Caller is responsible for ensuring the number is valid & opted-in.
 */
export async function sendWhatsappText(
  phoneE164: string | null | undefined,
  text: string,
  opts: SendWaOpts = {},
): Promise<WhatsappResult> {
  // Guarda: lead sin WhatsApp (form en 2 pasos, fase 2 saltada).
  if (!phoneE164 || phoneE164.trim().length === 0) {
    return { ok: false, reason: "no_whatsapp_on_lead" };
  }
  // Bloqueo duro — números que pidieron no recibir mensajes automáticos.
  if (isWhatsappBlocked(phoneE164)) {
    console.warn("[whatsapp] número en blocklist, mensaje suprimido:", phoneE164);
    return { ok: false, reason: "blocklisted" };
  }
  // Kill switch global con dos modos:
  //  - "true" / true / "1"  → bloquea TODO (ni siquiera los 5 kinds de
  //    la whitelist; usado tras bans repetidos a v3).
  //  - "partial"            → bloquea TODO excepto kinds en
  //    ALLOWED_WA_KINDS (modo WA mínimo).
  // El bypass se usa solo desde endpoints admin (Gelfis manualmente).
  const killMode = await getWhatsappDisableMode();
  if (killMode !== "off") {
    if (!opts.bypassKillSwitch) {
      const kind = opts.kind ?? "";
      const passesWhitelist = killMode === "partial" && ALLOWED_WA_KINDS.has(kind);
      if (!passesWhitelist) {
        return { ok: false, reason: "whatsapp_globally_disabled" };
      }
    }
  }
  // Rate limit cliente — separa envíos al menos 15s.
  const now = Date.now();
  const elapsed = now - _lastWaSentAt;
  if (elapsed < MIN_GAP_MS && _lastWaSentAt > 0) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  _lastWaSentAt = Date.now();

  const baseUrl = process.env.AGENTS_BASE_URL?.replace(/\/$/, "");
  const secret  = process.env.AGENTS_INTERNAL_SECRET;
  if (!baseUrl || !secret) {
    console.warn(
      "[whatsapp] AGENTS_BASE_URL / AGENTS_INTERNAL_SECRET missing — " +
      "message not sent. Would have sent to %s: %s",
      phoneE164,
      text.slice(0, 120),
    );
    return { ok: false, reason: "missing_agent_env" };
  }

  try {
    const res = await fetch(`${baseUrl}/internal/send-text`, {
      method: "POST",
      headers: {
        "Content-Type":        "application/json",
        "X-Internal-Secret":   secret,
      },
      body: JSON.stringify({ phone: phoneE164, text }),
      // 60s ceiling — long enough that a slow Evolution API call
      // doesn't cause a false-negative `send_failed` timeline log
      // when the message actually delivered. The caller's response
      // path no longer waits on this (book-trial uses `after()`),
      // so there's no UX pressure to fail fast.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `http_${res.status}:${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: data.messageId ?? null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Envía un documento (PDF) por WhatsApp via Evolution API.
 *
 * @param phoneE164    Destinatario en E.164.
 * @param mediaUrl     URL pública o firmada del PDF (Evolution descarga).
 * @param fileName     Nombre que verá el receptor.
 * @param caption      Texto que acompaña al documento (opcional).
 * @param kind         Etiqueta para logging/retry.
 * @param leadId       Para tracking en timeline.
 */
export async function sendWhatsappDocument(
  phoneE164: string | null | undefined,
  mediaUrl: string,
  fileName: string,
  opts: { caption?: string; kind?: string; leadId?: string } = {},
): Promise<WhatsappResult> {
  // Guarda: lead sin WhatsApp.
  if (!phoneE164 || phoneE164.trim().length === 0) {
    return { ok: false, reason: "no_whatsapp_on_lead" };
  }
  // Bloqueo duro — mismos números que sendWhatsappText.
  if (isWhatsappBlocked(phoneE164)) {
    console.warn("[whatsapp] número en blocklist, documento suprimido:", phoneE164);
    return { ok: false, reason: "blocklisted" };
  }
  // Kill switch global (cualquier modo que no sea "off" → bloquea
  // documentos sin excepción — no hay use-case crítico de documentos
  // en los 5 kinds permitidos).
  const docKillMode = await getWhatsappDisableMode();
  if (docKillMode !== "off") {
    return { ok: false, reason: "whatsapp_globally_disabled" };
  }

  const baseUrl = process.env.AGENTS_BASE_URL?.replace(/\/$/, "");
  const secret  = process.env.AGENTS_INTERNAL_SECRET;
  if (!baseUrl || !secret) {
    console.warn(
      "[whatsapp] agent env missing — document NOT sent. Would have sent to %s: %s",
      phoneE164, mediaUrl.slice(0, 80),
    );
    return { ok: false, reason: "missing_agent_env" };
  }

  try {
    const res = await fetch(`${baseUrl}/internal/send-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
      body: JSON.stringify({
        phone:     phoneE164,
        media_url: mediaUrl,
        file_name: fileName,
        caption:   opts.caption ?? "",
        kind:      opts.kind ?? "document",
        lead_id:   opts.leadId ?? null,
      }),
      signal: AbortSignal.timeout(120_000),  // 2 min — descarga + envío
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `http_${res.status}:${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: data.messageId ?? null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}
