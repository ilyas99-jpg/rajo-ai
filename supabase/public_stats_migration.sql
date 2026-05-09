-- ============================================================
-- RAJO AI — Public Dataset Stats Migration
-- ============================================================
-- PURPOSE:
--   Create a database function that returns aggregate dataset
--   statistics to anonymous (public) visitors. No personal data
--   is exposed — only counts and totals.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste → Run
--
-- SECURITY MODEL:
--   • SECURITY DEFINER runs the function as its owner (postgres),
--     bypassing RLS. This is intentional and safe here because the
--     function returns ONLY aggregated data — no individual rows.
--   • SET search_path = public pins the schema to prevent
--     search_path injection attacks.
--   • STABLE tells Postgres the function doesn't modify data and
--     returns the same result within a transaction (optimizer hint).
--   • GRANT EXECUTE TO anon allows unauthenticated browser calls
--     via supabase.rpc("get_public_stats").
-- ============================================================

CREATE OR REPLACE FUNCTION get_public_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    -- Total recordings ever submitted (all statuses)
    'total_recordings',
    COUNT(*)::int,

    -- Recordings that passed quality review
    'approved_recordings',
    COUNT(*) FILTER (WHERE status = 'approved')::int,

    -- Cumulative audio duration of approved recordings (seconds)
    'approved_duration_seconds',
    COALESCE(
      SUM(duration_seconds) FILTER (WHERE status = 'approved'),
      0
    )::numeric,

    -- Distinct donors who have submitted at least one recording
    'total_contributors',
    COUNT(DISTINCT donor_id) FILTER (WHERE donor_id IS NOT NULL)::int,

    -- Number of distinct Somali dialects in approved recordings
    'dialects_covered',
    COUNT(DISTINCT dialect) FILTER (
      WHERE status = 'approved'
        AND dialect IS NOT NULL
        AND dialect <> ''
    )::int,

    -- Number of distinct countries in approved recordings
    'countries_covered',
    COUNT(DISTINCT country) FILTER (
      WHERE status = 'approved'
        AND country IS NOT NULL
        AND country <> ''
    )::int
  )
  FROM voice_recordings;
$$;

-- Allow public (unauthenticated) callers to invoke this function.
GRANT EXECUTE ON FUNCTION get_public_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_public_stats() TO authenticated;

-- ── Verification ──────────────────────────────────────────────
-- Test the function directly:
--   SELECT get_public_stats();
--
-- Test anonymous access (simulates a browser call):
--   SET ROLE anon;
--   SELECT get_public_stats();
--   RESET ROLE;
-- ============================================================
