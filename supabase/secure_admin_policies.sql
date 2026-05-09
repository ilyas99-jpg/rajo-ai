-- ============================================================
-- RAJO AI — Secure Admin Policies Migration
-- ============================================================
-- PURPOSE:
--   Replace the insecure MVP "anon" admin policies with
--   authenticated-only policies that enforce the admin email
--   at the database level using auth.email().
--
-- PREREQUISITE:
--   The admin account (jamailyaz2024@gmail.com) must already
--   exist in Supabase Auth before running this migration.
--   Create it in: Supabase Dashboard → Authentication → Users
--
-- HOW TO RUN:
--   Paste this entire file into:
--   Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── Step 1: Drop the insecure MVP anonymous access policies ──
-- These allowed ANY anonymous user to read ALL donor data and
-- update/delete ANY recording — protected only by a weak client-
-- side password that was compiled into the JavaScript bundle.

DROP POLICY IF EXISTS "anon_select_voice_donors_mvp_admin"       ON voice_donors;
DROP POLICY IF EXISTS "anon_select_voice_recordings_mvp_admin"   ON voice_recordings;
DROP POLICY IF EXISTS "anon_update_voice_recordings_mvp_admin"   ON voice_recordings;
DROP POLICY IF EXISTS "anon_delete_voice_recordings_mvp_admin"   ON voice_recordings;
DROP POLICY IF EXISTS "anon_read_voice_recordings_mvp_admin"     ON storage.objects;
DROP POLICY IF EXISTS "anon_delete_voice_recordings_mvp_admin"   ON storage.objects;

-- ── Step 2: Admin-only SELECT on voice_donors ─────────────────
-- Regular authenticated users can only see their own row
-- (covered by "authenticated_select_own_voice_donor").
-- The admin can see all rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'voice_donors'
      AND policyname = 'admin_select_all_donors'
  ) THEN
    CREATE POLICY "admin_select_all_donors"
      ON voice_donors FOR SELECT
      TO authenticated
      USING (auth.email() = 'jamailyaz2024@gmail.com');
  END IF;
END $$;

-- ── Step 3: Admin-only SELECT on voice_recordings ─────────────
-- Regular authenticated users can only see their own recordings
-- (covered by "authenticated_select_own_voice_recordings").
-- The admin can see all recordings.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'voice_recordings'
      AND policyname = 'admin_select_all_recordings'
  ) THEN
    CREATE POLICY "admin_select_all_recordings"
      ON voice_recordings FOR SELECT
      TO authenticated
      USING (auth.email() = 'jamailyaz2024@gmail.com');
  END IF;
END $$;

-- ── Step 4: Admin-only UPDATE on voice_recordings ─────────────
-- Only the admin can change recording status or quality scores.
-- The WITH CHECK clause also prevents escalating status values
-- outside the allowed set.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'voice_recordings'
      AND policyname = 'admin_update_recordings'
  ) THEN
    CREATE POLICY "admin_update_recordings"
      ON voice_recordings FOR UPDATE
      TO authenticated
      USING  (auth.email() = 'jamailyaz2024@gmail.com')
      WITH CHECK (
        auth.email() = 'jamailyaz2024@gmail.com'
        AND status IN ('pending', 'pending_review', 'approved', 'rejected')
      );
  END IF;
END $$;

-- ── Step 5: Admin-only DELETE on voice_recordings ─────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'voice_recordings'
      AND policyname = 'admin_delete_recordings'
  ) THEN
    CREATE POLICY "admin_delete_recordings"
      ON voice_recordings FOR DELETE
      TO authenticated
      USING (auth.email() = 'jamailyaz2024@gmail.com');
  END IF;
END $$;

-- ── Step 6: Admin-only storage SELECT (audio playback) ────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'admin_read_storage'
  ) THEN
    CREATE POLICY "admin_read_storage"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'voice-recordings'
        AND auth.email() = 'jamailyaz2024@gmail.com'
      );
  END IF;
END $$;

-- ── Step 7: Admin-only storage DELETE (file removal) ──────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'admin_delete_storage'
  ) THEN
    CREATE POLICY "admin_delete_storage"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'voice-recordings'
        AND auth.email() = 'jamailyaz2024@gmail.com'
      );
  END IF;
END $$;

-- ── Step 8 (RECOMMENDED): Restrict anonymous recording inserts ─
-- The current "anon_insert_voice_recordings" policy allows any
-- anonymous user to insert rows into voice_recordings with no
-- authentication — enabling spam/abuse.
--
-- If your registration flow uses Supabase Auth (signUp → auto
-- sign-in), authenticated users will be covered by the existing
-- "authenticated_insert_own_voice_recordings" policy. You can
-- safely drop the anonymous insert policy:
--
--   DROP POLICY IF EXISTS "anon_insert_voice_recordings" ON voice_recordings;
--
-- Only do this after verifying that your sign-up flow works
-- correctly with the authenticated policy alone.

-- ── Verification query ────────────────────────────────────────
-- Run this after the migration to confirm the policies:
--
-- SELECT schemaname, tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN ('voice_donors', 'voice_recordings')
--    OR (schemaname = 'storage' AND tablename = 'objects')
-- ORDER BY tablename, policyname;
