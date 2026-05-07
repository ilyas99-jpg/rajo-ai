-- RAJO AI admin dashboard support.
-- Run this in Supabase SQL Editor for an existing project.

ALTER TABLE voice_donors
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE voice_recordings
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_review';

-- MVP admin dashboard policies.
-- These make browser-admin review possible with the public anon key plus
-- VITE_ADMIN_PASSWORD. Replace with authenticated admin-only policies before
-- handling sensitive production data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_donors'
      AND policyname = 'anon_select_voice_donors_mvp_admin'
  ) THEN
    CREATE POLICY "anon_select_voice_donors_mvp_admin"
      ON voice_donors FOR SELECT
      TO anon
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_recordings'
      AND policyname = 'anon_select_voice_recordings_mvp_admin'
  ) THEN
    CREATE POLICY "anon_select_voice_recordings_mvp_admin"
      ON voice_recordings FOR SELECT
      TO anon
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_recordings'
      AND policyname = 'anon_update_voice_recordings_mvp_admin'
  ) THEN
    CREATE POLICY "anon_update_voice_recordings_mvp_admin"
      ON voice_recordings FOR UPDATE
      TO anon
      USING (true)
      WITH CHECK (status IN ('pending_review', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_recordings'
      AND policyname = 'anon_delete_voice_recordings_mvp_admin'
  ) THEN
    CREATE POLICY "anon_delete_voice_recordings_mvp_admin"
      ON voice_recordings FOR DELETE
      TO anon
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'anon_read_voice_recordings_mvp_admin'
  ) THEN
    CREATE POLICY "anon_read_voice_recordings_mvp_admin"
      ON storage.objects FOR SELECT
      TO anon
      USING (bucket_id = 'voice-recordings');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'anon_delete_voice_recordings_mvp_admin'
  ) THEN
    CREATE POLICY "anon_delete_voice_recordings_mvp_admin"
      ON storage.objects FOR DELETE
      TO anon
      USING (bucket_id = 'voice-recordings');
  END IF;
END $$;
