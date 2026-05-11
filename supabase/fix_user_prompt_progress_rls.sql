-- ============================================================
-- RAJO AI - Fix user_prompt_progress RLS
-- ============================================================
-- PURPOSE:
--   Allow authenticated users to manage only their own prompt
--   progress rows, including inserting the first unlocked prompt
--   pack row where user_id = auth.uid().
--
--   Admin jamailyaz2024@gmail.com can read/manage all rows.
-- ============================================================

ALTER TABLE user_prompt_progress ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON user_prompt_progress TO authenticated;

DROP POLICY IF EXISTS "admin_manage_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "users_read_own_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "users_unlock_allowed_prompt_packs" ON user_prompt_progress;
DROP POLICY IF EXISTS "users_complete_own_prompt_packs" ON user_prompt_progress;
DROP POLICY IF EXISTS "users_select_own_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "users_insert_own_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "users_update_own_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "admin_select_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "admin_insert_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "admin_update_user_prompt_progress" ON user_prompt_progress;
DROP POLICY IF EXISTS "admin_delete_user_prompt_progress" ON user_prompt_progress;

CREATE POLICY "users_select_own_user_prompt_progress"
  ON user_prompt_progress
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users_insert_own_user_prompt_progress"
  ON user_prompt_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_own_user_prompt_progress"
  ON user_prompt_progress
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "admin_select_user_prompt_progress"
  ON user_prompt_progress
  FOR SELECT
  TO authenticated
  USING (auth.email() = 'jamailyaz2024@gmail.com');

CREATE POLICY "admin_insert_user_prompt_progress"
  ON user_prompt_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');

CREATE POLICY "admin_update_user_prompt_progress"
  ON user_prompt_progress
  FOR UPDATE
  TO authenticated
  USING (auth.email() = 'jamailyaz2024@gmail.com')
  WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');

CREATE POLICY "admin_delete_user_prompt_progress"
  ON user_prompt_progress
  FOR DELETE
  TO authenticated
  USING (auth.email() = 'jamailyaz2024@gmail.com');
