-- =============================================================================
-- Migration 070 — trial_assigned notification type
-- =============================================================================
-- Adds the 'trial_assigned' value to the notification_type enum so teachers
-- receive an in-app bell notification when a trial class is booked for them.
-- Also backfills other values that exist in TypeScript but may be missing
-- from the DB enum.
-- =============================================================================

BEGIN;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trial_assigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'class_reminder_30m';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'teacher_pending_approval';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'lead_new_urgent';

COMMIT;
