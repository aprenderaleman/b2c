import type { Metadata } from "next";
import { PaidFunnelWizard } from "./PaidFunnelWizard";

/**
 * Wizard de 5 pasos + captura + pago del funnel /meta-ads-paid.
 *
 * Reutiliza los primitives del calendario ya existente
 * (`MobileDayStrip`, `TimeList`, `/api/public/trial-slots`) y el helper
 * de teléfono `lib/phone.ts`. La página es un shell mínimo — todo el
 * flow es client-side en `<PaidFunnelWizard>`.
 */
export const metadata: Metadata = {
  title: "Reserva tu clase de prueba · Aprender-Aleman.de",
  description: "Elige tu horario y activa la Agenda Prioritaria por 10€.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PaidFunnelWizard />;
}
