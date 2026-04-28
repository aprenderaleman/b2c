"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Numbers Gelfis approved on 2026-04-28: cientos de alumnos activos,
 * 90 % aprueba los exámenes oficiales, resultados garantizados. We
 * keep them honest — no fake precision (we don't claim "503") and
 * we anchor each cifra with a one-line clarifier.
 *
 * Counts animate on first scroll-into-view (IntersectionObserver) so
 * the section feels alive without auto-playing on page load.
 */
type Stat = {
  value:   number;
  suffix?: string;
  label:   string;
  hint:    string;
  // For non-numeric stats ("garantizado") we render `display` directly
  // and skip the count-up.
  display?: string;
};

const STATS: Stat[] = [
  {
    value:   500,
    suffix:  "+",
    label:   "alumnos activos",
    hint:    "Hispanohablantes aprendiendo alemán con nosotros este año.",
  },
  {
    value:   90,
    suffix:  "%",
    label:   "aprueba el examen oficial",
    hint:    "Goethe / TELC a la primera. Plan a medida + práctica guiada.",
  },
  {
    value:   8,
    suffix:  " países",
    label:   "estudiando con nosotros",
    hint:    "Latinoamérica, España y los hispanos ya en DACH.",
  },
  {
    value:   0,
    display: "✓",
    label:   "Resultados garantizados",
    hint:    "Si no llegas a tu objetivo en el plazo acordado, repites las clases que falten sin coste.",
  },
];

export function StatsBand() {
  return (
    <section className="hidden md:block bg-section-muted dark:bg-slate-950 border-b border-border">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-16 lg:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-warm">
            Resultados
          </span>
          <h2 className="mt-3 text-3xl lg:text-[40px] font-bold tracking-tight text-foreground leading-tight">
            Cientos de alumnos. <span className="text-warm">Resultados reales.</span>
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          {STATS.map((s, i) => <StatCard key={i} stat={s} index={i} />)}
        </div>
      </div>
    </section>
  );
}

function StatCard({ stat, index }: { stat: Stat; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { threshold: 0.4 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="text-center">
      <div className="text-5xl lg:text-[56px] font-extrabold tracking-tight text-foreground leading-none">
        {stat.display
          ? <span className="text-warm">{stat.display}</span>
          : <>
              <CountUp to={stat.value} active={visible} delayMs={index * 120} />
              {stat.suffix && <span className="text-warm">{stat.suffix}</span>}
            </>}
      </div>
      <div className="mt-3 text-sm font-semibold text-foreground">{stat.label}</div>
      <div className="mt-1 text-xs text-muted-foreground max-w-[14rem] mx-auto leading-relaxed">
        {stat.hint}
      </div>
    </div>
  );
}

/** Cheap CountUp — easeOutCubic over ~1.2s, RAF-driven. */
function CountUp({ to, active, delayMs = 0 }: { to: number; active: boolean; delayMs?: number }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let start = 0;
    const dur = 1200;
    const startTime = performance.now() + delayMs;
    const tick = (t: number) => {
      if (t < startTime) { raf = requestAnimationFrame(tick); return; }
      if (!start) start = t;
      const elapsed = Math.min(1, (t - startTime) / dur);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setN(Math.round(to * eased));
      if (elapsed < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, to, delayMs]);

  return <>{n.toLocaleString("es-ES")}</>;
}
