import type { Metadata } from "next";
import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { LandingHero } from "@/components/landings/LandingHero";
import { LandingExtra } from "@/components/landings/LandingExtra";

export const metadata: Metadata = {
  title: "Curso de alemán online — Profesores nativos · Aprender-Aleman.de",
  description:
    "Curso de alemán online con profesores nativos que hablan español. Clases en directo, plan a tu medida y certificado A1 hasta B2. Empieza con una clase de prueba GRATIS.",
  alternates: { canonical: "/curso-aleman-online" },
};

export default function Page() {
  return (
    <>
      <LandingHero
        h1="Curso de alemán online"
        subtitle="Aprende alemán online con profesores nativos, clases en directo y un plan a tu medida — desde cero (A1) hasta nivel avanzado (B2)."
        bullets={[
          <>Profesores <strong>nativos certificados</strong> que también hablan español</>,
          <>Clases <strong>en directo</strong> (no grabaciones) en grupos pequeños o 1 a 1</>,
          <>Plan <strong>adaptado a tu nivel</strong> y a tu objetivo, no un curso genérico</>,
          <>Certificado oficial al terminar (A1 · A2 · B1 · B2)</>,
        ]}
        trustLine="+1.500 alumnos hispanohablantes ya aprenden con nosotros"
      />

      <div id="empezar">
        <DiagnosticoFunnel landingIntent="curso-online" />
      </div>

      <LandingExtra
        whatIncluded={{
          title: "Qué incluye nuestro curso de alemán online",
          items: [
            <>Clases en directo con profesor nativo (online, vía Zoom)</>,
            <>Material y ejercicios entre clases (vocabulario, gramática, audios)</>,
            <>Plataforma SCHULE de auto-estudio con IA (Hans, tu tutor virtual)</>,
            <>Seguimiento personalizado y corrección de errores frecuentes</>,
            <>Certificado de finalización por nivel (A1, A2, B1 o B2)</>,
            <>Soporte por WhatsApp para resolver dudas entre clases</>,
          ],
        }}
        howItWorks={{
          title: "Cómo funciona el curso de alemán en línea",
          body: (
            <>
              <p>
                Después de la <strong>clase de prueba gratis</strong>, diseñamos contigo un
                plan de aprendizaje adaptado a tu nivel actual y a tu objetivo. Eliges
                el ritmo (clases semanales, intensivo o flexible) y el formato (1 a 1
                o grupo pequeño).
              </p>
              <p className="mt-3">
                Las clases son <strong>en directo</strong> con un profesor nativo que habla
                español — esto es clave para que entiendas las reglas del alemán
                desde tu lógica de hispanohablante. Nada de cursos pregrabados ni
                profesores que solo hablan alemán contigo cuando aún no tienes nivel.
              </p>
            </>
          ),
        }}
        faq={[
          {
            q: "¿Cuánto tiempo necesito para aprender alemán online?",
            a: "Depende del nivel objetivo y del ritmo. De cero a A1 toma 2-3 meses con clases semanales; de A1 a B1 unos 6 meses; B1 a B2 otros 4-6 meses. En la clase de prueba te damos un plan realista para tu caso.",
          },
          {
            q: "¿Necesito conocer algo de alemán antes de empezar?",
            a: "No. Tenemos cursos desde el nivel A0 (cero conocimientos). Te enseñamos desde el alfabeto hasta tu primera conversación real, paso a paso.",
          },
          {
            q: "¿Cuánto cuesta el curso de alemán online?",
            a: "El precio depende del formato (1 a 1 o grupo) y la duración. En la clase de prueba gratuita te explicamos los planes exactos sin sorpresas.",
          },
        ]}
        relatedLinks={[
          { href: "/clases-particulares-aleman-online", label: "Clases particulares 1 a 1" },
          { href: "/curso-intensivo-aleman",            label: "Curso intensivo" },
          { href: "/curso-aleman-certificado",          label: "Curso con certificado" },
          { href: "/aleman-b2-trabajar",                label: "Alemán B2 para trabajar" },
        ]}
      />
    </>
  );
}
