-- 123_setter_role.sql
-- Rol "setter": confirma, recuerda y rescata citas por voz. Sin tablas
-- nuevas: sus contactos viven en lead_contacts con actor_type='setter'
-- y dos action_type nuevos tipados (cola y metricas se derivan de ahi,
-- no de notas libres).

BEGIN;

-- 1. Ampliar enum user_role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'setter';

COMMIT;

-- ADD VALUE en un enum no puede ir en la misma TX que lo usa (patron 090).
BEGIN;

-- 2. lead_contacts.actor_type admite 'setter' (CHECK inline de 113 →
--    nombre autogenerado por Postgres).
ALTER TABLE lead_contacts
  DROP CONSTRAINT IF EXISTS lead_contacts_actor_type_check;
ALTER TABLE lead_contacts
  ADD CONSTRAINT lead_contacts_actor_type_check
  CHECK (actor_type IN ('closer', 'profesor', 'admin', 'stiv', 'lead', 'setter'));

-- 3. Dos action_type nuevos para las 3 jugadas del setter:
--    confirmar_cita   → llamada post-agenda ("confirmo y pregunto la meta")
--    recordatorio_cita → llamada/nota de voz el dia antes o el mismo dia
--    (el rescate reutiliza 'agendar_prueba', que ya existe)
ALTER TABLE lead_contacts
  DROP CONSTRAINT IF EXISTS lead_contacts_action_type_check;
ALTER TABLE lead_contacts
  ADD CONSTRAINT lead_contacts_action_type_check
  CHECK (action_type IN (
    'agendar_prueba', 'no_contesto', 'enviar_info', 'enviar_propuesta',
    'seguimiento_pactado', 'enviar_enlace', 'confirmar_pago', 'reactivacion',
    'asistio', 'no_show', 'feedback_profesor',
    'confirmar_cita', 'recordatorio_cita',
    'nota_libre', 'mensaje_stiv', 'mensaje_lead'
  ));

COMMIT;
