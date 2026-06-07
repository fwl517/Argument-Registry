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

async function init() {
  const session = await bootstrap({ require: 'auth' });
  if (!session || session.force_reset) return;

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

init();
