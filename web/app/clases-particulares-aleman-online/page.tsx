import type { Metadata } from "next";
import { DiagnosticoFunnel } from "@/components/diagnostico/DiagnosticoFunnel";
import { LandingHero } from "@/components/landings/LandingHero";
import { LandingExtra } from "@/components/landings/LandingExtra";

export const metadata: Metadata = {
  title: "Clases particulares de alemán online — Profesor nativo · Aprender-Aleman.de",
  description:
    "Clases particulares de alemán online 1 a 1 con profesor nativo que habla español. Sin grupos, sin horarios fijos, certificado A1 hasta B2. Empieza con una clase de prueba GRATIS.",
  alternates: { canonical: "/clases-particulares-aleman-online" },
};

export default function Page() {
  return (
    <>
      <LandingHero
        h1="Clases particulares de alemán online"
        subtitle="Profesor nativo que habla español, 1 a 1, sin grupos ni horarios fijos. Avanza a tu ritmo desde A1 hasta B2 con un plan diseñado para ti."
        bullets={[
          <><strong>1 a 1 puro</strong> — toda la clase es para ti, sin compartir con otros alumnos</>,
          <>Profesor <strong>nativo alemán</strong> que también habla español — explica las reglas desde tu lógica</>,
          <><strong>Sin horarios fijos</strong> — reservas las clases cuando te convienen</>,
          <>Certificado <strong>A1 · A2 · B1 · B2</strong> al terminar cada nivel</>,
        ]}
        trustLine="208 alumnos eligieron este formato — el más demandado de Aprender-Aleman.de"
      />

      <div id="empezar">
        <DiagnosticoFunnel presetMotivo="particulares" landingIntent="particulares" />
      </div>

      <LandingExtra
        whatIncluded={{
          title: "Qué incluye tu clase particular de alemán",
          items: [
            <>Clase 1 a 1 en directo con un profesor nativo (online, vía Zoom)</>,
            <>Material adaptado a tu nivel y a tus errores concretos</>,
            <>Acceso a la plataforma SCHULE entre clases (ejercicios + Hans IA)</>,
            <>Corrección personalizada — el profesor te corrige cada error</>,
            <>Flexibilidad total para reagendar, cambiar de horario o de profe</>,
            <>Atención por WhatsApp para dudas entre sesiones</>,
          ],
        }}
        howItWorks={{
          title: "Por qué 1 a 1 funciona mejor que un grupo",
          body: (
            <>
              <p>
                En un grupo de 6-8 alumnos, hablas máximo <strong>5 minutos por clase</strong>.
                En tu clase particular 1 a 1, hablas los <strong>45 minutos enteros</strong>.
                Eso es 9× más práctica oral por cada euro invertido.
              </p>
              <p className="mt-3">
                Además, el profesor adapta cada clase a TI: si te trabas con los
                artículos der/die/das, una clase entera para eso. Si necesitas
                vocabulario médico porque trabajas en sanidad, lo enfocamos ahí.
                Imposible en un grupo donde todos van al mismo ritmo.
              </p>
              <p className="mt-3">
                Y como el profesor habla español, te explica las reglas raras del
                alemán (Akkusativ, Dativ, verbos separables) en tu idioma — sin
                perder media hora intentando entender la explicación.
              </p>
            </>
          ),
        }}
        faq={[
          {
            q: "¿Cómo se diferencia de las clases en grupo?",
            a: "El 1 a 1 te garantiza atención 100% personalizada y tiempo de habla real. En grupo hablas 5-8 minutos por clase; en particular hablas los 45 minutos. Si tu objetivo es avanzar rápido o tienes necesidades específicas (un examen, un trabajo, una entrevista), el 1 a 1 es claramente la mejor opción.",
          },
          {
            q: "¿Puedo elegir el horario?",
            a: "Sí, totalmente flexible. Tú eliges el día y la hora que te vienen bien. Si necesitas reagendar, lo haces sin penalización con al menos 24h de antelación.",
          },
          {
            q: "¿Qué pasa si no me llevo bien con mi profesor?",
            a: "Lo cambiamos sin coste. Tu progreso depende de la química con el profesor — si no fluye, te asignamos otro de inmediato.",
          },
        ]}
        relatedLinks={[
          { href: "/curso-aleman-online",       label: "Curso de alemán online" },
          { href: "/curso-intensivo-aleman",    label: "Curso intensivo" },
          { href: "/curso-aleman-certificado",  label: "Curso con certificado" },
          { href: "/aleman-b2-trabajar",        label: "Alemán B2 para trabajar" },
          { href: "/clases-aleman-ciudades",    label: "Academias por ciudad" },
        ]}
      />
    </>
  );
}
