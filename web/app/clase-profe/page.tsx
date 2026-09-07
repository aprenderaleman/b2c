import type { Metadata } from "next";
import { LandingStep0 } from "@/components/landings/LandingStep0";
import { resolveProfe, landingIntentForProfe } from "@/lib/profes";

/**
 * Landing dedicada a la campaña Meta Reels 2026-08-20 con profesores
 * concretos (Sabine, Jonathan). URL: /clase-profe?profe=sabine|jonathan.
 *
 *   ?profe=sabine|jonathan  → hero + copy + slot picker limitado a ese
 *                              profe. landing_intent="clase-profe-{slug}".
 *   sin param / valor raro  → variante genérica (pool normal).
 *                              landing_intent="clase-profe-generico".
 *
 * Reusa LandingStep0 + su CTA hacia /agendar/cuando. El picker respeta
 * el ?profe= (fetch /api/public/trial-slots?teacher_id=X) y book-trial
 * ancla la clase al teacher_id correcto. La confirmación va a la misma
 * /confirmacion — se aprovecha CAPI Purchase / Schedule / Reserva
 * Prioritaria sin código extra.
 *
 * Reporting: filtra en /admin/leads por landing_intent LIKE 'clase-profe-%'
 * para separar la performance de cada reel; utm_content diferencia
 * anuncio (reel-sabine vs reel-jonathan) dentro del mismo profe.
 */

type SP = Promise<{ profe?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const p = await searchParams;
  const profe = resolveProfe(p?.profe);
  const who = profe ? profe.firstName : "un profesor nativo";
  return {
    title: `Agenda tu clase de prueba con ${who} · Aprender-Aleman.de`,
    description: "Profesor nativo alemán que habla español. 30 minutos gratis, 1 a 1, online. Sin examen, sin compromiso.",
    alternates: { canonical: "/clase-profe" },
    robots: { index: false, follow: false },
  };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  const p = await searchParams;
  const profe = resolveProfe(p?.profe);
  const landingIntent = landingIntentForProfe(profe);

  const heroLine = profe
    ? `Agenda tu clase de prueba con ${profe.firstName}`
    : "Agenda tu clase de prueba con un profesor nativo";
  const subtitle = profe
    ? `${profe.firstName} es profesor nativo alemán y habla español. 30 minutos 1 a 1 online, para conocerte, ver tu nivel y planificar tu ruta al alemán — sin compromiso.`
    : "Profesor nativo alemán que habla español. 30 minutos 1 a 1 online, para conocerte, ver tu nivel y planificar tu ruta al alemán — sin compromiso.";

  // CTA URL: preserva ?profe= para que /agendar/cuando restrinja el
  // picker y ancle el book-trial al teacher_id correcto.
  const ctaHref = profe
    ? `/agendar/cuando?landing=clase-profe&profe=${encodeURIComponent(profe.slug)}`
    : `/agendar/cuando?landing=clase-profe`;

  return (
    <LandingStep0
      h1={heroLine}
      subtitle={subtitle}
      bulletsMode="replace"
      bullets={[
        { icon: "⏱", text: <><strong>30 minutos gratis</strong>, sin tarjeta, sin compromiso</> },
        { icon: "🗣", text: <>Profesor <strong>nativo bilingüe</strong> — te explica en español cuando te trabas</> },
        { icon: "👤", text: <><strong>1 a 1</strong> — toda la clase es solo para ti</> },
        { icon: "📖", text: <><strong>Sin examen previo</strong>, sin necesidad de hablar alemán todavía</> },
        { icon: "🏠", text: <><strong>100% online</strong> desde tu casa, con el profe en directo</> },
      ]}
      afterBullets={<SocialProof />}
      ctaLabel={profe ? `Reservar mi clase con ${profe.firstName}` : "Reservar mi clase gratis"}
      ctaHref={ctaHref}
      presetMotivo="particulares"
      landingIntent={landingIntent}
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
        <li className="rounded-lg bg-white border border-slate-100 p-3 text-[13.5px] md:text-[14px] text-slate-700">
          <div className="font-semibold text-slate-900 text-[13px] mb-0.5">María, Berlín</div>
          <div className="italic">&ldquo;En 3 meses pasé la entrevista de mi Ausbildung en enfermería.&rdquo;</div>
        </li>
        <li className="rounded-lg bg-white border border-slate-100 p-3 text-[13.5px] md:text-[14px] text-slate-700">
          <div className="font-semibold text-slate-900 text-[13px] mb-0.5">Carlos, Zúrich</div>
          <div className="italic">&ldquo;Ahora negocio con clientes alemanes sin bloquearme.&rdquo;</div>
        </li>
        <li className="rounded-lg bg-white border border-slate-100 p-3 text-[13.5px] md:text-[14px] text-slate-700">
          <div className="font-semibold text-slate-900 text-[13px] mb-0.5">Ana, Múnich</div>
          <div className="italic">&ldquo;Empecé de cero. En 6 meses hago mis trámites yo sola.&rdquo;</div>
        </li>
      </ul>
    </section>
  );
}
