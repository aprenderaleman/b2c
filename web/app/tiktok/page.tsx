import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing dedicada para tráfico ORGÁNICO de TikTok (bio link).
 * URL corta pegable: b2c.aprender-aleman.de/tiktok.
 *
 * noindex: landing de campaña. Suscriptores llegan directo desde TT.
 *
 * Atribución: landingIntent="tiktok" → badge negro 🎵 en /admin/funnel.
 */
export const metadata: Metadata = {
  title: "Del TikTok a hablar alemán de verdad — Aprender-Aleman.de",
  description:
    "Aprende alemán con un profesor nativo que habla español. Primera clase 100% gratis, 30 min, sin compromiso.",
  alternates: { canonical: "/tiktok" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Del scroll a hablar alemán 🇩🇪"
      subtitle="Los TikToks te motivan, pero solo hablando 30 min con un profesor real se te queda algo. Prueba tu primera clase gratis, sin tarjeta ni compromiso."
      bullets={[
        { icon: "⚡", text: <><strong>30 min al grano</strong> — nada de intros largas, directo a hablar</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español si te trabas</> },
        { icon: "🎁", text: <><strong>Clase de prueba GRATIS</strong> — si no te convence, no vuelves</> },
      ]}
      presetMotivo="particulares"
      landingIntent="tiktok"
    />
  );
}
