-- Config keys para protecciones anti-ban del WhatsApp (Evolution).
-- Fix Gelfis 2026-08-01 tras auditoria post-3-bans consecutivos.
--
--   wa_daily_send_cap        → int. Máximo mensajes WA/día. Superado, solo
--                              pasan kinds transaccionales del kill switch.
--                              Default 300.
--   wa_night_gate_enabled    → 'true'/'false'. Si true, entre 22:00-08:00
--                              Europe/Berlin solo pasan T-30m y T-15m.
--                              Default 'true'.
--   wa_burst_cap_per_tick    → int. Máximo mensajes WA por ejecución de
--                              cron. Los crons respetan LIMIT en su query.
--                              Default 20.
--   wa_warmup_day            → int nullable. Día del warm-up del número
--                              nuevo (1-14). NULL = warm-up terminado.
--   wa_warmup_started_at     → timestamptz nullable. Fecha inicio warm-up.

INSERT INTO system_config (key, value) VALUES
  ('wa_daily_send_cap',     '300'),
  ('wa_night_gate_enabled', 'true'),
  ('wa_burst_cap_per_tick', '20'),
  ('wa_warmup_day',         ''),   -- string vacío = warm-up terminado
  ('wa_warmup_started_at',  '')
ON CONFLICT (key) DO NOTHING;
