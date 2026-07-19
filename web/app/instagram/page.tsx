import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing dedicada para tráfico ORGÁNICO de Instagram (bio + stories
 * + link in bio). URL corta pegable: b2c.aprender-aleman.de/instagram.
 *
 * noindex: landing de campaña, no compite en SEO con las de intención
 * comercial. Suscriptores llegan directo desde Instagram.
 *
 * Atribución: landingIntent="instagram" → leads.landing_intent
 * distingue orgánico IG en /admin/funnel (badge morado 📸).
 */
export const metadata: Metadata = {
  title: "Nos viste en Instagram — Prueba una clase real gratis · Aprender-Aleman.de",
  description:
    "Aprende alemán con un profesor nativo que habla español. Primera clase 100% gratis, 30 min, sin compromiso.",
  alternates: { canonical: "/instagram" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Nos viste en Instagram, ahora hablemos alemán 🇩🇪"
      subtitle="Los reels están bien para inspirarte, pero solo hablando con un profesor de verdad rompes la barrera. Primera clase 100% gratis, sin compromiso."
      bullets={[
        { icon: "🎯", text: <><strong>30 min conversacionales</strong> — no más scroll infinito, esta vez hablas tú</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "🎁", text: <><strong>Clase de prueba GRATIS</strong> — si no te convence, no vuelves</> },
      ]}
      presetMotivo="particulares"
      landingIntent="instagram"
    />
  );
}
