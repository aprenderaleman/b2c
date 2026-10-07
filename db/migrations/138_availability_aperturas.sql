-- 138: Franjas puntuales de disponibilidad (petición profes 2026-10-08,
-- idea "robada de Preply").
--
-- La tabla de excepciones (migración 137) ahora distingue dos tipos:
--   'bloqueo'  → ese día/franja NO estoy (resta del motor, comportamiento actual)
--   'apertura' → ese día/franja SÍ estoy, solo esa fecha (se suma como
--                ventana extra sin tocar el horario semanal — evita el
--                "me reservaron también el martes siguiente")

alter table teacher_availability_exceptions
  add column if not exists kind text not null default 'bloqueo'
    check (kind in ('bloqueo', 'apertura'));

comment on column teacher_availability_exceptions.kind is
  'bloqueo = franja cerrada solo esa fecha; apertura = franja abierta solo esa fecha (no recurre).';
