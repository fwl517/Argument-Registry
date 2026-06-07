/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// account.js — self-service account settings page. Currently houses the
// username-change form; password change still routes through the /reset-password
// flow when forced by an admin.

import { apiFetch, errorMessage } from './api.js';
import { $, toast, showFieldErrors } from './utils.js';
import { bootstrap } from './auth.js';

const MIN_PASSWORD_LENGTH = 12;

function wireUsernameForm(session) {
  const form = $('#username-form');
  form.username.value = session.username || '';

  $('#username-btn').addEventListener('click', async () => {
    showFieldErrors(form, null);
    const value = form.username.value.trim();
    if (!value) { showFieldErrors(form, { username: 'Required.' }); return; }
    if (value === session.username) { toast('No change to save.', 'info'); return; }

    const btn = $('#username-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await apiFetch('/auth/change-username', {
        method: 'POST',
        body: JSON.stringify({ username: value }),
      });
      toast('Username updated.', 'ok');
      // Reload so the nav chip and every cached UI element picks up the new name.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      else toast(errorMessage(err, 'Could not update your username.'), 'error');
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });
}

function wirePasswordForm() {
  const form = $('#password-form');
  const btn = $('#password-btn');

  const submit = async () => {
    showFieldErrors(form, null);
    const current = form.current_password.value;
    const next = form.new_password.value;
    const confirm = form.confirm_password.value;

    const fields = {};
    if (!current) fields.current_password = 'Required.';
    if (next.length < MIN_PASSWORD_LENGTH) fields.new_password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (next && confirm !== next) fields.confirm_password = 'Passwords do not match.';
    if (Object.keys(fields).length) { showFieldErrors(form, fields); return; }

    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      toast('Password updated. Other sessions have been signed out.', 'ok');
      form.reset();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      else toast(errorMessage(err, 'Could not update your password.'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update password';
    }
  };

  btn.addEventListener('click', submit);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

async function init() {
  const session = await bootstrap({ require: 'auth' });
  if (!session || session.force_reset) return;

  wireUsernameForm(session);
  wirePasswordForm();
}

init();
