"use client";

import { useLang } from "@/lib/lang-context";

type Row = { feature: string; us: string | true; babbel: string | true | false; duo: string | true | false; local: string | true | false };

const ROWS_ES: Row[] = [
  { feature: "Profesor nativo 1-a-1",     us: true, babbel: false, duo: false, local: "A veces" },
  { feature: "Habla español de apoyo",    us: true, babbel: false, duo: false, local: "A veces" },
  { feature: "Plan personalizado",         us: true, babbel: false, duo: false, local: false      },
  { feature: "Diploma MCER",              us: true, babbel: false, duo: false, local: true       },
  { feature: "Preparación Goethe / TELC", us: true, babbel: false, duo: false, local: true       },
  { feature: "Horario flexible",           us: true, babbel: true,  duo: true,  local: false      },
  { feature: "100% online",                us: true, babbel: true,  duo: true,  local: false      },
  { feature: "Práctica IA 24/7 (SCHULE)", us: true, babbel: false, duo: true,  local: false      },
  { feature: "Precio típico",              us: "Desde 17 €/h", babbel: "~10–13 €/mes (sin profe)", duo: "Gratis (sin profe)", local: "25–40 €/h" },
];

const ROWS_DE: Row[] = [
  { feature: "1-zu-1 mit Muttersprachler",      us: true, babbel: false, duo: false, local: "Manchmal" },
  { feature: "Spanisch als Stütze",             us: true, babbel: false, duo: false, local: "Manchmal" },
  { feature: "Individueller Plan",              us: true, babbel: false, duo: false, local: false       },
  { feature: "GER-Diplom",                       us: true, babbel: false, duo: false, local: true        },
  { feature: "Goethe / TELC Vorbereitung",      us: true, babbel: false, duo: false, local: true        },
  { feature: "Flexible Zeiten",                  us: true, babbel: true,  duo: true,  local: false       },
  { feature: "100% online",                      us: true, babbel: true,  duo: true,  local: false       },
  { feature: "KI-Praxis 24/7 (SCHULE)",          us: true, babbel: false, duo: true,  local: false       },
  { feature: "Typischer Preis",                  us: "Ab 17 €/Std.", babbel: "~10–13 €/Mon. (ohne Lehrer)", duo: "Gratis (ohne Lehrer)", local: "25–40 €/Std." },
];

const HEAD = {
  es: {
    eyebrow: "¿Por qué nosotros?",
    title:   "Comparado con las alternativas",
    sub:     "Sin trampas: cada herramienta brilla en lo suyo. Esto es lo que te llevas con cada una.",
    headerLocal: "Academia local",
    footnote: "Datos públicos de cada plataforma (abr 2026). Babbel y Duolingo no incluyen clases con profesor humano en sus planes estándar.",
    yes: "Sí", no: "No",
  },
  de: {
    eyebrow: "Warum wir?",
    title:   "Im Vergleich zu den Alternativen",
    sub:     "Ehrlich: jedes Tool glänzt in seinem Bereich. So sieht es bei jedem aus.",
    headerLocal: "Lokale Akademie",
    footnote: "Öffentliche Daten der jeweiligen Plattform (Apr 2026). Babbel und Duolingo bieten in ihren Standardplänen keinen menschlichen Unterricht.",
    yes: "Ja", no: "Nein",
  },
};

export function Comparativa() {
  const { lang } = useLang();
  const isDe = lang === "de";
  const head = HEAD[isDe ? "de" : "es"];
  const rows = isDe ? ROWS_DE : ROWS_ES;
  return (
    <section className="hidden md:block bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-warm">
            {head.eyebrow}
          </span>
          <h2 className="mt-3 text-3xl lg:text-[40px] font-bold tracking-tight text-foreground leading-tight">
            {head.title}
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            {head.sub}
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-section-muted text-left">
                  <th className="px-5 py-4 font-semibold text-muted-foreground" />
                  <th className="px-5 py-4 font-bold text-warm bg-warm/5 border-x border-warm/20">
                    Aprender-Aleman.de
                  </th>
                  <th className="px-5 py-4 font-semibold text-foreground/70">Babbel</th>
                  <th className="px-5 py-4 font-semibold text-foreground/70">Duolingo</th>
                  <th className="px-5 py-4 font-semibold text-foreground/70">{head.headerLocal}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.feature} className={i % 2 === 0 ? "bg-card" : "bg-section-muted/40"}>
                    <td className="px-5 py-3 font-medium text-foreground">{r.feature}</td>
                    <td className="px-5 py-3 bg-warm/5 border-x border-warm/20 font-semibold text-foreground">
                      <Cell value={r.us} highlight yes={head.yes} no={head.no} />
                    </td>
                    <td className="px-5 py-3 text-foreground/70"><Cell value={r.babbel} yes={head.yes} no={head.no} /></td>
                    <td className="px-5 py-3 text-foreground/70"><Cell value={r.duo}    yes={head.yes} no={head.no} /></td>
                    <td className="px-5 py-3 text-foreground/70"><Cell value={r.local}  yes={head.yes} no={head.no} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {head.footnote}
        </p>
      </div>
    </section>
  );
}

function Cell({ value, highlight = false, yes, no }: { value: string | true | false; highlight?: boolean; yes: string; no: string }) {
  if (value === true) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${highlight ? "text-warm" : "text-emerald-600 dark:text-emerald-400"}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12l5 5L20 7" />
        </svg>
        <span className="text-[13px] font-semibold">{yes}</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
        <span className="text-[13px]">{no}</span>
      </span>
    );
  }
  return <span className="text-[13px]">{value}</span>;
}
