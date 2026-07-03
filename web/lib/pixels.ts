/**
 * Wrappers no-op de los pixels publicitarios.
 *
 * Política de conversiones (Gelfis 2026-06-16) — UNA SOLA conversión a
 * Google Ads por funnel, disparada al llegar a /confirmacion:
 *
 *   - Google Ads conversion → SOLO en /confirmacion vía
 *     firePixelScheduleGoogle() con transaction_id=classId. Dedup
 *     garantizada por classId — si el lead refresca o vuelve, no
 *     doble-cuenta. Smart Bidding aprende del evento más fuerte
 *     (reserva confirmada de trial).
 *
 *   - Meta y TikTok mantienen DOS eventos por embudo (Lead +
 *     Schedule) porque sus modelos de atribución se benefician de
 *     ver ambos pasos. firePixelLead emite Lead a Meta + TikTok
 *     (sin Google Ads). firePixelSchedule emite Schedule a Meta +
 *     TikTok.
 *
 * Antes (pre-2026-06-16) firePixelLead disparaba Google Ads en submit
 * Y firePixelScheduleGoogle volvía a disparar en /confirmacion con el
 * mismo label → doble-conteo (cada lead contaba 2×) → Google Ads veía
 * un CPA artificialmente bajo y Smart Bidding sobre-pujaba. Fix limpio:
 * solo /confirmacion dispara Google Ads.
 *
 * Las llamadas son seguras de invocar siempre — si los pixels no están
 * configurados (env vacías), son no-ops gracias a los try/catch.
 * Los scripts globales se inyectan en `app/layout.tsx` vía PixelTags.
 */

type Window_ = Window & {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (event: string, params?: Record<string, unknown>) => void };
  gtag?: (...args: unknown[]) => void;
};

// Conversion de Google Ads — la primaria "trial reservado" se dispara
// desde /agendar/cuando ANTES del redirect a Stripe (Gelfis 2026-06-30).
// Con el depósito opcional se movió aquí porque:
//   - La clase queda agendada al confirmar datos (paguen o no).
//   - Si esperamos a /confirmacion, perdemos las conversiones de leads
//     que cierran el pago de Stripe sin volver a nuestro dominio.
//   - El transaction_id=classId sigue garantizando dedup.
//
// El gtag base (AW-17724667323) ya se carga en app/layout.tsx.
const GADS_CONVERSION_LABEL = "AW-17724667323/5fU7CKWqmLUcELvr44NC";

// [PLACEHOLDER_GOOGLE_TAG] — reemplazar por el label real de la
// conversión secundaria "depósito pagado" cuando esté creado en
// Google Ads UI. Debe tener el mismo formato "AW-<ACCOUNT>/<LABEL>".
const GADS_DEPOSIT_PAID_LABEL = process.env.NEXT_PUBLIC_GADS_DEPOSIT_LABEL
  ?? "AW-17724667323/PLACEHOLDER_DEPOSIT_LABEL";

/** Disparado cuando el lead completa el form (registro o trial booking).
 *
 *  IMPORTANTE: NO emite Google Ads — eso lo hace firePixelScheduleGoogle
 *  desde /confirmacion para evitar doble-conteo. Aquí solo Meta + TikTok.
 *
 *  El `value` señaliza calidad del lead para Meta/TikTok bidding:
 *    - hasWhatsapp=true  → 2 EUR (lead con WA, alta conversión)
 *    - hasWhatsapp=false → 1 EUR (lead email-only, baja conversión)
 */
export function firePixelLead(args: {
  leadId: string;
  email: string;
  budget: string | null;
  hasWhatsapp?: boolean;
}) {
  if (typeof window === "undefined") return;
  const w = window as Window_;
  const value = args.hasWhatsapp ? 2.0 : 1.0;
  // ── Meta ──
  try {
    w.fbq?.("track", "Lead", {
      content_name: "diagnostico_register",
      content_category: args.hasWhatsapp ? "with_whatsapp" : "email_only",
      value,
      currency: "EUR",
    });
  } catch (e) { console.warn("[pixel] fbq Lead failed:", e); }
  // ── TikTok ──
  try {
    w.ttq?.track("CompleteRegistration", {
      content_id: args.leadId,
      content_name: "diagnostico_register",
      value,
      currency: "EUR",
    });
  } catch (e) { console.warn("[pixel] ttq CompleteRegistration failed:", e); }
}

