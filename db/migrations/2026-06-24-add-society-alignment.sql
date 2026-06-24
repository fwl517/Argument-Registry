-- Migration: add the `society_alignment` field to entries.
--
-- Captures whether an entry agrees with, opposes, or is neutral toward OUR
-- society's position — distinct from `stance`, which is the argument's position
-- on its own listed topic. Lets us spot topics that still need counter-arguments.
--
-- The column is NOT NULL (every entry must be classified). Existing rows are
-- backfilled to 'Neutral' as a safe default; re-classify them as needed.
--
-- Safe to run on an existing database. Idempotent: the type guard and the
-- IF NOT EXISTS column add make re-running a no-op.
--
-- Run with:
--   psql "$DATABASE_URL" -f db/migrations/2026-06-24-add-society-alignment.sql

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 't_society_alignment') THEN
        CREATE TYPE t_society_alignment AS ENUM ('Aligned', 'Opposed', 'Neutral');
    END IF;
END$$;

ALTER TABLE entries ADD COLUMN IF NOT EXISTS society_alignment t_society_alignment;

-- Backfill any rows added before this column existed, then enforce NOT NULL.
UPDATE entries SET society_alignment = 'Neutral' WHERE society_alignment IS NULL;

ALTER TABLE entries ALTER COLUMN society_alignment SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entries_society_alignment ON entries(society_alignment);

COMMENT ON COLUMN entries.society_alignment IS 'Where the entry sits relative to our society''s position (Aligned/Opposed/Neutral). Distinct from stance, which is the argument''s position on its own topic.';
