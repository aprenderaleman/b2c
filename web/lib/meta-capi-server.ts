import { createHash } from "node:crypto";

/**
 * Meta CAPI helper — llamada SERVER-SIDE desde crons y webhooks
 * (donde no hay request del navegador, así que no hay _fbc cookie).
 *
 * Cuándo usarlo:
 *   - Purchase real del pack (auto-conversion.ts, tras Stripe pago).
 *   - Cualquier evento sin browser context (batch jobs, backfills).
 *
 * Para eventos que sí vienen del navegador (Schedule, Purchase del
 * depósito 10€), usar el endpoint /api/meta-capi que lee _fbc/_fbp
 * del Cookie header. Este helper NO los tiene — usa el fbclid
 * persistido en leads.fbclid como fallback para atribución.
 *
 * Dedup: eventID es determinista (stripePiId o similar) → si Meta
 * ya recibió Purchase con ese ID por el pixel del navegador, este
 * server-side se deduplica en ventana 48h.
 */

type MetaCapiPurchaseArgs = {
  /** ID único del evento (dedup con browser pixel). Usar el
   *  stripe payment_intent.id o similar para determinismo. */
  eventId:      string;
  /** Valor de la compra en unidades enteras de la moneda (ej. 297 = 297€). */
  value:        number;
  currency:     string;
  /** Email plaintext — se hashea SHA256 antes de enviar. */
  email?:       string | null;
  /** Teléfono E.164 o digits-only — se hashea SHA256 antes de enviar. */
  phone?:       string | null;
  /** fbclid persistido en leads (URL del click original). Se
   *  convierte a formato fbc="fb.1.<ts>.<fbclid>" que Meta espera. */
  fbclid?:      string | null;
  /** URL "fuente" del evento — típicamente la landing o la
   *  confirmación. No hay origen real desde un webhook, pero Meta
   *  lo requiere. */
  sourceUrl?:   string;
  /** Timestamp del evento (default: now). Meta acepta hasta 7 días
   *  atrás — útil para backfills. */
  eventTimeMs?: number;
};

function sha256(v: string): string {
  return createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
}

function fbclidToFbc(fbclid: string): string {
  // Meta espera fbc = "fb.<subdomainIndex>.<ts>.<fbclid>"
  // subdomainIndex=1 para "com" root, ts = ahora (segundos → ms).
  return `fb.1.${Date.now()}.${fbclid}`;
}

/**
 * Envía un Purchase server-side a Meta CAPI. No lanza — devuelve
 * { ok, error?, meta? } para que el caller decida si loguear al fallar
 * sin romper la conversión (Meta CAPI tiene downtimes ocasionales; la
 * venta real no debe abortarse por un fallo de tracking).
 */
export async function sendMetaPurchaseCapi(args: MetaCapiPurchaseArgs): Promise<{
  ok:     boolean;
  reason?: string;
  meta?:  unknown;
}> {
  const PIXEL_ID     = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN ?? "";
  const TEST_CODE    = process.env.META_TEST_EVENT_CODE || undefined;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn("[meta-capi-server] not_configured — skipping Purchase");
    return { ok: false, reason: "not_configured" };
  }

  const userData: Record<string, string> = {};
  if (args.email) userData.em = sha256(args.email);
  if (args.phone) {
    const digits = args.phone.replace(/\D/g, "");
    if (digits.length >= 8) userData.ph = sha256(digits);
  }
  if (args.fbclid) userData.fbc = fbclidToFbc(args.fbclid);

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:       "Purchase",
        event_time:       Math.floor((args.eventTimeMs ?? Date.now()) / 1000),
        event_id:         args.eventId,
        event_source_url: args.sourceUrl ?? `${process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de"}/confirmacion`,
        action_source:    "website",
        user_data:        userData,
        custom_data:      { value: args.value, currency: args.currency },
      },
    ],
  };
  if (TEST_CODE) (payload as Record<string, unknown>).test_event_code = TEST_CODE;

  console.log("[meta-capi-server] Purchase →", {
    event_id: args.eventId,
    value:    args.value,
    currency: args.currency,
    hasEmail: !!userData.em,
    hasPhone: !!userData.ph,
    hasFbc:   !!userData.fbc,
    testMode: !!TEST_CODE,
  });

  try {
    const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[meta-capi-server] Purchase FAILED:", res.status, body);
      return { ok: false, reason: `http_${res.status}`, meta: body };
    }
    console.log("[meta-capi-server] Purchase ← OK", body);
    return { ok: true, meta: body };
  } catch (err) {
    console.error("[meta-capi-server] fetch error:", err);
    return { ok: false, reason: "network_error", meta: err instanceof Error ? err.message : String(err) };
  }
}
