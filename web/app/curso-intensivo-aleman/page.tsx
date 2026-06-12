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
        { icon: "🚀", text: <><strong>3-5 clases por semana</strong> — el doble de progreso vs el curso estándar</> },
        { icon: "📈", text: <>Programa estructurado: <strong>de A1 a B1 en 6 meses</strong> · A1 a B2 en 10-12 meses</> },
        { icon: "📊", text: <>Mini-evaluaciones cada 2 semanas para ajustar el ritmo</> },
      ]}
      presetMotivo="intensivo"
      landingIntent="intensivo"
    />
  );
}
