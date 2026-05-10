-- ============================================================
-- RAJO AI — Supabase schema
-- Run this once in the Supabase SQL Editor.
-- ============================================================

-- ── voice_donors ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_donors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name        TEXT        NOT NULL,
  email            TEXT        NOT NULL,
  age              INTEGER,
  age_range        TEXT        NOT NULL DEFAULT 'Prefer not to say',
  gender           TEXT        NOT NULL,
  country          TEXT        NOT NULL DEFAULT '',
  city             TEXT        NOT NULL DEFAULT '',
  dialect          TEXT        NOT NULL,
  consent          BOOLEAN     NOT NULL DEFAULT false,
  voice_profile_id TEXT,
  status           TEXT        NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE voice_donors
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS age_range TEXT NOT NULL DEFAULT 'Prefer not to say',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE voice_donors
  ALTER COLUMN age DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voice_donors_auth_user_id_key
  ON voice_donors(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS voice_donors_email_idx
  ON voice_donors(LOWER(email));

ALTER TABLE voice_donors ENABLE ROW LEVEL SECURITY;

-- Allow anonymous volunteers to register
CREATE POLICY "anon_insert_voice_donors"
  ON voice_donors FOR INSERT
  TO anon
  WITH CHECK (consent = true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_donors'
      AND policyname = 'authenticated_insert_own_voice_donor'
  ) THEN
    CREATE POLICY "authenticated_insert_own_voice_donor"
      ON voice_donors FOR INSERT
      TO authenticated
      WITH CHECK (auth_user_id = auth.uid() AND consent = true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_donors'
      AND policyname = 'authenticated_select_own_voice_donor'
  ) THEN
    CREATE POLICY "authenticated_select_own_voice_donor"
      ON voice_donors FOR SELECT
      TO authenticated
      USING (auth_user_id = auth.uid());
  END IF;
END $$;

-- ── voice_recordings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_recordings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id      UUID        NOT NULL REFERENCES voice_donors(id) ON DELETE CASCADE,
  sentence_id   TEXT        NOT NULL,
  sentence_text TEXT        NOT NULL,
  audio_url     TEXT        NOT NULL,
  audio_path    TEXT        NOT NULL,
  duration_seconds NUMERIC,
  dialect       TEXT,
  gender        TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending',
  review_notes  TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE voice_recordings
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE voice_recordings ENABLE ROW LEVEL SECURITY;

-- Anonymous recording insert is intentionally restricted:
-- WITH CHECK (false) blocks all anonymous inserts. Authenticated
-- users are covered by "authenticated_insert_own_voice_recordings".
-- If your sign-up flow still needs anonymous inserts (e.g. because
-- Supabase email confirmation delays the session), temporarily flip
-- this to WITH CHECK (true) and tighten it once auth is confirmed.
CREATE POLICY "anon_insert_voice_recordings"
  ON voice_recordings FOR INSERT
  TO anon
  WITH CHECK (false);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_recordings'
      AND policyname = 'authenticated_insert_own_voice_recordings'
  ) THEN
    CREATE POLICY "authenticated_insert_own_voice_recordings"
      ON voice_recordings FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM voice_donors
          WHERE voice_donors.id = voice_recordings.donor_id
            AND voice_donors.auth_user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voice_recordings'
      AND policyname = 'authenticated_select_own_voice_recordings'
  ) THEN
    CREATE POLICY "authenticated_select_own_voice_recordings"
      ON voice_recordings FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM voice_donors
          WHERE voice_donors.id = voice_recordings.donor_id
            AND voice_donors.auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

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
      WITH CHECK (status IN ('pending', 'pending_review', 'approved', 'rejected'));
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
END $$;

-- ── Storage bucket ───────────────────────────────────────────
-- Bucket is PRIVATE. Audio files are never served via public URL.
-- All playback uses signed URLs (1 hr TTL) generated server-side.
-- For existing projects run: supabase/private_storage_migration.sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-recordings', 'voice-recordings', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Authenticated users can upload only to their own donor UUID subfolder.
-- Path layout: <donor_uuid>/<sentence_id>-<timestamp>.<ext>
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

-- Authenticated users can read files in their own folder.
-- Admin read policy (auth.email() = 'jamailyaz2024@gmail.com') is
-- created by secure_admin_policies.sql. Supabase ORs SELECT policies,
-- so: admin sees all objects, regular users see only their own.
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

-- ── Public dataset statistics RPC ────────────────────────────
-- Returns aggregate counts only — no individual rows, no PII.
-- SECURITY DEFINER bypasses RLS so anon users can call it safely.
-- For existing projects run: supabase/public_stats_migration.sql

CREATE OR REPLACE FUNCTION get_public_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_recordings',
    COUNT(*)::int,

    'approved_recordings',
    COUNT(*) FILTER (WHERE status = 'approved')::int,

    'approved_duration_seconds',
    COALESCE(
      SUM(duration_seconds) FILTER (WHERE status = 'approved'),
      0
    )::numeric,

    'total_contributors',
    COUNT(DISTINCT donor_id) FILTER (WHERE donor_id IS NOT NULL)::int,

    'dialects_covered',
    COUNT(DISTINCT dialect) FILTER (
      WHERE status = 'approved'
        AND dialect IS NOT NULL
        AND dialect <> ''
    )::int,

    'countries_covered',
    COUNT(DISTINCT country) FILTER (
      WHERE status = 'approved'
        AND country IS NOT NULL
        AND country <> ''
    )::int
  )
  FROM voice_recordings;
$$;

GRANT EXECUTE ON FUNCTION get_public_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_public_stats() TO authenticated;
