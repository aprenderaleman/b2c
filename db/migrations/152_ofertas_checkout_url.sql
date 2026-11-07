-- 152: URL exacta del enlace de inscripción enviado al lead (Jonathan
-- 2026-11-07: los profes deben poder copiar el enlace desde la ficha de
-- la clase de prueba). Para ofertas individuales es reconstruible
-- (/pago/<ofertaId>), pero para Dúo/Trío el grp lleva el mes y hay que
-- conservar la URL original para no romper el emparejamiento.
alter table ofertas_enviadas add column if not exists checkout_url text;
