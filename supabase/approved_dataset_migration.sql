-- ============================================================
-- RAJO AI — approved-dataset bucket + schema migration
-- Run once in the Supabase SQL Editor.
-- ============================================================

-- ── 1. New columns on voice_recordings ──────────────────────
ALTER TABLE voice_recordings
  ADD COLUMN IF NOT EXISTS approved       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dataset_ready  BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Create private approved-dataset bucket ────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('approved-dataset', 'approved-dataset', false)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Storage RLS policies for approved-dataset ─────────────

-- Admin can write (copy) files into the bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'admin_insert_approved_dataset'
  ) THEN
    CREATE POLICY "admin_insert_approved_dataset"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'approved-dataset'
        AND auth.email() = 'jamailyaz2024@gmail.com'
      );
  END IF;
END $$;

-- Admin can read (generate signed URLs) from the bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'admin_select_approved_dataset'
  ) THEN
    CREATE POLICY "admin_select_approved_dataset"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'approved-dataset'
        AND auth.email() = 'jamailyaz2024@gmail.com'
      );
  END IF;
END $$;

-- Admin can delete files from the bucket (for cleanup)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'admin_delete_approved_dataset'
  ) THEN
    CREATE POLICY "admin_delete_approved_dataset"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'approved-dataset'
        AND auth.email() = 'jamailyaz2024@gmail.com'
      );
  END IF;
END $$;
