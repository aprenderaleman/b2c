const CURSOS = [
  {
    nivel: "A1",
    title: "Deutsch A1",
    description:
      "Tu primer paso en el alemán. Aprende a presentarte, pedir en un restaurante, hacer compras y desenvolverte en situaciones cotidianas.",
    url: "https://schule.aprender-aleman.de/deutscha1",
    color: "from-emerald-500 to-teal-600",
    emoji: "🌱",
  },
  {
    nivel: "A2",
    title: "Deutsch A2",
    description:
      "Consolida las bases. Habla sobre tu rutina, haz planes con amigos, entiende instrucciones y participa en conversaciones sencillas.",
    url: "https://schule.aprender-aleman.de/deutscha2",
    color: "from-sky-500 to-blue-600",
    emoji: "🚀",
  },
  {
    nivel: "B1",
    title: "Deutsch B1",
    description:
      "El salto intermedio. Expresa opiniones, cuenta experiencias, entiende textos más largos y prepárate para el certificado B1.",
    url: "https://schule.aprender-aleman.de/deutschb1",
    color: "from-violet-500 to-purple-600",
    emoji: "📚",
  },
  {
    nivel: "B2",
    title: "Deutsch B2",
    description:
      "Domina la comunicación profesional. Argumenta, debate, escribe textos formales y comprende contenido complejo en alemán.",
    url: "https://schule.aprender-aleman.de/deutschb2",
    color: "from-amber-500 to-orange-600",
    emoji: "💼",
  },
  {
    nivel: "C1",
    title: "Deutsch C1",
    description:
      "Nivel avanzado. Comprende textos exigentes, exprésate con fluidez y precisión, y domina matices del idioma a nivel nativo.",
    url: "https://schule.aprender-aleman.de/deutschc1",
    color: "from-rose-500 to-red-600",
    emoji: "🎓",
  },
];

export function CursosGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {CURSOS.map((c) => (
        <a
          key={c.nivel}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-shadow hover:shadow-lg hover:shadow-slate-200/50 dark:hover:shadow-slate-900/50"
        >
          <div
            className={`flex items-center justify-center h-36 bg-gradient-to-br ${c.color} text-white`}
          >
            <span className="text-5xl" role="img" aria-label={c.title}>
              {c.emoji}
            </span>
          </div>

          <div className="flex flex-1 flex-col p-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                {c.nivel}
              </span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
              {c.title}
            </h2>
            <p className="mt-1 flex-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {c.description}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
              Ir al curso
              <span aria-hidden className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
