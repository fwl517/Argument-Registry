-- ================================================================
-- POLITICAL SOCIETY ARGUMENT & SOURCE DATABASE ENGINE
-- Schema Version : 2.0
-- Target         : PostgreSQL 15+
-- -------------------------------------------------
-- Author:   BEN GREEN
-- GitHub:   https://github.com/fwl517/Argument-Registry
-- Licence:  CC0
-- ================================================================
--
-- Run once against an empty database:
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Then seed the root account with:
--   node scripts/seed-root.js
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ================================================================
-- SECTION 1 — ENUMERATED TYPES
-- ================================================================

CREATE TYPE t_permission AS ENUM (
    'Root',
    'Admin',
    'Write',
    'Read'
);

CREATE TYPE t_society_role AS ENUM (
    'President',
    'General Secretary',
    'Treasurer',
    'Extended-Committee',
    'Member',
    'Alumni'
);

CREATE TYPE t_stance AS ENUM (
    'Pro',
    'Con',
    'Neutral/Background'
);

CREATE TYPE t_argument_type AS ENUM (
    'Study',
    'Article',
    'Raw Statistic',
    'Policy Paper',
    'Argument',
    'Other'
);

-- The category of the source material (what kind of document it is).
-- Distinct from the `sources` table, which identifies the specific
-- party or organisation that produced it.
CREATE TYPE t_source_type AS ENUM (
    'Our Party Platform',
    'Opposition Platform',
    'Academic',
    'News',
    'Original Society Material',
    'Other'
);

-- Relation types between entries. Most are directional (A → B means
-- "A [relation] B") and the inverse is derived at query time.
-- 'Updates' captures the case where newer evidence supersedes an older argument.
-- 'Related' is SYMMETRIC: it simply means the two entries have something to do
-- with each other, so a single row reads the same in both directions.
CREATE TYPE t_relation AS ENUM (
    'Counters',
    'Rebuts',
    'Evidence For',
    'Updates',
    'Related'
);


-- ================================================================
-- SECTION 2 — GROUPS (affiliations / partner societies)
-- ================================================================
--
-- Groups model the society or organisation a user belongs to. Exactly one
-- group has is_home = TRUE — that's the host society, whose Admins have
-- platform-wide reach. Every other group is a partner; its Admins are
-- scoped to their own group's members and entries.
--
-- The Independent group is seeded alongside the home group as a catch-all
-- for unaffiliated individuals. It carries no group-admins by convention.
--
-- Lifecycle: Root can archive a group (soft, reversible) or hard-delete it
-- (FK ON DELETE RESTRICT forces the group to be empty first). The home group
-- itself can never be archived or deleted.

CREATE TABLE groups (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    colour          VARCHAR(7)   NOT NULL DEFAULT '#6B7280',
    text_colour     VARCHAR(7)   NOT NULL DEFAULT '#FFFFFF',
    is_home         BOOLEAN      NOT NULL DEFAULT FALSE,
    is_archived     BOOLEAN      NOT NULL DEFAULT FALSE,
    member_quota    INTEGER,                            -- NULL = unlimited
    link            VARCHAR(2048),                      -- the group's own website
    logo_path       VARCHAR(512),                       -- bare filename in FILE_STORE_PATH
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_member_quota_positive
        CHECK (member_quota IS NULL OR member_quota > 0)
);

COMMENT ON TABLE  groups               IS 'Affiliations / partner societies that users belong to.';
COMMENT ON COLUMN groups.is_home       IS 'TRUE for the singular host group — its Admins have cross-group reach.';
COMMENT ON COLUMN groups.is_archived   IS 'TRUE freezes the group: no new users, no name/quota edits. Existing members can still sign in.';
COMMENT ON COLUMN groups.member_quota  IS 'NULL = unlimited. Counts only is_active = TRUE rows.';
COMMENT ON COLUMN groups.link          IS 'Optional public website for the group, shown in the associated-groups banner.';
COMMENT ON COLUMN groups.logo_path     IS 'Bare filename of the uploaded logo in FILE_STORE_PATH. Served publicly via /api/groups/:id/logo.';

CREATE INDEX idx_groups_home     ON groups(is_home);
CREATE INDEX idx_groups_archived ON groups(is_archived);

-- Seed: the host group and the catch-all Independent group. Both seeded
-- with NULL quota; Root can tighten the Independent cap later if desired.
INSERT INTO groups (name, colour, text_colour, is_home) VALUES
    ('Home Society', '#1B3A6B', '#FFFFFF', TRUE),
    ('Independent',  '#6B7280', '#FFFFFF', FALSE);

