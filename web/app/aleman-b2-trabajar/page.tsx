import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Alemán B2 para trabajar en Alemania — Aprender-Aleman.de",
  description:
    "Alcanza el nivel B2 que piden para trabajar, estudiar o convalidar tu título en Alemania. Curso especial para enfermeras, Ausbildung e ingenieros. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/aleman-b2-trabajar" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Alemán B2 para trabajar en Alemania"
      subtitle="Alcanza el nivel B2 que piden para trabajar, estudiar o convalidar tu título. Curso enfocado en lo que de verdad necesitas para empezar tu vida profesional en Alemania."
      bullets={[
        { icon: "🎯", text: <>Plan específico para llegar al <strong>B2</strong> — el nivel laboral estándar</> },
        { icon: "🩺", text: <>Vocabulario y simulaciones del <strong>sector sanitario</strong> (enfermería, medicina)</> },
        { icon: "💼", text: <>Preparación para <strong>Ausbildung</strong>, entrevistas e integración profesional</> },
      ]}
      presetMotivo="profesional"
      landingIntent="b2-trabajar"
    />
  );
}
