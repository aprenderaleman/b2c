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
  // Sesión de Plan-Alemán con closer (funnel /sesion-plan, 2026-08-13)
  "sesion_confirmation",
  "sesion_reminder_24h",
  "sesion_reminder_morning",
  "sesion_reminder_15m",
  // ACK al lead cuando responde CONFIRMO a la sesión de plan (Gelfis 2026-08-14)
  "sesion_confirm_ack",
  // Reagendar sesión de plan (link a /sesion-plan/funnel)
  "sesion_reschedule_link",
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
  // Cadena welcome_week (Gelfis 2026-08-14): activación primera semana
  "welcome_week_t0",           // T+0 síncrono desde lead-conversion
  "welcome_week",              // steps 2-4 del motor (Hans/SCHULE/checkin)
  "welcome_week_celebration",  // variantes celebración Hans/SCHULE
  "welcome_week_checkin_ack",  // ACK respuesta "1" al check-in
  // Testimonios en audio (Gelfis 2026-08-14): social proof
  "testimonial_chain2",        // preludio texto + audio en chain2 step 3
  // Celebración al referidor: su amigo se inscribió, +3 clases (2026-08-14)
  "referral_reward",
  // Absent-interest: mandamos pregunta, si dice SÍ → link, si NO → cierre
  "trial_absent_interest_yes",
  "trial_absent_interest_close",
  // Hitos de clases restantes 10/5/0 de Stiv (cron pack-alerts, 2026-09-21)
  "pack_milestone",
  "admin_manual",  // bypass para Gelfis desde endpoints admin
  // Notificación al profesor cuando su lead convierte (post-conversion-flow)
  "teacher_conversion_notify",
  // Envíos del setter tras hablar con el lead (Gelfis 2026-10-26):
  // humano-iniciados — el lead acaba de contestar su llamada, así que
  // son transaccionales y exentos del gate nocturno (la setter trabaja
  // tarde Latam = noche Berlín).
  "setter_class_link",   // enlace de acceso al aula + instrucciones
  "setter_confirm_ack",  // gracias por confirmar + enlace + Wir sehen uns
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
  // Gate 21:00-09:00 Berlin (Gelfis 2026-10-13 tras 2do ban v5).
  // Antes: 22-08. Ampliado 1h en cada extremo para:
  //  - Terminar actividad 1h antes de la hora típica de caída de
  //    sesión Baileys (~22:00-23:00 observado en v4 y v5)
  //  - Arrancar 1h después, dando tiempo a que la instancia esté
  //    plenamente estable tras la noche
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", hour: "numeric", hour12: false,
  }).format(new Date());
  const h = parseInt(hourStr, 10);
  return h >= 21 || h < 9;
}

/**
 * Anti-ban #2: cap diario de mensajes salientes. Superado el cap, solo
 * pasan los kinds transaccionales de `ALLOWED_WA_KINDS`. Cuenta desde
 * medianoche Europe/Berlin. Config: `system_config.wa_daily_send_cap`.
 * Durante warm-up post-ban, el cap efectivo es min(cap, warmup_cap_del_dia).
 */
/**
 * Anti-ban #3 (Gelfis 2026-10-13 tras 2do ban v5): cap por hora para
 * distribuir carga. Antes el único límite era diario (300/día) y en el
 * ban del 12-10 observamos pico de 28 msgs en 4h tarde-noche justo antes
 * de la caída. Un cap horario fuerza distribución natural y reduce la
 * densidad justo antes del gate nocturno.
 *
 * Default: 25 msgs/hora. Configurable via system_config.wa_hourly_send_cap.
 * Durante warm-up el cap efectivo es min(hora_normal, día_warmup / 10).
 */