-- Deferred singleton: paralleling the Root user singleton.
CREATE OR REPLACE FUNCTION fn_check_home_group_singleton()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM groups WHERE is_home = TRUE;
    IF v_count != 1 THEN
        RAISE EXCEPTION 'HOME_GROUP_SINGLETON_VIOLATION: count is %', v_count;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_home_group_singleton
    AFTER INSERT OR UPDATE OR DELETE ON groups
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_home_group_singleton();

-- The home group cannot be archived or deleted.
CREATE OR REPLACE FUNCTION fn_protect_home_group()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.is_home THEN
        RAISE EXCEPTION 'HOME_GROUP_PROTECTED: cannot delete the home group.';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_home AND NEW.is_archived THEN
        RAISE EXCEPTION 'HOME_GROUP_PROTECTED: cannot archive the home group.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_protect_home_group
    BEFORE UPDATE OR DELETE ON groups
    FOR EACH ROW EXECUTE FUNCTION fn_protect_home_group();


-- ================================================================
-- SECTION 3 — USERS
-- ================================================================

CREATE TABLE users (
    id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(100)      NOT NULL UNIQUE,
    password_hash   VARCHAR(255)      NOT NULL,
    permission      t_permission      NOT NULL DEFAULT 'Read',
    society_role    t_society_role    NOT NULL DEFAULT 'Member',
    group_id        UUID              NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    is_active       BOOLEAN           NOT NULL DEFAULT TRUE,
    force_reset     BOOLEAN           NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    created_by      UUID              REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_users_group ON users(group_id);

COMMENT ON COLUMN users.password_hash  IS 'Argon2id hash only. Plaintext never stored.';
COMMENT ON COLUMN users.force_reset    IS 'Blocks all routes except /reset-password until cleared.';

CREATE OR REPLACE FUNCTION fn_lock_user_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'USER_ID_IMMUTABLE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_user_id
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_lock_user_id();

CREATE OR REPLACE FUNCTION fn_block_root_deletion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.permission = 'Root' THEN
        RAISE EXCEPTION 'ROOT_DELETION_BLOCKED: Transfer Crown before removing this account.';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_block_root_deletion
    BEFORE DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_block_root_deletion();

-- Deferred singleton: allows Transfer Crown's two-step promote/demote
-- to coexist temporarily within a transaction.
CREATE OR REPLACE FUNCTION fn_check_root_singleton()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM users WHERE permission = 'Root';
    IF v_count != 1 THEN
        RAISE EXCEPTION 'ROOT_SINGLETON_VIOLATION: count is %. Use Transfer Crown.', v_count;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_root_singleton
    AFTER INSERT OR UPDATE OR DELETE ON users
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_root_singleton();

CREATE OR REPLACE PROCEDURE transfer_crown(p_current UUID, p_new UUID)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM users WHERE id IN (p_current, p_new) ORDER BY id FOR UPDATE;

    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_current AND permission = 'Root' AND is_active) THEN
        RAISE EXCEPTION 'INVALID_CURRENT_ROOT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_new AND is_active) THEN
        RAISE EXCEPTION 'INVALID_TARGET';
    END IF;
    IF p_current = p_new THEN
        RAISE EXCEPTION 'SAME_ACCOUNT';
    END IF;

    UPDATE users SET permission = 'Root'  WHERE id = p_new;
    UPDATE users SET permission = 'Admin' WHERE id = p_current;
END;
$$;


-- ================================================================
-- SECTION 4 — SESSIONS
-- ================================================================

CREATE TABLE sessions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        VARCHAR(16) NOT NULL DEFAULT 'full',  -- 'full' | 'reset'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '8 hours'),
    ip_address  INET,
    user_agent  TEXT
);

COMMENT ON COLUMN sessions.kind IS 'full = normal 8h session; reset = restricted 30min pre-session for forced password change.';

CREATE INDEX idx_sessions_user   ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);


-- ================================================================
-- SECTION 5 — SOURCES
-- Sources identify the specific party or organisation behind a
-- piece of material. Distinct from source_type, which is the
-- category (e.g. "Academic", "News"). Sources can be preset
-- party entries or user-defined custom sources.
-- ================================================================

