import type { Metadata } from "next";
import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { LandingHero } from "@/components/landings/LandingHero";
import { LandingExtra } from "@/components/landings/LandingExtra";

export const metadata: Metadata = {
  title: "Curso intensivo de alemán online — Avanza rápido · Aprender-Aleman.de",
  description:
    "Curso intensivo de alemán online con más horas semanales para avanzar rápido. Profesor nativo que habla español, A1 a B2. Empieza con una clase de prueba GRATIS.",
  alternates: { canonical: "/curso-intensivo-aleman" },
};

export default function Page() {
  return (
    <>
      <LandingHero
        h1="Curso intensivo de alemán online"
        subtitle="Avanza rápido con más horas semanales y un ritmo intensivo. Pensado para quienes tienen una mudanza, un examen o un trabajo en Alemania cerca."
        bullets={[
          <><strong>3-5 clases por semana</strong> (vs 1-2 del curso estándar) — el doble de progreso</>,
          <>Programa estructurado <strong>de A1 a B1 en 6 meses</strong> · de A1 a B2 en 10-12 meses</>,
          <>Profesor <strong>nativo alemán</strong> que habla español</>,
          <>Material concentrado + ejercicios diarios entre clases</>,
        ]}
        trustLine="Ideal para mudanzas a Alemania, exámenes oficiales o entrevistas de trabajo en menos de 1 año"
      />

      <div id="empezar">
        <DiagnosticoFunnel presetMotivo="intensivo" landingIntent="intensivo" />
      </div>

      <LandingExtra
        whatIncluded={{
          title: "Qué incluye el curso intensivo",
          items: [
            <>3, 4 o 5 clases en directo por semana (eliges la frecuencia)</>,
            <>Material concentrado: 1-2 capítulos por semana en vez de uno cada dos</>,
            <>Acceso ilimitado a SCHULE para practicar entre clases</>,
            <>Hans (IA) disponible 24/7 para resolver dudas inmediatas</>,
            <>Mini-evaluaciones cada 2 semanas para ajustar el ritmo</>,
            <>Posibilidad de combinar 1 a 1 + grupo pequeño según el bloque</>,
          ],
        }}
        howItWorks={{
          title: "Para quién es el intensivo",
          body: (
            <>
              <p>
                El intensivo es para <strong>3 perfiles muy concretos</strong>:
              </p>
              <ul className="mt-2 ml-4 list-disc space-y-1">
                <li>Te mudas a Alemania en menos de 1 año y necesitas comunicarte ya</li>
                <li>Vas a presentarte a un examen oficial (telc, Goethe) con fecha</li>
                <li>Tienes una entrevista de trabajo o de Ausbildung pronto</li>
              </ul>
              <p className="mt-3">
                Si tu situación es más relajada (aprender por hobby, sin urgencia),
                el curso estándar te dará mejor relación calidad/precio. En la clase
                de prueba te aconsejamos honestamente qué formato te encaja.
              </p>
            </>
          ),
        }}
        faq={[
          {
            q: "¿Cuánto tarda un intensivo en llevarme de A0 a B1?",
            a: "Con 4-5 clases por semana + práctica diaria entre clases, unos 6-7 meses. El A0 a A1 toma 8-10 semanas; A1 a A2 otras 8 semanas; A2 a B1 unas 10. Es ritmo exigente — requiere 5-7 horas semanales de dedicación.",
          },
          {
            q: "¿Puedo pausar el intensivo en vacaciones?",
            a: "Sí, puedes pausar hasta 4 semanas al año sin coste. Más allá de eso, lo conversamos.",
          },
          {
            q: "¿Es mejor un intensivo de verano o anual?",
            a: "Para A0 → A1 funciona muy bien hacer un intensivo de verano de 8 semanas. Para niveles más altos (B1, B2) el ritmo sostenido todo el año da mejores resultados que cargar 2 meses y descansar.",
          },
        ]}
        relatedLinks={[
          { href: "/curso-aleman-online",                   label: "Curso de alemán online" },
          { href: "/clases-particulares-aleman-online",     label: "Clases particulares 1 a 1" },
          { href: "/curso-aleman-certificado",              label: "Curso con certificado" },
          { href: "/aleman-b2-trabajar",                    label: "Alemán B2 para trabajar" },
        ]}
      />
    </>
  );
}
