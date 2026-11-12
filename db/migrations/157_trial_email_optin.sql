-- 157: excepción al opt-out de notificaciones (Gelfis 2026-11-12, caso
-- Sabine). Con notifications_opt_out=true el usuario no recibe ningún
-- email ni aviso in-app; con trial_email_optin=true el correo de "nueva
-- clase de prueba asignada" SÍ se le envía (1 por trial). No afecta a
-- nadie más: default false.
alter table users add column if not exists trial_email_optin boolean not null default false;

-- Registro de avisos de trial ya enviados a cada profe: la PK garantiza
-- 1 solo aviso (in-app + email) por clase y usuario, incluso con
-- reintentos o dobles llamadas. Se usa como lock de idempotencia.
create table if not exists trial_teacher_notices (
  class_id   uuid not null references classes(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
