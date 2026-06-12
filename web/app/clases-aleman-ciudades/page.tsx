import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Clases de alemán en Madrid, Barcelona, Valencia — online en directo",
  description:
    "Clases de alemán en tu ciudad — la misma cercanía que una academia, desde casa y en directo. Profesores nativos, hasta nivel C1. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/clases-aleman-ciudades" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Clases de alemán en tu ciudad — online en directo"
      subtitle="La misma cercanía que una academia de Madrid, Barcelona o Valencia, desde casa y en directo. Ahorras desplazamientos, ganas flexibilidad y mantienes la calidad humana."
      bullets={[
        { icon: "🚇", text: <><strong>Cero desplazamientos</strong> — recuperas 2-4 horas a la semana</> },
        { icon: "🕒", text: <>Horarios flexibles compatibles con tu trabajo (mañanas, tardes, noches)</> },
        { icon: "🌍", text: <>Acceso a profesores nativos de toda Alemania, Austria y Suiza</> },
      ]}
      presetMotivo="particulares"
      landingIntent="ciudades"
    />
  );
}
