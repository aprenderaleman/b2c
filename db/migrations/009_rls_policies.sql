-- =============================================================================
-- Migration 009 — Row-Level Security (RLS) for the new LMS tables
-- =============================================================================
-- Our server code always talks to Supabase with the service_role key (which
-- bypasses RLS by design), so these policies are defensive: they stop any
-- accidental anon/public access if someone ever queries the DB from the
-- browser or from a misconfigured client.
--
-- In later phases (teacher/student login via the API) we'll add more nuanced
-- policies that restrict rows by auth.uid(); for now a blanket "service_role
-- only" policy is correct and safe.
-- =============================================================================

BEGIN;

-- Enable RLS on every new table
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress        ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens   ENABLE ROW LEVEL SECURITY;

-- Helper macro: create a single policy per table that only allows service_role
-- Supabase's service_role bypasses RLS entirely, but making the policy explicit
-- means that if anyone switches to anon/auth'd keys the data stays locked.
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'users',
            'teachers',
            'students',
            'student_progress',
            'password_reset_tokens'
        ])
    LOOP
        EXECUTE format($f$
            DROP POLICY IF EXISTS "service_role_all_%I" ON %I;
            CREATE POLICY "service_role_all_%I" ON %I
                FOR ALL
                USING (auth.role() = 'service_role')
                WITH CHECK (auth.role() = 'service_role');
        $f$, tbl, tbl, tbl, tbl);
    END LOOP;
END $$;

COMMIT;
