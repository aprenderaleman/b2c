import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { getEpisode, listComments, fmtDuration } from "@/lib/serie";
import { EpisodeInteractions } from "./EpisodeInteractions";
import { Stars } from "../Stars";

export const dynamic = "force-dynamic";

export default async function EpisodePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireRoleWithImpersonation(["student", "admin", "superadmin"], "student");
  const student = await getStudentByUserId(session.user.id);
  const ep = await getEpisode(slug, student?.id ?? null);
  if (!ep) notFound();
  const comments = await listComments(ep.id, student?.id ?? null);
  const canInteract = session.user.role === "student" && !!student;

  return (
    <main className="space-y-5">
      <Link href="/estudiante/videos" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">← Todos los capítulos</Link>

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Stars value={ep.avg_stars ?? 0} />
          <span>{ep.ratings_count > 0 ? `${ep.avg_stars} de 5 · ${ep.ratings_count} valoración${ep.ratings_count === 1 ? "" : "es"}` : "Sé el primero en valorarlo"}</span>
        </div>
        <div className="flex gap-2">
          {ep.prev && <Link href={`/estudiante/videos/${ep.prev.slug}`} className="btn-secondary text-xs">← Kapitel {ep.prev.number}</Link>}
          {ep.next && <Link href={`/estudiante/videos/${ep.next.slug}`} className="btn-secondary text-xs">Kapitel {ep.next.number} →</Link>}
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
