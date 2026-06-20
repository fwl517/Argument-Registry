/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// admin.js — member management. Lists users, supports inline edit / force-reset /
// delete (permission-gated), creating accounts, and the Root-only Transfer Crown
// and group-management panels. The API enforces every rule; the UI gating here
// is a convenience.

import { apiFetch, apiUpload, errorMessage } from './api.js';
import {
  $, el, clear, esc, formatShortDate, toast, showFieldErrors, groupTag,
} from './utils.js';
import { bootstrap, hasPermission } from './auth.js';

const SOCIETY_ROLES = [
  'President', 'General Secretary', 'Treasurer', 'Extended-Committee', 'Member', 'Alumni',
];

let session = null;
let users = [];
let groups = [];
let userSearchTerm = '';

/* — Capability helpers ——————————————————————————————————————— */

function isHomeAdmin() {
  return hasPermission(session, 'Admin') && session?.is_home_group === true;
}
function isRoot() {
  return hasPermission(session, 'Root');
}

// Whether the current actor may edit / reset / delete the target account.
function canManage(target) {
  if (target.permission === 'Root') return false;          // sitting Root → Transfer Crown only
  if (isRoot()) return true;                                // Root manages Read/Write/Admin
  // Home-group admins manage everyone (apart from sitting Root, blocked above).
  if (isHomeAdmin()) return target.permission !== 'Admin' || isRoot();
  // Other admins manage only their own group's Read/Write members.
  if (target.group?.id !== session.group_id) return false;
  return target.permission === 'Read' || target.permission === 'Write';
}

function assignablePermissions() {
  if (isRoot() || isHomeAdmin()) return ['Read', 'Write', 'Admin'];
  return ['Read', 'Write'];
}

function assignableGroupsForCreate() {
  // Home admins and Root pick from non-archived groups; other admins create in
  // their own group only.
  if (isRoot() || isHomeAdmin()) {
    return groups.filter((g) => !g.is_archived);
  }
  const own = groups.find((g) => g.id === session.group_id);
  return own ? [own] : [];
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

/* — User table ——————————————————————————————————————————————— */

function matchesSearch(u, term) {
  if (!term) return true;
  const haystack = `${u.username} ${u.permission} ${u.society_role} ${u.group?.name || ''}`.toLowerCase();
  return haystack.includes(term);
}

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
    u.group ? groupTag(u.group) : el('span', { class: 'faint text-sm', text: '—' }),
  ]));
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

  // Group cell. Root can edit; everyone else sees a read-only pill.
  let groupSel = null;
  const groupCell = el('td', {});
  if (isRoot()) {
    groupSel = el('select', { class: 'select' });
    groups
      .filter((g) => !g.is_archived || g.id === u.group?.id)
      .forEach((g) =>
        groupSel.appendChild(el('option', { value: g.id, text: g.name })));
    groupSel.value = u.group?.id || '';
  } else if (u.group) {
    groupCell.appendChild(groupTag(u.group));
  } else {
    groupCell.appendChild(el('span', { class: 'faint text-sm', text: '—' }));
  }
  if (groupSel) groupCell.appendChild(groupSel);
  tr.appendChild(groupCell);

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
    if (groupSel && groupSel.value && groupSel.value !== u.group?.id) {
      body.group_id = groupSel.value;
    }
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
  const filtered = users.filter((u) => matchesSearch(u, userSearchTerm));
  if (filtered.length === 0) {
    tbody.appendChild(el('tr', {}, [
      el('td', { colspan: '7', class: 'muted', text: userSearchTerm ? 'No members match that search.' : 'No members yet.' }),
    ]));
    return;
  }
  filtered.forEach((u) => tbody.appendChild(staticRow(u)));
}

/* — Member search box ————————————————————————————————————— */
function setupMemberSearch() {
  const input = $('#member-search');
  if (!input) return;
  input.addEventListener('input', () => {
    userSearchTerm = input.value.trim().toLowerCase();
    renderTable();
  });
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

  // Group dropdown. Group admins see only their own group (locked, single
  // option). Home admins and Root pick from any non-archived group.
  const groupSel = form.group_id;
  clear(groupSel);
  const opts = assignableGroupsForCreate();
  opts.forEach((g) => groupSel.appendChild(el('option', { value: g.id, text: g.name })));
  groupSel.disabled = opts.length <= 1;
  if (session.group_id) groupSel.value = session.group_id;

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
          group_id: groupSel.value,
        }),
      });
      showTempPassword(res.user.username, res.temp_password);
      form.username.value = '';
      load();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      else if (err.code === 'GROUP_QUOTA_REACHED') {
        toast('That group is at its member quota.', 'error');
      } else {
        toast(errorMessage(err, 'Could not create the account.'), 'error');
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Create account';
    }
  });
}

