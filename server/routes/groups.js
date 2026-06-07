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
const { isHexColour, textColourFor } = require('../utils/colour');

const router = express.Router();

function serialiseGroup(row) {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    text_colour: row.text_colour,
    is_home: row.is_home,
    is_archived: row.is_archived,
    member_quota: row.member_quota,
  };
}

// ── GET /api/groups ─────────────────────────────────────────────────────────
// Public-readable so the listing filter and the upload form can populate
// their group dropdowns without auth.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, name, colour, text_colour, is_home, is_archived, member_quota
         FROM groups
        ORDER BY created_at ASC`
    );
    res.json(rows.map(serialiseGroup));
  })
);

// All write paths require Root.
router.post('/', requirePermission('Root'), asyncHandler(create));
router.patch('/:id', requirePermission('Root'), asyncHandler(update));
router.delete('/:id', requirePermission('Root'), asyncHandler(remove));

// ── POST /api/groups ────────────────────────────────────────────────────────
async function create(req, res) {
  const { name, colour, member_quota: memberQuota } = req.body || {};

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
  let quota = null;
  if (memberQuota !== undefined && memberQuota !== null && memberQuota !== '') {
    const n = parseInt(memberQuota, 10);
    if (!Number.isInteger(n) || n <= 0) {
      fields.member_quota = 'Must be a positive integer or empty for unlimited.';
    } else {
      quota = n;
    }
  }
  if (Object.keys(fields).length > 0) {
    return res.status(422).json({ error: 'VALIDATION', fields });
  }

  const textColour = textColourFor(bg);

  let row;
  try {
    const result = await db.query(
      `INSERT INTO groups (name, colour, text_colour, member_quota)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, colour, text_colour, is_home, is_archived, member_quota`,
      [name.trim(), bg, textColour, quota]
    );
    row = result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      return res.status(422).json({ error: 'VALIDATION', fields: { name: 'Already exists.' } });
    }
    throw err;
  }

  res.status(201).json(serialiseGroup(row));
}

// ── PATCH /api/groups/:id ───────────────────────────────────────────────────
async function update(req, res) {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new HttpError(404, 'NOT_FOUND');
  }

  const existing = await db.query(
    'SELECT id, is_home, is_archived FROM groups WHERE id = $1',
    [id]
  ).then((r) => r.rows[0]).catch(() => null);
  if (!existing) throw new HttpError(404, 'NOT_FOUND');

  const {
    name,
    colour,
    member_quota: memberQuota,
    is_archived: isArchived,
  } = req.body || {};

  // Archived groups are read-only — only the un-archive flip is allowed.
  if (existing.is_archived) {
    const onlyUnarchiving =
      isArchived === false &&
      name === undefined &&
      colour === undefined &&
      memberQuota === undefined;
    if (!onlyUnarchiving) {
      return res.status(422).json({ error: 'GROUP_ARCHIVED', message: 'Unarchive the group before editing it.' });
    }
  }

  const fields = {};
  const sets = [];
  const params = [];
  let i = 1;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      fields.name = 'Cannot be empty.';
    } else {
      sets.push(`name = $${i++}`);
      params.push(name.trim());
    }
  }

  if (colour !== undefined && colour !== null) {
    if (!isHexColour(colour)) {
      fields.colour = 'Must be a 6-digit hex colour.';
    } else {
      const bg = colour.toUpperCase();
      sets.push(`colour = $${i++}`);
      params.push(bg);
      sets.push(`text_colour = $${i++}`);
      params.push(textColourFor(bg));
    }
  }

  if (memberQuota !== undefined) {
    if (memberQuota === null || memberQuota === '') {
      sets.push(`member_quota = $${i++}`);
      params.push(null);
    } else {
      const n = parseInt(memberQuota, 10);
      if (!Number.isInteger(n) || n <= 0) {
        fields.member_quota = 'Must be a positive integer or null for unlimited.';
      } else {
        sets.push(`member_quota = $${i++}`);
        params.push(n);
      }
    }
  }

  if (isArchived !== undefined) {
    if (typeof isArchived !== 'boolean') {
      fields.is_archived = 'Must be true or false.';
    } else if (existing.is_home && isArchived === true) {
      // Belt-and-braces; the DB trigger will also refuse this.
      fields.is_archived = 'The home group cannot be archived.';
    } else {
      sets.push(`is_archived = $${i++}`);
      params.push(isArchived);
    }
  }

  if (Object.keys(fields).length > 0) {
    return res.status(422).json({ error: 'VALIDATION', fields });
  }
  if (sets.length === 0) {
    return res.status(422).json({ error: 'VALIDATION', fields: { _: 'No changes supplied.' } });
  }

  params.push(id);
  let row;
  try {
    const result = await db.query(
      `UPDATE groups SET ${sets.join(', ')} WHERE id = $${i}
        RETURNING id, name, colour, text_colour, is_home, is_archived, member_quota`,
      params
    );
    row = result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      return res.status(422).json({ error: 'VALIDATION', fields: { name: 'Already exists.' } });
    }
    if (/HOME_GROUP_PROTECTED/.test(err.message || '')) {
      return res
        .status(422)
        .json({ error: 'VALIDATION', fields: { is_archived: 'The home group cannot be archived.' } });
    }
    throw err;
  }

  res.json(serialiseGroup(row));
}

// ── DELETE /api/groups/:id ──────────────────────────────────────────────────
// Hard delete. Requires the group to be empty — the FK from users.group_id
// is ON DELETE RESTRICT, so any remaining members block the call with a
// 23503 error from Postgres.
async function remove(req, res) {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new HttpError(404, 'NOT_FOUND');
  }

  try {
    const result = await db.query('DELETE FROM groups WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new HttpError(404, 'NOT_FOUND');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.code === '23503') {
      return res
        .status(422)
        .json({ error: 'GROUP_NOT_EMPTY', message: 'Move or remove all members before deleting the group.' });
    }
    if (/HOME_GROUP_PROTECTED/.test(err.message || '')) {
      return res
        .status(422)
        .json({ error: 'HOME_GROUP_PROTECTED', message: 'The home group cannot be deleted.' });
    }
    throw err;
  }

  res.status(204).end();
}

module.exports = router;
