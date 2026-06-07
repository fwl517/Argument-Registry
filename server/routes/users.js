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
const { requirePermission, atLeast } = require('../middleware/auth');
const { hashPassword, generateTempPassword } = require('../utils/password');

const router = express.Router();

const ASSIGNABLE = ['Read', 'Write', 'Admin']; // Root is never assignable via the API
const SOCIETY_ROLES = [
  'President',
  'General Secretary',
  'Treasurer',
  'Extended-Committee',
  'Member',
  'Alumni',
];

function serialiseUser(row) {
  return {
    id: row.id,
    username: row.username,
    permission: row.permission,
    society_role: row.society_role,
    is_active: row.is_active,
    force_reset: row.force_reset,
    created_at: row.created_at,
  };
}

async function getUserById(id) {
  let result;
  try {
    result = await db.query(
      `SELECT id, username, permission, society_role, is_active, force_reset, created_at
         FROM users WHERE id = $1`,
      [id]
    );
  } catch {
    return null; // malformed uuid
  }
  return result.rows[0] || null;
}

// Every route below requires Admin or higher.
router.use(requirePermission('Admin'));

// ── GET /api/users ──────────────────────────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, username, permission, society_role, is_active, force_reset, created_at
         FROM users
        ORDER BY created_at ASC`
    );
    res.json(rows.map(serialiseUser));
  })
);

// ── POST /api/users ─────────────────────────────────────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const { username, permission, society_role: societyRole } = req.body || {};

    const fields = {};
    if (typeof username !== 'string' || username.trim() === '') {
      fields.username = 'Required.';
    }
    const role = societyRole || 'Member';
    if (!SOCIETY_ROLES.includes(role)) {
      fields.society_role = 'Invalid role.';
    }
    if (!ASSIGNABLE.includes(permission)) {
      fields.permission = 'Must be one of Read, Write, Admin.';
    }
    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    // Admins may only create Read/Write accounts. Root may also create Admin.
    if (permission === 'Admin' && !atLeast(actor.permission, 'Root')) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    let row;
    try {
      const result = await db.query(
        `INSERT INTO users (username, password_hash, permission, society_role, force_reset, created_by)
         VALUES ($1, $2, $3, $4, TRUE, $5)
         RETURNING id, username, permission, society_role, is_active, force_reset, created_at`,
        [username.trim(), passwordHash, permission, role, actor.id]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { username: 'Already taken.' } });
      }
      throw err;
    }

    res.status(201).json({ user: serialiseUser(row), temp_password: tempPassword });
  })
);

// ── PATCH /api/users/:id ─────────────────────────────────────────────────────
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const target = await getUserById(req.params.id);
    if (!target) throw new HttpError(404, 'NOT_FOUND');

    const actorIsRoot = atLeast(actor.permission, 'Root');

    // Admins cannot touch Root or Admin accounts at all.
    if (!actorIsRoot && (target.permission === 'Root' || target.permission === 'Admin')) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    const { username, society_role: societyRole, permission, is_active: isActive } = req.body || {};

    const fields = {};
    const sets = [];
    const params = [];
    let i = 1;

    if (username !== undefined) {
      if (typeof username !== 'string' || username.trim() === '') {
        fields.username = 'Cannot be empty.';
      } else {
        sets.push(`username = $${i++}`);
        params.push(username.trim());
      }
    }

    if (societyRole !== undefined) {
      if (!SOCIETY_ROLES.includes(societyRole)) {
        fields.society_role = 'Invalid role.';
      } else {
        sets.push(`society_role = $${i++}`);
        params.push(societyRole);
      }
    }

    let permissionChanged = false;
    if (permission !== undefined) {
      if (permission === 'Root') {
        // Root is only granted via Transfer Crown.
        throw new HttpError(403, 'PERMISSION_DENIED');
      }
      if (!ASSIGNABLE.includes(permission)) {
        fields.permission = 'Must be one of Read, Write, Admin.';
      } else if (!actorIsRoot && permission === 'Admin') {
        throw new HttpError(403, 'PERMISSION_DENIED');
      } else if (target.permission === 'Root') {
        // Demoting the sitting Root must go through Transfer Crown.
        throw new HttpError(403, 'PERMISSION_DENIED');
      } else if (permission !== target.permission) {
        sets.push(`permission = $${i++}`);
        params.push(permission);
        permissionChanged = true;
      }
    }

    let deactivating = false;
    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        fields.is_active = 'Must be true or false.';
      } else {
        if (target.permission === 'Root' && isActive === false) {
          // Never let the sitting Root be deactivated.
          throw new HttpError(403, 'PERMISSION_DENIED');
        }
        sets.push(`is_active = $${i++}`);
        params.push(isActive);
        deactivating = isActive === false;
      }
    }

    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }
    if (sets.length === 0) {
      return res.status(422).json({ error: 'VALIDATION', fields: { _: 'No changes supplied.' } });
    }

    params.push(target.id);
    let row;
    try {
      const result = await db.query(
        `UPDATE users SET ${sets.join(', ')}
          WHERE id = $${i}
          RETURNING id, username, permission, society_role, is_active, force_reset, created_at`,
        params
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { username: 'Already taken.' } });
      }
      throw err;
    }

    // Permission change or deactivation invalidates the user's sessions.
    if (permissionChanged || deactivating) {
      await db.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    }

    res.json({ user: serialiseUser(row) });
  })
);

// ── DELETE /api/users/:id ─────────────────────────────────────────────────────
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const target = await getUserById(req.params.id);
    if (!target) throw new HttpError(404, 'NOT_FOUND');

    if (target.permission === 'Root') {
      // Blocked at the DB trigger too; refuse early with a clean message.
      throw new HttpError(403, 'PERMISSION_DENIED');
    }
    if (!atLeast(actor.permission, 'Root') && target.permission === 'Admin') {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    // Entries reference uploader_id with ON DELETE RESTRICT — if any exist we
    // deactivate the account instead of deleting it.
    const { rows: entryRows } = await db.query(
      'SELECT 1 FROM entries WHERE uploader_id = $1 LIMIT 1',
      [target.id]
    );
    if (entryRows.length > 0) {
      await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [target.id]);
      await db.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
      return res.status(204).end();
    }

    await db.query('DELETE FROM users WHERE id = $1', [target.id]);
    return res.status(204).end();
  })
);

// ── POST /api/users/:id/force-reset ──────────────────────────────────────────
router.post(
  '/:id/force-reset',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const target = await getUserById(req.params.id);
    if (!target) throw new HttpError(404, 'NOT_FOUND');

    if (target.permission === 'Root') {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }
    if (!atLeast(actor.permission, 'Root') && target.permission === 'Admin') {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    await db.query('UPDATE users SET password_hash = $1, force_reset = TRUE WHERE id = $2', [
      passwordHash,
      target.id,
    ]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);

    res.json({ temp_password: tempPassword });
  })
);

// ── POST /api/users/transfer-crown ───────────────────────────────────────────
router.post(
  '/transfer-crown',
  requirePermission('Root'),
  asyncHandler(async (req, res) => {
    const currentRootId = req.user.id;
    const targetId = req.body?.target_user_id;
    if (typeof targetId !== 'string' || targetId.trim() === '') {
      return res
        .status(422)
        .json({ error: 'VALIDATION', fields: { target_user_id: 'Required.' } });
    }

    try {
      await db.withTransaction(async (client) => {
        await client.query('CALL transfer_crown($1, $2)', [currentRootId, targetId]);
      });
    } catch (err) {
      // Procedure / trigger RAISE EXCEPTION arrives as a P0001 error.
      const msg = String(err.message || '');
      if (/INVALID_TARGET/.test(msg)) {
        throw new HttpError(422, 'INVALID_TARGET');
      }
      if (/INVALID_CURRENT_ROOT/.test(msg)) {
        throw new HttpError(409, 'INVALID_CURRENT_ROOT');
      }
      if (/SAME_ACCOUNT/.test(msg)) {
        throw new HttpError(422, 'SAME_ACCOUNT');
      }
      if (/ROOT_SINGLETON_VIOLATION/.test(msg)) {
        throw new HttpError(409, 'ROOT_SINGLETON_VIOLATION');
      }
      throw err;
    }

    // The former root's existing sessions are invalidated.
    await db.query('DELETE FROM sessions WHERE user_id = $1', [currentRootId]);
    res.json({ ok: true });
  })
);

module.exports = router;
