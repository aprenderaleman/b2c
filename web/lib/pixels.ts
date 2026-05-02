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
};

/** Disparado al completar paso 5 (registro). */
export function firePixelLead(args: { leadId: string; email: string; budget: string | null }) {
  if (typeof window === "undefined") return;
  const w = window as Window_;
  try {
    w.fbq?.("track", "Lead", {
      content_name: "diagnostico_register",
      content_category: args.budget ?? "unknown",
    });
  } catch (e) { console.warn("[pixel] fbq Lead failed:", e); }
  try {
    w.ttq?.track("CompleteRegistration", {
      content_id: args.leadId,
      content_name: "diagnostico_register",
    });
  } catch (e) { console.warn("[pixel] ttq CompleteRegistration failed:", e); }
}

/** Disparado al agendar la clase de prueba (paso 6 → /agendar/objetivo). */
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
