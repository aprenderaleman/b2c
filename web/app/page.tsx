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
      {/* La home recibe tráfico de redes sociales (no Google Ads — esas
          aterrizan en /clases-aleman-online, /aleman-b2-trabajar, etc).
          Tag explícito 'socialmedia' para que /admin/ads lo distinga
          en el desglose por landing. Decisión Gelfis 2026-06-15.
          Adicionalmente, este landingIntent activa el redirect a
          /agendar/cuando tras el paso 2 (nivel) en DiagnosticoFunnel. */}
      <DiagnosticoFunnel landingIntent="socialmedia" />
      {/* Footer con links a las 6 landings dedicadas. Vive BAJO el
          funnel (fuera del primer scroll del usuario) pero el crawler
          lo ve para distribuir la autoridad SEO. */}
      <SiteFooter />
    </>
  );
}
