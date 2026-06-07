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
const { isHexColour, textColourFor } = require('../utils/colour');

const router = express.Router();

function serialiseSource(row) {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    text_colour: row.text_colour,
    is_preset: row.is_preset,
  };
}

// ── GET /api/sources ──────────────────────────────────────────────────────────
// Public. Presets first, then alphabetical.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, name, colour, text_colour, is_preset
         FROM sources
        ORDER BY is_preset DESC, name ASC`
    );
    res.json(rows.map(serialiseSource));
  })
);

// ── POST /api/sources ──────────────────────────────────────────────────────────
// Write, Admin, Root. Always creates a non-preset source.
router.post(
  '/',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const { name, colour } = req.body || {};

    const fields = {};
    if (typeof name !== 'string' || name.trim() === '') {
      fields.name = 'Required.';
    }
    let bg = '#6B7280';
    if (colour !== undefined && colour !== null && colour !== '') {
      if (!isHexColour(colour)) {
        fields.colour = 'Must be a 6-digit hex colour like #1B3A6B.';
      } else {
        bg = colour.toUpperCase();
      }
    }
    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    const textColour = textColourFor(bg);

    let row;
    try {
      const result = await db.query(
        `INSERT INTO sources (name, colour, text_colour, is_preset, created_by)
         VALUES ($1, $2, $3, FALSE, $4)
         RETURNING id, name, colour, text_colour, is_preset`,
        [name.trim(), bg, textColour, req.user.id]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(422).json({ error: 'VALIDATION', fields: { name: 'Already exists.' } });
      }
      throw err;
    }

    res.status(201).json(serialiseSource(row));
  })
);

module.exports = router;
