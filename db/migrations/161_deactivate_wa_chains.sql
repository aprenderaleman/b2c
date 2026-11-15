-- 161_deactivate_wa_chains.sql — Gelfis 2026-11-15
--
-- Desactiva todos los templates de WhatsApp que ya no deben salir
-- automáticamente. El universo de WA auto queda reducido a los 7
-- mensajes esenciales:
--   Pre-trial  (2): trial_confirmation, trial_reminder_2h
--   Post-trial (8): trial_attended_initial, trial_inscription_initial,
--                   trial_absent_initial, trial_reschedule_link,
--                   trial_{asistio,absent,reagendar,inscription}_fu24h
--   Post-conv  (1): welcome_week sub_n=1 (único)
--
-- Cadenas desactivadas (channel=whatsapp, active=false):
--   chain1_attended + bonus_vivo (todas las sub_n)
--   chain2_link_sent             (todas las sub_n)
--   chain4_absent + deposit + nodeposit (todas las sub_n)
--   welcome_week sub_n >= 2 (los steps 2-5 ya iban por chat en el motor,
--     esto es higiene — quedan por si alguien los llama por id)
--   welcome_week_celebration (toda, ya iba por chat)
--
-- Las filas activas en lead_chains de estos tipos también se cancelan
-- para que chain-processor no las drene mientras existan.
--
-- Rollback: `git revert` y re-UPDATE active=true de las filas afectadas.

BEGIN;

UPDATE message_templates
   SET active = false,
       updated_at = NOW()
 WHERE channel = 'whatsapp'
   AND active = true
   AND kind IN (
     'chain1_attended',
     'chain1_attended_bonus_vivo',
     'chain2_link_sent',
     'chain4_absent',
     'chain4_absent_deposit',
     'chain4_absent_nodeposit',
     'welcome_week_celebration'
   );

-- welcome_week: solo desactivar los WA para sub_n >= 2 (step 1 es el
-- único mensaje de bienvenida que mantenemos).
UPDATE message_templates
   SET active = false,
       updated_at = NOW()
 WHERE channel = 'whatsapp'
   AND active = true
   AND kind = 'welcome_week'
   AND sub_n >= 2;

-- Cancelar lead_chains activas de los tipos desactivados. El motor
-- chain-processor no las volverá a tocar (filter completed_at IS NULL
-- es su gate — al setearlo, sale del conjunto).
UPDATE lead_chains
   SET completed_at = NOW(),
       cancel_reason = 'wa_auto_scope_reduction_2026_11_15',
       updated_at = NOW()
 WHERE completed_at IS NULL
   AND chain_type IN (
     'chain1_attended',
     'chain2_link_sent',
     'chain4_absent'
   );

COMMIT;
