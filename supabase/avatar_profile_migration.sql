-- Add avatar_url column to voice_donors table
ALTER TABLE voice_donors
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create avatars storage bucket (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read of avatar images
CREATE POLICY "Avatars public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- Allow authenticated users to upload/update avatars
CREATE POLICY "Avatars authenticated insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Avatars authenticated update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars');

-- Allow authenticated users to update their own avatar_url in voice_donors
-- (The existing RLS policy covers this via the auth_user_id check)
