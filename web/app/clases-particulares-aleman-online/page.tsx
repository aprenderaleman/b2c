import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

export const metadata: Metadata = {
  title: "Clases particulares de alemán online — Profesor nativo · Aprender-Aleman.de",
  description:
    "Clases particulares de alemán online 1 a 1 con profesor nativo que habla español. Sin grupos, sin horarios fijos, certificado A1 hasta B2. Primera clase de prueba GRATIS.",
  alternates: { canonical: "/clases-particulares-aleman-online" },
};

export default function Page() {
  return (
    <LandingStep0
      h1="Clases particulares de alemán online"
      subtitle="Profesor nativo que habla español, 1 a 1, sin grupos ni horarios fijos. Avanza a tu ritmo desde A1 hasta B2 con un plan diseñado para ti."
      bullets={[
        <><strong>1 a 1 puro</strong> — toda la clase es para ti, sin compartir con otros alumnos</>,
        <><strong>Sin horarios fijos</strong>: reservas las clases cuando te convienen</>,
        <>Certificado <strong>A1 · A2 · B1 · B2</strong> al terminar cada nivel</>,
      ]}
      presetMotivo="particulares"
      landingIntent="particulares"
    />
  );
}
