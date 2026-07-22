import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing dedicada para tráfico PAGADO de Meta Ads (FB + IG ads).
 * URL corta: b2c.aprender-aleman.de/meta-ads.
 *
 * Distinta de las orgánicas (Gelfis 2026-07-21): copy alineado al
 * mensaje del anuncio (dolor → solución → prueba social → cierre),
 * bullets reordenados con `bulletsMode: "replace"`, testimonios
 * inyectados vía `afterBullets`, CTA con etiqueta específica de
 * conversión ("mi clase de prueba gratis"). Un solo objetivo:
 * agendar la clase de prueba. Sin FAQ, sin nav.
 */
export const metadata: Metadata = {
  title: "¿Cansado de perder oportunidades por no hablar alemán? · Aprender-Aleman.de",
  description:
    "Aprende alemán con un profesor nativo que habla español. Clases 1 a 1 online. Primera clase 100% gratis, sin tarjeta ni compromiso.",
  alternates: { canonical: "/meta-ads" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      h1="¿Cansado de perder oportunidades por no hablar alemán?"
      subtitle="Aprende con un profesor nativo que habla español. Clases 1 a 1 online, adaptadas a tu ritmo. La primera es 100% gratis, sin compromiso ni tarjeta."
      bulletsMode="replace"
      bullets={[
        { icon: "🎯", text: <><strong>Prepárate para trabajar, estudiar o vivir</strong> en Alemania, Suiza o Austria</> },
        { icon: "🏠", text: <><strong>Aprende desde casa</strong> con profesor nativo que habla español</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "👤", text: <><strong>1 a 1</strong> — toda la clase es para ti, sin grupos que te frenen</> },
        { icon: "🗓", text: <><strong>Sin horarios fijos</strong> — reservas cuando te va bien</> },
      ]}
      afterBullets={<SocialProof />}
      ctaLabel="Reservar mi clase de prueba gratis"
      presetMotivo="particulares"
      landingIntent="meta-ads"
    />
  );
}

/**
 * Prueba social — cifra hero + 3 testimonios cortos. TESTIMONIOS SON
 * PLACEHOLDERS: sustituirlos por citas reales cuando Gelfis las
 * confirme. La cifra "+500 estudiantes hispanos" está alineada con el
 * "+500 alumnos" que ya aparece en la ratings row (mantener sincronía
 * si Gelfis actualiza uno, actualizar el otro).
 */
function SocialProof() {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:p-5">
      <h2 className="text-[16px] md:text-[17px] font-bold text-slate-900 text-center">
        Miles de hispanos ya aprenden con nosotros
      </h2>
      <div className="mt-2 text-center">
        <div className="text-2xl md:text-3xl font-extrabold text-emerald-700 tabular-nums leading-none">
          +500
        </div>
        <div className="text-[12px] md:text-[13px] text-slate-600 mt-0.5">
          estudiantes hispanos aprendiendo alemán
        </div>
      </div>

      <ul className="mt-4 space-y-2.5">
        {/* PLACEHOLDER - reemplazar con testimonios reales */}
        <li className="rounded-lg bg-white border border-slate-100 p-3 text-[13.5px] md:text-[14px] text-slate-700">
          <div className="font-semibold text-slate-900 text-[13px] mb-0.5">María, Berlín</div>
          <div className="italic">&ldquo;En 3 meses pasé la entrevista de mi Ausbildung en enfermería.&rdquo;</div>
        </li>
        {/* PLACEHOLDER - reemplazar con testimonios reales */}
        <li className="rounded-lg bg-white border border-slate-100 p-3 text-[13.5px] md:text-[14px] text-slate-700">
          <div className="font-semibold text-slate-900 text-[13px] mb-0.5">Carlos, Zúrich</div>
          <div className="italic">&ldquo;Ahora negocio con clientes alemanes sin bloquearme.&rdquo;</div>
        </li>
        {/* PLACEHOLDER - reemplazar con testimonios reales */}
        <li className="rounded-lg bg-white border border-slate-100 p-3 text-[13.5px] md:text-[14px] text-slate-700">
          <div className="font-semibold text-slate-900 text-[13px] mb-0.5">Ana, Múnich</div>
          <div className="italic">&ldquo;Empecé de cero. En 6 meses hago mis trámites yo sola.&rdquo;</div>
        </li>
      </ul>
    </section>
  );
}
