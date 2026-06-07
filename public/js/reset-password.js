/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// reset-password.js — the forced password-change gate. The user arrives holding
// a restricted reset pre-session (sid_reset cookie) issued at login. On success
// the server swaps it for a full session and we proceed to the dashboard.

import { apiFetch, errorMessage } from './api.js';
import { $, toast, showFieldErrors } from './utils.js';
import { getSession } from './auth.js';

const MIN_LENGTH = 12;

async function init() {
  const session = await getSession();
  if (!session) {
    // No session at all (reset cookie expired or missing) → start over.
    window.location.href = '/login.html';
    return;
  }
  if (!session.force_reset) {
    // Already in good standing — nothing to do here.
    window.location.href = '/dashboard.html';
    return;
  }

  $('#reset-user').textContent = session.username;

  const form = $('#reset-form');
  const btn = $('#reset-btn');
  const errBox = $('#reset-error');

  const submit = async () => {
    errBox.classList.add('hidden');
    showFieldErrors(form, null);

    const current = form.current_password.value;
    const next = form.new_password.value;
    const confirm = form.confirm_password.value;

    const fields = {};
    if (!current) fields.current_password = 'Enter your temporary password.';
    if (next.length < MIN_LENGTH) fields.new_password = `Use at least ${MIN_LENGTH} characters.`;
    if (next && confirm !== next) fields.confirm_password = 'Passwords do not match.';
    if (Object.keys(fields).length) { showFieldErrors(form, fields); return; }

    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        noRedirect: true,
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      toast('Password updated.', 'ok');
      window.location.href = '/dashboard.html';
    } catch (err) {
      if (err.fields) {
        showFieldErrors(form, err.fields);
      } else if (err.status === 401) {
        errBox.textContent = 'Your reset session has expired. Please sign in again.';
        errBox.classList.remove('hidden');
        setTimeout(() => { window.location.href = '/login.html'; }, 1500);
      } else {
        errBox.textContent = errorMessage(err, 'Could not update your password.');
        errBox.classList.remove('hidden');
      }
      btn.disabled = false;
      btn.textContent = 'Set new password';
    }
  };

  btn.addEventListener('click', submit);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

init();
