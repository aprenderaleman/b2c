/**
 * Home page — el funnel "Diagnostico" simplificado.
 *
 * Decisión Gelfis 2026-06-15: el quiz de 4 preguntas se reemplaza por
 * un flujo de 2 pasos (nivel → calendario+datos). SimpleTrialFlow
 * unifica el flujo en home, landings y /agendar/cuando.
 */

import { SimpleTrialFlow } from "@/components/funnel/SimpleTrialFlow";
import { SiteFooter } from "@/components/landings/SiteFooter";

export default function HomePage() {
  return (
    <>
      <SimpleTrialFlow landingIntent="home" />
      <SiteFooter />
    </>
  );
}
