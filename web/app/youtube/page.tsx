import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing dedicada para tráfico de YouTube (descripciones de videos,
 * end-cards, comments). URL corta pegable: b2c.aprender-aleman.de/youtube.
 *
 * noindex: es una landing de campaña — no queremos que compita en SEO
 * con las landings de intención comercial (particulares, certificado,
 * intensivo, etc.). Los suscriptores llegan directo desde YouTube.
 *
 * Atribución: landingIntent="youtube" → book-trial lo persiste en
 * leads.landing_intent y /admin/funnel lo distingue con badge rojo 📺.
 */
export const metadata: Metadata = {
  title: "¿Te gustan los videos? Prueba una clase real gratis — Aprender-Aleman.de",
  description:
    "Aprende alemán con un profesor nativo que habla español. Primera clase 100% gratis, 30 min, sin compromiso. Reserva tu horario.",
  alternates: { canonical: "/youtube" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      h1="¿Viste el video? Da el siguiente paso 🎓"
      subtitle="Los videos están bien para empezar, pero hablar es lo que rompe la barrera. Reserva tu primera clase 100% gratis con un profesor nativo que habla español."
      bullets={[
        { icon: "🎥", text: <><strong>De ver a hablar</strong> — 30 min conversacionales, no otro video</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "🎁", text: <><strong>Sin tarjeta, sin compromiso</strong> — si no te convence, no vuelves</> },
      ]}
      presetMotivo="particulares"
      landingIntent="youtube"
    />
  );
}
