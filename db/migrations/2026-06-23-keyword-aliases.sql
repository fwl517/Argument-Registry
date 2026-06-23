-- Migration: keyword aliases (synonym groups).
--   * keywords.alias_of: self-referential pointer to a canonical keyword.
--     NULL = canonical. Concept of a row = COALESCE(alias_of, id); tags that
--     share a concept are synonyms (matched together in search + link suggestions).
--   * chk_alias_not_self / fn_check_keyword_alias: keep chains one level deep,
--     acyclic, and forbid self-aliasing.
--
-- Safe to run on an existing database. Additive only — existing rows get
-- alias_of = NULL (every tag starts as its own canonical group). Idempotent via
-- IF NOT EXISTS / CREATE OR REPLACE.
--
-- Run with:
--   psql "$DATABASE_URL" -f db/migrations/2026-06-23-keyword-aliases.sql

ALTER TABLE keywords ADD COLUMN IF NOT EXISTS alias_of INTEGER REFERENCES keywords(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_alias_not_self'
    ) THEN
        ALTER TABLE keywords
            ADD CONSTRAINT chk_alias_not_self CHECK (alias_of IS NULL OR alias_of <> id);
    END IF;
END$$;

COMMENT ON COLUMN keywords.alias_of IS 'Canonical keyword id this tag is a synonym of; NULL when this row is itself canonical.';

CREATE INDEX IF NOT EXISTS idx_keywords_alias_of ON keywords(alias_of);

CREATE OR REPLACE FUNCTION fn_check_keyword_alias()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_target_alias INTEGER;
    v_has_aliases  BOOLEAN;
BEGIN
    IF NEW.alias_of IS NOT NULL THEN
        SELECT alias_of INTO v_target_alias FROM keywords WHERE id = NEW.alias_of;
        IF v_target_alias IS NOT NULL THEN
            RAISE EXCEPTION 'ALIAS_CHAIN: alias target must itself be canonical.';
        END IF;
        SELECT EXISTS (SELECT 1 FROM keywords WHERE alias_of = NEW.id) INTO v_has_aliases;
        IF v_has_aliases THEN
            RAISE EXCEPTION 'ALIAS_HAS_MEMBERS: a keyword with aliases cannot become an alias.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_keyword_alias ON keywords;
CREATE TRIGGER trg_check_keyword_alias
    BEFORE INSERT OR UPDATE ON keywords
    FOR EACH ROW EXECUTE FUNCTION fn_check_keyword_alias();
