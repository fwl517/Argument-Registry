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
const { requirePermission, atLeast, sameScope } = require('../middleware/auth');
const { hashPassword, generateTempPassword } = require('../utils/password');
const { serialiseUser } = require('../utils/serialise');

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

// Shared SELECT clause: join the user's group so the serialiser can render
// the group pill in one round-trip.
const USER_SELECT = `
  SELECT u.id, u.username, u.permission, u.society_role, u.is_active,
         u.force_reset, u.created_at,
         u.group_id,
         g.name        AS group_name,
         g.colour      AS group_colour,
         g.text_colour AS group_text_colour,
         g.is_home     AS group_is_home
    FROM users u
    JOIN groups g ON g.id = u.group_id
`;

async function getUserById(id) {
  let result;
  try {
    result = await db.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
  } catch {
    return null; // malformed uuid
  }
  return result.rows[0] || null;
}

/** Can the actor grant the Admin permission level? Root and home-group Admins only. */
function canGrantAdmin(actor) {
  return atLeast(actor.permission, 'Root') || actor.is_home_group;
}

// Every route below requires Admin or higher.
router.use(requirePermission('Admin'));

// ── GET /api/users ──────────────────────────────────────────────────────────
// Group admins see only their own group's members. Home-group admins see
// everyone. The frontend layer adds a client-side search box on top of this.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const params = [];
    let where = '';
    if (!actor.is_home_group) {
      where = 'WHERE u.group_id = $1';
      params.push(actor.group_id);
    }
    const { rows } = await db.query(
      `${USER_SELECT} ${where} ORDER BY u.created_at ASC`,
      params
    );
    res.json(rows.map(serialiseUser));
  })
);

// ── POST /api/users ─────────────────────────────────────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const {
      username,
      permission,
      society_role: societyRole,
      group_id: groupIdInput,
    } = req.body || {};

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

    // Group admins create in their own group only; home-group admins must
    // name a group explicitly.
    let groupId;
    if (actor.is_home_group) {
      if (typeof groupIdInput !== 'string' || groupIdInput.trim() === '') {
        fields.group_id = 'Required.';
      } else {
        groupId = groupIdInput.trim();
      }
    } else {
      // Force the actor's own group regardless of any value sent. Prevents a
      // group admin from creating accounts in another group.
      groupId = actor.group_id;
      if (groupIdInput && groupIdInput !== actor.group_id) {
        fields.group_id = 'You can only create accounts within your own group.';
      }
    }

    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    // Group admins cannot mint Admins; only Root and home-group admins can.
    if (permission === 'Admin' && !canGrantAdmin(actor)) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    // Validate the target group: must exist, must not be archived, must not
    // be at quota.
    const groupRow = await db.query(
      'SELECT id, is_archived, member_quota FROM groups WHERE id = $1',
      [groupId]
    ).then((r) => r.rows[0]).catch(() => null);
    if (!groupRow) {
      return res
        .status(422)
        .json({ error: 'VALIDATION', fields: { group_id: 'Unknown group.' } });
    }
    if (groupRow.is_archived) {
      return res
        .status(422)
        .json({ error: 'VALIDATION', fields: { group_id: 'Group is archived.' } });
    }
    if (groupRow.member_quota !== null) {
      const { rows: countRows } = await db.query(
        'SELECT COUNT(*)::int AS c FROM users WHERE group_id = $1 AND is_active = TRUE',
        [groupId]
      );
      if (countRows[0].c >= groupRow.member_quota) {
        return res.status(422).json({ error: 'GROUP_QUOTA_REACHED' });
      }
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    let insertedId;
    try {
      const result = await db.query(
        `INSERT INTO users
           (username, password_hash, permission, society_role, group_id, force_reset, created_by)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         RETURNING id`,
        [username.trim(), passwordHash, permission, role, groupId, actor.id]
      );
      insertedId = result.rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { username: 'Already taken.' } });
      }
      throw err;
    }

    const created = await getUserById(insertedId);
    res.status(201).json({ user: serialiseUser(created), temp_password: tempPassword });
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

    // Scope: non-home admins can only act on members of their own group.
    if (!sameScope(actor, target)) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    // Admins cannot touch Root or Admin accounts at all.
    if (!actorIsRoot && (target.permission === 'Root' || target.permission === 'Admin')) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    const {
      username,
      society_role: societyRole,
      permission,
      is_active: isActive,
      group_id: groupIdChange,
    } = req.body || {};

    // Group changes are Root-only. Everyone else (including home-group admins)
    // is locked out so groups stay stable affiliations.
    if (groupIdChange !== undefined && !actorIsRoot) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

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
      } else if (permission === 'Admin' && !canGrantAdmin(actor)) {
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

    // Group change: Root only, validated against the groups table.
    if (groupIdChange !== undefined) {
      if (typeof groupIdChange !== 'string' || groupIdChange.trim() === '') {
        fields.group_id = 'Must be a group id.';
      } else {
        const grow = await db.query(
          'SELECT id, is_archived FROM groups WHERE id = $1',
          [groupIdChange.trim()]
        ).then((r) => r.rows[0]).catch(() => null);
        if (!grow) {
          fields.group_id = 'Unknown group.';
        } else if (grow.is_archived) {
          fields.group_id = 'Group is archived.';
        } else {
          sets.push(`group_id = $${i++}`);
          params.push(grow.id);
        }
      }
    }

    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }
    if (sets.length === 0) {
      return res.status(422).json({ error: 'VALIDATION', fields: { _: 'No changes supplied.' } });
    }

    params.push(target.id);
    try {
      await db.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`,
        params
      );
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

    const updated = await getUserById(target.id);
    res.json({ user: serialiseUser(updated) });
  })
);

// ── DELETE /api/users/:id ─────────────────────────────────────────────────────
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const actor = req.user;
    const target = await getUserById(req.params.id);
    if (!target) throw new HttpError(404, 'NOT_FOUND');

    if (!sameScope(actor, target)) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }
    if (target.permission === 'Root') {
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

    if (!sameScope(actor, target)) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }
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

    // Root must live in the home group. Refuse the transfer if the target
    // is in a partner group — Root would need to move them to home first.
    const target = await getUserById(targetId.trim());
    if (!target) {
      throw new HttpError(422, 'INVALID_TARGET');
    }
    if (!target.group_is_home) {
      return res.status(422).json({
        error: 'TARGET_NOT_IN_HOME_GROUP',
        message: 'Root can only sit in the home group. Move the target there first.',
      });
    }

    try {
      await db.withTransaction(async (client) => {
        await client.query('CALL transfer_crown($1, $2)', [currentRootId, targetId]);
      });
    } catch (err) {
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

    await db.query('DELETE FROM sessions WHERE user_id = $1', [currentRootId]);
    res.json({ ok: true });
  })
);

module.exports = router;
