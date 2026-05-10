-- ============================================================
-- RAJO AI - Fix prompt_packs RLS recursion
-- ============================================================
-- The previous prompt_packs SELECT policy queried prompt_packs from inside
-- its own USING expression, which can trigger Postgres RLS recursion.
-- Keep prompt_packs policies simple and non-recursive.

DROP POLICY IF EXISTS "admin_manage_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "users_read_unlocked_active_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "public_read_active_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "authenticated_read_active_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "admin_select_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "admin_insert_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "admin_update_prompt_packs" ON prompt_packs;
DROP POLICY IF EXISTS "admin_delete_prompt_packs" ON prompt_packs;

ALTER TABLE prompt_packs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON prompt_packs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON prompt_packs TO authenticated;

CREATE POLICY "public_read_active_prompt_packs"
  ON prompt_packs FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "admin_select_prompt_packs"
  ON prompt_packs FOR SELECT
  TO authenticated
  USING (auth.email() = 'jamailyaz2024@gmail.com');

CREATE POLICY "admin_insert_prompt_packs"
  ON prompt_packs FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');

CREATE POLICY "admin_update_prompt_packs"
  ON prompt_packs FOR UPDATE
  TO authenticated
  USING (auth.email() = 'jamailyaz2024@gmail.com')
  WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');

CREATE POLICY "admin_delete_prompt_packs"
  ON prompt_packs FOR DELETE
  TO authenticated
  USING (auth.email() = 'jamailyaz2024@gmail.com');
