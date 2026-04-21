-- =============================================================================
-- Migration 030 — admin_broadcasts (mass communications log)
-- =============================================================================
-- Every send from /admin/comunicados writes one row here so we can:
--   • audit who sent what to whom
--   • show the admin a history of past broadcasts with per-recipient results
--   • re-drive a failed send later if needed (the resolved audience_filter
--     and message body are preserved verbatim)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS admin_broadcasts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    audience_filter   jsonb       NOT NULL,       -- the filter selection (kind, level, group_id, custom_emails, language…)
    subject           text        NOT NULL,       -- email subject line
    message_markdown  text        NOT NULL,       -- raw markdown body, same for email + whatsapp
    channels          text[]      NOT NULL,       -- {'email'}, {'whatsapp'}, or {'email','whatsapp'}
    total_recipients  integer     NOT NULL DEFAULT 0,
    ok_count          integer     NOT NULL DEFAULT 0,
    fail_count        integer     NOT NULL DEFAULT 0,
    results           jsonb       NOT NULL DEFAULT '[]'::jsonb
                                  -- [{ user_id, name, email, phone,
                                  --    email:    {ok, id|null, error|null} | null,
                                  --    whatsapp: {ok, id|null, error|null} | null }]
);

CREATE INDEX IF NOT EXISTS admin_broadcasts_created_idx
    ON admin_broadcasts(created_at DESC);

ALTER TABLE admin_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_ab" ON admin_broadcasts;
CREATE POLICY "service_role_all_ab" ON admin_broadcasts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE  admin_broadcasts IS
    'Log of every mass communication fired from /admin/comunicados.';
COMMENT ON COLUMN admin_broadcasts.audience_filter IS
    'Structured filter the admin chose. Shape: {kind, status?, level?, group_id?, custom_emails?, language?}.';
COMMENT ON COLUMN admin_broadcasts.results IS
    'Per-recipient outcome per channel. Lets the UI show ✓/✗ for each.';

COMMIT;
