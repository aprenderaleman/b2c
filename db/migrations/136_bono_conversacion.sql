-- 136: Bono de clase de conversación gratis (Gelfis 2026-09-30)
--
-- Oferta: si el lead convierte dentro de las 48h posteriores a asistir a
-- su clase de prueba, gana una clase de conversación gratis.
--   - bono_conversacion_at:       cuándo GANÓ el bono (null = sin bono)
--   - bono_conversacion_usada_at: cuándo se dio/agendó la clase (null = pendiente)
--
-- La promesa viaja en chain1_attended variante _bonus_vivo (bonus_activo=true
-- desde markTrialAttendedNoLink); el derecho se registra en convertLeadToStudent.

alter table students
  add column if not exists bono_conversacion_at timestamptz,
  add column if not exists bono_conversacion_usada_at timestamptz;

comment on column students.bono_conversacion_at is
  'Ganó el bono de clase de conversación gratis (convirtió <=48h post-trial). Null = sin bono.';
comment on column students.bono_conversacion_usada_at is
  'Cuándo se agendó/dio la clase de conversación del bono. Null = pendiente.';
