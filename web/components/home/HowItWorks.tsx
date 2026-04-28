/**
 * 3-step "how it works" strip. Lives directly under the trust band so
 * the visitor learns the flow in 5 seconds before scrolling into
 * social proof / comparativa.
 */
const STEPS = [
  {
    n: "01",
    title: "Reserva tu prueba gratis",
    body:  "Eliges día y hora en menos de un minuto. Sin tarjeta, sin compromiso.",
    icon:  (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    n: "02",
    title: "Conoce a tu profesor",
    body:  "45 minutos online: te evalúa el nivel y arma un plan a tu medida.",
    icon:  (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 14c4 0 7 2 7 5v1H5v-1c0-3 3-5 7-5z" />
        <circle cx="12" cy="8" r="4" />
      </svg>
    ),
  },
  {
    n: "03",
    title: "Domina el alemán",
    body:  "Clases 1-a-1 + práctica con Hans 24/7 + certificado MCER al terminar.",
    icon:  (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="hidden md:block bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-warm">
            En tres pasos
          </span>
          <h2 className="mt-3 text-3xl lg:text-[40px] font-bold tracking-tight text-foreground leading-tight">
            Así de fácil empieza tu alemán
          </h2>
        </div>

        <div className="mt-14 grid lg:grid-cols-3 gap-6">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative">
              {/* Connector line between steps (desktop) */}
              {i < STEPS.length - 1 && (
                <div aria-hidden className="hidden lg:block absolute top-7 left-[calc(50%+2rem)] right-[-2rem] h-px bg-gradient-to-r from-warm/40 to-transparent" />
              )}
              <div className="relative rounded-3xl border border-border bg-card p-6 lg:p-7 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="h-12 w-12 rounded-2xl bg-warm/15 text-warm flex items-center justify-center">
                    {s.icon}
                  </div>
                  <span className="text-xs font-bold text-muted-foreground tracking-widest">
                    {s.n}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
