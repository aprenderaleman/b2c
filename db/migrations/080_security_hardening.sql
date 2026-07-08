-- =============================================================================
-- Migration 080 — Security hardening (Supabase Linter fixes)
-- =============================================================================
-- Fixes all issues reported by the Supabase Performance & Security Linter:
--
-- [ERROR] 3 views with SECURITY DEFINER → switch to SECURITY INVOKER
-- [ERROR] 13 tables without RLS → enable RLS + service_role-only policy
-- [ERROR] 2 tables with sensitive columns exposed → covered by RLS fix
-- [WARN]  33 functions with mutable search_path → pin to 'public'
-- [WARN]  pg_trgm extension in public schema → move to 'extensions'
-- [WARN]  count_silent_inbounds callable by anon → revoke from anon/authenticated
-- =============================================================================

BEGIN;

-- =====================================================================
-- 1. FIX SECURITY DEFINER VIEWS → SECURITY INVOKER
-- =====================================================================
-- These views run with the view creator's privileges, bypassing RLS.
-- Since our API always uses service_role (which bypasses RLS anyway),
-- SECURITY INVOKER is correct — it respects the caller's permissions.
-- =====================================================================

ALTER VIEW v_teacher_earnings SET (security_invoker = on);
ALTER VIEW v_student_packs    SET (security_invoker = on);
ALTER VIEW v_leads_today      SET (security_invoker = on);

-- =====================================================================
-- 2. ENABLE RLS ON UNPROTECTED TABLES + service_role-only policy
-- =====================================================================
-- All these tables are admin-only and accessed via service_role key.
-- RLS + a service_role policy blocks accidental anon/public access.
-- =====================================================================

ALTER TABLE lead_deletion_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gelfis_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_motivo_inicial  ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_resources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_class_scripts  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'lead_deletion_log',
            'gelfis_notifications',
            'outbound_queue',
            'business_expenses',
            'rate_limit_log',
            'teacher_invitations',
            'lead_motivo_inicial',
            'funnel_progress',
            'teacher_resources',
            'class_reviews',
            'message_templates',
            'admin_notifications',
            'trial_class_scripts'
        ])
    LOOP
        EXECUTE format(
            'CREATE POLICY "service_role_all_%s" ON %I
                FOR ALL
                USING (auth.role() = ''service_role'')
                WITH CHECK (auth.role() = ''service_role'')',
            tbl, tbl
        );
    END LOOP;
END $$;

-- =====================================================================
-- 3. FIX count_silent_inbounds — revoke from anon/authenticated
-- =====================================================================
-- This SECURITY DEFINER function is an admin dashboard RPC.
-- It must NOT be callable by unauthenticated or regular users.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION count_silent_inbounds() FROM anon;
REVOKE EXECUTE ON FUNCTION count_silent_inbounds() FROM authenticated;
REVOKE EXECUTE ON FUNCTION count_silent_inbounds() FROM public;

-- =====================================================================
-- 4. PIN search_path ON ALL FUNCTIONS (prevents search_path hijacking)
-- =====================================================================
-- A mutable search_path lets an attacker create a malicious function
-- in a schema that shadows a legitimate one. Pinning to 'public'
-- ensures all unqualified names resolve only to the public schema.
-- =====================================================================

ALTER FUNCTION set_updated_at()                              SET search_path = public;
ALTER FUNCTION gdpr_delete_lead(uuid)                        SET search_path = public;
ALTER FUNCTION tg_users_updated_at()                         SET search_path = public;
ALTER FUNCTION tg_teachers_updated_at()                      SET search_path = public;
ALTER FUNCTION tg_students_updated_at()                      SET search_path = public;
ALTER FUNCTION tg_student_progress_updated_at()              SET search_path = public;
ALTER FUNCTION tg_classes_updated_at()                       SET search_path = public;
ALTER FUNCTION tg_teacher_availability_updated_at()          SET search_path = public;
ALTER FUNCTION tg_messages_bump_chat_last_message()          SET search_path = public;
ALTER FUNCTION tg_teacher_earnings_updated_at()              SET search_path = public;
ALTER FUNCTION tg_heartbeat_updated_at()                     SET search_path = public;
ALTER FUNCTION tg_student_groups_updated_at()                SET search_path = public;
ALTER FUNCTION tg_teacher_payouts_updated_at()               SET search_path = public;
ALTER FUNCTION recompute_classes_remaining(uuid)             SET search_path = public;
ALTER FUNCTION tg_cp_sync_remaining()                        SET search_path = public;
ALTER FUNCTION tg_classes_sync_remaining()                   SET search_path = public;
ALTER FUNCTION tg_shared_materials_updated_at()              SET search_path = public;
ALTER FUNCTION tg_students_adjustment_sync()                 SET search_path = public;
ALTER FUNCTION tg_admin_notes_updated_at()                   SET search_path = public;
ALTER FUNCTION count_silent_inbounds()                       SET search_path = public;
ALTER FUNCTION data_integrity_phantom_membership()           SET search_path = public;
ALTER FUNCTION data_integrity_bulk_backfill()                SET search_path = public;
ALTER FUNCTION recompute_teacher_month(uuid, timestamptz)     SET search_path = public;
ALTER FUNCTION tg_classes_auto_log_hours()                   SET search_path = public;
ALTER FUNCTION increment_resource_open_count(uuid)           SET search_path = public;
ALTER FUNCTION enroll_group_members_on_class()               SET search_path = public;
ALTER FUNCTION enroll_member_into_future_group_classes()     SET search_path = public;
ALTER FUNCTION unenroll_member_from_future_group_classes()   SET search_path = public;
ALTER FUNCTION costes_fijos_updated_at()                     SET search_path = public;
ALTER FUNCTION fn_log_class_hours()                          SET search_path = public;
ALTER FUNCTION tg_posts_updated_at()                         SET search_path = public;
ALTER FUNCTION tg_post_likes_count()                         SET search_path = public;
ALTER FUNCTION tg_post_comments_count()                      SET search_path = public;

-- =====================================================================
-- 5. MOVE pg_trgm EXTENSION OUT OF public SCHEMA
-- =====================================================================
-- Extensions in public are visible to PostgREST and increase attack
-- surface. We move pg_trgm to the 'extensions' schema (Supabase
-- convention). Must CASCADE to drop dependent GIN indexes, then
-- recreate them after the extension is reinstalled.
-- =====================================================================

-- Drop dependent GIN indexes first
DROP INDEX IF EXISTS idx_leads_name_trgm;
DROP INDEX IF EXISTS teacher_resources_topic_trgm;
DROP INDEX IF EXISTS teacher_resources_title_trgm;

-- Move extension
CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_trgm;
CREATE EXTENSION pg_trgm SCHEMA extensions;

-- Recreate GIN indexes using the extension from its new schema
CREATE INDEX idx_leads_name_trgm
    ON leads USING gin (name extensions.gin_trgm_ops);
CREATE INDEX teacher_resources_topic_trgm
    ON teacher_resources USING gin (topic extensions.gin_trgm_ops);
CREATE INDEX teacher_resources_title_trgm
    ON teacher_resources USING gin (title extensions.gin_trgm_ops);

COMMIT;
