-- 154: registro de reproducciones de la serie (Gelfis 2026-11-08).
-- Una fila por estudiante+capítulo: cuándo empezó, última vez, nº de
-- plays y % máximo alcanzado. Alimentará las métricas de la serie.
create table if not exists serie_episode_plays (
  episode_id      uuid not null references serie_episodes(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  first_played_at timestamptz not null default now(),
  last_played_at  timestamptz not null default now(),
  play_count      int not null default 1,
  max_pct         int not null default 0,
  primary key (episode_id, student_id)
);