CREATE TABLE sources (
    id          SERIAL        PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL UNIQUE,
    colour      VARCHAR(7)    NOT NULL DEFAULT '#6B7280',  -- Badge background hex
    text_colour VARCHAR(7)    NOT NULL DEFAULT '#FFFFFF',  -- Badge text hex (auto or manual)
    is_preset   BOOLEAN       NOT NULL DEFAULT FALSE,
    created_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  sources             IS 'Specific party or organisation presets and user-defined sources. Linked to entries via source_id.';
COMMENT ON COLUMN sources.colour      IS 'Hex badge background colour, e.g. #E4003B.';
COMMENT ON COLUMN sources.text_colour IS 'Hex badge text colour computed from background luminance. #000000 or #FFFFFF.';
COMMENT ON COLUMN sources.is_preset   IS 'TRUE for built-in party entries. Presets cannot be deleted.';

CREATE INDEX idx_sources_preset ON sources(is_preset);

-- ── Preset seed: UK political parties ────────────────────────────────────────
-- These are inserted immediately; no user dependency (created_by = NULL).
INSERT INTO sources (name, colour, text_colour, is_preset) VALUES
    ('Labour',            '#E4003B', '#FFFFFF', TRUE),
    ('Conservative',      '#0087DC', '#FFFFFF', TRUE),
    ('Liberal Democrats', '#FAA61A', '#000000', TRUE),
    ('Green Party',       '#00B140', '#FFFFFF', TRUE),
    ('Reform UK',         '#12B6CF', '#000000', TRUE),
    ('SNP',               '#F8D500', '#000000', TRUE),
    ('Plaid Cymru',       '#3F8428', '#FFFFFF', TRUE),
    ('DUP',               '#BF3F00', '#FFFFFF', TRUE),
    ('Sinn Féin',         '#326760', '#FFFFFF', TRUE),
    ('Alliance Party',    '#F6CB2F', '#000000', TRUE),
    ('SDLP',              '#2AA82C', '#FFFFFF', TRUE),
    ('UKIP',              '#70147A', '#FFFFFF', TRUE),
    ('Restore Britain',   '#1B3A6B', '#FFFFFF', TRUE);

-- Protect presets from deletion
CREATE OR REPLACE FUNCTION fn_block_preset_source_deletion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_preset THEN
        RAISE EXCEPTION 'PRESET_PROTECTED: Party presets cannot be deleted.';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_block_preset_source_deletion
    BEFORE DELETE ON sources
    FOR EACH ROW EXECUTE FUNCTION fn_block_preset_source_deletion();


-- ================================================================
-- SECTION 6 — ENTRIES (Argument Matrix)
-- ================================================================

CREATE TABLE entries (
    id                       UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    title                    VARCHAR(500)      NOT NULL,
    topic                    VARCHAR(500)      NOT NULL,
    stance                   t_stance          NOT NULL,
    argument_type            t_argument_type   NOT NULL,
    source_type              t_source_type     NOT NULL,
    source_id                INTEGER           REFERENCES sources(id) ON DELETE SET NULL,
    date_published           DATE,
    gist                     TEXT              NOT NULL,
    is_private               BOOLEAN           NOT NULL DEFAULT TRUE,
    link                     VARCHAR(2048),
    local_path               VARCHAR(1024),
    uploader_id              UUID              REFERENCES users(id) ON DELETE RESTRICT,
    foreign_uploader_name    VARCHAR(100),
    foreign_uploader_role    t_society_role,
    foreign_uploader_group   VARCHAR(100),
    anonymise_uploader       BOOLEAN           NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_link_or_local
        CHECK (link IS NOT NULL OR local_path IS NOT NULL),

    -- Identity rules:
    --   * Real uploader      : uploader_id set, foreign_* null.
    --   * Foreign import     : uploader_id null, foreign_uploader_name set (display only).
    --   * Anonymous          : all identity columns null, anonymise_uploader = TRUE.
    --   * Real + anonymised  : uploader_id set, foreign_* null, anonymise_uploader = TRUE
    --                          (serialiser still hides the name).
    -- Foreign and anonymous can never co-exist on the same row — anonymous foreign
    -- imports just drop identity entirely.
    CONSTRAINT chk_uploader_identity CHECK (
        NOT (uploader_id IS NOT NULL AND foreign_uploader_name IS NOT NULL)
        AND NOT (foreign_uploader_name IS NOT NULL AND anonymise_uploader = TRUE)
        AND (uploader_id IS NOT NULL OR foreign_uploader_name IS NOT NULL OR anonymise_uploader = TRUE)
    )
);

COMMENT ON COLUMN entries.source_type IS 'Category of the source material (what kind of document).';
COMMENT ON COLUMN entries.source_id   IS 'Specific party or organisation. FK to sources table. Nullable.';
COMMENT ON COLUMN entries.local_path  IS 'Relative path from FILE_STORE_PATH root. Served via /api/files only.';
COMMENT ON COLUMN entries.anonymise_uploader IS 'When TRUE, server scrubs identity before JSON serialisation.';
COMMENT ON COLUMN entries.foreign_uploader_name  IS 'Display-only uploader name for entries imported from another instance. Never references a real user account.';
COMMENT ON COLUMN entries.foreign_uploader_role  IS 'Display-only society role accompanying foreign_uploader_name.';
COMMENT ON COLUMN entries.foreign_uploader_group IS 'Display-only group name (the source instance''s society/affiliation). Never references a real groups row.';
COMMENT ON CONSTRAINT chk_link_or_local      ON entries IS 'Every entry must have at least a URL or a local file.';
COMMENT ON CONSTRAINT chk_uploader_identity  ON entries IS 'Exactly one of real uploader, foreign uploader, or anonymous — never two at once.';

CREATE OR REPLACE FUNCTION fn_lock_entry_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'ENTRY_ID_IMMUTABLE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_entry_id
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION fn_lock_entry_id();

CREATE OR REPLACE FUNCTION fn_lock_uploader_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.uploader_id IS DISTINCT FROM OLD.uploader_id THEN
        RAISE EXCEPTION 'AUDIT_VIOLATION: uploader_id is immutable.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_uploader_id
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION fn_lock_uploader_id();

CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE INDEX idx_entries_fts       ON entries USING GIN (to_tsvector('english', title || ' ' || gist));
CREATE INDEX idx_entries_private   ON entries(is_private);
CREATE INDEX idx_entries_stance    ON entries(stance);
CREATE INDEX idx_entries_srctype   ON entries(source_type);
CREATE INDEX idx_entries_argtype   ON entries(argument_type);
CREATE INDEX idx_entries_topic     ON entries(topic text_pattern_ops);
CREATE INDEX idx_entries_source    ON entries(source_id);
CREATE INDEX idx_entries_uploader  ON entries(uploader_id);
CREATE INDEX idx_entries_created   ON entries(created_at);


-- ================================================================
-- SECTION 7 — KEYWORDS / TAGS
-- ================================================================

CREATE TABLE keywords (
    id  SERIAL         PRIMARY KEY,
    tag VARCHAR(100)   NOT NULL UNIQUE
);

COMMENT ON COLUMN keywords.tag IS 'Normalised lowercase, no # prefix. e.g. "carbon-tax".';

CREATE TABLE entry_keywords (
    entry_id    UUID     NOT NULL REFERENCES entries(id)  ON DELETE CASCADE,
    keyword_id  INTEGER  NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, keyword_id)
);

