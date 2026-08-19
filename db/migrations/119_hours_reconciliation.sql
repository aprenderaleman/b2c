-- Migration 119: Automatic hours reconciliation
--
-- Adds a SQL function that finds completed classes with billed_hours=0
-- that have evidence of actually happening (recording, timer, or
-- actual_duration), and bills them using the standard 50-min-unit rule.
-- The existing AFTER trigger (047) handles class_hours_log + earnings.

CREATE OR REPLACE FUNCTION reconcile_unbilled_classes(
  p_month_start DATE DEFAULT date_trunc('month', NOW())::date
)
RETURNS TABLE(
  class_id       UUID,
  teacher_id     UUID,
  teacher_name   TEXT,
  title          TEXT,
  scheduled_at   TIMESTAMPTZ,
  duration_min   INT,
  actual_min     INT,
  has_recording  BOOLEAN,
  has_timer      BOOLEAN,
  computed_bh    INT,
  action         TEXT
) AS $$
DECLARE
  p_month_end DATE := (p_month_start + INTERVAL '1 month')::date;
  r RECORD;
  dur INT;
  units INT;
BEGIN
  FOR r IN
    SELECT c.id AS cid,
           c.teacher_id AS tid,
           u.full_name AS tname,
           c.title AS ctitle,
           c.scheduled_at AS sched,
           c.duration_minutes AS plan_min,
           c.actual_duration_minutes AS act_min,
           c.started_at,
           c.ended_at,
           c.is_trial,
           (SELECT COUNT(*) FROM recordings rec
            WHERE rec.class_id = c.id AND rec.status = 'ready') AS rec_count
    FROM classes c
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = t.user_id
    WHERE c.status = 'completed'
      AND COALESCE(c.billed_hours, 0) = 0
      AND c.is_trial = FALSE
      AND u.role = 'teacher'
      AND c.scheduled_at >= p_month_start
      AND c.scheduled_at < p_month_end
    ORDER BY c.scheduled_at
  LOOP
    class_id      := r.cid;
    teacher_id    := r.tid;
    teacher_name  := r.tname;
    title         := r.ctitle;
    scheduled_at  := r.sched;
    duration_min  := r.plan_min;
    actual_min    := r.act_min;
    has_recording := r.rec_count > 0;
    has_timer     := r.started_at IS NOT NULL OR r.ended_at IS NOT NULL;

    -- Determine effective duration
    IF r.act_min IS NOT NULL AND r.act_min > 0 THEN
      dur := r.act_min;
    ELSIF r.started_at IS NOT NULL AND r.ended_at IS NOT NULL THEN
      dur := EXTRACT(EPOCH FROM (r.ended_at - r.started_at))::int / 60;
    ELSE
      dur := r.plan_min;
    END IF;

    -- Skip if actual_duration explicitly set to < 15 (no-show / accidental)
    IF r.act_min IS NOT NULL AND r.act_min < 15 THEN
      computed_bh := 0;
      action := 'skip_short';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Compute billing units (same rule as tg_auto_bill_on_complete)
    IF dur < 15 THEN
      units := 0;
    ELSIF dur <= 75 THEN
      units := 1;
    ELSIF dur <= 125 THEN
      units := 2;
    ELSIF dur <= 175 THEN
      units := 3;
    ELSE
      units := CEIL(dur::numeric / 50)::int;
    END IF;

    computed_bh := units;

    -- Decide action based on evidence
    IF r.rec_count > 0 THEN
      -- Has recording = strong evidence → auto-bill
      action := 'auto_bill';
    ELSIF r.act_min IS NOT NULL AND r.act_min >= 15 THEN
      -- Has actual_duration >= 15 = evidence → auto-bill
      action := 'auto_bill';
    ELSIF r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) >= 900 THEN
      -- Timer ran >= 15 min = evidence → auto-bill
      action := 'auto_bill';
    ELSE
      -- No evidence → flag for manual review
      action := 'needs_review';
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
