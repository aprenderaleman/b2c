import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing dedicada para tráfico PAGADO de Meta Ads (Facebook + Instagram
 * ads). URL corta pegable en el destination URL de cada creative:
 *   b2c.aprender-aleman.de/meta-ads
 *
 * Separado de /instagram y /facebook (orgánicos) para que en
 * /admin/funnel puedas ver CPA real vs CVR orgánico sin mezclarlos.
 *
 * Copy más directo que orgánico: promesa clara + urgencia suave. El lead
 * pagado tiene menos contexto previo → tenemos que convencerlo rápido.
 *
 * Atribución: landingIntent="meta-ads" → badge magenta 💰.
 */
export const metadata: Metadata = {
  title: "Aprende alemán con profesor nativo — Clase gratis · Aprender-Aleman.de",
  description:
    "Habla alemán en 3 meses con clases 1 a 1 online. Profesor nativo que habla español. Primera clase 100% gratis.",
  alternates: { canonical: "/meta-ads" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Habla alemán en 3 meses con clases 1 a 1"
      subtitle="Prueba gratis nuestro método: 30 min con profesor nativo que habla español. Te evaluamos el nivel y te armamos un plan para llegar a tu objetivo. Sin tarjeta, sin compromiso."
      bullets={[
        { icon: "🎯", text: <><strong>Plan personalizado</strong> — sabrás exactamente qué hacer y en cuánto llegas</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "🎁", text: <><strong>Clase 100% gratis</strong> — si no te convence, no vuelves. Sin tarjeta.</> },
      ]}
      presetMotivo="particulares"
      landingIntent="meta-ads"
    />
  );
}
