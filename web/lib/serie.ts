import { supabaseAdmin } from "@/lib/supabase";
import { signRecordingUrl } from "@/lib/r2";

/**
 * Serie "Un dominicano en Alemania" (sección Videos del estudiante,
 * Gelfis 2026-10-28). Episodios en R2 (privado); las URLs se firman al
 * servir igual que las grabaciones.
 */
export type Keyword = { de: string; es: string; icon?: string };
export type Episode = {
  id: string; season: number; number: number; slug: string; title_de: string; title_es: string;
  level: string; topic: string | null; duration_s: number | null; video_url: string | null; poster_url: string | null;
  keywords: Keyword[]; published: boolean;
};
export type EpisodeCard = Episode & { avg_stars: number | null; ratings_count: number; my_stars: number | null; poster_signed: string | null };
export type Comment = { id: string; body: string; created_at: string; student_name: string; mine: boolean };

const SIGN_TTL = 6 * 3600; // 6 h: suficiente para ver un episodio y la página sigue viva

export async function listEpisodes(studentId: string | null): Promise<EpisodeCard[]> {
  const sb = supabaseAdmin();
  const { data: eps } = await sb.from("serie_episodes").select("*").eq("published", true).order("season").order("number");
  const episodes = (eps ?? []) as Episode[];
  if (episodes.length === 0) return [];
  const ids = episodes.map(e => e.id);
  const { data: ratings } = await sb.from("serie_episode_ratings").select("episode_id, student_id, stars").in("episode_id", ids);
  const agg = new Map<string, { sum: number; n: number; mine: number | null }>();
  for (const r of (ratings ?? []) as Array<{ episode_id: string; student_id: string; stars: number }>) {
    const a = agg.get(r.episode_id) ?? { sum: 0, n: 0, mine: null };
    a.sum += r.stars; a.n++; if (studentId && r.student_id === studentId) a.mine = r.stars;
    agg.set(r.episode_id, a);
  }
  return Promise.all(episodes.map(async e => {
    const a = agg.get(e.id);
    return {
      ...e,
      avg_stars: a && a.n ? Math.round((a.sum / a.n) * 10) / 10 : null,
      ratings_count: a?.n ?? 0,
      my_stars: a?.mine ?? null,
      poster_signed: e.poster_url ? await signRecordingUrl(e.poster_url, SIGN_TTL).catch(() => null) : null,
    };
  }));
}

export async function getEpisode(slug: string, studentId: string | null): Promise<(EpisodeCard & { video_signed: string | null; prev: Episode | null; next: Episode | null }) | null> {
  const all = await listEpisodes(studentId);
  const i = all.findIndex(e => e.slug === slug);
  if (i < 0) return null;
  const e = all[i];
  return {
    ...e,
    video_signed: e.video_url ? await signRecordingUrl(e.video_url, SIGN_TTL).catch(() => null) : null,
    prev: i > 0 ? all[i - 1] : null,
    next: i < all.length - 1 ? all[i + 1] : null,
  };
}

export async function rateEpisode(episodeId: string, studentId: string, stars: number): Promise<void> {
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  const { error } = await supabaseAdmin().from("serie_episode_ratings")
    .upsert({ episode_id: episodeId, student_id: studentId, stars: s, updated_at: new Date().toISOString() }, { onConflict: "episode_id,student_id" });
  if (error) throw new Error(error.message);
}

export async function addComment(episodeId: string, studentId: string, body: string): Promise<Comment> {
  const sb = supabaseAdmin();
  const clean = body.trim().slice(0, 1000);
  const { data, error } = await sb.from("serie_episode_comments").insert({ episode_id: episodeId, student_id: studentId, body: clean }).select("id, body, created_at").single();
  if (error || !data) throw new Error(error?.message ?? "insert_failed");
  const { data: st } = await sb.from("students").select("users!inner(full_name)").eq("id", studentId).maybeSingle();
  const name = ((st as { users: { full_name: string | null } | Array<{ full_name: string | null }> } | null)?.users);
  const full = (Array.isArray(name) ? name[0]?.full_name : name?.full_name) ?? "Estudiante";
  const row = data as { id: string; body: string; created_at: string };
  return { id: row.id, body: row.body, created_at: row.created_at, student_name: shortName(full), mine: true };
}

export async function listComments(episodeId: string, studentId: string | null): Promise<Comment[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("serie_episode_comments")
    .select("id, body, created_at, student_id, students!inner(users!inner(full_name))")
    .eq("episode_id", episodeId).is("deleted_at", null).order("created_at", { ascending: true }).limit(200);
  return ((data ?? []) as Array<{ id: string; body: string; created_at: string; student_id: string; students: unknown }>).map(r => {
    const s = (Array.isArray(r.students) ? r.students[0] : r.students) as { users: { full_name: string | null } | Array<{ full_name: string | null }> } | undefined;
    const u = s ? (Array.isArray(s.users) ? s.users[0] : s.users) : undefined;
    return { id: r.id, body: r.body, created_at: r.created_at, student_name: shortName(u?.full_name ?? "Estudiante"), mine: r.student_id === studentId };
  });
}

export async function hideComment(commentId: string): Promise<void> {
  await supabaseAdmin().from("serie_episode_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
}

/** "María De Los Ángeles Lezcano" → "María L." (privacidad entre alumnos). */
export function shortName(full: string): string {
  const p = full.trim().split(/\s+/);
  if (p.length <= 1) return full;
  return `${p[0]} ${p[p.length - 1][0]}.`;
}

export function fmtDuration(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")} min`;
}