CREATE INDEX idx_ekw_keyword ON entry_keywords(keyword_id);
CREATE INDEX idx_ekw_entry   ON entry_keywords(entry_id);


-- ================================================================
-- SECTION 8 — ARGUMENT RELATIONS (Clash Map)
-- Directional. A → B means "A [relation_type] B".
-- Inverse ("B [Updated By] A") is derived at query time.
-- ================================================================

CREATE TABLE argument_relations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID        NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    target_id       UUID        NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    relation_type   t_relation  NOT NULL,
    context_note    TEXT        NOT NULL,
    created_by      UUID        REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_no_self_link    CHECK  (source_id != target_id),
    CONSTRAINT uq_directional_link UNIQUE (source_id, target_id, relation_type)
);

COMMENT ON COLUMN argument_relations.context_note IS 'Required. The strategic angle: how/why source clashes with or updates target.';
COMMENT ON COLUMN argument_relations.created_by  IS 'Nullable: foreign-imported relations have no local creator.';

CREATE INDEX idx_rel_source ON argument_relations(source_id);
CREATE INDEX idx_rel_target ON argument_relations(target_id);


-- ================================================================
-- SECTION 9 — INITIAL ROOT SEED
-- ================================================================
--
-- Do NOT hand-edit a hash in here. Instead run:
--
--   node scripts/seed-root.js
--
-- which generates an Argon2id hash for a random temporary password,
-- inserts the root account with force_reset = TRUE, and prints the
-- temporary password to the console exactly once.
-- ================================================================
