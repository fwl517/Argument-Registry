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
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { allowAuthOrReset, requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../utils/password');
const {
  createSession,
  setFullCookie,
  setResetCookie,
  clearFullCookie,
  clearResetCookie,
  reqMeta,
} = require('../utils/session');

const router = express.Router();

function publicUser(u, forceReset) {
  return {
    id: u.id,
    username: u.username,
    permission: u.permission,
    society_role: u.society_role,
    force_reset: forceReset,
    group_id: u.group_id ?? null,
    group_name: u.group_name ?? null,
    is_home_group: u.is_home_group ?? u.group_is_home ?? false,
  };
}

// ── GET /api/auth/session ───────────────────────────────────────────────────
// Returns the current user (full session OR reset pre-session), or null.
router.get('/session', (req, res) => {
  if (req.user) {
    return res.json({ user: publicUser(req.user, req.user.force_reset) });
  }
  if (req.resetUser) {
    return res.json({ user: publicUser(req.resetUser, true) });
  }
  return res.json({ user: null });
});

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(422).json({
        error: 'VALIDATION',
        fields: { username: 'Required.', password: 'Required.' },
      });
    }

    const { rows } = await db.query(
      `SELECT u.id, u.username, u.password_hash, u.permission, u.society_role,
              u.is_active, u.force_reset,
              u.group_id, g.name AS group_name, g.is_home AS group_is_home
         FROM users u
         JOIN groups g ON g.id = u.group_id
        WHERE u.username = $1`,
      [username]
    );
    const user = rows[0];

    // Identical 401 for "no such user", "inactive", and "wrong password" so the
    // response cannot be used to enumerate accounts.
    const ok = user && user.is_active && (await verifyPassword(user.password_hash, password));
    if (!ok) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    if (user.force_reset) {
      // Issue a restricted pre-session accepted only by change-password.
      const sid = await createSession(db, user.id, 'reset', reqMeta(req));
      setResetCookie(res, sid);
      return res.json({ user: publicUser(user, true), force_reset: true });
    }

    const sid = await createSession(db, user.id, 'full', reqMeta(req));
    setFullCookie(res, sid);
    return res.json({ user: publicUser(user, false) });
  })
);

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    // Accept either a full session or a reset pre-session.
    const sessionId = req.session?.id || req.resetSession?.id;
    if (!sessionId) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    clearFullCookie(res);
    clearResetCookie(res);
    return res.status(204).end();
  })
);

// ── POST /api/auth/change-password ──────────────────────────────────────────
router.post(
  '/change-password',
  allowAuthOrReset,
  asyncHandler(async (req, res) => {
    const { current_password: currentPassword, new_password: newPassword } = req.body || {};

    const fields = {};
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      fields.current_password = 'Required.';
    }
    if (typeof newPassword !== 'string' || newPassword.length < config.passwordMinLength) {
      fields.new_password = `Must be at least ${config.passwordMinLength} characters.`;
    }
    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    const acting = req.actingUser;
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [acting.id]);
    const stored = rows[0];
    if (!stored || !(await verifyPassword(stored.password_hash, currentPassword))) {
      return res
        .status(422)
        .json({ error: 'VALIDATION', fields: { current_password: 'Incorrect.' } });
    }

    const newHash = await hashPassword(newPassword);

    if (req.actingKind === 'reset') {
      // Forced-reset path: clear the flag, store the new hash, then replace the
      // restricted pre-session with a fresh full session and wipe everything else.
      await db.query(
        'UPDATE users SET password_hash = $1, force_reset = FALSE WHERE id = $2',
        [newHash, acting.id]
      );
      await db.query('DELETE FROM sessions WHERE user_id = $1', [acting.id]);
      clearResetCookie(res);
      const sid = await createSession(db, acting.id, 'full', reqMeta(req));
      setFullCookie(res, sid);
      return res.json({ ok: true });
    }

    // Voluntary change from an existing full session: keep this session, drop
    // all the others belonging to the user.
    await db.query(
      'UPDATE users SET password_hash = $1, force_reset = FALSE WHERE id = $2',
      [newHash, acting.id]
    );
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND id != $2', [
      acting.id,
      req.actingSessionId,
    ]);
    return res.json({ ok: true });
  })
);

// ── POST /api/auth/change-username ──────────────────────────────────────────
// A signed-in member can rename themselves. Society role and group affiliation
// remain admin-managed.
router.post(
  '/change-username',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};

    const fields = {};
    if (typeof username !== 'string' || username.trim() === '') {
      fields.username = 'Required.';
    } else if (username.trim().length > 100) {
      fields.username = 'Must be 100 characters or fewer.';
    }
    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    const newUsername = username.trim();
    if (newUsername === req.user.username) {
      return res.json({ ok: true, username: newUsername });
    }

    try {
      await db.query('UPDATE users SET username = $1 WHERE id = $2', [
        newUsername,
        req.user.id,
      ]);
    } catch (err) {
      if (err.code === '23505') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { username: 'Already taken.' } });
      }
      throw err;
    }

    return res.json({ ok: true, username: newUsername });
  })
);

module.exports = router;
