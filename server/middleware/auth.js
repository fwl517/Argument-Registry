/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const db = require('../db');

// Numeric permission ladder used for "minimum level" checks.
const LEVELS = { Read: 0, Write: 1, Admin: 2, Root: 3 };

/**
 * Look up a session row joined with its user. Returns null when the session
 * does not exist, has expired, is of the wrong kind, or the user is inactive.
 *
 * @param {string} sessionId
 * @param {'full'|'reset'} kind
 */
async function loadSession(sessionId, kind) {
  if (!sessionId) return null;
  let result;
  try {
    result = await db.query(
      `SELECT s.id AS session_id, s.kind, s.expires_at,
              u.id, u.username, u.permission, u.society_role,
              u.is_active, u.force_reset
         FROM sessions s
         JOIN users u ON s.user_id = u.id
        WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sessionId]
    );
  } catch {
    // Malformed UUID etc. → treat as no session.
    return null;
  }
  const row = result.rows[0];
  if (!row) return null;
  if (row.kind !== kind) return null;
  if (!row.is_active) return null;
  return row;
}

/**
 * Global middleware. Reads the full-session cookie (`sid`) and, when valid,
 * attaches `req.user` and `req.session`. Always calls next() — does not block.
 */
async function attachSession(req, _res, next) {
  try {
    const sid = req.cookies?.sid;
    const row = await loadSession(sid, 'full');
    if (row) {
      req.session = { id: row.session_id, kind: row.kind };
      req.user = {
        id: row.id,
        username: row.username,
        permission: row.permission,
        society_role: row.society_role,
        force_reset: row.force_reset,
      };
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Global middleware. Reads the restricted pre-session cookie (`sid_reset`) and,
 * when valid, attaches `req.resetUser` and `req.resetSession`. Used only to
 * permit the forced password change. Always calls next().
 */
async function attachResetSession(req, _res, next) {
  try {
    const sid = req.cookies?.sid_reset;
    const row = await loadSession(sid, 'reset');
    if (row) {
      req.resetSession = { id: row.session_id, kind: row.kind };
      req.resetUser = {
        id: row.id,
        username: row.username,
        permission: row.permission,
        society_role: row.society_role,
        force_reset: row.force_reset,
      };
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** 401 unless a valid full session is present. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  return next();
}

/**
 * Returns a middleware that requires a full session whose permission is at
 * least `minLevel`. 401 if unauthenticated, 403 if under-privileged.
 * @param {'Read'|'Write'|'Admin'|'Root'} minLevel
 */
function requirePermission(minLevel) {
  const floor = LEVELS[minLevel];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (LEVELS[req.user.permission] < floor) {
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }
    return next();
  };
}

/**
 * Allow either a normal authenticated user OR the holder of a restricted
 * reset pre-session. Used exclusively by POST /api/auth/change-password.
 * Sets req.actingUser to whichever identity was found.
 */
function allowAuthOrReset(req, res, next) {
  if (req.user) {
    req.actingUser = req.user;
    req.actingSessionId = req.session.id;
    req.actingKind = 'full';
    return next();
  }
  if (req.resetUser) {
    req.actingUser = req.resetUser;
    req.actingSessionId = req.resetSession.id;
    req.actingKind = 'reset';
    return next();
  }
  return res.status(401).json({ error: 'UNAUTHENTICATED' });
}

/** Compare two permission strings; true when `a` >= `b`. */
function atLeast(a, b) {
  return LEVELS[a] >= LEVELS[b];
}

module.exports = {
  LEVELS,
  attachSession,
  attachResetSession,
  requireAuth,
  requirePermission,
  allowAuthOrReset,
  atLeast,
};
