import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing dedicada para tráfico ORGÁNICO de TikTok (bio link).
 * URL corta pegable: b2c.aprender-aleman.de/tiktok.
 *
 * Copy unificado con /facebook, /instagram y /meta-ads (Gelfis
 * 2026-07-19). Solo cambia landingIntent para atribución en
 * /admin/funnel (badge 🎵).
 */
export const metadata: Metadata = {
  title: "Aprende alemán con profesor nativo — Clase de prueba gratis · Aprender-Aleman.de",
  description:
    "Clases de alemán online 1 a 1 con profesor nativo que habla español. Primera clase 100% gratis, sin compromiso.",
  alternates: { canonical: "/tiktok" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Aprende alemán con un profesor nativo que habla español"
      subtitle="Clases 1 a 1 online, adaptadas a tu ritmo. Tu profesor prepara la clase pensando en ti. La primera es 100% gratis, sin compromiso ni tarjeta."
      bullets={[
        { icon: "🎯", text: <><strong>1 a 1</strong> — toda la clase es para ti, sin grupos que te frenen</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "🗓", text: <><strong>Sin horarios fijos</strong> — reservas cuando te va bien</> },
      ]}
      presetMotivo="particulares"
      landingIntent="tiktok"
    />
  );
}
