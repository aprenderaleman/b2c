-- 112: FK de tareas_closer con ON DELETE CASCADE (Gelfis 2026-08-15)
--
-- Borrar un lead desde admin fallaba con "viola la restricción
-- tareas_closer_lead_id_fkey" — la FK era NO ACTION. Una tarea de
-- closer sin su lead no tiene sentido, así que cascada.
-- (Ya aplicada a producción manualmente; este archivo documenta.)

ALTER TABLE tareas_closer DROP CONSTRAINT IF EXISTS tareas_closer_lead_id_fkey;
ALTER TABLE tareas_closer ADD CONSTRAINT tareas_closer_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
