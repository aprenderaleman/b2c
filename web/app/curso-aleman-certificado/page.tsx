import type { Metadata } from "next";
import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { LandingHero } from "@/components/landings/LandingHero";
import { LandingExtra } from "@/components/landings/LandingExtra";

export const metadata: Metadata = {
  title: "Curso de alemán online con certificado — telc · Goethe · Aprender-Aleman.de",
  description:
    "Curso de alemán online con certificado oficial A1, A2, B1 o B2. Preparación específica para examen telc y Goethe. Empieza con una clase de prueba GRATIS.",
  alternates: { canonical: "/curso-aleman-certificado" },
};

export default function Page() {
  return (
    <>
      <LandingHero
        h1="Curso de alemán online con certificado"
        subtitle="Prepárate para tu certificado oficial por niveles (A1–B2) con un curso estructurado, profesores nativos y simulacros de examen real."
        bullets={[
          <>Niveles certificados: <strong>A1 · A2 · B1 · B2</strong></>,
          <>Preparación específica para <strong>telc</strong> y <strong>Goethe-Institut</strong></>,
          <>Profesor <strong>nativo evaluador</strong> que conoce los criterios del examen</>,
          <><strong>Simulacros</strong> de examen real + corrección detallada</>,
        ]}
        trustLine="Nuestros alumnos aprueban a la primera el 92% de las veces"
      />

      <div id="empezar">
        <DiagnosticoFunnel presetMotivo="certificado" landingIntent="certificado" />
      </div>

      <LandingExtra
        whatIncluded={{
          title: "Qué incluye el curso con certificado",
          items: [
            <>Clases en directo enfocadas en las 4 destrezas del examen (leer, escuchar, escribir, hablar)</>,
            <>Material oficial de telc / Goethe + ejercicios extra de la academia</>,
            <>Simulacros completos cronometrados con corrección detallada</>,
            <>Mock interview oral con un profesor evaluador</>,
            <>Hoja de ruta semanal con objetivos medibles hasta el día del examen</>,
            <>Certificado de finalización Aprender-Aleman.de + apoyo para inscribirte al oficial</>,
          ],
        }}
        howItWorks={{
          title: "Cómo te preparamos para el examen",
          body: (
            <>
              <p>
                Primero hacemos una <strong>evaluación inicial</strong> en la clase de prueba para
                saber tu nivel real (no el que crees). De ahí salimos con un plan de
                semanas hasta el día del examen, con objetivos concretos por bloque.
              </p>
              <p className="mt-3">
                Cada 2 semanas haces un <strong>mini-simulacro</strong> para ver tu progreso real.
                Y en el último mes hacemos 2-3 simulacros completos cronometrados,
                con corrección granular para que llegues al examen sin sorpresas.
              </p>
              <p className="mt-3">
                Trabajamos especialmente la parte oral — donde más alumnos fallan
                porque les da vergüenza. Tu profesor te hace preguntas como las del
                examen real, en condiciones similares.
              </p>
            </>
          ),
        }}
        faq={[
          {
            q: "¿Cuánto tarda en prepararme para el B1?",
            a: "Depende de tu nivel inicial. Si ya tienes A2 sólido, unos 4-5 meses con clases semanales + práctica diaria. Si vienes de cero, planifica 12-14 meses hasta el B1.",
          },
          {
            q: "¿Cuál es la diferencia entre telc y Goethe?",
            a: "Ambos son válidos oficialmente. telc tiende a ser un poco más asequible y más pragmático en la prueba oral; Goethe tiene más prestigio internacional. Para visa o trabajo en Alemania, ambos sirven. En la clase de prueba te recomendamos cuál encaja mejor con tu objetivo.",
          },
          {
            q: "¿Vosotros emitís el certificado oficial?",
            a: "No, el certificado oficial lo emite telc o Goethe-Institut (los únicos reconocidos). Nosotros te preparamos para aprobar, te emitimos un certificado de finalización de curso, y te ayudamos a inscribirte al examen oficial.",
          },
        ]}
        relatedLinks={[
          { href: "/curso-aleman-online",                   label: "Curso de alemán online" },
          { href: "/clases-particulares-aleman-online",     label: "Clases particulares 1 a 1" },
          { href: "/curso-intensivo-aleman",                label: "Curso intensivo" },
          { href: "/aleman-b2-trabajar",                    label: "Alemán B2 para trabajar" },
        ]}
      />
    </>
  );
}
