-- ============================================================
-- RAJO AI — Age range privacy migration
-- ============================================================
-- Replaces exact donor age collection with a categorical age range.
-- Existing exact ages are converted into ranges; new registrations no
-- longer write the legacy age column.

ALTER TABLE voice_donors
  ADD COLUMN IF NOT EXISTS age_range TEXT NOT NULL DEFAULT 'Prefer not to say';

UPDATE voice_donors
SET age_range = CASE
  WHEN age IS NULL THEN 'Prefer not to say'
  WHEN age < 18 THEN 'Under 18'
  WHEN age BETWEEN 18 AND 25 THEN '18–25'
  WHEN age BETWEEN 26 AND 35 THEN '26–35'
  WHEN age BETWEEN 36 AND 45 THEN '36–45'
  WHEN age BETWEEN 46 AND 60 THEN '46–60'
  ELSE '60+'
END
WHERE age_range IS NULL OR age_range = 'Prefer not to say';

ALTER TABLE voice_donors
  ALTER COLUMN age DROP NOT NULL;

ALTER TABLE voice_recordings
  ADD COLUMN IF NOT EXISTS age_range TEXT;
