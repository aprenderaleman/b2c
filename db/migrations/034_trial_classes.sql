-- =============================================================================
-- Migration 034 — native trial-class booking flow
-- =============================================================================
-- The funnel now lets a lead self-book a 45-minute "clase de prueba"
-- without leaving the site. The lead stays a lead (no user/student
-- account is created until they pay) — they enter the live aula via a
-- magic-link cookie scoped to that single class.
--
-- Schema additions:
--   * teachers.accepts_trials  — only flagged teachers receive trial
--                                bookings via the rotation algorithm.
--   * classes.is_trial         — distinguishes trial classes from real
--                                ones in lists, billing, etc.
--   * classes.lead_id          — for trial classes, points at the lead
--                                who booked. NULL for normal classes
--                                (which use class_participants instead).
--
-- Bootstrap: only Gelfis (superadmin) is initially eligible for trial
-- routing, matching today's behaviour. Toggle others on from
-- /admin/profesores/[id].
-- =============================================================================

BEGIN;

ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS accepts_trials boolean NOT NULL DEFAULT false;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS lead_id  uuid REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS classes_is_trial_idx
    ON classes(is_trial) WHERE is_trial = true;
CREATE INDEX IF NOT EXISTS classes_lead_id_idx
    ON classes(lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN teachers.accepts_trials IS
    'When true, the teacher is part of the trial-class rotation pool. Admin toggles per-teacher in /admin/profesores/[id].';
COMMENT ON COLUMN classes.is_trial IS
    'True for the 45-minute "clase de prueba" booked from the public funnel. Excluded from billable-hours rollups.';
COMMENT ON COLUMN classes.lead_id IS
    'For trial classes only. Points at the lead who booked. The lead has no user account yet — magic-link cookie grants aula access.';

-- Bootstrap the existing superadmin so the rotation isn't empty on day 1.
UPDATE teachers t
   SET accepts_trials = true
  FROM users u
 WHERE t.user_id = u.id
   AND u.role = 'superadmin';

COMMIT;
