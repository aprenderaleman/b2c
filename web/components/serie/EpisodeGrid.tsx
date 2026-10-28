import Link from "next/link";
import { fmtDuration, type EpisodeCard } from "@/lib/serie";

/**
 * Rejilla de capítulos de la serie "Un dominicano en Alemania". Compartida
 * en /estudiante/videos (solo alumnos, Gelfis 2026-10-28). Las medias solo se
 * muestran en /admin/videos (Gelfis 2026-10-28).
 */
export function EpisodeGrid({ episodes, basePath }: { episodes: EpisodeCard[]; basePath: string }) {
  return (
    <main className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Serie · Temporada 1 · A1</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Un dominicano en Alemania</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Diez capítulos cortos con subtítulos en alemán y español. Míralos a tu ritmo, aprende el vocabulario de cada capítulo y cuéntanos qué te parecen.
        </p>
      </header>

      {episodes.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500">
          Los capítulos se están publicando. Vuelve en unos días.
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {episodes.map(e => (
            <Link key={e.id} href={`${basePath}/${e.slug}`}
                  className="group overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 dark:hover:border-brand-500">
              <div className="relative aspect-video bg-slate-200 dark:bg-slate-800">
                {e.poster_signed
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={e.poster_signed} alt={e.title_es} className="h-full w-full object-cover" loading="lazy" />
                  : <div className="flex h-full items-center justify-center text-4xl">🎬</div>}
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">Kapitel {e.number}</span>
                <span className="absolute right-3 top-3 rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-semibold text-white">{e.level}</span>
                {e.duration_s != null && <span className="absolute bottom-3 right-3 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-mono text-white">{fmtDuration(e.duration_s)}</span>}
              </div>
              <div className="p-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-50 group-hover:text-brand-600 dark:group-hover:text-brand-400">{e.title_de}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{e.title_es}</p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
