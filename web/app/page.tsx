import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";
import { SiteFooter } from "@/components/landings/SiteFooter";

/**
 * Home page — b2c.aprender-aleman.de.
 *
 * Decisión Gelfis 2026-06-26: la home pasa a renderizar el mismo
 * paso 0 que `/clases-particulares-aleman-online` (Hero corto + 3
 * bullets + CTA al funnel de agendado). El quiz Diagnostico queda
 * accesible vía las landings dedicadas, pero el dominio pelado
 * recibe principalmente tráfico de redes sociales — donde un solo
 * CTA directo convierte mejor que un quiz de 5 pasos.
 *
 * Única diferencia respecto a la landing /clases-particulares-aleman-online:
 *   landingIntent="socialmedia"  (vs "particulares" en la landing).
 *
 * Así en /admin/funnel distinguimos los leads que llegan al dominio
 * pelado (socialmedia) de los que entran por la landing dedicada
 * (particulares), sin tocar la landing existente.
 *
 * El antiguo quiz Diagnostico queda guardado en /landing-anterior
 * para rollback y como backup histórico.
 */

export const metadata: Metadata = {
  title: "Aprender-Aleman.de — Clases de alemán online con profesor nativo",
  description:
    "Clases particulares de alemán online 1 a 1 con profesor nativo que habla español. Sin grupos, sin horarios fijos, hasta nivel C1. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <LandingStep0
        h1="Clases particulares de alemán online"
        subtitle="Profesor nativo que habla español, 1 a 1, sin grupos ni horarios fijos. Avanza a tu ritmo desde A1 hasta C1 con un plan diseñado para ti."
        bullets={[
          { icon: "🎯", text: <><strong>1 a 1 puro</strong> — toda la clase es para ti, sin compartir con otros alumnos</> },
          { icon: "🗓", text: <><strong>Sin horarios fijos</strong>: reservas las clases cuando te convienen</> },
          { icon: "📜", text: <>Certificado <strong>A1 · A2 · B1 · B2 · C1</strong> al terminar cada nivel</> },
        ]}
        presetMotivo="particulares"
        landingIntent="socialmedia"
      />
      {/* Footer SEO con links a las 6 landings dedicadas — se mantiene
          solo en la home (las landings dedicadas no lo renderizan para
          evitar redundancia y mejorar conversión). */}
      <SiteFooter />
    </>
  );
}
