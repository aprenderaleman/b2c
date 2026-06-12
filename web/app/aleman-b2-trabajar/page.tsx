import type { Metadata } from "next";
import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { LandingHero } from "@/components/landings/LandingHero";
import { LandingExtra } from "@/components/landings/LandingExtra";

export const metadata: Metadata = {
  title: "Alemán B2 para trabajar en Alemania — Aprender-Aleman.de",
  description:
    "Alcanza el nivel B2 que piden para trabajar, estudiar o convalidar tu título en Alemania. Curso especial para enfermeras, Ausbildung e ingenieros. Clase de prueba GRATIS.",
  alternates: { canonical: "/aleman-b2-trabajar" },
};

export default function Page() {
  return (
    <>
      <LandingHero
        h1="Alemán B2 para trabajar en Alemania"
        subtitle="Alcanza el nivel B2 que piden para trabajar, estudiar o convalidar tu título. Curso enfocado en lo que de verdad necesitas para empezar tu vida profesional en Alemania."
        bullets={[
          <>Plan específico para llegar al <strong>B2</strong> — el nivel laboral estándar</>,
          <>Vocabulario y simulaciones del <strong>sector sanitario</strong> (enfermería, medicina)</>,
          <>Preparación para <strong>Ausbildung</strong>, entrevistas e <strong>integración</strong> en el equipo</>,
          <>Profesor <strong>nativo alemán</strong> que conoce el mundo laboral allá</>,
        ]}
        trustLine="Muchas enfermeras y técnicos hispanohablantes ya trabajan en Alemania con nuestro método"
      />

      <div id="empezar">
        <DiagnosticoFunnel presetMotivo="profesional" landingIntent="b2-trabajar" />
      </div>

      <LandingExtra
        whatIncluded={{
          title: "Qué incluye el curso para trabajar en Alemania",
          items: [
            <>Plan de A1 a B2 (o desde tu nivel actual) con objetivo laboral</>,
            <>Módulos de vocabulario sectorial (sanidad, técnico, oficina, hostelería)</>,
            <>Simulación de entrevistas de trabajo en alemán</>,
            <>Preparación para examen oficial telc B2 / Goethe B2</>,
            <>Apoyo con CV alemán (Lebenslauf) y carta de motivación</>,
            <>Asesoramiento sobre Anerkennung (reconocimiento de tu título)</>,
          ],
        }}
        howItWorks={{
          title: "Por qué el B2 es el nivel clave para trabajar",
          body: (
            <>
              <p>
                La mayoría de ofertas laborales en Alemania piden <strong>B2</strong> como nivel
                mínimo — incluido el sector sanitario, donde la ley exige B2
                para que enfermeras y médicos puedan ejercer.
              </p>
              <p className="mt-3">
                Para Ausbildung (formación profesional dual) suele bastar B1
                inicial subiendo a B2 durante el primer año. Para entrevistas
                de oficina o ingeniería, B2 es el estándar.
              </p>
              <p className="mt-3">
                Nuestro curso te lleva de tu nivel actual hasta B2 con un foco
                práctico: hablar de tu profesión, entender órdenes en el trabajo,
                participar en reuniones y escribir emails formales.
              </p>
            </>
          ),
        }}
        faq={[
          {
            q: "¿Cuánto tarda llegar al B2 desde cero?",
            a: "De A0 a B2 son unos 10-14 meses con dedicación constante (clases semanales + 5h propias de estudio). Con un curso intensivo se puede acortar a 8-10 meses, pero requiere ritmo alto.",
          },
          {
            q: "Soy enfermera, ¿qué nivel necesito para trabajar?",
            a: "En Alemania la ley exige B2 para enfermería y profesiones sanitarias reguladas. La buena noticia: el examen B2 sanitario es más enfocado y predecible que el general. En la clase de prueba te explicamos la ruta exacta según tu país y tu título.",
          },
          {
            q: "¿Ofrecéis apoyo con la convalidación del título (Anerkennung)?",
            a: "Te orientamos sobre los pasos, las autoridades que validan tu título y la documentación, pero el trámite legal lo hace el lead con el organismo correspondiente. La parte de idioma es lo que dominamos.",
          },
        ]}
        relatedLinks={[
          { href: "/curso-aleman-online",                   label: "Curso de alemán online" },
          { href: "/clases-particulares-aleman-online",     label: "Clases particulares 1 a 1" },
          { href: "/curso-intensivo-aleman",                label: "Curso intensivo" },
          { href: "/curso-aleman-certificado",              label: "Curso con certificado" },
        ]}
      />
    </>
  );
}
