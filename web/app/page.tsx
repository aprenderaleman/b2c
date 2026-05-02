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

export default function HomePage() {
  return <DiagnosticoFunnel />;
}