/* — Backup panel (Root only) ——————————————————————————————— */
function setupBackupPanel() {
  const panel = $('#backup-panel');
  if (!panel) return;
  if (hasPermission(session, 'Root')) panel.classList.remove('hidden');
}

/* — Manage groups (Root only) ————————————————————————————— */
function groupRow(g) {
  const tr = el('tr', { dataset: { id: g.id } });

  // Logo (if any) + name pill + website link.
  const nameCellKids = [];
  if (g.logo_url) {
    nameCellKids.push(el('img', { class: 'group-logo-thumb', src: g.logo_url, alt: `${g.name} logo` }));
  }
  nameCellKids.push(groupTag(g));
  if (g.link) {
    nameCellKids.push(el('a', {
      class: 'linkbtn text-sm', href: g.link, target: '_blank', rel: 'noopener noreferrer',
      text: 'site ↗', title: g.link,
    }));
  }
  tr.appendChild(el('td', {}, [el('div', { class: 'group-name-cell' }, nameCellKids)]));

  // Member count (computed from loaded users)
  const count = users.filter((u) => u.group?.id === g.id && u.is_active).length;
  tr.appendChild(el('td', { text: String(count) }));

  // Quota
  tr.appendChild(el('td', { text: g.member_quota == null ? 'Unlimited' : String(g.member_quota) }));

  // Status
  let status;
  if (g.is_home) status = 'Home group';
  else if (g.is_archived) status = 'Archived';
  else status = 'Active';
  tr.appendChild(el('td', { class: g.is_home ? 'status-active' : (g.is_archived ? 'muted' : '') }, [
    document.createTextNode(status),
  ]));

  // Actions
  const actions = el('div', { class: 'row-actions' });
  if (g.is_home) {
    actions.appendChild(el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Edit' })).addEventListener('click', () => editGroup(g));
  } else {
    const edit = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Edit' });
    edit.addEventListener('click', () => editGroup(g));
    actions.appendChild(edit);

    if (g.is_archived) {
      const restore = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Unarchive' });
      restore.addEventListener('click', () => toggleArchive(g, false));
      actions.appendChild(restore);
    } else {
      const arch = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Archive' });
      arch.addEventListener('click', () => toggleArchive(g, true));
      actions.appendChild(arch);
    }

    const del = el('button', { class: 'linkbtn linkbtn--danger text-sm', type: 'button', text: 'Delete' });
    del.addEventListener('click', () => deleteGroup(g));
    actions.appendChild(del);
  }
  tr.appendChild(el('td', {}, [actions]));
  return tr;
}

function renderGroupTable() {
  const tbody = $('#group-rows');
  if (!tbody) return;
  clear(tbody);
  if (groups.length === 0) {
    tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', class: 'muted', text: 'No groups yet.' })]));
    return;
  }
  groups.forEach((g) => tbody.appendChild(groupRow(g)));
}

function renderGroupEditRow(tr, g) {
  clear(tr);

  // Name + colour picker, stacked in the Group column.
  const nameInput = el('input', {
    class: 'input', type: 'text', value: g.name, maxlength: '100',
  });
  const colourInput = el('input', {
    class: 'colour-picker', type: 'color', value: g.colour,
    title: 'Pick the group pill colour',
  });

  // Website link.
  const linkInput = el('input', {
    class: 'input', type: 'url', value: g.link || '', placeholder: 'https://… (website)',
  });

  // Logo: current thumbnail (if any) + replace picker + remove button.
  let removeLogo = false;
  const logoFileInput = el('input', {
    class: 'input', type: 'file', accept: '.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp',
  });
  const logoThumb = g.logo_url
    ? el('img', { class: 'group-logo-thumb', src: g.logo_url, alt: `${g.name} logo` })
    : null;
  const removeBtn = g.logo_url
    ? el('button', { class: 'linkbtn linkbtn--danger text-sm', type: 'button', text: 'Remove' })
    : null;
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      removeLogo = true;
      logoThumb?.remove();
      removeBtn.remove();
      logoFileInput.value = '';
      toast('Logo will be removed when you save.', 'ok');
    });
  }
  const logoRow = el('div', { class: 'group-edit-logo' },
    [logoThumb, logoFileInput, removeBtn].filter(Boolean));

  const groupCell = el('td', {}, [
    el('div', { class: 'group-edit-fields' }, [
      el('div', { class: 'group-edit-row' }, [nameInput, colourInput]),
      linkInput,
      logoRow,
    ]),
  ]);
  tr.appendChild(groupCell);

  // Members (read-only).
  const count = users.filter((u) => u.group?.id === g.id && u.is_active).length;
  tr.appendChild(el('td', { text: String(count) }));

  // Quota input. Disabled for the home group (always unlimited).
  const quotaInput = el('input', {
    class: 'input', type: 'number', min: '1',
    value: g.member_quota == null ? '' : String(g.member_quota),
    placeholder: 'Unlimited',
  });
  if (g.is_home) quotaInput.disabled = true;
  tr.appendChild(el('td', {}, [quotaInput]));

  // Status (read-only here; archive flips via the separate button on the static row).
  const status = g.is_home ? 'Home group' : g.is_archived ? 'Archived' : 'Active';
  tr.appendChild(el('td', { text: status }));

  // Save / Cancel.
  const save = el('button', { class: 'btn btn--sm', type: 'button', text: 'Save' });
  const cancel = el('button', { class: 'linkbtn text-sm', type: 'button', text: 'Cancel' });
  cancel.addEventListener('click', renderGroupTable);

  save.addEventListener('click', async () => {
    const body = {};
    const newName = nameInput.value.trim();
    const newColour = colourInput.value.toUpperCase();
    if (newName && newName !== g.name) body.name = newName;
    if (newColour && newColour !== g.colour.toUpperCase()) body.colour = newColour;
    if (!g.is_home) {
      const q = quotaInput.value.trim();
      const newQuota = q === '' ? null : parseInt(q, 10);
      if (newQuota !== (g.member_quota == null ? null : g.member_quota)) {
        body.member_quota = newQuota;
      }
    }
    const newLink = linkInput.value.trim();
    if (newLink !== (g.link || '')) body.link = newLink === '' ? null : newLink;

    const newLogo = logoFileInput.files[0] || null;
    const hasChanges = Object.keys(body).length > 0 || newLogo || removeLogo;
    if (!hasChanges) { renderGroupTable(); return; }

    save.disabled = true;
    try {
      if (Object.keys(body).length > 0) {
        await apiFetch(`/groups/${encodeURIComponent(g.id)}`, {
          method: 'PATCH', body: JSON.stringify(body),
        });
      }
      // A newly chosen logo wins over a pending removal.
      if (newLogo) {
        const fd = new FormData();
        fd.append('logo', newLogo);
        await apiUpload(`/groups/${encodeURIComponent(g.id)}/logo`, fd);
      } else if (removeLogo) {
        await apiFetch(`/groups/${encodeURIComponent(g.id)}/logo`, { method: 'DELETE' });
      }
      toast('Group updated.', 'ok');
      await loadGroups();
      renderGroupTable();
    } catch (err) {
      if (err.fields?.link) {
        toast('The website must be a full http(s) address.', 'error');
      } else {
        toast(errorMessage(err, 'Could not update the group.'), 'error');
      }
      save.disabled = false;
    }
  });
  tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [save, cancel])]));
}

