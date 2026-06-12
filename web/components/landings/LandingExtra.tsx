/**
 * Sección de contenido extra debajo del funnel — propósito doble:
 *
 *   1. SEO: Google premia páginas con contenido propio suficiente
 *      por sección. Aquí va el texto único que diferencia cada
 *      landing y evita que sean "thin content".
 *
 *   2. Reasegurar al lead: si bajó del funnel sin agendar, este
 *      contenido le da otro empujón con FAQs, método o testimoniales.
 *
 * Recibe bloques renderizables — cada landing los compone a su gusto.
 */
import { type ReactNode } from "react";

export type LandingExtraProps = {
  /** Bloque de "Qué incluye". */
  whatIncluded: { title: string; items: ReactNode[] };
  /** Bloque de "Método" o "Cómo funciona". */
  howItWorks?: { title: string; body: ReactNode };
  /** FAQ corto — 3 preguntas máximo. */
  faq?: Array<{ q: string; a: ReactNode }>;
  /** Footer con links a las otras landings (internal linking SEO). */
  relatedLinks?: Array<{ href: string; label: string }>;
};

export function LandingExtra({
  whatIncluded, howItWorks, faq, relatedLinks,
}: LandingExtraProps) {
  return (
    <section className="bg-slate-50 px-5 md:px-8 lg:px-10 py-10 md:py-16 border-t border-slate-200">
      <div className="mx-auto max-w-3xl space-y-10">
        <div>
          <h2 className="text-[22px] md:text-[26px] font-bold text-slate-900">
            {whatIncluded.title}
          </h2>
          <ul className="mt-4 space-y-2.5">
            {whatIncluded.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[15px] text-slate-700">
                <span className="mt-[2px] text-warm-foreground shrink-0" aria-hidden>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {howItWorks && (
          <div>
            <h2 className="text-[22px] md:text-[26px] font-bold text-slate-900">
              {howItWorks.title}
            </h2>
            <div className="mt-3 text-[15px] text-slate-700 leading-relaxed">
              {howItWorks.body}
            </div>
          </div>
        )}

        {faq && faq.length > 0 && (
          <div>
            <h2 className="text-[22px] md:text-[26px] font-bold text-slate-900">
              Preguntas frecuentes
            </h2>
            <div className="mt-4 space-y-4">
              {faq.map((f, i) => (
                <details
                  key={i}
                  className="group rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <summary className="cursor-pointer font-semibold text-[15px] text-slate-900
                                      flex items-center justify-between">
                    <span>{f.q}</span>
                    <span className="ml-3 text-slate-400 group-open:rotate-180 transition" aria-hidden>▼</span>
                  </summary>
                  <div className="mt-2 text-[14.5px] text-slate-600 leading-relaxed">
                    {f.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {relatedLinks && relatedLinks.length > 0 && (
          <div className="pt-2 border-t border-slate-200">
            <h2 className="text-[16px] font-semibold text-slate-700">
              También te puede interesar
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {relatedLinks.map((l, i) => (
                <li key={i}>
                  <a
                    href={l.href}
                    className="inline-flex items-center h-9 px-3 rounded-full
                               bg-white border border-slate-200 text-[13px] text-slate-700
                               hover:border-warm hover:text-warm-foreground transition"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
