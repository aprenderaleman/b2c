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
  "trial_reminder_24h",
  "trial_reminder_15m",
  "trial_reminder_morning",
  // Sesión de Plan con closer (funnel /sesion-plan, 2026-08-13)
  "sesion_confirmation",
  "sesion_reminder_24h",
  "sesion_reminder_morning",
  "sesion_reminder_15m",
  // ACK al lead cuando responde CONFIRMO a la sesión de plan (Gelfis 2026-08-14)
  "sesion_confirm_ack",
  // Notificaciones al closer (funnel /sesion-plan)
  "sesion_closer_booked",   // al agendarse: nombre + meta + hora
  "sesion_closer_pre_15m",  // T-15m: espejo del recordatorio al lead
  // Eliminados 2026-08-01: trial_reminder_2h (fusionado en morning),
  // trial_reminder_30m (redundante con 15m).
  "trial_attended_initial",
  "trial_inscription_initial",
  "trial_absent_initial",
  "trial_cancelled",
  // ACKs a respuestas del lead al T+0 (CONFIRMO/CAMBIAR/CANCELAR)
  "trial_confirm_ack",
  "trial_reschedule_link",
  // Follow-up único del reagendamiento iniciado por el profesor
  // (fu1 +8h eliminado 2026-08-01 por redundancia con fu2 +24h)
  "trial_teacher_reschedule_fu2",  // +24h sin rebook (único)
  // Welcome student al convertir lead → student
  "welcome_student",
  // Celebración al referidor: su amigo se inscribió, +3 clases (2026-08-14)
  "referral_reward",
  // Absent-interest: mandamos pregunta, si dice SÍ → link, si NO → cierre
  "trial_absent_interest_yes",
  "trial_absent_interest_close",
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

/**
 * Anti-ban #1: gate nocturno. Ningún WA automático 22:00–08:00 Europe/Berlin,
 * salvo mensajes TRANSACCIONALES — el lead acaba de hacer una acción y
 * espera respuesta inmediata (agendar, reagendar, cancelar, confirmar
 * asistencia post-trial). Si estos se bloquean, el lead nunca recibe la
 * respuesta y el cron no reintenta.
 *
 * La lista transaccional es la MISMA que ALLOWED_WA_KINDS (whitelist del
 * kill switch): si un mensaje es transaccional-suficiente para pasar el
 * kill switch, también lo es para pasar el gate nocturno.
 *
 * Fix 2026-08-11 tras 18 mensajes perdidos en 7d (mayoría
 * trial_confirmation de leads que agendaron 22-08h Berlin).
 * Config editable: `system_config.wa_night_gate_enabled`.
 */
const NIGHT_EXEMPT_KINDS = ALLOWED_WA_KINDS;
let _nightGateCache: { enabled: boolean; ts: number } | null = null;
async function isNightGateEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_nightGateCache && now - _nightGateCache.ts < 60_000) return _nightGateCache.enabled;
  try {
    const { supabaseAdmin } = await import("./supabase");
    const { data } = await supabaseAdmin()
      .from("system_config").select("value").eq("key", "wa_night_gate_enabled").maybeSingle();
    const enabled = (data as { value?: string } | null)?.value !== "false";
    _nightGateCache = { enabled, ts: now };
    return enabled;
  } catch { return true; }
}
function isBerlinNight(): boolean {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hour: "numeric", hour12: false,
  }).format(new Date());
  const h = parseInt(hourStr, 10);
  return h >= 22 || h < 8;
}

/**
 * Anti-ban #2: cap diario de mensajes salientes. Superado el cap, solo
 * pasan los kinds transaccionales de `ALLOWED_WA_KINDS`. Cuenta desde
 * medianoche Europe/Berlin. Config: `system_config.wa_daily_send_cap`.
 * Durante warm-up post-ban, el cap efectivo es min(cap, warmup_cap_del_dia).
 */
