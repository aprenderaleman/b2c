-- =============================================================================
-- Migration 073 — allow duration_minutes = 0 for commissions/bonuses
-- =============================================================================
-- The original CHECK (duration_minutes > 0) blocks commission rows that use
-- duration_minutes = 0 as a marker. Drop and re-add with >= 0.
-- Also adds a "kind" column to distinguish class hours from commissions/bonuses.
-- =============================================================================

-- 1. Relax duration_minutes check
ALTER TABLE class_hours_log
  DROP CONSTRAINT IF EXISTS class_hours_log_duration_minutes_check;

ALTER TABLE class_hours_log
  ADD CONSTRAINT class_hours_log_duration_minutes_check CHECK (duration_minutes >= 0);

-- 2. Add kind column (default 'class' for existing rows)
ALTER TABLE class_hours_log
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'class';

-- 3. Drop the old UNIQUE on class_id alone
ALTER TABLE class_hours_log
  DROP CONSTRAINT IF EXISTS class_hours_log_class_id_key;

-- 4. New composite unique: one row per (class_id, kind)
CREATE UNIQUE INDEX IF NOT EXISTS class_hours_log_class_kind_uniq
  ON class_hours_log(class_id, kind);

-- 5. Update the trigger to use the new composite conflict target
CREATE OR REPLACE FUNCTION fn_log_class_hours()
RETURNS TRIGGER AS $$
DECLARE
    rate_cents       INTEGER;
    log_currency     TEXT;
    log_amount_cents INTEGER;
    log_rate         NUMERIC(10,2);
    is_individual    BOOLEAN;
BEGIN
    IF NEW.status <> 'completed' OR COALESCE(NEW.billed_hours, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    IF COALESCE(NEW.is_trial, FALSE) = TRUE THEN
        SELECT t.rate_individual_cents INTO rate_cents
          FROM teachers t WHERE t.id = NEW.teacher_id;
        IF rate_cents IS NULL OR rate_cents = 0 THEN
            RETURN NEW;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM class_hours_log WHERE class_id = NEW.id AND kind = 'class') THEN
        RETURN NEW;
    END IF;

    is_individual := (NEW.type = 'individual');
    SELECT
        CASE WHEN is_individual THEN t.rate_individual_cents ELSE t.rate_group_cents END,
        t.currency
      INTO rate_cents, log_currency
      FROM teachers t
     WHERE t.id = NEW.teacher_id;

    IF rate_cents IS NULL OR rate_cents = 0 THEN
        RETURN NEW;
    END IF;

    log_amount_cents := NEW.billed_hours * rate_cents;
    log_rate := rate_cents / 100.0;

    INSERT INTO class_hours_log
        (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, kind, created_at)
    VALUES
        (NEW.id, NEW.teacher_id, NEW.billed_hours * 50, log_rate, log_amount_cents,
         COALESCE(log_currency, 'EUR'), 'class', COALESCE(NEW.scheduled_at, now()))
    ON CONFLICT (class_id, kind) DO NOTHING;

    PERFORM recompute_teacher_month(NEW.teacher_id, NEW.scheduled_at);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
