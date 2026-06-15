/**
 * Home page — el funnel "Diagnostico".
 *
 * Decisión Gelfis 2026-05-02: la ruta `/` deja de ser landing
 * marketing y pasa a ser el quiz de diagnóstico directamente.
 * Cuando el usuario llega a aprender-aleman.de inmediatamente está
 * en el paso 1 del quiz.
 *
 * La landing anterior queda guardada en `/landing-anterior` para
 * rollback y comparativa.
 */

import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { SiteFooter } from "@/components/landings/SiteFooter";

export default function HomePage() {
  return (
    <>
      {/* La home es el funnel completo (100dvh). landingIntent='home'
          se setea implícitamente por el default del componente. */}
      <DiagnosticoFunnel />
      {/* Footer con links a las 6 landings dedicadas. Vive BAJO el
          funnel (fuera del primer scroll del usuario) pero el crawler
          lo ve para distribuir la autoridad SEO. */}
      <SiteFooter />
    </>
  );
}
