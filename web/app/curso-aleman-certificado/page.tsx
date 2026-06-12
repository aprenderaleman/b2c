import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Curso de alemán online con certificado — telc · Goethe · Aprender-Aleman.de",
  description:
    "Curso de alemán online con certificado oficial A1, A2, B1 o B2. Preparación específica para examen telc y Goethe. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/curso-aleman-certificado" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Curso de alemán online con certificado"
      subtitle="Prepárate para tu certificado oficial por niveles (A1–B2) con un curso estructurado, profesores nativos y simulacros de examen real."
      bullets={[
        <>Niveles certificados: <strong>A1 · A2 · B1 · B2</strong></>,
        <>Preparación específica para <strong>telc</strong> y <strong>Goethe-Institut</strong></>,
        <><strong>Simulacros</strong> de examen real con corrección detallada</>,
      ]}
      presetMotivo="certificado"
      landingIntent="certificado"
    />
  );
}
