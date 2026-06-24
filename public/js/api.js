/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// api.js — central fetch wrapper for the JSON API.
// All requests send the session cookie (credentials: 'include'). A 401 means the
// session is gone or the resource needs auth, so we bounce to the login page and
// remember where to return. Error bodies follow { error: "<CODE>", ...extra }.

const BASE = '/api';

function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  window.location.href = `/login.html?next=${next}`;
}

/**
 * Fetch JSON from the API.
 * @param {string} path  path under /api, e.g. "/entries?page=1"
 * @param {object} [options]  standard fetch options, plus:
 *   - noRedirect: don't auto-redirect on 401 (throws instead)
 * @returns {Promise<any|null>} parsed JSON, or null for 204 / after a redirect
 */
export async function apiFetch(path, options = {}) {
  const { noRedirect, headers, ...rest } = options;
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    ...rest,
  });

  if (res.status === 401) {
    if (!noRedirect) {
      redirectToLogin();
      return null;
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP_${res.status}`);
    err.status = res.status;
    err.code = body.error || null;
    err.fields = body.fields || null;
    err.body = body;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/**
 * Multipart upload (FormData). The browser sets the multipart boundary, so we
 * must NOT set Content-Type ourselves.
 */
export async function apiUpload(path, formData, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    body: formData,
  });

  if (res.status === 401) {
    redirectToLogin();
    return null;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP_${res.status}`);
    err.status = res.status;
    err.code = body.error || null;
    err.fields = body.fields || null;
    err.body = body;
    throw err;
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** Human-friendly message for a thrown API error. */
export function errorMessage(err, fallback = 'Something went wrong.') {
  if (!err) return fallback;
  const map = {
    UNAUTHENTICATED: 'You need to sign in to do that.',
    PERMISSION_DENIED: 'You do not have permission to do that.',
    NOT_FOUND: 'That item could not be found.',
    VALIDATION: 'Please check the highlighted fields.',
    DUPLICATE: 'That already exists.',
    DUPLICATE_RELATION: 'These two entries are already linked that way.',
    FILE_TOO_LARGE: 'That file is too large (100 MB maximum).',
    UNSUPPORTED_FILE_TYPE: 'This file type is not accepted.',
    FOREIGN_KEY_VIOLATION: 'A referenced item no longer exists.',
    RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
    INTERNAL_SERVER_ERROR: 'A server error occurred. Please try again.',
  };
  return map[err.code] || err.body?.message || fallback;
}
