import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { VideosAdmin } from "./VideosAdmin";

/**
 * /admin/videos — gestión de la serie: subir MP4/JPG a R2 (navegador → R2
 * con URL firmada de PUT), publicar/ocultar episodios, ver valoraciones
 * y moderar comentarios. Los datos de los episodios vienen del seed
 * (scripts/seed-serie.ts); aquí solo se completan vídeo y portada.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Videos · Admin" };

export default async function AdminVideosPage() {
  await requireRole(["admin", "superadmin"]);
  const sb = supabaseAdmin();

  const [{ data: eps }, { data: ratings }, { data: comments }] = await Promise.all([
    sb.from("serie_episodes").select("id, number, slug, title_de, title_es, level, duration_s, video_url, poster_url, published").order("season").order("number"),
    sb.from("serie_episode_ratings").select("episode_id, stars"),
    sb.from("serie_episode_comments").select("id, episode_id, body, created_at, students!inner(users!inner(full_name))").is("deleted_at", null).order("created_at", { ascending: false }).limit(30),
  ]);

  const sum = new Map<string, { s: number; n: number }>();
  for (const r of (ratings ?? []) as Array<{ episode_id: string; stars: number }>) {
    const cur = sum.get(r.episode_id) ?? { s: 0, n: 0 }; cur.s += r.stars; cur.n += 1; sum.set(r.episode_id, cur);
  }
  const commentsByEp = new Map<string, number>();
  type RawComment = { id: string; episode_id: string; body: string; created_at: string; students: { users: { full_name: string | null } | { full_name: string | null }[] } | { users: { full_name: string | null } }[] };
  const rawComments = (comments ?? []) as unknown as RawComment[];
  for (const c of rawComments) commentsByEp.set(c.episode_id, (commentsByEp.get(c.episode_id) ?? 0) + 1);

  const episodes = ((eps ?? []) as Array<{ id: string; number: number; slug: string; title_de: string; title_es: string; level: string; duration_s: number | null; video_url: string | null; poster_url: string | null; published: boolean }>).map(e => {
    const r = sum.get(e.id);
    return { ...e, avg_stars: r ? Math.round((r.s / r.n) * 10) / 10 : null, ratings_count: r?.n ?? 0, comments_count: commentsByEp.get(e.id) ?? 0 };
  });
  const epByIdNum = new Map(episodes.map(e => [e.id, e] as const));

  const nameOf = (c: RawComment): string => {
    const st = Array.isArray(c.students) ? c.students[0] : c.students;
    const u = st ? (Array.isArray(st.users) ? st.users[0] : st.users) : null;
    return u?.full_name ?? "Estudiante";
  };
  const recent = rawComments.map(c => ({
    id: c.id, body: c.body, created_at: c.created_at, student_name: nameOf(c),
    episode_number: epByIdNum.get(c.episode_id)?.number ?? 0, episode_slug: epByIdNum.get(c.episode_id)?.slug ?? "",
  }));

  const done = episodes.filter(e => e.video_url && e.poster_url).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Videos · Serie temporada 1</h1>
        <p className="mt-1 text-sm text-slate-500">
          {done}/{episodes.length} capítulos con vídeo y portada. Los archivos se suben directamente desde tu navegador a R2
          (clave <code className="text-xs">serie/t1/&lt;slug&gt;.mp4|.jpg</code>). Si la subida falla con error de red, revisa el CORS del bucket.
        </p>
      </header>
      <VideosAdmin episodes={episodes} recent={recent} />
    </div>
  );
}
