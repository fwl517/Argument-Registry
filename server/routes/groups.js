/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');
const { isHexColour, textColourFor } = require('../utils/colour');
const { upload, removeUploaded } = require('../middleware/upload');

const router = express.Router();

// Columns returned everywhere a group is read.
const GROUP_COLS =
  'id, name, colour, text_colour, is_home, is_archived, member_quota, link, logo_path';

const LOGO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

// Accept only http(s) absolute URLs for a group's website.
function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function serialiseGroup(row) {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    text_colour: row.text_colour,
    is_home: row.is_home,
    is_archived: row.is_archived,
    member_quota: row.member_quota,
    link: row.link || null,
    // Stable per-group URL; the ?v cache-buster changes whenever the logo file
    // is replaced (the stored filename is a fresh UUID each upload).
    logo_url: row.logo_path
      ? `/api/groups/${row.id}/logo?v=${encodeURIComponent(row.logo_path)}`
      : null,
  };
}

// Best-effort removal of a stored logo file by its bare filename.
function unlinkLogo(filename) {
  if (!filename || filename !== path.basename(filename)) return;
  fs.unlink(path.join(config.fileStorePath, filename), () => { /* ignore */ });
}

// ── GET /api/groups ─────────────────────────────────────────────────────────
// Public-readable so the listing filter and the upload form can populate
// their group dropdowns without auth.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT ${GROUP_COLS}
         FROM groups
        ORDER BY created_at ASC`
    );
    res.json(rows.map(serialiseGroup));
  })
);

// ── GET /api/groups/:id/logo ────────────────────────────────────────────────
// Public — the associated-groups banner renders on the unauthenticated front
// page. Streams the stored image with a path-traversal guard.
router.get('/:id/logo', asyncHandler(serveLogo));

// All write paths require Root.
router.post('/', requirePermission('Root'), asyncHandler(create));
router.patch('/:id', requirePermission('Root'), asyncHandler(update));
router.delete('/:id', requirePermission('Root'), asyncHandler(remove));

// Logo management (Root). upload.single runs before the handler so a rejected
// file (wrong type / too large) is surfaced by the shared error handler.
router.post('/:id/logo', requirePermission('Root'), upload.single('logo'), asyncHandler(uploadLogo));
router.delete('/:id/logo', requirePermission('Root'), asyncHandler(deleteLogo));

// ── POST /api/groups ────────────────────────────────────────────────────────
async function create(req, res) {
  const { name, colour, member_quota: memberQuota, link } = req.body || {};

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
  let linkValue = null;
  if (link !== undefined && link !== null && String(link).trim() !== '') {
    if (!isHttpUrl(link)) {
      fields.link = 'Must be a full http(s) web address.';
    } else {
      linkValue = link.trim();
    }
  }
  if (Object.keys(fields).length > 0) {
    return res.status(422).json({ error: 'VALIDATION', fields });
  }

  const textColour = textColourFor(bg);

  let row;
  try {
    const result = await db.query(
      `INSERT INTO groups (name, colour, text_colour, member_quota, link)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${GROUP_COLS}`,
      [name.trim(), bg, textColour, quota, linkValue]
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
    link,
  } = req.body || {};

  // Archived groups are read-only — only the un-archive flip is allowed.
  if (existing.is_archived) {
    const onlyUnarchiving =
      isArchived === false &&
      name === undefined &&
      colour === undefined &&
      memberQuota === undefined &&
      link === undefined;
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

  if (link !== undefined) {
    if (link === null || String(link).trim() === '') {
      sets.push(`link = $${i++}`);
      params.push(null);
    } else if (!isHttpUrl(link)) {
      fields.link = 'Must be a full http(s) web address.';
    } else {
      sets.push(`link = $${i++}`);
      params.push(link.trim());
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
        RETURNING ${GROUP_COLS}`,
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

  let deletedLogo = null;
  try {
    const result = await db.query(
      'DELETE FROM groups WHERE id = $1 RETURNING logo_path',
      [id]
    );
    if (result.rowCount === 0) throw new HttpError(404, 'NOT_FOUND');
    deletedLogo = result.rows[0].logo_path;
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

  if (deletedLogo) unlinkLogo(deletedLogo);
  res.status(204).end();
}

// ── POST /api/groups/:id/logo ───────────────────────────────────────────────
// Replaces the group's logo with the uploaded image and removes the old file.
async function uploadLogo(req, res) {
  const id = req.params.id;

  if (!req.file) {
    throw new HttpError(422, 'VALIDATION', { fields: { logo: 'An image file is required.' } });
  }
  // The shared upload filter already restricts MIME types, but logos must be
  // images specifically — reject anything else and clean up the stray file.
  const ext = path.extname(req.file.filename).toLowerCase();
  if (!LOGO_MIME[ext]) {
    removeUploaded(req.file);
    throw new HttpError(422, 'VALIDATION', { fields: { logo: 'Logo must be a PNG, JPG, GIF, WEBP, AVIF or BMP image.' } });
  }

  const existing = await db
    .query('SELECT id, is_archived, logo_path FROM groups WHERE id = $1', [id])
    .then((r) => r.rows[0])
    .catch(() => null);
  if (!existing) {
    removeUploaded(req.file);
    throw new HttpError(404, 'NOT_FOUND');
  }
  if (existing.is_archived) {
    removeUploaded(req.file);
    return res.status(422).json({ error: 'GROUP_ARCHIVED', message: 'Unarchive the group before editing it.' });
  }

  const { rows } = await db.query(
    `UPDATE groups SET logo_path = $1 WHERE id = $2 RETURNING ${GROUP_COLS}`,
    [req.file.filename, id]
  );
  if (existing.logo_path) unlinkLogo(existing.logo_path);
  res.json(serialiseGroup(rows[0]));
}

// ── DELETE /api/groups/:id/logo ─────────────────────────────────────────────
async function deleteLogo(req, res) {
  const id = req.params.id;
  const existing = await db
    .query('SELECT logo_path FROM groups WHERE id = $1', [id])
    .then((r) => r.rows[0])
    .catch(() => null);
  if (!existing) throw new HttpError(404, 'NOT_FOUND');

  const { rows } = await db.query(
    `UPDATE groups SET logo_path = NULL WHERE id = $1 RETURNING ${GROUP_COLS}`,
    [id]
  );
  if (existing.logo_path) unlinkLogo(existing.logo_path);
  res.json(serialiseGroup(rows[0]));
}

// ── GET /api/groups/:id/logo ────────────────────────────────────────────────
async function serveLogo(req, res) {
  const id = req.params.id;
  const row = await db
    .query('SELECT logo_path FROM groups WHERE id = $1', [id])
    .then((r) => r.rows[0])
    .catch(() => null);
  const filename = row && row.logo_path;
  if (!filename) throw new HttpError(404, 'NOT_FOUND');

  // Bare-filename guard before touching disk.
  if (filename !== path.basename(filename)) throw new HttpError(400, 'BAD_REQUEST');
  const resolved = path.resolve(config.fileStorePath, filename);
  if (!resolved.startsWith(config.fileStorePath + path.sep)) throw new HttpError(400, 'BAD_REQUEST');
  if (!fs.existsSync(resolved)) throw new HttpError(404, 'NOT_FOUND');

  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', LOGO_MIME[ext] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const stream = fs.createReadStream(resolved);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  stream.pipe(res);
}

module.exports = router;
