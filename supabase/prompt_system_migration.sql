-- ============================================================
-- RAJO AI - Database-driven prompt system
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL DEFAULT 'so',
  dialect TEXT NOT NULL DEFAULT 'Maxaa Tiri',
  unlock_order INTEGER NOT NULL,
  required_previous_pack_id UUID REFERENCES prompt_packs(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES prompt_packs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category TEXT,
  difficulty TEXT,
  order_number INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_prompt_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES prompt_packs(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, pack_id)
);

CREATE INDEX IF NOT EXISTS prompt_packs_active_order_idx
  ON prompt_packs (is_active, unlock_order);

CREATE INDEX IF NOT EXISTS prompt_packs_dialect_active_order_idx
  ON prompt_packs (dialect, is_active, unlock_order);

CREATE INDEX IF NOT EXISTS prompts_pack_order_idx
  ON prompts (pack_id, is_active, order_number);

CREATE INDEX IF NOT EXISTS user_prompt_progress_user_idx
  ON user_prompt_progress (user_id, pack_id);

ALTER TABLE prompt_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prompt_progress ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON prompt_packs TO authenticated;
GRANT SELECT ON prompts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_prompt_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prompt_packs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prompts TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prompt_packs' AND policyname = 'admin_manage_prompt_packs'
  ) THEN
    CREATE POLICY "admin_manage_prompt_packs"
      ON prompt_packs
      TO authenticated
      USING (auth.email() = 'jamailyaz2024@gmail.com')
      WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prompts' AND policyname = 'admin_manage_prompts'
  ) THEN
    CREATE POLICY "admin_manage_prompts"
      ON prompts
      TO authenticated
      USING (auth.email() = 'jamailyaz2024@gmail.com')
      WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_prompt_progress' AND policyname = 'admin_manage_user_prompt_progress'
  ) THEN
    CREATE POLICY "admin_manage_user_prompt_progress"
      ON user_prompt_progress
      TO authenticated
      USING (auth.email() = 'jamailyaz2024@gmail.com')
      WITH CHECK (auth.email() = 'jamailyaz2024@gmail.com');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_prompt_progress' AND policyname = 'users_read_own_prompt_progress'
  ) THEN
    CREATE POLICY "users_read_own_prompt_progress"
      ON user_prompt_progress FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_prompt_progress' AND policyname = 'users_unlock_allowed_prompt_packs'
  ) THEN
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_prompt_progress' AND policyname = 'users_complete_own_prompt_packs'
  ) THEN
    CREATE POLICY "users_complete_own_prompt_packs"
      ON user_prompt_progress FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prompt_packs' AND policyname = 'users_read_unlocked_active_prompt_packs'
  ) THEN
    CREATE POLICY "users_read_unlocked_active_prompt_packs"
      ON prompt_packs FOR SELECT
      TO authenticated
      USING (
        is_active = true
        AND (
          EXISTS (
            SELECT 1
            FROM user_prompt_progress progress
            WHERE progress.user_id = auth.uid()
              AND progress.pack_id = prompt_packs.id
          )
          OR unlock_order = (
            SELECT MIN(first_pack.unlock_order)
            FROM prompt_packs first_pack
            WHERE first_pack.is_active = true
              AND first_pack.dialect = prompt_packs.dialect
          )
          OR EXISTS (
            SELECT 1
            FROM user_prompt_progress done
            JOIN prompt_packs previous_pack ON previous_pack.id = done.pack_id
            WHERE done.user_id = auth.uid()
              AND done.completed_at IS NOT NULL
              AND previous_pack.is_active = true
              AND previous_pack.dialect = prompt_packs.dialect
              AND (
                prompt_packs.required_previous_pack_id = previous_pack.id
                OR previous_pack.unlock_order < prompt_packs.unlock_order
              )
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prompts' AND policyname = 'users_read_unlocked_active_prompts'
  ) THEN
    CREATE POLICY "users_read_unlocked_active_prompts"
      ON prompts FOR SELECT
      TO authenticated
      USING (
        is_active = true
        AND EXISTS (
          SELECT 1
          FROM prompt_packs pack
          JOIN user_prompt_progress progress ON progress.pack_id = pack.id
          WHERE pack.id = prompts.pack_id
            AND pack.is_active = true
            AND progress.user_id = auth.uid()
        )
      );
  END IF;
END $$;

WITH first_pack AS (
  INSERT INTO prompt_packs (slug, title, description, language, unlock_order)
  VALUES (
    'first-contribution-set',
    'First Contribution Set',
    'A focused starter set for a contributor''s first RAJO AI recording session.',
    'so',
    1
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    language = EXCLUDED.language,
    unlock_order = EXCLUDED.unlock_order,
    is_active = true
  RETURNING id
),
everyday_pack AS (
  INSERT INTO prompt_packs (slug, title, description, language, unlock_order, required_previous_pack_id)
  SELECT
    'everyday-somali',
    'Everyday Somali',
    'Daily Somali phrases that broaden RAJO AI''s speech coverage across natural contexts.',
    'so',
    2,
    first_pack.id
  FROM first_pack
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    language = EXCLUDED.language,
    unlock_order = EXCLUDED.unlock_order,
    required_previous_pack_id = EXCLUDED.required_previous_pack_id,
    is_active = true
  RETURNING id
)
INSERT INTO prompts (pack_id, text, category, difficulty, order_number)
SELECT first_pack.id, seed.text, seed.category, seed.difficulty, seed.order_number
FROM first_pack
CROSS JOIN (
  VALUES
    ('Magacaygu waa Rajo AI.', 'starter', 'easy', 1),
    ('Waxaan ku hadlaa af Soomaali.', 'starter', 'easy', 2),
    ('Maanta waa maalin wanaagsan.', 'starter', 'easy', 3),
    ('Fadlan akhri weedhan si tartiib ah.', 'starter', 'easy', 4),
    ('Codkaaga wuxuu caawinayaa bulshada.', 'starter', 'easy', 5)
) AS seed(text, category, difficulty, order_number)
WHERE NOT EXISTS (
  SELECT 1 FROM prompts existing
  WHERE existing.pack_id = first_pack.id AND existing.order_number = seed.order_number
);

WITH everyday_pack AS (
  SELECT id FROM prompt_packs WHERE slug = 'everyday-somali'
)
INSERT INTO prompts (pack_id, text, category, difficulty, order_number)
SELECT everyday_pack.id, seed.text, seed.category, seed.difficulty, seed.order_number
FROM everyday_pack
CROSS JOIN (
  VALUES
    ('Carruurtu waxay dhigtaan iskuulka subaxdii.', 'daily-life', 'easy', 1),
    ('Hooyaday waxay karisay shaah kulul.', 'daily-life', 'easy', 2),
    ('Aabbahay wuxuu jecel yahay akhriska.', 'daily-life', 'easy', 3),
    ('Waxaan rabaa inaan barto tiknoolajiyada.', 'technology', 'easy', 4),
    ('Soomaaliya waxay leedahay taariikh dheer.', 'culture', 'easy', 5),
    ('Biyaha nadiifka ah waa muhiim.', 'daily-life', 'easy', 6),
    ('Cimiladu maanta way deggan tahay.', 'daily-life', 'easy', 7),
    ('Saaxiibkay wuxuu yimid guriga.', 'daily-life', 'easy', 8),
    ('Waxaan u socdaa suuqa weyn.', 'daily-life', 'easy', 9),
    ('Fariintan waa mid gaaban oo cad.', 'speech', 'easy', 10),
    ('Dadka oo dhan waxay mudan yihiin ixtiraam.', 'community', 'easy', 11),
    ('Afka hooyo waa hanti qaali ah.', 'culture', 'easy', 12),
    ('Waxbarashadu waxay furtaa fursado cusub.', 'education', 'easy', 13),
    ('Cod dabiici ah ayaa fududeeya adeegyada.', 'technology', 'medium', 14),
    ('Fadlan ku celi haddii aad qalad dareento.', 'speech', 'easy', 15),
    ('Waxaan cabayaa biyo qabow.', 'daily-life', 'easy', 16),
    ('Magaaladu waxay leedahay waddooyin badan.', 'daily-life', 'easy', 17),
    ('Qoyskeygu wuxuu ku nool yahay xaafad deggan.', 'daily-life', 'easy', 18),
    ('Shaqadu waxay bilaabataa sagaalka subaxnimo.', 'daily-life', 'easy', 19),
    ('Waxaan maqlaa codka roobka.', 'daily-life', 'easy', 20),
    ('Buuggan wuxuu ka hadlayaa caafimaadka.', 'health', 'easy', 21),
    ('Ardaydu waxay qoreen casharka maanta.', 'education', 'easy', 22),
    ('Farsamada cusub waxay u baahan tahay xog wanaagsan.', 'technology', 'medium', 23),
    ('Waxaan ilaalinaa sirta dadka.', 'privacy', 'medium', 24),
    ('Oggolaansho la''aan cod lama uruurinayo.', 'privacy', 'medium', 25),
    ('Maqalka fiican wuxuu ka bilaabmaa meel deggan.', 'recording', 'easy', 26),
    ('Fadlan taleefanka ha ku dhaweyn afkaaga.', 'recording', 'easy', 27),
    ('Waxaan akhrinayaa weedh Soomaali ah.', 'speech', 'easy', 28),
    ('Adeegyada codka waxay caawin karaan dadka aragga la''.', 'accessibility', 'medium', 29),
    ('Ganacsigu wuxuu u baahan yahay kalsooni.', 'daily-life', 'easy', 30),
    ('Dhalinyaradu waxay abuuri karaan mustaqbal fiican.', 'community', 'easy', 31),
    ('Waxaa muhiim ah in xogta si ammaan ah loo hayo.', 'privacy', 'medium', 32),
    ('Waxaan dooran karaa inaan joojiyo duubista.', 'privacy', 'easy', 33),
    ('Codad badan ayaa hagaajiya tayada nidaamka.', 'technology', 'medium', 34),
    ('Fadlan si dabiici ah u hadal.', 'recording', 'easy', 35),
    ('Haddii aad diyaar tahay, bilow duubista.', 'recording', 'easy', 36),
    ('Waxaan ku faraxsanahay inaan caawiyo.', 'community', 'easy', 37),
    ('Bulshada Soomaaliyeed way kala codad badan tahay.', 'culture', 'medium', 38),
    ('Lahjad kasta waxay leedahay qiimo.', 'culture', 'easy', 39),
    ('Tiknoolajiyada waa inay dadka u adeegtaa.', 'technology', 'medium', 40),
    ('Codkani waa tabaruc aan oggolaaday.', 'privacy', 'easy', 41),
    ('Waxaan rabnaa AI si masuuliyad leh loo dhiso.', 'technology', 'medium', 42),
    ('Af Soomaaligu wuxuu u qalmaa qalab casri ah.', 'culture', 'medium', 43),
    ('Mahadsanid inaad wakhtigaaga bixisay.', 'community', 'easy', 44),
    ('Duubista xigta diyaar bay kuu tahay.', 'recording', 'easy', 45)
) AS seed(text, category, difficulty, order_number)
WHERE NOT EXISTS (
  SELECT 1 FROM prompts existing
  WHERE existing.pack_id = everyday_pack.id AND existing.order_number = seed.order_number
);