/** Disparado al agendar la clase de prueba.
 *
 *  Meta + TikTok aquí; Google Ads va en firePixelScheduleGoogle desde
 *  /confirmacion para deduplicación robusta por classId.
 */
export function firePixelSchedule(args: { leadId: string }) {
  if (typeof window === "undefined") return;
  const w = window as Window_;
  try {
    w.fbq?.("track", "Schedule", { content_id: args.leadId });
  } catch (e) { console.warn("[pixel] fbq Schedule failed:", e); }
  try {
    w.ttq?.track("Subscribe", { content_id: args.leadId });
  } catch (e) { console.warn("[pixel] ttq Subscribe failed:", e); }
}

/** ÚNICA conversion de Google Ads en todo el funnel. Se dispara desde
 *  <ConfirmacionPixel /> al cargar /confirmacion.
 *
 *  Por qué SOLO aquí:
 *    - /confirmacion solo se alcanza tras book-trial exitoso → señal
 *      fuerte para Smart Bidding (reserva confirmada).
 *    - transaction_id=classId garantiza dedup nativa de Google Ads —
 *      refresh, share del link, multi-tab, todo dedup.
 *    - Un solo evento por funnel = CPA real, no inflado.
 *
 *  value = 5 EUR refleja el valor esperado de un lead que llega a este
 *  punto (vs 2 EUR de un lead que solo registra). Ajusta cuando tengas
 *  datos de tu CLV real.
 */
export function firePixelScheduleGoogle(args: { classId: string }) {
  if (typeof window === "undefined") return;
  const w = window as Window_;
  try {
    w.gtag?.("event", "conversion", {
      send_to: GADS_CONVERSION_LABEL,
      value:    5,
      currency: "EUR",
      transaction_id: args.classId,
    });
  } catch (e) { console.warn("[pixel] gtag conversion failed:", e); }
}

/**
 * Conversión secundaria "depósito pagado" — se dispara en /confirmacion
 * cuando el lead vuelve de Stripe con `?deposito=ok`. Es un evento
 * distinto del "Schedule" primario porque señaliza a Smart Bidding
 * intención más fuerte (dinero puesto sobre la mesa).
 *
 * transaction_id=classId sigue garantizando dedup: si el lead abre
 * /confirmacion?deposito=ok varias veces (compartir link, refresh),
 * Google Ads solo cuenta una vez.
 *
 * value=10 EUR = importe del depósito. Ajustar cuando el LTV real esté
 * calculado.
 *
 * Espera opcional a un callback (event_callback) para que la promesa
 * resuelva cuando gtag confirma el envío; útil cuando quieres redirigir
 * inmediatamente después. Si gtag no está cargado, la promesa resuelve
 * al instante.
 */
export function firePixelDepositPaid(args: {
  classId: string;
  onSent?: () => void;
}): void {
  if (typeof window === "undefined") { args.onSent?.(); return; }
  const w = window as Window_;
  let called = false;
  const fire = () => { if (!called) { called = true; args.onSent?.(); } };
  try {
    w.gtag?.("event", "conversion", {
      send_to: GADS_DEPOSIT_PAID_LABEL,
      value:    10,
      currency: "EUR",
      transaction_id: args.classId,
      event_callback: fire,
    });
  } catch (e) { console.warn("[pixel] gtag deposit_paid failed:", e); }
  // Fallback: si gtag no llama al callback en 800ms (script bloqueado
  // o no cargado), disparamos igual para no bloquear el flow del lead.
  setTimeout(fire, 800);
}
