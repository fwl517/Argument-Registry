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
const { asyncHandler } = require('../middleware/errorHandler');
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

// ── GET /api/keywords ─────────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query('SELECT id, tag FROM keywords ORDER BY tag ASC');
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
       RETURNING id, tag`,
      [tag]
    );
    res.status(201).json(rows[0]);
  })
);

module.exports = { router, normaliseTag };
