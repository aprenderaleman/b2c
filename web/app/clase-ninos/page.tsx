import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";
import { resolveProfe, PROFES_MAP } from "@/lib/profes";

/**
 * Landing para padres hispanos que agendan una clase de prueba para su
 * hijo/a (6-17 años). Campaña Meta 2026-10-09.
 *
 * La profe por defecto es Verónica (especializada en niños); ?profe=X
 * admite otro profe de PROFES_MAP. El CTA lleva a /agendar/cuando con
 * ?tipo=menor, que muestra el formulario de padres (datos del hijo/a) y
 * guarda el lead con lead_tipo='menor' + menor_datos (migración 140).
 * landing_intent = "clase-ninos-{slug}".
 */

type SP = Promise<{ profe?: string }>;

export const metadata: Metadata = {
  title: "Clase de prueba de alemán gratis para tu hijo/a · Aprender-Aleman.de",
  description: "Profesora nativa alemana que habla español, especializada en niños y adolescentes hispanos en escuelas alemanas. 30 minutos gratis, 1 a 1, online.",
  alternates: { canonical: "/clase-ninos" },
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: SP }) {
  const p = await searchParams;
  const profe = resolveProfe(p?.profe) ?? PROFES_MAP.veronica;
  const esProfesora = profe.female === true;

  return (
    <LandingStep0
      h1={`Clase de prueba gratis para tu hijo/a con ${profe.firstName}`}
      subtitle={`${esProfesora ? "Profesora nativa alemana" : "Profesor nativo alemán"} que habla español, ${esProfesora ? "especializada" : "especializado"} en niños y adolescentes hispanos en escuelas alemanas.`}
      bulletsMode="replace"
      bullets={[
        { icon: "👤", text: <><strong>Clases 1 a 1</strong>, 100% online</> },
        { icon: "🌱", text: <><strong>A su ritmo</strong>, sin presión de examen</> },
        { icon: "🗣", text: <><strong>Explicación en español</strong> cuando se traba</> },
        { icon: "🏫", text: <><strong>Horarios adaptados</strong> al colegio</> },
        { icon: "⏱", text: <><strong>Sin compromiso</strong>, 30 min gratis</> },
      ]}
      ctaLabel="Reservar la clase de mi hijo/a"
      ctaHref={`/agendar/cuando?landing=clase-ninos&tipo=menor&profe=${encodeURIComponent(profe.slug)}`}
      presetMotivo="particulares"
      landingIntent={`clase-ninos-${profe.slug}`}
    />
  );
}