let _dailyCapCache: { limit: number; sent: number; ts: number } | null = null;
async function getDailySendState(): Promise<{ limit: number; sent: number }> {
  const now = Date.now();
  if (_dailyCapCache && now - _dailyCapCache.ts < 60_000) {
    return { limit: _dailyCapCache.limit, sent: _dailyCapCache.sent };
  }
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data: rows } = await sb
      .from("system_config").select("key,value")
      .in("key", ["wa_daily_send_cap", "wa_warmup_day"]);
    const cfg = new Map((rows ?? []).map(r => [r.key as string, r.value as string]));
    const baseCap = parseInt(cfg.get("wa_daily_send_cap") ?? "300", 10) || 300;
    const warmupDay = parseInt(cfg.get("wa_warmup_day") ?? "", 10);
    // Warm-up post-ban: 30/día días 1-3, 100/día días 4-7, luego sin masivos.
    let effectiveCap = baseCap;
    if (Number.isFinite(warmupDay) && warmupDay >= 1 && warmupDay <= 14) {
      if (warmupDay <= 3) effectiveCap = Math.min(effectiveCap, 30);
      else if (warmupDay <= 7) effectiveCap = Math.min(effectiveCap, 100);
      // 8-14: sin masivos → cap efectivo = baseCap normal, pero comunicados
      // deberían pausarse manualmente.
    }
    // Contar sends WA de hoy (medianoche Berlin).
    const midnightBerlin = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }),
    );
    midnightBerlin.setHours(0, 0, 0, 0);
    const { count } = await sb
      .from("lead_timeline")
      .select("id", { count: "exact", head: true })
      .eq("type", "system_message_sent")
      .filter("metadata->>channel", "eq", "whatsapp")
      .gte("timestamp", midnightBerlin.toISOString());
    const sent = count ?? 0;
    _dailyCapCache = { limit: effectiveCap, sent, ts: now };
    return { limit: effectiveCap, sent };
  } catch {
    return { limit: 300, sent: 0 };
  }
}

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
  // Anti-ban gate nocturno: 22:00-08:00 Berlin, salvo T-30m / T-15m.
  if (!opts.bypassKillSwitch && isBerlinNight()) {
    const gateOn = await isNightGateEnabled();
    if (gateOn && !NIGHT_EXEMPT_KINDS.has(opts.kind ?? "")) {
      return { ok: false, reason: "night_gate" };
    }
  }
  // Anti-ban cap diario: superado, solo kinds transaccionales del whitelist.
  if (!opts.bypassKillSwitch) {
    const { limit, sent } = await getDailySendState();
    if (sent >= limit && !ALLOWED_WA_KINDS.has(opts.kind ?? "")) {
      console.warn(`[whatsapp] daily cap ${limit} alcanzado (${sent}), silenciando kind=${opts.kind}`);
      return { ok: false, reason: "daily_cap_reached" };
    }
  }
  // Rate limit cliente — separa envíos al menos 15s.
  const now = Date.now();
  const elapsed = now - _lastWaSentAt;
  if (elapsed < MIN_GAP_MS && _lastWaSentAt > 0) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  _lastWaSentAt = Date.now();

  // Ruta directa a Evolution: usamos EVOLUTION_API_URL + instancia de
  // BD (active_whatsapp_instance). Hasta 2026-07-02 pasábamos por el
  // VPS Python (AGENTS_BASE_URL/internal/send-text) — el problema es
  // que el VPS lee la instancia de una env var y quedó desincronizado
  // tras rotar v2 → v3 → v4 por SQL, así que TODOS los envíos caían
  // a v2 (cerrada). El VPS Python se mantiene solo para recibir
  // webhooks entrantes (agent_4_conversation). Envíos directos.
  const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    console.warn(
      "[whatsapp] EVOLUTION_API_URL / EVOLUTION_API_KEY missing — " +
      "message not sent. Would have sent to %s: %s",
      phoneE164,
      text.slice(0, 120),
    );
    return { ok: false, reason: "missing_evolution_env" };
  }
  // Resolver instancia activa (misma fuente que agent_3_sender en Python).
  let instance: string;
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("system_config")
      .select("value")
      .eq("key", "active_whatsapp_instance")
      .maybeSingle();
    instance = ((data as { value?: string } | null)?.value)
      ?? process.env.EVOLUTION_INSTANCE_MAIN
      ?? "aprender-aleman-main";
  } catch {
    instance = process.env.EVOLUTION_INSTANCE_MAIN ?? "aprender-aleman-main";
  }

  // Formato Evolution v1.8: number (dígitos), options, textMessage.text
  const digits = phoneE164.replace(/^\+/, "").replace(/\D/g, "");
  const payload = {
    number: digits,
    options: { delay: 1200, presence: "composing", linkPreview: false },
    textMessage: { text },
  };

  try {
    const res = await fetch(`${evoUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        "apikey":       evoKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
      // 60s ceiling — Evolution rara vez tarda más pero mantiene margen.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `http_${res.status}:${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as {
      key?: { id?: string };
      messageId?: string;
    };
    const messageId = data.key?.id ?? data.messageId ?? null;
    return { ok: true, messageId };
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
