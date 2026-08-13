import { LandingStep0 } from "@/components/landings/LandingStep0";

/**
 * Landing /sesion-plan — Sesión de Plan con un asesor (closer).
 *
 * Gemela estructural de /meta-ads-paid pero SIN depósito: la cita es
 * una videollamada gratuita de 20 min con un asesor que arma el plan
 * de alemán del lead (nivel, meta, ritmo, precio). El wizard vive en
 * /sesion-plan/funnel y agenda contra la disponibilidad de los
 * CLOSERS (closer_availability), no de los profesores.
 *
 * Uso interno primero (Gelfis 2026-08-13): invitaciones directas de
 * los closers a su backlog. Tráfico pagado solo tras el paso 5
 * (mensajería) desplegado.
 */
export const metadata = {
  title: "Tu Plan de Alemán en 20 minutos · Aprender-Aleman.de",
  description:
    "Agenda una Sesión de Plan gratuita: 20 minutos por videollamada con un asesor para definir tu nivel, tu meta y el camino más corto para lograrla.",
  robots: { index: false, follow: true },
};

export default function SesionPlanLanding() {
  return (
    <LandingStep0
      tagline="Sesión de Plan · 20 min · Gratis"
      h1="Tu plan personal de alemán, en una videollamada de 20 minutos"
      subtitle="Habla con un asesor de la academia: definimos tu nivel real, tu meta y el camino más corto para lograrla — con fechas y precio claros. Sin compromiso."
      bullets={[
        { icon: "🎯", text: "Sales con un plan concreto: nivel de partida, meta y cuántos meses te tomará" },
        { icon: "🗓️", text: "Elige tú el horario — hoy mismo si quieres, en horas redondas" },
        { icon: "💶", text: "Precio exacto de tu programa, sin letra pequeña" },
        { icon: "🚫", text: "Gratis y sin compromiso — 20 minutos, cero presión" },
      ]}
      bulletsMode="replace"
      ctaLabel="Reservar mi Sesión de Plan"
      ctaHref="/sesion-plan/funnel"
      microcopy="Gratis · 20 minutos · Por videollamada"
      presetMotivo="particulares"
      landingIntent="sesion-plan"
      afterBullets={<ComoFunciona />}
    />
  );
}

function ComoFunciona() {
  const pasos = [
    { n: "1", title: "Cuéntanos tu meta", body: "3 preguntas rápidas: para qué necesitas el alemán, tu nivel y tu plazo." },
    { n: "2", title: "Elige tu horario", body: "Slots en horas redondas, desde hoy mismo. Recibes el enlace por email y WhatsApp." },
    { n: "3", title: "Sal con tu plan", body: "20 minutos con tu asesor: plan de estudio, fechas realistas y precio exacto." },
  ];
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">
        Cómo funciona
      </h2>
      <ol className="mt-3 space-y-3">
        {pasos.map((p) => (
          <li key={p.n} className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-[12px] font-bold flex items-center justify-center">
              {p.n}
            </span>
            <div>
              <p className="text-[14px] font-semibold text-slate-800 leading-tight">{p.title}</p>
              <p className="text-[13px] text-slate-600 leading-snug">{p.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
