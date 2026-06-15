"use client";

/**
 * /agendar/cuando — entrypoint del funnel simplificado.
 *
 * Decisión Gelfis 2026-06-15: tras unificar el flujo de reserva en
 * SimpleTrialFlow (nivel → calendario+datos), esta ruta deja de tener
 * lógica propia y solo monta el componente. Mantenida como URL pública
 * porque está en los links de campañas y SEO.
 *
 * El flujo viejo (state.from_diagnostico → auto-submit) ya no aplica
 * porque DiagnosticoFunnel está retirado: SimpleTrialFlow pide los 3
 * datos siempre. Si en el futuro hay que reintroducir el atajo, el
 * componente ya recibe `landingIntent` para distinguir el origen.
 */

import { SimpleTrialFlow } from "@/components/funnel/SimpleTrialFlow";

export default function StepCuando() {
  return <SimpleTrialFlow landingIntent="agendar-directo" />;
}
