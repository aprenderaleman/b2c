import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Curso de alemán online con certificado — telc · Goethe · Aprender-Aleman.de",
  description:
    "Curso de alemán online con certificado oficial A1, A2, B1, B2 o C1. Preparación específica para examen telc y Goethe. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/curso-aleman-certificado" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Curso de alemán online con certificado"
      subtitle="Prepárate para tu certificado oficial por niveles (A1–C1) con un curso estructurado, profesores nativos y simulacros de examen real."
      bullets={[
        { icon: "📜", text: <>Niveles certificados: <strong>A1 · A2 · B1 · B2 · C1</strong></> },
        { icon: "🏅", text: <>Preparación específica para <strong>telc</strong> y <strong>Goethe-Institut</strong></> },
        { icon: "📝", text: <><strong>Simulacros</strong> de examen real con corrección detallada</> },
      ]}
      presetMotivo="certificado"
      landingIntent="certificado"
    />
  );
}
