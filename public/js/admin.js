/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// admin.js — member management. Lists users, supports inline edit / force-reset /
// delete (permission-gated), creating accounts, and the Root-only Transfer Crown.
// The API enforces every rule; the UI gating here is a convenience.

import { apiFetch, errorMessage } from './api.js';
import {
  $, el, clear, esc, formatShortDate, toast, showFieldErrors,
} from './utils.js';
import { bootstrap, hasPermission } from './auth.js';

const SOCIETY_ROLES = [
  'President', 'General Secretary', 'Treasurer', 'Extended-Committee', 'Member', 'Alumni',
];

let session = null;
let users = [];

/* — Capability helper ————————————————————————————————————— */
// Whether the current actor may edit / reset / delete the target account.
function canManage(target) {
  if (target.permission === 'Root') return false;          // sitting Root → Transfer Crown only
  if (hasPermission(session, 'Root')) return true;          // Root manages Read/Write/Admin
  return target.permission === 'Read' || target.permission === 'Write'; // Admin manages Read/Write
}

function assignablePermissions() {
  return hasPermission(session, 'Root') ? ['Read', 'Write', 'Admin'] : ['Read', 'Write'];
}

/* — Temp-password banner ——————————————————————————————————— */
function showTempPassword(username, password) {
  const host = $('#temp-pw');
  clear(host);
  const box = el('div', { class: 'alert alert--warn' });
  box.appendChild(el('strong', { text: 'Temporary password set. ' }));
  box.appendChild(document.createTextNode(`Share this with ${username} now — it is shown once and they must change it on first sign-in.`));
  const row = el('div', { class: 'row', style: { marginTop: '10px' } });
  const code = el('code', { class: 'mono', text: password });
  code.style.fontSize = '1rem';
  code.style.padding = '6px 10px';
  code.style.background = 'rgba(0,0,0,0.05)';
  code.style.borderRadius = '4px';
  const copy = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy' });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(password); toast('Copied.', 'ok'); }
    catch (_e) { toast('Copy failed — select it manually.', 'error'); }
  });
  const dismiss = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Dismiss' });
  dismiss.addEventListener('click', () => clear(host));
  row.appendChild(code); row.appendChild(copy); row.appendChild(dismiss);
  box.appendChild(row);
  host.appendChild(box);
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* — Table rendering ———————————————————————————————————————— */
function staticRow(u) {
  const tr = el('tr', { dataset: { id: u.id } });

  tr.appendChild(el('td', {}, [
    el('strong', { text: u.username }),
    u.id === session.id ? el('span', { class: 'faint text-sm', text: '  (you)' }) : null,
  ]));
  tr.appendChild(el('td', {}, [
    el('span', { class: 'tag-perm', dataset: { perm: u.permission }, text: u.permission }),
  ]));
  tr.appendChild(el('td', {}, [el('span', { class: 'tag-role', text: u.society_role })]));
  tr.appendChild(el('td', {}, [
    el('span', {
      class: u.is_active ? 'status-active' : 'status-inactive',
      text: u.is_active ? 'Active' : 'Inactive',
    }),
    u.force_reset ? el('span', { class: 'faint text-sm', text: '  · reset pending' }) : null,
  ]));
  tr.appendChild(el('td', { class: 'text-sm muted', text: formatShortDate(u.created_at) }));

  const actions = el('td', {});
  const wrap = el('div', { class: 'row-actions' });
  if (canManage(u)) {
    const edit = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Edit' });
    edit.addEventListener('click', () => renderEditRow(tr, u));
    const reset = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Force reset' });
    reset.addEventListener('click', () => forceReset(u));
    const del = el('button', { class: 'linkbtn linkbtn--danger text-sm', type: 'button', text: 'Delete' });
    del.addEventListener('click', () => removeUser(u));
    wrap.appendChild(edit); wrap.appendChild(reset); wrap.appendChild(del);
  } else if (u.permission === 'Root') {
    wrap.appendChild(el('span', { class: 'faint text-sm', text: 'Sitting Root' }));
  } else {
    wrap.appendChild(el('span', { class: 'faint text-sm', text: '—' }));
  }
  actions.appendChild(wrap);
  tr.appendChild(actions);
  return tr;
}

