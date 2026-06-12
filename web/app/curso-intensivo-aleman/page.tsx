import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Curso intensivo de alemán online — Avanza rápido · Aprender-Aleman.de",
  description:
    "Curso intensivo de alemán online con más horas semanales para avanzar rápido. Profesor nativo que habla español, hasta nivel C1. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/curso-intensivo-aleman" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Curso intensivo de alemán online"
      subtitle="Avanza rápido con más horas semanales. Pensado para quienes tienen una mudanza, un examen o un trabajo en Alemania cerca."
      bullets={[
        { icon: "🎯", text: <>Plan <strong>a medida de tu deadline real</strong> (mudanza, examen oficial, Ausbildung, contrato)</> },
        { icon: "👩‍🏫", text: <>El <strong>mismo profesor nativo</strong> en toda la formación — continuidad y seguimiento real</> },
        { icon: "💬", text: <>Hablas alemán <strong>desde la primera clase</strong> — fluidez práctica, no solo gramática</> },
      ]}
      presetMotivo="intensivo"
      landingIntent="intensivo"
    />
  );
}
