/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const config = require('../config');

/**
 * Insert a session row and return its id.
 * @param {{query: Function}} executor  db module or a transaction client
 * @param {string} userId
 * @param {'full'|'reset'} kind
 * @param {{ip?: string, userAgent?: string}} meta
 * @returns {Promise<string>} new session id
 */
async function createSession(executor, userId, kind, meta = {}) {
  const ttl = kind === 'reset' ? config.resetTtlMs : config.sessionTtlMs;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const { rows } = await executor.query(
    `INSERT INTO sessions (user_id, kind, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, kind, expiresAt, meta.ip || null, meta.userAgent || null]
  );
  return rows[0].id;
}

function baseCookieOpts() {
  return {
    httpOnly: config.cookie.httpOnly,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: config.cookie.path,
  };
}

function setFullCookie(res, sessionId) {
  res.cookie(config.cookie.fullName, sessionId, {
    ...baseCookieOpts(),
    maxAge: config.sessionTtlMs,
  });
}

function setResetCookie(res, sessionId) {
  res.cookie(config.cookie.resetName, sessionId, {
    ...baseCookieOpts(),
    maxAge: config.resetTtlMs,
  });
}

function clearFullCookie(res) {
  res.clearCookie(config.cookie.fullName, baseCookieOpts());
}

function clearResetCookie(res) {
  res.clearCookie(config.cookie.resetName, baseCookieOpts());
}

/** Extract request metadata to store alongside a session. */
function reqMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || null };
}

module.exports = {
  createSession,
  setFullCookie,
  setResetCookie,
  clearFullCookie,
  clearResetCookie,
  reqMeta,
};
