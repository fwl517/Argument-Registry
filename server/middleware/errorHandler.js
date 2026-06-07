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
 * Wrap an async route handler so rejected promises are forwarded to the
 * Express error handler instead of crashing the process.
 * @param {Function} fn
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Helper to throw a typed HTTP error from within handlers. */
class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

/** 404 fallthrough for unmatched /api routes. */
function notFound(_req, res) {
  res.status(404).json({ error: 'NOT_FOUND' });
}

/**
 * Global error handler. Stack traces are logged server-side and NEVER sent to
 * the client. Known HttpErrors map to their status; everything else is a 500.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    const body = { error: err.code };
    if (err.extra) Object.assign(body, err.extra);
    return res.status(err.status).json(body);
  }

  // Multer file-size / type errors surface with a `.code`.
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(422).json({ error: 'FILE_TOO_LARGE' });
  }

  // Map common Postgres errors to friendly responses.
  if (err && err.code === '23505') {
    return res.status(422).json({ error: 'DUPLICATE', detail: err.constraint || null });
  }
  if (err && err.code === '23503') {
    return res.status(422).json({ error: 'FOREIGN_KEY_VIOLATION' });
  }

  // eslint-disable-next-line no-console
  console.error('[error]', err && err.stack ? err.stack : err);

  const payload = { error: 'INTERNAL_SERVER_ERROR' };
  if (!config.isProduction && err && err.message) {
    payload.detail = err.message; // dev convenience only; suppressed in prod
  }
  return res.status(500).json(payload);
}

module.exports = { asyncHandler, HttpError, notFound, errorHandler };
