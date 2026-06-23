/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

/**
 * Normalise a tag into a slug: strip a leading '#', trim, lowercase, and
 * collapse internal whitespace to single hyphens.  "  #Carbon Tax " -> "carbon-tax"
 */
function normaliseTag(raw) {
  return String(raw)
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/** Parse a keyword id from a route param, or 404 if it is not a positive int. */
function parseId(raw) {
  const id = Number.parseInt(raw, 10);
  if (Number.isNaN(id) || id < 1) throw new HttpError(404, 'NOT_FOUND');
  return id;
}

// ── GET /api/keywords ─────────────────────────────────────────────────────────
// Returns every keyword with its alias grouping:
//   canonical_tag  — the tag of this row's canonical (null when itself canonical)
//   concept_id     — COALESCE(alias_of, id): rows sharing it are synonyms
//   group_tag      — the canonical tag of the concept (for client-side grouping)
//   entry_count    — how many entries carry this exact tag
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT k.id, k.tag, k.alias_of,
              c.tag AS canonical_tag,
              COALESCE(k.alias_of, k.id) AS concept_id,
              COALESCE(c.tag, k.tag)     AS group_tag,
              COUNT(ek.entry_id)::int    AS entry_count
         FROM keywords k
         LEFT JOIN keywords c        ON c.id = k.alias_of
         LEFT JOIN entry_keywords ek ON ek.keyword_id = k.id
        GROUP BY k.id, k.tag, k.alias_of, c.tag
        ORDER BY group_tag ASC, k.alias_of IS NOT NULL, k.tag ASC`
    );
    res.json(rows);
  })
);

// ── POST /api/keywords ────────────────────────────────────────────────────────
router.post(
  '/',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const tag = normaliseTag(req.body?.tag ?? '');
    if (tag === '') {
      return res.status(422).json({ error: 'VALIDATION', fields: { tag: 'Required.' } });
    }

    // Idempotent: return the existing row if the tag already exists.
    const { rows } = await db.query(
      `INSERT INTO keywords (tag) VALUES ($1)
       ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag
       RETURNING id, tag, alias_of`,
      [tag]
    );
    res.status(201).json(rows[0]);
  })
);

// ── POST /api/keywords/:id/alias ──────────────────────────────────────────────
// Merge keyword :id (and any aliases that already point at it) into the concept
// group of `target_id`. Both become synonyms of the target's canonical keyword.
router.post(
  '/:id/alias',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const targetId = Number.parseInt(req.body?.target_id, 10);
    if (Number.isNaN(targetId) || targetId < 1) {
      return res.status(422).json({ error: 'VALIDATION', fields: { target_id: 'Required.' } });
    }
    if (targetId === id) {
      return res.status(422).json({ error: 'VALIDATION', fields: { target_id: 'A keyword cannot alias itself.' } });
    }

    const group = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT id, tag, alias_of FROM keywords WHERE id = ANY($1::int[]) FOR UPDATE',
        [[id, targetId]]
      );
      const self = rows.find((r) => r.id === id);
      const target = rows.find((r) => r.id === targetId);
      if (!self || !target) throw new HttpError(404, 'NOT_FOUND');

      // Resolve to canonical ids. The target's group always wins.
      const canonical = target.alias_of ?? target.id;
      const selfConcept = self.alias_of ?? self.id;
      // Already in the same group → idempotent no-op.
      if (selfConcept !== canonical) {
        // Repoint any aliases currently pointing at `id` onto the new canonical
        // first, so `id` has no dependants when it becomes an alias itself.
        await client.query('UPDATE keywords SET alias_of = $1 WHERE alias_of = $2', [canonical, id]);
        await client.query('UPDATE keywords SET alias_of = $1 WHERE id = $2', [canonical, id]);
      }
      return fetchGroup(client, canonical);
    });

    res.json(group);
  })
);

// ── DELETE /api/keywords/:id/alias ────────────────────────────────────────────
// Detach :id from its group: it becomes its own canonical keyword again.
router.delete(
  '/:id/alias',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { rowCount } = await db.query(
      'UPDATE keywords SET alias_of = NULL WHERE id = $1',
      [id]
    );
    if (rowCount === 0) throw new HttpError(404, 'NOT_FOUND');
    res.json({ ok: true });
  })
);

/** Load a concept group (canonical + its aliases) for an API response. */
async function fetchGroup(client, canonicalId) {
  const { rows } = await client.query(
    `SELECT id, tag, alias_of FROM keywords
      WHERE id = $1 OR alias_of = $1
      ORDER BY alias_of IS NOT NULL, tag`,
    [canonicalId]
  );
  return {
    canonical_id: canonicalId,
    canonical_tag: rows.find((r) => r.id === canonicalId)?.tag ?? null,
    members: rows,
  };
}

module.exports = { router, normaliseTag };
