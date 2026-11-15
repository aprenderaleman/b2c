-- 162_deactivate_more_wa.sql — Gelfis 2026-11-15 (barrido anti-ban completo)
--
-- Continúa el apagado iniciado en 161. Templates WA que desactivamos:
--
--   chain3_obj_precio / pensarlo / pareja / tiempo (todas sub_n)
--     — objection chains post-trial; el flujo de objection se gestiona
--       ahora manualmente por el setter desde la cola post-trial.
--
--   chain5_reschedule (todas sub_n)
--     — legacy admin reschedule chain, reemplazado por sendRescheduleLinkMessage.
--
--   chain6_cancel (todas sub_n)
--     — cuando se cancela una clase: el cancel propio ya envía su
--       mensaje de "he cancelado tu clase". Chain redundante.
--
--   pack_milestone (todas sub_n, channel=whatsapp)
--     — hitos de progreso del estudiante (10/5/0 clases restantes).
--       Post-conversión → chat interno por regla Gelfis 2026-10-30.
--       El email del mismo kind se mantiene.
--
--   dormant_monthly_nudge (todas sub_n, channel=whatsapp)
--     — nudge mensual a leads dormidos. Riesgo de ban. Email-only.
--
-- NO tocados (pendiente de decisión Gelfis):
--   sesion_* (funnel /sesion-plan con closers — flujo distinto al trial).
--   chain8_* (closer Layer 2 — parte del funnel sesion-plan).
--
-- También cancelamos lead_chains activas de los tipos desactivados
-- para que chain-processor no las drene mientras existan.
--
-- Rollback: `git revert` y reaplicar active=true.

BEGIN;

UPDATE message_templates
   SET active = false,
       updated_at = NOW()
 WHERE channel = 'whatsapp'
   AND active = true
   AND kind IN (
     'chain3_obj_precio',
     'chain3_obj_pensarlo',
     'chain3_obj_pareja',
     'chain3_obj_tiempo',
     'chain5_reschedule',
     'chain6_cancel',
     'pack_milestone',
     'dormant_monthly_nudge'
   );

UPDATE lead_chains
   SET completed_at = NOW(),
       cancel_reason = 'wa_auto_scope_reduction_2026_11_15',
       updated_at = NOW()
 WHERE completed_at IS NULL
   AND chain_type IN (
     'chain3_obj_precio',
     'chain3_obj_pensarlo',
     'chain3_obj_pareja',
     'chain3_obj_tiempo',
     'chain5_reschedule',
     'chain6_cancel'
   );

COMMIT;
