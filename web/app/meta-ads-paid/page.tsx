import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * A/B paralelo a /meta-ads con depósito de 10€ y wizard de 5 pasos
 * de calificación (Gelfis 2026-07-28). Mismo copy hero + prueba social,
 * añadiendo tagline "Clase de prueba · Agenda Prioritaria 10€" y una
 * nota "¿Por qué 10€?" bajo el CTA. El CTA no lleva a /agendar/cuando
 * como el gratuito — lleva al wizard de calificación /meta-ads-paid/funnel.
 *
 * La landing /meta-ads original NO SE TOCA — coexisten para el A/B.
 */
export const metadata: Metadata = {
  title: "¿Cansado de perder oportunidades por no hablar alemán? · Aprender-Aleman.de",
  description:
    "Reserva tu clase de prueba por 10€ — se descuentan íntegros del programa que elijas. Aprende alemán con un profesor nativo que habla español.",
  alternates: { canonical: "/meta-ads-paid" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <LandingStep0
      tagline="Clase de prueba · Agenda Prioritaria 10€"
      h1="¿Cansado de perder oportunidades por no hablar alemán?"
      subtitle="Aprende con un profesor nativo que habla español. Clases 1 a 1 online, adaptadas a tu ritmo. Reserva tu plaza con Agenda Prioritaria por 10€ — se descuentan íntegros del programa que elijas."
      bulletsMode="replace"
      bullets={[
        { icon: "🎯", text: <><strong>Prepárate para trabajar, estudiar o vivir</strong> en Alemania, Suiza o Austria</> },
        { icon: "🏠", text: <><strong>Aprende desde casa</strong> con profesor nativo que habla español</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "👤", text: <><strong>1 a 1</strong> — toda la clase es para ti, sin grupos que te frenen</> },
        { icon: "🗓", text: <><strong>Sin horarios fijos</strong> — reservas cuando te va bien</> },
      ]}
      afterBullets={<SocialProof />}
      ctaLabel="Reservar mi clase por 10€"
      ctaHref="/meta-ads-paid/funnel"
      microcopy="Los 10€ se descuentan íntegros de tu programa"
      belowCtaNote={<WhyTenEuros />}
      presetMotivo="particulares"
      landingIntent="meta-ads-paid"
    />
  );
}

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

function WhyTenEuros() {
  return (
    <div className="text-[12.5px] md:text-[13px] text-slate-700 leading-snug">
      <p className="font-bold text-slate-900 mb-1">¿Por qué 10€?</p>
      <p>
        Tu profesor prepara la clase para <strong>TU objetivo</strong> y tu plaza queda reservada con prioridad. Trabajamos con quien va en serio — y los 10€ son tuyos: se descuentan de tu programa.
      </p>
    </div>
  );
}
