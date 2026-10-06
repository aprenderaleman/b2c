-- 137: Bloqueos puntuales de disponibilidad (Gelfis 2026-10-06, fase 2
-- del plan de agendado).
--
-- La disponibilidad semanal (teacher_availability) no sabe de fechas
-- concretas. Esta tabla guarda excepciones puntuales ("el lunes 4/5 de
-- 17:00 a 18:00 no estoy") que el motor de huecos resta como si fueran
-- clases ocupadas: afectan al funnel de trials y al agendado self-service
-- de alumnos (fase 3). Horas en reloj de Berlín, igual que
-- teacher_availability.

create table if not exists teacher_availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers(id) on delete cascade,
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint tae_end_after_start check (end_time > start_time)
);

create index if not exists tae_teacher_date_idx
  on teacher_availability_exceptions (teacher_id, date);

comment on table teacher_availability_exceptions is
  'Bloqueos puntuales de disponibilidad por fecha (hora Berlín). El motor de slots los resta como intervalos ocupados.';
