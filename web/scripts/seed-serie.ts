/**
 * Seed/actualización de los episodios de la serie desde SEASON1.json.
 *   npx tsx --env-file=.env.local --env-file=.env.development.local scripts/seed-serie.ts
 * Idempotente (upsert por slug). Los vídeos y portadas se suben desde
 * /admin/videos (navegador → R2 con URL firmada); aquí solo van los datos.
 */
import { readFileSync } from "node:fs";

const MANIFEST = process.env.SERIE_MANIFEST ?? "C:/Users/gelfi/Desktop/serie_temporada1/SEASON1.json";

(async () => {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const sb = supabaseAdmin();
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    season: number; level: string;
    episodes: Array<{ number: number; slug: string; title_de: string; title_es: string; level?: string; schule_topic?: string; duration_s?: number;
      keywords?: Array<{ de: string; es: string; icon?: string }>; r2_key_video?: string; r2_key_poster?: string; video_url?: string; poster_url?: string }>;
  };

  // Las URLs de vídeo/portada se rellenan al subir desde /admin/videos
  // (URL firmada de PUT); el seed solo las fija si el manifiesto ya las trae.
  let n = 0;
  for (const e of m.episodes) {
    const row = {
      season: m.season ?? 1, number: e.number, slug: e.slug, title_de: e.title_de, title_es: e.title_es,
      level: e.level ?? m.level ?? "A1", topic: e.schule_topic ?? null, duration_s: e.duration_s != null ? Math.round(e.duration_s) : null,
      keywords: e.keywords ?? [],
      ...(e.video_url ? { video_url: e.video_url } : {}),
      ...(e.poster_url ? { poster_url: e.poster_url } : {}),
    };
    const { error } = await sb.from("serie_episodes").upsert(row, { onConflict: "slug" });
    if (error) { console.error("ERR", e.slug, error.message); continue; }
    n++;
  }
  console.log(`episodios sembrados/actualizados: ${n}`);
})();