let _hourlyCapCache: { limit: number; sent: number; ts: number } | null = null;
async function getHourlySendState(): Promise<{ limit: number; sent: number }> {
  const now = Date.now();
  if (_hourlyCapCache && now - _hourlyCapCache.ts < 30_000) {
    return { limit: _hourlyCapCache.limit, sent: _hourlyCapCache.sent };
  }
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data: rows } = await sb
      .from("system_config").select("key,value")
      .in("key", ["wa_hourly_send_cap", "wa_warmup_day"]);
    const cfg = new Map((rows ?? []).map(r => [r.key as string, r.value as string]));
    const baseHourly = parseInt(cfg.get("wa_hourly_send_cap") ?? "25", 10) || 25;
    const warmupDay = parseInt(cfg.get("wa_warmup_day") ?? "", 10);
    // Durante warm-up: diario / ~10 horas de ventana = cap/hora derivado.
    let effectiveHourly = baseHourly;
    if (Number.isFinite(warmupDay) && warmupDay >= 1 && warmupDay <= 7) {
      const scaleHourly: Record<number, number> = { 1: 6, 2: 10, 3: 15, 4: 20, 5: 25, 6: 25, 7: 25 };
      effectiveHourly = Math.min(effectiveHourly, scaleHourly[warmupDay]);
    }
    // Contar envíos última hora (sliding window).
    const oneHourAgo = new Date(now - 3600_000).toISOString();
    const { count } = await sb
      .from("lead_timeline")
      .select("id", { count: "exact", head: true })
      .eq("type", "system_message_sent")
      .filter("metadata->>channel", "eq", "whatsapp")
      .gte("timestamp", oneHourAgo);
    const sent = count ?? 0;
    _hourlyCapCache = { limit: effectiveHourly, sent, ts: now };
    return { limit: effectiveHourly, sent };
  } catch {
    return { limit: 25, sent: 0 };
  }
}

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
    // Warm-up post-ban (Gelfis 2026-09-29 tras caída v4): rampa gradual
    // en vez de saltos. Cada día suma 50 respecto al anterior, plateau
    // día 5-7 en 250 y día 8+ vuelve al cap normal (300 por default).
    let effectiveCap = baseCap;
    if (Number.isFinite(warmupDay) && warmupDay >= 1 && warmupDay <= 7) {
      const scale: Record<number, number> = { 1: 50, 2: 100, 3: 150, 4: 200, 5: 250, 6: 250, 7: 250 };
      effectiveCap = Math.min(effectiveCap, scale[warmupDay]);
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

/**
 * Pre-check de número en WhatsApp (Gelfis 2026-10-13).
 *
 * Llama a Evolution `/chat/whatsappNumbers/{instance}` que verifica si
 * un número está registrado en WA sin consumir un "message attempt" en
 * el log de WhatsApp. Devuelve:
 *   - true  → número está en WhatsApp, enviar normal
 *   - false → número NO está en WhatsApp, no gastar un envío
 *   - null  → no se pudo chequear (timeout, Evolution down), enviar
 *             normal como fallback (el error llegará por otro camino)
 *
 * Cache 24h en memoria del worker Vercel. Un número que confirma válido
 * raramente deja de estarlo; si cambia, al próximo deploy el cache se
 * resetea igual.
 */
const _waNumberCache = new Map<string, { valid: boolean; ts: number }>();
const WA_PRECHECK_CACHE_MS = 24 * 3600_000;

async function checkWhatsappNumberExists(
  evoUrl: string,
  evoKey: string,
  instance: string,
  digits: string,
): Promise<boolean | null> {
  const cached = _waNumberCache.get(digits);
  if (cached && Date.now() - cached.ts < WA_PRECHECK_CACHE_MS) {
    return cached.valid;
  }
  try {
    const res = await fetch(`${evoUrl}/chat/whatsappNumbers/${instance}`, {
      method:  "POST",
      headers: { apikey: evoKey, "Content-Type": "application/json" },
      body:    JSON.stringify({ numbers: [digits] }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[whatsapp precheck] http_${res.status} for ${digits}`);
      return null;
    }
    const data = (await res.json().catch(() => [])) as Array<{
      exists?: boolean; jid?: string; number?: string;
    }>;
    const row = Array.isArray(data) ? data.find(r => r.number === digits) ?? data[0] : null;
    if (!row || typeof row.exists !== "boolean") return null;
    _waNumberCache.set(digits, { valid: row.exists, ts: Date.now() });
    return row.exists;
  } catch (e) {
    console.warn(`[whatsapp precheck] threw for ${digits}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export type SendWaOpts = {
  /** Etiqueta de propósito. Si el kill switch está on y este kind NO
   *  está en `ALLOWED_WA_KINDS`, el envío se silencia. */
  kind?: string;
  /** Bypass total del kill switch (uso interno admin). */
  bypassKillSwitch?: boolean;
  /** Bypass del gate nocturno 22-08 Berlin. chain-engine lo pasa true
   *  para cadenas transaccionales (bypassPause en def o
   *  bypass_gate_on_start en metadata) — el mensaje ya fue autorizado
   *  por chain-engine, sería doble-gate absurdo bloquearlo aquí también.
   *  Bug Myriam 2026-09-30: chain4_absent bypassPause salta gate del
   *  chain-engine pero era bloqueado por este gate independiente. */
  bypassNightGate?: boolean;
  /** Firma de contenido para la Capa-1 anti-duplicados (Gelfis 2026-10-23).
   *  Para text se calcula automáticamente del body. Para audio el caller
   *  debe pasarlo (ej. "audio:testimonial:marcela:step3"). Si se omite en
   *  audio, no se dedupea. Si se pasa aquí explícito en text, sobreescribe
   *  el cálculo automático. */
  dedupKey?: string;
  /** Bypass total del dedupe (uso solo para tests o notificaciones críticas
   *  intencionalmente repetidas). */
  bypassDedup?: boolean;
  /** Canal de envío (Gelfis 2026-10-26, warm-up post-ban v5). "setter"
   *  enruta por la instancia de `system_config.wa_setter_instance` (el
   *  número nuevo que calienta la setter) y queda EXENTO del kill switch
   *  global — es otro canal, no toca el número principal. Si la key no
   *  está configurada, se comporta como un envío normal (inerte). */
  channel?: "setter";
};

// ── Canal del setter: instancia propia para el warm-up del número nuevo ──

/** Contador diario del canal setter. Una sola fila en system_config
 *  (`wa_setter_sent_today`, valor "YYYY-MM-DD:N" en día Berlín) — al
 *  cambiar el día se resetea sola. Read-modify-write sin lock: para un
 *  cap protector con volumen humano (decenas/día) es suficiente. */
const SETTER_SENT_KEY = "wa_setter_sent_today";

function berlinDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function getSetterDailyState(): Promise<{ sent: number; limit: number }> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data: rows } = await sb
      .from("system_config").select("key,value")
      .in("key", ["wa_setter_daily_cap", SETTER_SENT_KEY]);
    const cfg = new Map((rows ?? []).map(r => [r.key as string, String(r.value ?? "")]));
    const limit = parseInt(cfg.get("wa_setter_daily_cap") ?? "30", 10) || 30;
    const raw = cfg.get(SETTER_SENT_KEY) ?? "";
    const [day, n] = raw.split(":");
    const sent = day === berlinDayKey() ? (parseInt(n ?? "0", 10) || 0) : 0;
    return { sent, limit };
  } catch {
    return { sent: 0, limit: 30 };
  }
}

async function bumpSetterDailyCount(): Promise<void> {
  try {
    const { sent } = await getSetterDailyState();
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    await sb.from("system_config").upsert({
      key: SETTER_SENT_KEY,
      value: `${berlinDayKey()}:${sent + 1}`,
    });
  } catch {
    // contador best-effort — nunca bloquea el envío ya hecho
  }
}

let _setterInstanceCache: { value: string | null; ts: number } | null = null;
async function getSetterInstance(): Promise<string | null> {
  const now = Date.now();
  if (_setterInstanceCache && now - _setterInstanceCache.ts < 60_000) {
    return _setterInstanceCache.value;
  }
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("system_config")
      .select("value")
      .eq("key", "wa_setter_instance")
      .maybeSingle();
    const raw = ((data as { value?: string } | null)?.value ?? "").trim();
    const value = raw.length > 0 ? raw : null;
    _setterInstanceCache = { value, ts: now };
    return value;
  } catch {
    return _setterInstanceCache?.value ?? null;
  }
}

/**
 * Capa-1 anti-duplicados (Gelfis 2026-10-23). Bloquea envíos cuyo
 * (phone + firma de contenido) ya salió en las últimas 24h. Guard
 * universal independiente de la lógica de chain-engine — aunque un
 * bug nuevo haga retry duplicado, este helper lo frena.
 *
 * Reutilizamos `lead_timeline` como fuente de verdad (no tabla nueva).
 * Para TEXT: comparamos los primeros 80 chars del content exacto —
 * chain-engine escribe el body renderizado en timeline, así que si el
 * mismo contenido ya salió, lo detectamos. Para AUDIO el caller DEBE
 * pasar `dedupKey` (ej. "testimonial:marcela:chain2:step3") — el guard
 * lo busca contra metadata.wa_dedup_key de timeline (que el caller
 * registra junto al envío).
 *
 * Devuelve el motivo si YA se mandó algo con esa firma, null si libre.
 */
async function _recentDuplicateReason(
  phoneE164: string,
  textOrNull: string | null,
  dedupKey: string | null,
): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin();
    const { data: leadRow } = await sb
      .from("leads")
      .select("id")
      .eq("whatsapp_normalized", phoneE164)
      .limit(1)
      .maybeSingle();
    if (!leadRow?.id) return null;
    const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    // Audio / explicit dedupKey → busca por metadata.wa_dedup_key
    if (dedupKey) {
      const { data: hitKey } = await sb
        .from("lead_timeline")
        .select("id")
        .eq("lead_id", (leadRow as { id: string }).id)
        .eq("type", "system_message_sent")
        .gte("timestamp", sinceIso)
        .filter("metadata->>wa_dedup_key", "eq", dedupKey)
        .limit(1)
        .maybeSingle();
      if (hitKey) return `dedup_key:${dedupKey}`;
    }
    // Text → busca por prefijo exacto 80c
    if (textOrNull && textOrNull.trim().length > 0) {
      const prefix = textOrNull.replace(/\s+/g, " ").trim().slice(0, 80);
      // Escape % y _ para ILIKE y añadimos % final
      const esc = prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const { data: hitTxt } = await sb
        .from("lead_timeline")
        .select("id,content")
        .eq("lead_id", (leadRow as { id: string }).id)
        .eq("type", "system_message_sent")
        .gte("timestamp", sinceIso)
        .ilike("content", `${esc}%`)
        .limit(1)
        .maybeSingle();
      if (hitTxt) return `text_prefix:${prefix.slice(0, 40)}...`;
    }
    return null;
  } catch (e) {
    console.warn("[whatsapp dedup] guard error:", e instanceof Error ? e.message : e);
    return null;
  }
}

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
  // Canal del setter (warm-up del número nuevo): si el envío viene del
  // setter Y wa_setter_instance está configurada, sale por ESA instancia
  // y no le aplica el kill switch global (que protege el canal
  // principal). Blocklist, dedup y separación mínima siguen aplicando.
  const setterInstance = opts.channel === "setter" ? await getSetterInstance() : null;

  // Cap diario PROPIO del número en warm-up (Gelfis 2026-10-26). Los
  // kinds del setter están en ALLOWED_WA_KINDS y por eso se saltan los
  // caps globales — este tope es su red de seguridad: superado, el WA
  // se silencia (el email del helper sigue saliendo) hasta medianoche
  // Berlín. Config: system_config.wa_setter_daily_cap (default 30).
  if (setterInstance && !opts.bypassKillSwitch) {
    const { sent, limit } = await getSetterDailyState();
    if (sent >= limit) {
      console.warn(`[whatsapp setter] cap diario ${limit} alcanzado (${sent}) — WA silenciado hasta mañana`);
      return { ok: false, reason: "setter_daily_cap" };
    }
  }

  // Kill switch global con dos modos:
  //  - "true" / true / "1"  → bloquea TODO (ni siquiera los 5 kinds de
  //    la whitelist; usado tras bans repetidos a v3).
  //  - "partial"            → bloquea TODO excepto kinds en
  //    ALLOWED_WA_KINDS (modo WA mínimo).
  // El bypass se usa solo desde endpoints admin (Gelfis manualmente).
  const killMode = await getWhatsappDisableMode();
  if (killMode !== "off" && !setterInstance) {
    if (!opts.bypassKillSwitch) {
      const kind = opts.kind ?? "";
      const passesWhitelist = killMode === "partial" && ALLOWED_WA_KINDS.has(kind);
      if (!passesWhitelist) {
        return { ok: false, reason: "whatsapp_globally_disabled" };
      }
    }
  }
  // Anti-ban gate nocturno: 22:00-08:00 Berlin, salvo T-30m / T-15m
  // o si el caller pasó bypassNightGate=true (chain-engine para
  // cadenas transaccionales con bypassPause / bypass_gate_on_start).
  if (!opts.bypassKillSwitch && !opts.bypassNightGate && isBerlinNight()) {
    const gateOn = await isNightGateEnabled();
    if (gateOn && !NIGHT_EXEMPT_KINDS.has(opts.kind ?? "")) {
      return { ok: false, reason: "night_gate" };
    }
  }
  // Anti-ban cap POR HORA (Gelfis 2026-10-13): distribuye carga, evita
  // picos de 20+ msgs/hora que anteceden la caída nocturna de sesión.
  // Default 25/hora. Transaccionales de ALLOWED_WA_KINDS pasan igual.
  if (!opts.bypassKillSwitch) {
    const { limit: hourlyLimit, sent: hourlySent } = await getHourlySendState();
    if (hourlySent >= hourlyLimit && !ALLOWED_WA_KINDS.has(opts.kind ?? "")) {
      console.warn(`[whatsapp] hourly cap ${hourlyLimit} alcanzado (${hourlySent}), silenciando kind=${opts.kind}`);
      return { ok: false, reason: "hourly_cap_reached" };
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
  // Capa-1 anti-duplicados (Gelfis 2026-10-23). Antes de nada chequea si
  // el mismo texto ya salió al mismo número en las últimas 24h — frena
  // retries bugueados sin importar su origen. Bypass con bypassDedup.
  if (!opts.bypassDedup) {
    const dupReason = await _recentDuplicateReason(phoneE164, text, opts.dedupKey ?? null);
    if (dupReason) {
      console.warn(`[whatsapp dedup] blocked duplicate text to ${phoneE164} (${dupReason})`);
      return { ok: false, reason: `recent_duplicate:${dupReason}` };
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
  // Resolver instancia: canal setter → wa_setter_instance; si no, la
  // activa (misma fuente que agent_3_sender en Python).
  let instance: string;
  if (setterInstance) {
    instance = setterInstance;
  } else try {
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

  // Pre-check de número en WhatsApp (Gelfis 2026-10-13 tras 2do ban v5):
  // llamada previa a /chat/whatsappNumbers para no gastar un intento
  // de envío si el número no está registrado en WA. Cada exists:false
  // real suma al "fallback scoring" del algoritmo de WhatsApp — con
  // pre-check 0 llegadas negativas por este motivo.
  // Cache 24h en memoria (del worker) + skip si opts.bypassKillSwitch.
  if (!opts.bypassKillSwitch) {
    const inWa = await checkWhatsappNumberExists(evoUrl, evoKey, instance, digits);
    if (inWa === false) {
      // Sintetizamos el mismo payload que devolvería Evolution para que
      // el helper handleWaPermanentFail del caller (si existe) detecte
      // el patrón exists:false y desactive el número del lead.
      return {
        ok: false,
        reason: `http_400:{"status":400,"error":"Bad Request","response":{"message":[{"exists":false,"jid":"${digits}@s.whatsapp.net","number":"${digits}","source":"precheck"}]}}`,
      };
    }
    // inWa === true  → seguir enviando normal
    // inWa === null  → no se pudo chequear (timeout, error), seguir normal
  }

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
    if (setterInstance) await bumpSetterDailyCount();
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

/**
 * Envía un audio por WhatsApp (nota de voz o audio file) via Evolution API.
 * Espejo de sendWhatsappText: aplica blocklist, kill switch, gate nocturno,
 * cap diario y rate limit.
 *
 * @param phoneE164     Destinatario en E.164.
 * @param audioSource   URL pública HTTP(S) del MP3/OGG (Evolution descarga)
 *                      O Buffer con el contenido crudo (se envía base64,
 *                      evita problemas de firma R2 → 403 en Evolution).
 * @param opts.kind     Etiqueta whitelist (ej: 'testimonial_chain2').
 *
 * Nota: WhatsApp NO soporta caption en audio-mensajes (limitación del
 * protocolo). Si necesitas texto de contexto, envía primero un
 * sendWhatsappText y luego este audio.
 */
export async function sendWhatsappAudio(
  phoneE164: string | null | undefined,
  audioSource: string | Buffer,
  opts: SendWaOpts = {},
): Promise<WhatsappResult> {
  if (!phoneE164 || phoneE164.trim().length === 0) {
    return { ok: false, reason: "no_whatsapp_on_lead" };
  }
  if (isWhatsappBlocked(phoneE164)) {
    console.warn("[whatsapp] número en blocklist, audio suprimido:", phoneE164);
    return { ok: false, reason: "blocklisted" };
  }
  const killMode = await getWhatsappDisableMode();
  if (killMode !== "off" && !opts.bypassKillSwitch) {
    const kind = opts.kind ?? "";
    if (!(killMode === "partial" && ALLOWED_WA_KINDS.has(kind))) {
      return { ok: false, reason: "whatsapp_globally_disabled" };
    }
  }
  if (!opts.bypassKillSwitch && isBerlinNight()) {
    const gateOn = await isNightGateEnabled();
    if (gateOn && !NIGHT_EXEMPT_KINDS.has(opts.kind ?? "")) {
      return { ok: false, reason: "night_gate" };
    }
  }
  if (!opts.bypassKillSwitch) {
    const { limit, sent } = await getDailySendState();
    if (sent >= limit && !ALLOWED_WA_KINDS.has(opts.kind ?? "")) {
      return { ok: false, reason: "daily_cap_reached" };
    }
  }
  // Capa-1 anti-duplicados (audio): el caller DEBE pasar dedupKey para
  // que esto aplique. Sin dedupKey → sin dedup (compatibilidad). Casos
  // típicos: testimoniales (dedupKey = "testimonial:<id>:<chain>:<step>").
  if (!opts.bypassDedup && opts.dedupKey) {
    const dupReason = await _recentDuplicateReason(phoneE164, null, opts.dedupKey);
    if (dupReason) {
      console.warn(`[whatsapp dedup] blocked duplicate audio to ${phoneE164} (${dupReason})`);
      return { ok: false, reason: `recent_duplicate:${dupReason}` };
    }
  }
  // Rate limit — 15s tras último send de este proceso
  const now = Date.now();
  const elapsed = now - _lastWaSentAt;
  if (elapsed < MIN_GAP_MS && _lastWaSentAt > 0) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  _lastWaSentAt = Date.now();

  const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) return { ok: false, reason: "missing_evolution_env" };

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

  const digits = phoneE164.replace(/^\+/, "").replace(/\D/g, "");
  // Evolution v1.8 / v2 shape para audio como voice note. El campo
  // `audio` acepta URL HTTP(S) pública O base64 crudo. Preferimos
  // base64 para bypassar problemas de descarga desde el server Evolution
  // (URLs firmadas de R2 devuelven 403 por mismatch virtual-hosted vs
  // path-style — bug encontrado 2026-08-15 con testimonial Marcela).
  const audioField = Buffer.isBuffer(audioSource)
    ? audioSource.toString("base64")
    : audioSource;
  const payload = {
    number: digits,
    options: { delay: 1200, presence: "recording" },
    audioMessage: { audio: audioField },
  };

  try {
    const res = await fetch(`${evoUrl}/message/sendWhatsAppAudio/${instance}`, {
      method: "POST",
      headers: {
        "apikey":       evoKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),  // 2 min — descarga + envío
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
