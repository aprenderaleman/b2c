/**
 * Wrappers no-op de los pixels publicitarios.
 *
 * Política de conversiones (Gelfis 2026-07-10) — UNA SOLA conversión a
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
 *     TikTok. Ambos se disparan en el submit de /agendar/cuando.
 *
 * Historia:
 *   - Pre-2026-06-30: Google Ads disparaba desde /confirmacion.
 *   - 2026-06-30 (Stripe depósito): se movió a submit /agendar/cuando
 *     para no perder conversiones si el lead no volvía de Stripe.
 *   - 2026-07-10 (Stripe eliminado): vuelve a /confirmacion — señal
 *     más limpia a Smart Bidding, solo cuenta si el lead llegó a la
 *     thank-you page.
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

// Conversion label de Google Ads — el gtag base (AW-17724667323) ya se
// carga en app/layout.tsx. Label + value seteados por Gelfis 2026-06-30.
const GADS_CONVERSION_LABEL = "AW-17724667323/YjyxCIjcqMocELvr44NC";
const GADS_CONVERSION_VALUE = 30.0;

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
 *      fuerte para Smart Bidding (reserva confirmada + lead visible).
 *    - transaction_id=classId garantiza dedup nativa de Google Ads —
 *      refresh, share del link, multi-tab, todo dedup.
 *    - Un solo evento por funnel = CPA real, no inflado.
 */
export function firePixelScheduleGoogle(args: { classId: string }) {
  if (typeof window === "undefined") return;
  const w = window as Window_;
  try {
    w.gtag?.("event", "conversion", {
      send_to: GADS_CONVERSION_LABEL,
      value:    GADS_CONVERSION_VALUE,
      currency: "EUR",
      transaction_id: args.classId,
    });
  } catch (e) { console.warn("[pixel] gtag conversion failed:", e); }
}