function editGroup(g) {
  const row = $(`#group-rows tr[data-id="${g.id}"]`);
  if (row) renderGroupEditRow(row, g);
}

async function toggleArchive(g, archive) {
  const verb = archive ? 'Archive' : 'Unarchive';
  if (!window.confirm(`${verb} ${g.name}?`)) return;
  try {
    await apiFetch(`/groups/${encodeURIComponent(g.id)}`, {
      method: 'PATCH', body: JSON.stringify({ is_archived: archive }),
    });
    toast(`${verb}d.`, 'ok');
    await loadGroups();
    renderGroupTable();
  } catch (err) {
    toast(errorMessage(err, `Could not ${verb.toLowerCase()} the group.`), 'error');
  }
}

async function deleteGroup(g) {
  if (!window.confirm(`Delete ${g.name}? All members must be moved or removed first.`)) return;
  try {
    await apiFetch(`/groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
    toast('Group deleted.', 'ok');
    await loadGroups();
    renderGroupTable();
  } catch (err) {
    if (err.code === 'GROUP_NOT_EMPTY') {
      toast('Cannot delete: group still has members.', 'error');
    } else {
      toast(errorMessage(err, 'Could not delete the group.'), 'error');
    }
  }
}

function setupGroupsPanel() {
  const panel = $('#groups-panel');
  if (!panel) return;
  if (!isRoot()) return;
  panel.classList.remove('hidden');

  $('#g-create-btn').addEventListener('click', async () => {
    const form = $('#group-create-form');
    showFieldErrors(form, null);
    const name = form.name.value.trim();
    const colour = form.colour.value.trim();
    const quota = form.member_quota.value.trim();
    const link = form.link.value.trim();
    const logoFile = form.logo.files[0] || null;
    const btn = $('#g-create-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const created = await apiFetch('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name,
          colour: colour || undefined,
          member_quota: quota || undefined,
          link: link || undefined,
        }),
      });
      // Logo rides in a second multipart request once the group id exists.
      if (logoFile && created?.id) {
        try {
          const fd = new FormData();
          fd.append('logo', logoFile);
          await apiUpload(`/groups/${encodeURIComponent(created.id)}/logo`, fd);
        } catch (logoErr) {
          toast(errorMessage(logoErr, 'Group created, but the logo upload failed.'), 'error');
        }
      }
      toast('Group created.', 'ok');
      form.reset();
      await loadGroups();
      renderGroupTable();
      // Refresh the create-user form's group dropdown.
      setupCreateForm._refreshGroups?.();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      else toast(errorMessage(err, 'Could not create the group.'), 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Create group';
    }
  });

  renderGroupTable();
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
      .filter((u) => u.id !== session.id && u.is_active && u.group?.is_home)
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
        INVALID_TARGET: 'That account cannot receive Root (must be an active home-group member).',
        SAME_ACCOUNT: 'You cannot transfer Root to yourself.',
        INVALID_CURRENT_ROOT: 'Your Root status could not be verified. Refresh and try again.',
        ROOT_SINGLETON_VIOLATION: 'The transfer failed a consistency check. No change was made.',
        TARGET_NOT_IN_HOME_GROUP: 'Move the target into the home group before transferring Root.',
      };
      toast(map[err.code] || errorMessage(err, 'Transfer failed.'), 'error');
      btn.disabled = false; btn.textContent = 'Transfer Root';
    }
  });
}

/* — Load + init ———————————————————————————————————————————— */
async function loadGroups() {
  try {
    groups = (await apiFetch('/groups', { noRedirect: true })) || [];
  } catch (_e) {
    groups = [];
  }
}

async function load() {
  try {
    users = (await apiFetch('/users')) || [];
    await loadGroups();
    renderTable();
    if ($('#group-rows')) renderGroupTable();
    const crown = $('#crown-panel');
    if (crown && crown._refresh) crown._refresh();
  } catch (err) {
    const tbody = $('#user-rows');
    clear(tbody);
    tbody.appendChild(el('tr', {}, [
      el('td', { colspan: '7', class: 'muted', text: errorMessage(err, 'Could not load members.') }),
    ]));
  }
}

async function init() {
  session = await bootstrap({ require: 'Admin' });
  if (!session || session.force_reset) return;

  // Reflect the actor's reach in the page subtitle.
  let scope;
  if (isRoot()) {
    scope = 'As Root you can manage every account, every group, and transfer the Root role.';
  } else if (isHomeAdmin()) {
    scope = 'As a home-group Admin you can manage every account across every group.';
  } else {
    scope = `As a group Admin you can manage members of ${session.group_name || 'your group'}.`;
  }
  $('#admin-scope').textContent = scope;

  // Load groups first so the create form's dropdown is populated.
  await loadGroups();

  setupMemberSearch();
  setupCreateForm();
  setupBackupPanel();
  setupGroupsPanel();
  setupTransferCrown();
  await load();
}

init();
