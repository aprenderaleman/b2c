-- 151: acuerdos especiales (caso Lydia 2026-11-05)
--  acuerdo_cierre      → la cuenta queda FUERA de todo flujo automático
--                        (hitos de pack, baja automática por saldo 0,
--                        avisos de inactividad, alertas de retención).
--  acuerdo_cierre_nota → etiqueta visible en admin ("Acuerdo de cierre — no facturar").
--  access_until        → fecha fija de expiración: el cron pack-alerts da de
--                        baja la cuenta (status expired) cuando ya pasó.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS acuerdo_cierre      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acuerdo_cierre_nota text,
  ADD COLUMN IF NOT EXISTS access_until        date;

CREATE INDEX IF NOT EXISTS students_access_until_idx
  ON public.students (access_until) WHERE access_until IS NOT NULL;
