-- ============================================================
-- RAJO AI — Private Storage Migration
-- ============================================================
-- PURPOSE:
--   Convert the voice-recordings storage bucket from public to
--   private and replace the permissive anon policies with
--   per-user and admin-only policies.
--
-- PREREQUISITES:
--   Run secure_admin_policies.sql first (creates admin_read_storage
--   and admin_delete_storage — this file depends on them).
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste → Run
--
-- WHAT CHANGES:
--   BEFORE  public bucket  → any URL can be accessed by anyone
--   AFTER   private bucket → only signed URLs work (1 hr TTL)
--             - Authenticated users upload to their own folder only
--             - Authenticated users read their own files
--             - Admin (jamailyaz2024@gmail.com) reads/deletes all
-- ============================================================

-- ── Step 1: Make the bucket private ──────────────────────────
-- Public buckets serve files without authentication via the
-- /object/public/ endpoint. Setting public = false disables that
-- endpoint so every object requires a signed URL or a valid JWT.

UPDATE storage.buckets
SET public = false
WHERE id = 'voice-recordings';

-- ── Step 2: Drop the permissive upload policies ───────────────
-- "anon_upload_voice_recordings"         → any anon user could upload
-- "authenticated_upload_voice_recordings" → any auth user could upload
--   to ANY path (not restricted to their own folder)

DROP POLICY IF EXISTS "anon_upload_voice_recordings"         ON storage.objects;
DROP POLICY IF EXISTS "authenticated_upload_voice_recordings" ON storage.objects;

-- ── Step 3: Drop the permissive read / delete policies ────────
-- These were MVP policies. secure_admin_policies.sql already dropped
-- them for existing projects. They are listed here for safety.

DROP POLICY IF EXISTS "anon_read_voice_recordings_mvp_admin"   ON storage.objects;
DROP POLICY IF EXISTS "anon_delete_voice_recordings_mvp_admin" ON storage.objects;

-- ── Step 4: Per-user INSERT (upload own folder only) ─────────
-- Each authenticated user may only write files whose first path
-- segment matches their own donor UUID (voice_donors.id where
-- voice_donors.auth_user_id = auth.uid()).
-- Storage path layout: <donor_uuid>/<sentence_id>-<timestamp>.<ext>

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'authenticated_upload_own_recordings'
  ) THEN
    CREATE POLICY "authenticated_upload_own_recordings"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'voice-recordings'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM voice_donors WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── Step 5: Per-user SELECT (read own files) ─────────────────
-- Authenticated users can only read files inside their own folder.
-- The admin SELECT policy (admin_read_storage, from
-- secure_admin_policies.sql) covers all files for the admin.
-- Supabase ORs multiple SELECT policies together, so both apply:
--   • admin   → sees all objects (via admin_read_storage)
--   • others  → sees only their own folder (this policy)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'authenticated_read_own_recordings'
  ) THEN
    CREATE POLICY "authenticated_read_own_recordings"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'voice-recordings'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM voice_donors WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── Verification ──────────────────────────────────────────────
-- Confirm the bucket is now private:
--   SELECT id, name, public FROM storage.buckets WHERE id = 'voice-recordings';
--   → public should be false
--
-- Confirm storage policies:
--   SELECT policyname, roles, cmd
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--   ORDER BY policyname;
--
-- Expected policies after running both migration files:
--   admin_delete_storage              | {authenticated} | DELETE
--   admin_read_storage                | {authenticated} | SELECT
--   authenticated_read_own_recordings | {authenticated} | SELECT
--   authenticated_upload_own_recordings| {authenticated} | INSERT
-- ============================================================
