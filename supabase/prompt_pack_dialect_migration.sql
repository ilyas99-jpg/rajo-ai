-- ============================================================
-- RAJO AI - Dialect-scoped prompt packs
-- ============================================================
-- Existing prompt packs default to Maxaa Tiri. Future May May
-- packs can be created separately and unlock independently.

ALTER TABLE prompt_packs
  ADD COLUMN IF NOT EXISTS dialect TEXT NOT NULL DEFAULT 'Maxaa Tiri';

UPDATE prompt_packs
SET dialect = 'Maxaa Tiri'
WHERE dialect IS NULL OR dialect = '';

CREATE INDEX IF NOT EXISTS prompt_packs_dialect_active_order_idx
  ON prompt_packs (dialect, is_active, unlock_order);

DROP POLICY IF EXISTS "users_unlock_allowed_prompt_packs" ON user_prompt_progress;

CREATE POLICY "users_unlock_allowed_prompt_packs"
  ON user_prompt_progress FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM prompt_packs target
      WHERE target.id = user_prompt_progress.pack_id
        AND target.is_active = true
        AND target.dialect = (
          SELECT donor.dialect
          FROM voice_donors donor
          WHERE donor.auth_user_id = auth.uid()
          LIMIT 1
        )
        AND (
          target.unlock_order = (
            SELECT MIN(first_pack.unlock_order)
            FROM prompt_packs first_pack
            WHERE first_pack.is_active = true
              AND first_pack.dialect = target.dialect
          )
          OR EXISTS (
            SELECT 1
            FROM user_prompt_progress done
            JOIN prompt_packs previous_pack ON previous_pack.id = done.pack_id
            WHERE done.user_id = auth.uid()
              AND done.completed_at IS NOT NULL
              AND previous_pack.is_active = true
              AND previous_pack.dialect = target.dialect
              AND (
                target.required_previous_pack_id = previous_pack.id
                OR previous_pack.unlock_order < target.unlock_order
              )
          )
        )
    )
  );
