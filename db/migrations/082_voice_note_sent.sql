BEGIN;
ALTER TABLE trial_class_scripts ADD COLUMN IF NOT EXISTS voice_note_sent_at timestamptz;
COMMIT;
