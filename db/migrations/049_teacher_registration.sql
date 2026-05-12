-- ============================================================
-- Migration 049: Self-registration de profesores (invite-only)
-- ============================================================
--
-- Decisión Gelfis 2026-05-12: en lugar de crear cada profesor a mano
-- desde /admin/usuarios/nuevo, ahora hay un flujo invite-only:
--   1. Gelfis genera un link único en el admin.
--   2. El candidato abre el link, rellena un formulario público.
--   3. El sistema crea su `users` (active=false) + `teachers` con
--      todos los campos que él aportó.
--   4. Gelfis recibe notificación in-app, revisa y aprueba/rechaza.
--   5. Al aprobar, se genera password temporal y se le manda welcome
--      email — ahí ya puede entrar a /profesor.
--
-- Cambios DB:
--
--   1. NUEVA tabla `teacher_invitations` — códigos de invitación con
--      TTL de 7 días. Una invitación se consume cuando un candidato
--      la usa para registrarse. Las que no se usan en 7 días expiran.
--
--   2. COLUMNAS NUEVAS en `teachers` para los datos que el profe
--      aporta en el form:
--      - address               TEXT       — dirección postal
--      - country               TEXT       — ISO-2 (ES, DE, AT, CH…)
--      - levels_taught         TEXT[]     — ['A1','A2','B1','B2','C1','C2']
--      - hourly_rate_group     NUMERIC    — tarifa grupal acordada
--      - hourly_rate_individual NUMERIC   — tarifa individual acordada
--      - iban                  TEXT       — cuenta bancaria para cobros
--      - registered_self       BOOLEAN    — TRUE si vino del flujo
--                                            público, FALSE si creado
--                                            por admin (compat)
--      - approved_at           TIMESTAMPTZ — null hasta que admin aprueba
--      - approved_by           UUID       — admin que aprobó
--
--      El `hourly_rate` viejo se conserva para data histórica; los
--      flujos nuevos usan los dos campos separados.
-- ============================================================

CREATE TABLE IF NOT EXISTS teacher_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT UNIQUE NOT NULL,
    email           TEXT,                                          -- pre-fill opcional
    notes           TEXT,                                          -- memo interno admin
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    used_at         TIMESTAMPTZ,
    used_by_user_id UUID REFERENCES users(id),
    revoked_at      TIMESTAMPTZ                                    -- admin lo invalida manualmente
);

CREATE INDEX IF NOT EXISTS idx_teacher_invitations_code
    ON teacher_invitations(code);
CREATE INDEX IF NOT EXISTS idx_teacher_invitations_active
    ON teacher_invitations(created_at DESC)
    WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS address                TEXT,
    ADD COLUMN IF NOT EXISTS country                TEXT,
    ADD COLUMN IF NOT EXISTS levels_taught          TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS hourly_rate_group      NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS hourly_rate_individual NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS iban                   TEXT,
    ADD COLUMN IF NOT EXISTS registered_self        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS approved_at            TIMESTAMPTZ,
    -- approved_by SIN FK a users.id intencionalmente. Si añadimos la FK
    -- se crea una segunda relación teachers↔users (la primera es
    -- user_id) y PostgREST falla con PGRST201 ("more than one
    -- relationship") en TODOS los embeds `users!inner(...)` que hace la
    -- app sobre teachers (≥30 sitios). Para evitar tocar todos esos
    -- queries dejamos approved_by como UUID puro — solo nos sirve de
    -- audit trail, no necesita integridad referencial estricta.
    ADD COLUMN IF NOT EXISTS approved_by            UUID;

-- Índice para que el admin pueda listar rápido los "pendientes"
-- (filtra teachers donde registered_self=TRUE y approved_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_teachers_pending_approval
    ON teachers(created_at DESC)
    WHERE registered_self = TRUE AND approved_at IS NULL;
