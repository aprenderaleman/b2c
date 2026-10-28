-- 147: Sección "Videos" del estudiante — serie "Un dominicano en Alemania"
-- (temporada 1, A1). Vídeos y portadas en R2 (prefijo serie/t1/), mismo
-- bucket que las grabaciones; se firman con signRecordingUrl().
-- Seed de los 10 episodios: web/scripts/seed-serie.ts (desde SEASON1.json).

CREATE TABLE IF NOT EXISTS serie_episodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season      int  NOT NULL DEFAULT 1,
  number      int  NOT NULL,
  slug        text NOT NULL UNIQUE,
  title_de    text NOT NULL,
  title_es    text NOT NULL,
  level       text NOT NULL DEFAULT 'A1',
  topic       text,
  duration_s  int,
  video_url   text,
  poster_url  text,
  keywords    jsonb NOT NULL DEFAULT '[]'::jsonb,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, number)
);

CREATE TABLE IF NOT EXISTS serie_episode_ratings (
  episode_id  uuid NOT NULL REFERENCES serie_episodes(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  stars       int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, student_id)
);

CREATE TABLE IF NOT EXISTS serie_episode_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id  uuid NOT NULL REFERENCES serie_episodes(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS serie_episode_comments_episode_idx ON serie_episode_comments(episode_id, created_at);
