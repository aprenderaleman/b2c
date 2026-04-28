/**
 * Slim band immediately under the hero. Two purposes:
 *   - Anchor credibility with the certifications visitors look for.
 *   - Show the stats Gelfis approved (cientos de alumnos, 90 %
 *     aprobado, resultados garantizados) right above the fold of the
 *     "details" section.
 *
 * Logos are typographic intentionally — we don't have licensed copies
 * of the Goethe / TELC marks, so styling them as a polished serif
 * mark with a tiny geometric icon avoids fake-logo territory while
 * still reading as a trust strip. The text under each clarifies what
 * the alignment is.
 */
export function TrustStrip() {
  return (
    <section className="hidden md:block bg-white dark:bg-slate-950 border-y border-border">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-10">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Reconocido en toda Europa · Resultados garantizados
        </p>

        {/* Cert marks */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 text-foreground/70">
          <CertMark
            title="MCER"
            subtitle="A1–C1 · Marco Común Europeo"
            icon={
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 2v6M16 24v6M2 16h6M24 16h6M5.6 5.6l4.2 4.2M22.2 22.2l4.2 4.2M5.6 26.4l4.2-4.2M22.2 9.8l4.2-4.2" />
              </svg>
            }
          />
          <Divider />
          <CertMark
            title="Goethe-Institut"
            subtitle="Examen oficial alineado"
            icon={
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 7h24v18H4z" />
                <path d="M4 11h24M10 7v18M22 7v18" />
              </svg>
            }
          />
          <Divider />
          <CertMark
            title="TELC"
            subtitle="Examen oficial alineado"
            icon={
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="16" cy="16" r="11" />
                <path d="M11 16l3.5 3.5L21 13" />
              </svg>
            }
          />
          <Divider />
          <CertMark
            title="DaF"
            subtitle="Profesores certificados"
            icon={
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 4l11 6-11 6L5 10z" />
                <path d="M9 13v8c0 2 4 4 7 4s7-2 7-4v-8" />
              </svg>
            }
          />
        </div>
      </div>
    </section>
  );
}

function CertMark({
  title, subtitle, icon,
}: { title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-foreground/80
                    grayscale opacity-80 hover:grayscale-0 hover:opacity-100
                    transition-all">
      <span className="text-warm">{icon}</span>
      <span className="flex flex-col leading-none">
        <span className="font-bold text-base tracking-tight text-foreground">{title}</span>
        <span className="mt-1 text-[10.5px] font-medium tracking-wide text-muted-foreground">{subtitle}</span>
      </span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="hidden lg:inline-block h-8 w-px bg-border" />;
}
