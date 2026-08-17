import { SesionPlanWizard } from "./SesionPlanWizard";

/**
 * Wizard /sesion-plan/funnel — gemelo de /meta-ads-paid/funnel pero:
 *  · slots de closers (/api/public/sesion-slots)
 *  · booking sin Stripe (/api/public/book-sesion-plan)
 * Reutiliza MobileDayStrip, TimeList, IllustrationPanel y lib/phone.
 */
export const metadata = {
  title: "Reserva tu Sesión de Plan-Alemán · Aprender-Aleman.de",
  robots: { index: false, follow: false },
};

export default function SesionPlanFunnelPage() {
  return <SesionPlanWizard />;
}
