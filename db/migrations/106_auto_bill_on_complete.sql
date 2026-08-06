-- =============================================================================
-- Migration 106 — auto-compute billed_hours when a class is completed
-- =============================================================================
-- Problem: when a class is completed via moderation, admin, or any path
-- other than the /aula/[id]/end endpoint, billed_hours stays at 0.
-- The existing triggers (047, 081) only react AFTER billed_hours is set,
-- so teacher earnings and student remaining classes don't update.
--
-- Solution: a BEFORE trigger that computes billed_hours from the class
-- duration when status changes to 'completed' and billed_hours is still 0.
-- This runs BEFORE the existing AFTER triggers, so the cascade works:
--   1. This trigger sets billed_hours (BEFORE UPDATE)
--   2. Trigger 047 logs to class_hours_log + recomputes teacher_earnings
--   3. Trigger 081 recalculates student classes_remaining
--
-- Uses the same billing formula as web/lib/finance.ts computeBillingUnits:
--   < 15 min  → 0 (no charge)
--   15-75 min → 1
--   76-125    → 2
--   126-175   → 3
--   >= 176    → ceil(min / 50)
--
-- Duration source: actual_duration_minutes if set, else duration_minutes.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION tg_auto_bill_on_complete() RETURNS trigger AS $$
DECLARE
    dur int;
    units int;
BEGIN
    -- Only act when status is changing to 'completed'
    IF NEW.status <> 'completed' THEN
        RETURN NEW;
    END IF;

    -- Only act if billed_hours is not already set
    IF COALESCE(NEW.billed_hours, 0) > 0 THEN
        RETURN NEW;
    END IF;

    -- Skip trials (admin-run trials shouldn't auto-bill)
    IF COALESCE(NEW.is_trial, FALSE) = TRUE THEN
        RETURN NEW;
    END IF;

    -- Determine duration: prefer actual, fall back to planned
    dur := COALESCE(NEW.actual_duration_minutes, NEW.duration_minutes);

    IF dur IS NULL OR dur < 15 THEN
        RETURN NEW;
    END IF;

    -- Compute billing units (same formula as computeBillingUnits in finance.ts)
    IF dur <= 75 THEN
        units := 1;
    ELSIF dur <= 125 THEN
        units := 2;
    ELSIF dur <= 175 THEN
        units := 3;
    ELSE
        units := CEIL(dur::numeric / 50);
    END IF;

    NEW.billed_hours := units;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE UPDATE: so billed_hours is set before the AFTER triggers fire
DROP TRIGGER IF EXISTS auto_bill_on_complete ON classes;
CREATE TRIGGER auto_bill_on_complete
    BEFORE UPDATE OF status ON classes
    FOR EACH ROW
    WHEN (
        OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status = 'completed'
    )
    EXECUTE FUNCTION tg_auto_bill_on_complete();

COMMIT;
