import Link from "next/link";
import { fmtDuration, type Comment, type getEpisode } from "@/lib/serie";
import { EpisodeInteractions } from "./EpisodeInteractions";

type EpisodeFull = NonNullable<Awaited<ReturnType<typeof getEpisode>>>;

/** Detalle de un capítulo: player, vocabulario, valoración y comentarios. */
export function EpisodeView({ ep, comments, canInteract, basePath }: { ep: EpisodeFull; comments: Comment[]; canInteract: boolean; basePath: string }) {
  return (
    <main className="space-y-5">
      <Link href={basePath} className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">← Todos los capítulos</Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Kapitel {ep.number} · {ep.level} · {fmtDuration(ep.duration_s)}</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{ep.title_de}</h1>
        <p className="text-slate-500 dark:text-slate-400">{ep.title_es}</p>
        {ep.topic && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tema SCHULE: {ep.topic}</p>}
      </header>

      {ep.video_signed ? (
        <div className="overflow-hidden rounded-2xl bg-black ring-1 ring-slate-800">
          <video src={ep.video_signed} poster={ep.poster_signed ?? undefined} controls playsInline preload="metadata" className="h-auto max-h-[80vh] w-full bg-black" />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500">Este capítulo se está publicando. Vuelve en unos días.</div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex gap-2">
          {ep.prev && <Link href={`${basePath}/${ep.prev.slug}`} className="btn-secondary text-xs">← Kapitel {ep.prev.number}</Link>}
          {ep.next && <Link href={`${basePath}/${ep.next.slug}`} className="btn-secondary text-xs">Kapitel {ep.next.number} →</Link>}
        </div>
      </div>

      {ep.keywords.length > 0 && (
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Vocabulario del capítulo</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ep.keywords.map((k, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2">
                <span className="text-xl" aria-hidden>{k.icon ?? "•"}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">{k.de}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{k.es}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EpisodeInteractions slug={ep.slug} myStars={ep.my_stars} initialComments={comments} canInteract={canInteract} />
    </main>
  );
}
