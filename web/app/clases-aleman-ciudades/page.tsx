import type { Metadata } from "next";
import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { LandingHero } from "@/components/landings/LandingHero";
import { LandingExtra } from "@/components/landings/LandingExtra";

export const metadata: Metadata = {
  title: "Clases de alemán en Madrid, Barcelona, Valencia — online en directo",
  description:
    "Clases de alemán en tu ciudad — la misma cercanía que una academia, desde casa y en directo. Profesores nativos, certificado A1 a B2. Clase de prueba GRATIS.",
  alternates: { canonical: "/clases-aleman-ciudades" },
};

export default function Page() {
  return (
    <>
      <LandingHero
        h1="Clases de alemán en tu ciudad — online en directo"
        subtitle="La misma cercanía que una academia de Madrid, Barcelona o Valencia, desde casa y en directo. Ahorras desplazamientos, ganas flexibilidad y mantienes la calidad humana."
        bullets={[
          <>Toda la <strong>cercanía de una academia local</strong>, sin moverte de casa</>,
          <>Clases <strong>en directo</strong> (no grabaciones) con profesores nativos</>,
          <>Horarios <strong>compatibles con tu trabajo</strong> en España (mañanas, tardes, noches)</>,
          <>Mismo <strong>precio</strong> o más barato que una academia presencial</>,
        ]}
        trustLine="Alumnos en Madrid, Barcelona, Valencia, Sevilla, Bilbao y más de 40 ciudades de España"
      />

      <div id="empezar">
        <DiagnosticoFunnel landingIntent="ciudades" />
      </div>

      <LandingExtra
        whatIncluded={{
          title: "Por qué los alumnos de ciudades nos eligen frente a la academia local",
          items: [
            <><strong>Cero desplazamientos</strong> — recuperas 2-4 horas a la semana</>,
            <>Horarios flexibles — puedes hacer clase a las 7am, a las 22h o el sábado</>,
            <>Acceso a una bolsa de profesores nativos (no solo los que viven en tu ciudad)</>,
            <>Mismo material y certificado que una academia presencial</>,
            <>Soporte en español por WhatsApp para resolver dudas inmediatamente</>,
            <>Grupos pequeños o 1 a 1 — tú eliges el formato</>,
          ],
        }}
        howItWorks={{
          title: "Lo mismo que en una academia local, pero online",
          body: (
            <>
              <p>
                Si estás buscando una <strong>academia de alemán en Madrid</strong>,
                <strong> Barcelona</strong> o <strong>cualquier ciudad española</strong>, probablemente buscas:
                clases en directo, profesor nativo que hable español, ambiente
                cercano y flexibilidad de horarios.
              </p>
              <p className="mt-3">
                Eso es exactamente lo que hacemos — online. La única diferencia
                es que en lugar de desplazarte 30 min en metro hasta la academia,
                te conectas desde el sofá. El profesor, las clases, el material
                y el certificado son idénticos a los de cualquier academia
                presencial top.
              </p>
              <p className="mt-3">
                Y a diferencia de una academia local, no estás limitado a los
                profesores que viven cerca de ti: puedes elegir entre nativos
                de toda Alemania, Austria y Suiza que dan clase desde su casa.
              </p>
            </>
          ),
        }}
        faq={[
          {
            q: "¿Es lo mismo que una academia presencial en mi ciudad?",
            a: "El método y la calidad son los mismos. La diferencia: ahorras el tiempo del desplazamiento (que suele ser 30-60 min en una ciudad grande) y tienes más flexibilidad de horarios. La química con el profesor depende de la persona, no del formato.",
          },
          {
            q: "¿Funciona en ciudades pequeñas sin academia de alemán cerca?",
            a: "Mejor todavía — para alumnos de ciudades pequeñas o pueblos donde no hay academia de alemán, esta es la única forma realista de tomar clases en directo con profesor nativo.",
          },
          {
            q: "¿Cuál es la diferencia de precio con una academia presencial?",
            a: "Generalmente somos un 20-30% más asequibles que una academia top de Madrid o Barcelona, porque no tenemos costes de alquiler de aulas. En la clase de prueba te damos el precio exacto.",
          },
        ]}
        relatedLinks={[
          { href: "/curso-aleman-online",                   label: "Curso de alemán online" },
          { href: "/clases-particulares-aleman-online",     label: "Clases particulares 1 a 1" },
          { href: "/curso-intensivo-aleman",                label: "Curso intensivo" },
          { href: "/curso-aleman-certificado",              label: "Curso con certificado" },
          { href: "/aleman-b2-trabajar",                    label: "Alemán B2 para trabajar" },
        ]}
      />
    </>
  );
}
