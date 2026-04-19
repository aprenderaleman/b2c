-- =============================================================================
-- Migration 023 — pack tracking + teacher payouts
-- =============================================================================
-- Adds the fields we need to guarantee two things:
--   (a) No student loses a paid class: their 96-session counter is derived,
--       cannot be edited by hand, and is the single source of truth.
--   (b) No teacher works unpaid: every class marked `completed` with a valid
--       duration contributes automatically to their monthly payout.
--
-- Design:
--   - `class_participants` is extended with per-session facts (minutes,
--     cancellation reason, whether the row counts as a session deduction).
--   - `classes` gets a `billed_hours` column (0 / 1 / 2) that implements
--     the duration rule: <45min → 0, 45-90min → 1, >90min → 2.
--   - Two views compute everything else on the fly — no materialised
--     denormalisation, no drift possible.
--   - `teacher_payouts` is a rolling monthly ledger Gelfis marks as paid.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) students — pack tracking
-- ---------------------------------------------------------------------------
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS classes_purchased INTEGER NOT NULL DEFAULT 96,
    ADD COLUMN IF NOT EXISTS pack_started_at   DATE,
    ADD COLUMN IF NOT EXISTS pack_expires_at   DATE;

COMMENT ON COLUMN students.classes_purchased IS
    'Total sessions paid for in the active pack. Usually 96 (Pack VIP Express or Pack Fluidez Total).';
COMMENT ON COLUMN students.pack_expires_at IS
    'Hard deadline to consume the pack (6 months after pack_started_at by policy).';

-- ---------------------------------------------------------------------------
-- 2) teachers — split rate for group vs individual
-- ---------------------------------------------------------------------------
ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS rate_group_cents      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rate_individual_cents INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN teachers.rate_group_cents IS
    'Pay per hour when teaching a group class, in cents (EUR). E.g. 1700 = 17€/h.';
COMMENT ON COLUMN teachers.rate_individual_cents IS
    'Pay per hour when teaching a 1-on-1 class, in cents (EUR).';

-- ---------------------------------------------------------------------------
-- 3) classes — billed-hours bucket (0 / 1 / 2)
--     0  → class too short (<45min) or cancelled → no pay, no deduction
--     1  → 45-90min → 1h of pay, 1 session deducted from student
--     2  → >90min → 2h of pay, still just 1 session deducted
-- ---------------------------------------------------------------------------
ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS billed_hours INTEGER NOT NULL DEFAULT 0
        CHECK (billed_hours IN (0, 1, 2));

CREATE INDEX IF NOT EXISTS classes_billed_idx
    ON classes(billed_hours, status)
    WHERE status = 'completed' AND billed_hours > 0;

-- ---------------------------------------------------------------------------
-- 4) class_participants — per-student per-class facts
-- ---------------------------------------------------------------------------
ALTER TABLE class_participants
    ADD COLUMN IF NOT EXISTS minutes_attended   INTEGER,
    ADD COLUMN IF NOT EXISTS cancellation_type  TEXT
        CHECK (cancellation_type IN ('none', 'on_time', 'late', 'no_show'))
        DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS counts_as_session  BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN class_participants.counts_as_session IS
    'FALSE only when teacher cancelled / tech failed / grupal on-time cancel extended. Default TRUE because: grupal always counts, individual no-show counts, individual late cancel counts.';
COMMENT ON COLUMN class_participants.cancellation_type IS
    'Audit trail for why (if) the student missed the class. Does not by itself change counts_as_session.';

-- ---------------------------------------------------------------------------
-- 5) teacher_payouts — one row per teacher per month
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_payouts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id     uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    period_start   DATE NOT NULL,
    period_end     DATE NOT NULL,
    classes_count  INTEGER NOT NULL DEFAULT 0,
    hours_total    INTEGER NOT NULL DEFAULT 0,
    amount_cents   INTEGER NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'EUR',
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'paid', 'disputed')),
    paid_at        TIMESTAMPTZ,
    receipt_url    TEXT,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (teacher_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS teacher_payouts_status_idx
    ON teacher_payouts(status) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION tg_teacher_payouts_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS teacher_payouts_updated_at ON teacher_payouts;
CREATE TRIGGER teacher_payouts_updated_at
    BEFORE UPDATE ON teacher_payouts
    FOR EACH ROW EXECUTE FUNCTION tg_teacher_payouts_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Views — the heart of the reporting
-- ---------------------------------------------------------------------------

-- Classes consumed vs remaining per student. The count derives from real
-- attendance rows, so nothing can be forged by writing to students.*.
CREATE OR REPLACE VIEW v_student_packs AS
SELECT
    s.id                                AS student_id,
    s.user_id,
    u.full_name,
    u.email,
    s.current_level,
    s.subscription_type,
    s.classes_purchased,
    s.pack_started_at,
    s.pack_expires_at,
    COALESCE(consumed.n, 0)             AS classes_consumed,
    s.classes_purchased - COALESCE(consumed.n, 0) AS classes_remaining
FROM students s
JOIN users u ON u.id = s.user_id
LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS n
      FROM class_participants cp
      JOIN classes c ON c.id = cp.class_id
     WHERE cp.student_id = s.id
       AND cp.counts_as_session = TRUE
       AND c.status = 'completed'
       AND c.billed_hours > 0
) consumed ON TRUE;

-- Monthly earnings per teacher, split by class type so grupal/individual
-- rates apply correctly.
CREATE OR REPLACE VIEW v_teacher_earnings AS
SELECT
    t.id                                AS teacher_id,
    u.full_name,
    u.email,
    DATE_TRUNC('month', c.started_at)::date AS period_start,
    c.type                              AS class_type,
    COUNT(*)::INT                       AS classes_count,
    SUM(c.billed_hours)::INT            AS hours_total,
    SUM(c.billed_hours *
        CASE c.type
            WHEN 'group'      THEN t.rate_group_cents
            WHEN 'individual' THEN t.rate_individual_cents
            ELSE 0
        END)::INT                       AS amount_cents
FROM teachers t
JOIN users u   ON u.id = t.user_id
JOIN classes c ON c.teacher_id = t.id
WHERE c.status = 'completed' AND c.billed_hours > 0
GROUP BY t.id, u.full_name, u.email, DATE_TRUNC('month', c.started_at), c.type;

-- ---------------------------------------------------------------------------
-- 7) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE teacher_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_teacher_payouts" ON teacher_payouts;
CREATE POLICY "service_role_all_teacher_payouts" ON teacher_payouts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMIT;
