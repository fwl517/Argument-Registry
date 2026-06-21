-- Migration: add new category values to the argument-type and source-type enums.
--   * t_argument_type: + 'Argument'  (placed before the catch-all 'Other')
--   * t_source_type:   + 'Other'
--
-- Safe to run on an existing database; npm run migrate (which runs the full
-- schema.sql via CREATE TYPE) cannot, because the enum types already exist.
-- Additive only: no existing rows are touched and nothing is dropped.
-- IF NOT EXISTS makes this idempotent — re-running it is a no-op.
--
-- Run with:
--   psql "$DATABASE_URL" -f db/migrations/2026-06-21-add-categories.sql

ALTER TYPE t_argument_type ADD VALUE IF NOT EXISTS 'Argument' BEFORE 'Other';
ALTER TYPE t_source_type   ADD VALUE IF NOT EXISTS 'Other';
