-- 158: flag "No tiene WA" (Gelfis 2026-11-25). Leads que escribieron
-- mal su número o no tienen WhatsApp: el setter los marca y dejan de
-- aparecer en sus listas (urgentes + no-shows); los profes ven el tag
-- en la ficha del trial. El lead NO se descarta: su cita sigue en pie
-- y los emails le siguen llegando.
alter table leads add column if not exists sin_whatsapp boolean not null default false;
