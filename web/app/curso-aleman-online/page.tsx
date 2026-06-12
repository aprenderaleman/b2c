import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Curso de alemán online — Profesores nativos · Aprender-Aleman.de",
  description:
    "Curso de alemán online con profesores nativos que hablan español. Clases en directo, plan a tu medida y hasta nivel C1. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/curso-aleman-online" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Curso de alemán online"
      subtitle="Aprende alemán online con profesores nativos, clases en directo y un plan a tu medida — desde cero (A1) hasta nivel avanzado (C1)."
      bullets={[
        { icon: "🎥", text: <>Clases <strong>en directo</strong> (no grabaciones), grupos pequeños o 1 a 1</> },
        { icon: "🧭", text: <>Plan <strong>adaptado a tu nivel</strong> y a tu objetivo, no un curso genérico</> },
        { icon: "📜", text: <>Certificado oficial al terminar (<strong>A1 · A2 · B1 · B2 · C1</strong>)</> },
      ]}
      presetMotivo="particulares"
      landingIntent="curso-online"
    />
  );
}
