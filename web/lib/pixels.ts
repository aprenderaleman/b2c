/**
 * Wrappers no-op de los pixels publicitarios.
 *
 * Las llamadas (`firePixelLead`, `firePixelSchedule`) son seguras de
 * invocar siempre — si las envs `NEXT_PUBLIC_META_PIXEL_ID` o
 * `NEXT_PUBLIC_TIKTOK_PIXEL_ID` no están configuradas, no hacen nada.
 *
 * Los scripts globales se inyectan en `app/layout.tsx` vía el
 * componente `<PixelTags />`. Cuando Gelfis pase los IDs, se setean
 * las envs en Vercel y todo arranca a trackear sin más cambios.
 */

type Window_ = Window & {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (event: string, params?: Record<string, unknown>) => void };
  gtag?: (...args: unknown[]) => void;
};

// Conversión de Google Ads "Enviar formulario de clientes potenciales".
// Se dispara al pulsar "Crear mi plan" (paso 5 completado). El gtag base
// (AW-17724667323) ya se carga en app/layout.tsx.
const GADS_LEAD_CONVERSION = "AW-17724667323/5fU7CKWqmLUcELvr44NC";

// Conversión de Google Ads "Clase de prueba reservada". Se dispara al
// llegar a /confirmacion (transaction_id = classId, dedup garantizada).
// El label viene de la env NEXT_PUBLIC_GADS_SCHEDULE_LABEL; si no está
// configurada, cae al mismo label del lead (mejor double-count que perder
// la señal). Gelfis crea el label nuevo en Google Ads y lo setea en Vercel.
const GADS_SCHEDULE_CONVERSION = process.env.NEXT_PUBLIC_GADS_SCHEDULE_CONVERSION
  ?? GADS_LEAD_CONVERSION;

/** Disparado al completar paso 5 (registro = click "Crear mi plan").
 *
 *  El `value` de la conversión Google Ads señaliza la calidad del lead:
 *    - hasWhatsapp=true  → 2 EUR (lead puede agendar trial, Stiv lo
 *      recupera por WA, alta tasa de conversión a cliente)
 *    - hasWhatsapp=false → 1 EUR (lead email-only, sólo drip por
 *      correo, baja tasa de conversión)
 *  Smart Bidding usa el ratio para optimizar hacia leads con WA.
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
  const transactionId = args.leadId; // dedup por lead_id
  // ── Google Ads conversion ──
  try {
    w.gtag?.("event", "conversion", {
      send_to: GADS_LEAD_CONVERSION,
      value,
      currency: "EUR",
      transaction_id: transactionId,
    });
  } catch (e) { console.warn("[pixel] gtag conversion failed:", e); }
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

/** Disparado al agendar la clase de prueba (post-submit en SimpleTrialFlow).
 *
 *  Meta + TikTok aquí; Google Ads va en `firePixelScheduleGoogle` que
 *  se dispara desde /confirmacion para deduplicación robusta por classId.
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

/** Conversion de Google Ads "Clase de prueba reservada". Dispárala
 *  desde /confirmacion (page-load). transaction_id=classId previene
 *  doble-conteo si el lead refresca o vuelve a la página.
 *
 *  value = 5 EUR (vs 2 EUR del lead) — señaliza a Smart Bidding que
 *  los leads que llegan a este punto valen más que los simplemente
 *  registrados. Ajusta el valor con producto si tu CPL real difiere.
 */
export function firePixelScheduleGoogle(args: { classId: string }) {
  if (typeof window === "undefined") return;
  const w = window as Window_;
  try {
    w.gtag?.("event", "conversion", {
      send_to: GADS_SCHEDULE_CONVERSION,
      value:    5,
      currency: "EUR",
      transaction_id: args.classId,
    });
  } catch (e) { console.warn("[pixel] gtag schedule conversion failed:", e); }
}