function renderEditRow(tr, u) {
  clear(tr);
  tr.appendChild(el('td', {}, [el('strong', { text: u.username })]));

  const permSel = el('select', { class: 'select' });
  assignablePermissions().forEach((p) =>
    permSel.appendChild(el('option', { value: p, text: p, selected: p === u.permission ? '' : null })));
  permSel.value = u.permission;
  tr.appendChild(el('td', {}, [permSel]));

  const roleSel = el('select', { class: 'select' });
  SOCIETY_ROLES.forEach((r) =>
    roleSel.appendChild(el('option', { value: r, text: r })));
  roleSel.value = u.society_role;
  tr.appendChild(el('td', {}, [roleSel]));

  const activeSel = el('select', { class: 'select' });
  activeSel.appendChild(el('option', { value: 'true', text: 'Active' }));
  activeSel.appendChild(el('option', { value: 'false', text: 'Inactive' }));
  activeSel.value = u.is_active ? 'true' : 'false';
  tr.appendChild(el('td', {}, [activeSel]));

  tr.appendChild(el('td', { class: 'text-sm muted', text: formatShortDate(u.created_at) }));

  const save = el('button', { class: 'btn btn--sm', type: 'button', text: 'Save' });
  const cancel = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Cancel' });
  cancel.addEventListener('click', load);
  save.addEventListener('click', async () => {
    const body = {};
    if (permSel.value !== u.permission) body.permission = permSel.value;
    if (roleSel.value !== u.society_role) body.society_role = roleSel.value;
    const active = activeSel.value === 'true';
    if (active !== u.is_active) body.is_active = active;
    if (Object.keys(body).length === 0) { load(); return; }
    save.disabled = true;
    try {
      await apiFetch(`/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      toast('Member updated.', 'ok');
      load();
    } catch (err) {
      toast(errorMessage(err, 'Could not update the member.'), 'error');
      save.disabled = false;
    }
  });
  tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [save, cancel])]));
}

async function forceReset(u) {
  if (!window.confirm(`Force a password reset for ${u.username}? Their current sessions end immediately.`)) return;
  try {
    const res = await apiFetch(`/users/${encodeURIComponent(u.id)}/force-reset`, { method: 'POST' });
    showTempPassword(u.username, res.temp_password);
    load();
  } catch (err) {
    toast(errorMessage(err, 'Could not reset the password.'), 'error');
  }
}

async function removeUser(u) {
  if (!window.confirm(`Delete ${u.username}? If they have contributed entries, the account is deactivated instead.`)) return;
  try {
    await apiFetch(`/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
    toast('Member removed.', 'ok');
    load();
  } catch (err) {
    toast(errorMessage(err, 'Could not remove the member.'), 'error');
  }
}

function renderTable() {
  const tbody = $('#user-rows');
  clear(tbody);
  users.forEach((u) => tbody.appendChild(staticRow(u)));
}

/* — Create user ———————————————————————————————————————————— */
function setupCreateForm() {
  const form = $('#create-form');
  const permSel = form.permission;
  clear(permSel);
  assignablePermissions().forEach((p) => permSel.appendChild(el('option', { value: p, text: p })));
  permSel.value = 'Read';

  const roleSel = form.society_role;
  clear(roleSel);
  SOCIETY_ROLES.forEach((r) => roleSel.appendChild(el('option', { value: r, text: r })));
  roleSel.value = 'Member';

  $('#create-btn').addEventListener('click', async () => {
    showFieldErrors(form, null);
    const username = form.username.value.trim();
    if (!username) { showFieldErrors(form, { username: 'Required.' }); return; }
    const btn = $('#create-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          permission: permSel.value,
          society_role: roleSel.value,
        }),
      });
      showTempPassword(res.user.username, res.temp_password);
      form.username.value = '';
      load();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      else toast(errorMessage(err, 'Could not create the account.'), 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Create account';
    }
  });
}

/* — Transfer Crown (Root only) ————————————————————————————— */
function setupTransferCrown() {
  const panel = $('#crown-panel');
  if (!hasPermission(session, 'Root')) { panel.remove(); return; }
  panel.classList.remove('hidden');

  const select = $('#crown-target');
  const confirmInput = $('#crown-confirm');
  const btn = $('#crown-btn');

  function refreshTargets() {
    clear(select);
    select.appendChild(el('option', { value: '', text: '— Select successor —' }));
    users
      .filter((u) => u.id !== session.id && u.is_active)
      .forEach((u) => select.appendChild(el('option', {
        value: u.id, text: `${u.username} (${u.permission})`,
      })));
  }
  refreshTargets();
  panel._refresh = refreshTargets;

  btn.addEventListener('click', async () => {
    const targetId = select.value;
    if (!targetId) { toast('Choose a successor.', 'error'); return; }
    if (confirmInput.value.trim() !== 'TRANSFER') {
      toast('Type TRANSFER to confirm.', 'error'); confirmInput.focus(); return;
    }
    const name = select.selectedOptions[0]?.textContent || 'this member';
    if (!window.confirm(`Transfer Root to ${name}? You will immediately lose Root access and be signed out.`)) return;

    btn.disabled = true; btn.textContent = 'Transferring…';
    try {
      await apiFetch('/users/transfer-crown', {
        method: 'POST', body: JSON.stringify({ target_user_id: targetId }),
      });
      toast('Crown transferred. Signing you out…', 'ok');
      setTimeout(() => { window.location.href = '/login.html'; }, 1200);
    } catch (err) {
      const map = {
        INVALID_TARGET: 'That account cannot receive Root (must be an active member).',
        SAME_ACCOUNT: 'You cannot transfer Root to yourself.',
        INVALID_CURRENT_ROOT: 'Your Root status could not be verified. Refresh and try again.',
        ROOT_SINGLETON_VIOLATION: 'The transfer failed a consistency check. No change was made.',
      };
      toast(map[err.code] || errorMessage(err, 'Transfer failed.'), 'error');
      btn.disabled = false; btn.textContent = 'Transfer Root';
    }
  });
}

/* — Load + init ———————————————————————————————————————————— */
async function load() {
  try {
    users = (await apiFetch('/users')) || [];
    renderTable();
    const crown = $('#crown-panel');
    if (crown && crown._refresh) crown._refresh();
  } catch (err) {
    const tbody = $('#user-rows');
    clear(tbody);
    tbody.appendChild(el('tr', {}, [
      el('td', { colspan: '6', class: 'muted', text: errorMessage(err, 'Could not load members.') }),
    ]));
  }
}

async function init() {
  session = await bootstrap({ require: 'Admin' });
  if (!session || session.force_reset) return;

  // Reflect the actor's reach in the page subtitle.
  const scope = hasPermission(session, 'Root')
    ? 'As Root you can manage every account and transfer the Root role.'
    : 'As an Admin you can manage Read and Write members.';
  $('#admin-scope').textContent = scope;

  setupCreateForm();
  setupTransferCrown();
  await load();
}

init();
