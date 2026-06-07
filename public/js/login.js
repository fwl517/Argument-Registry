/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// login.js — sign-in form. On success the server sets the session cookie; a
// forced-reset account is redirected to the reset page. Already-authenticated
// visitors are bounced straight to their destination.

import { apiFetch, errorMessage } from './api.js';
import { $, queryParam, toast } from './utils.js';
import { getSession } from './auth.js';

function safeNext() {
  const next = queryParam('next');
  // Only allow same-origin relative paths to prevent open-redirects.
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/dashboard.html';
}

async function init() {
  // If already signed in, don't show the form.
  const existing = await getSession();
  if (existing) {
    if (existing.force_reset) window.location.href = '/reset-password.html';
    else window.location.href = safeNext();
    return;
  }

  const form = $('#login-form');
  const errBox = $('#login-error');
  const btn = $('#login-btn');

  const submit = async () => {
    errBox.classList.add('hidden');
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      errBox.textContent = 'Enter your username and password.';
      errBox.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        noRedirect: true,
        body: JSON.stringify({ username, password }),
      });
      if (res?.force_reset) {
        window.location.href = '/reset-password.html';
        return;
      }
      toast('Welcome back.', 'ok');
      window.location.href = safeNext();
    } catch (err) {
      // The API returns an identical 401 for unknown user / inactive / wrong
      // password, so the message is deliberately non-committal.
      if (err.status === 401) {
        errBox.textContent = 'Those credentials were not recognised.';
      } else if (err.status === 429 || err.code === 'RATE_LIMITED') {
        errBox.textContent = 'Too many attempts. Please wait a minute and try again.';
      } else {
        errBox.textContent = errorMessage(err, 'Could not sign in. Please try again.');
      }
      errBox.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  };

  btn.addEventListener('click', submit);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

init();
