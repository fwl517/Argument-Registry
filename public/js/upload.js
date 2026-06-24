/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// upload.js — the entry form, shared by upload.html (create) and edit.html.
// Mode is decided by the presence of ?id=<uuid> in the URL.
//
//   Create: POST /api/entries        (multipart/form-data, file inline)
//   Edit:   POST /api/files (if a new file is chosen) → PATCH /api/entries/:id (JSON)

import { apiFetch, apiUpload, errorMessage } from './api.js';
import {
  $, el, clear, queryParam, toast, showFieldErrors, formatDate, attachAutocomplete,
} from './utils.js';
import { bootstrap } from './auth.js';

// Enum value lists (mirror the DB enum types exactly).
const STANCES = ['Pro', 'Con', 'Neutral/Background'];
const ALIGNMENTS = ['Aligned', 'Opposed', 'Neutral'];
const ARG_TYPES = ['Study', 'Article', 'Raw Statistic', 'Policy Paper', 'Argument', 'Other'];
const SRC_TYPES = [
  'Our Party Platform',
  'Opposition Platform',
  'Academic',
  'News',
  'Original Society Material',
  'Other',
];

/* — Note-to-file + client-side type guard ——————————————————— */
function noteToFile(text) {
  const stamp = new Date().toISOString().slice(0, 10);
  return new File([String(text)], `note-${stamp}.md`, { type: 'text/markdown' });
}

// Obviously-unsafe extensions refused on the client. Convenience only —
// the SERVER must enforce its own allow-list (accept + this list are bypassable).
const BLOCKED_EXT = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'app', 'jar',
  'sh', 'ps1', 'vbs', 'js', 'mjs', 'wsf',
  'html', 'htm', 'svg', 'svgz', 'xhtml',
  'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'rb',
]);

function extOf(name) {
  const base = String(name || '').split('/').pop().split('?')[0];
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function fileTypeError(file) {
  if (!file) return null;
  return BLOCKED_EXT.has(extOf(file.name))
    ? 'That file type isn’t allowed for security reasons.'
    : null;
}

let mode = 'create';
let entryId = null;
let existingLocalPath = null; // current attached file in edit mode
let anonTouched = false; // whether the user changed the anonymise box (edit mode)
const keywords = new Set();
let allKeywords = []; // [{ tag, alias_of, canonical_tag }] — keyword suggestion pool
let allTopics = [];   // [string] — topic suggestion pool

/* — Existing-value suggestions (topic + keyword autocomplete) ———————— */
async function loadSuggestions() {
  try {
    const [topics, kws] = await Promise.all([
      apiFetch('/entries/topics', { noRedirect: true }).catch(() => []),
      apiFetch('/keywords', { noRedirect: true }).catch(() => []),
    ]);
    allTopics = Array.isArray(topics) ? topics : [];
    allKeywords = Array.isArray(kws) ? kws : [];
  } catch (_e) {
    /* suggestions are a convenience — never block the form on a fetch failure */
  }
}

/* — Select population ————————————————————————————————————— */
function fillSelect(select, values, { placeholder } = {}) {
  clear(select);
  if (placeholder) select.appendChild(el('option', { value: '', text: placeholder }));
  values.forEach((v) => select.appendChild(el('option', { value: v, text: v })));
}

function populateSourceSelect(sources, select, preview, currentId) {
  clear(select);
  select.appendChild(el('option', { value: '', text: '— None —' }));
  sources.forEach((s) => {
    const opt = el('option', { value: String(s.id), text: s.name });
    opt.dataset.colour = s.colour;
    opt.dataset.textColour = s.text_colour;
    select.appendChild(opt);
  });
  if (currentId != null) select.value = String(currentId);
  updateSourcePreview(select, preview);
}

function updateSourcePreview(select, preview) {
  clear(preview);
  const opt = select.selectedOptions[0];
  if (!opt || !opt.value) {
    preview.appendChild(el('span', { class: 'faint text-sm', text: 'No party/source selected.' }));
    return;
  }
  const badge = el('span', { class: 'badge badge--source', text: opt.textContent });
  badge.style.backgroundColor = opt.dataset.colour || '';
  badge.style.color = opt.dataset.textColour || '';
  preview.appendChild(badge);
}

/* — Keyword pill input ——————————————————————————————————— */
function renderPills(container) {
  // Remove existing pills (but keep the text input).
  [...container.querySelectorAll('.pill')].forEach((p) => p.remove());
  const input = container.querySelector('input');
  for (const tag of keywords) {
    const pill = el('span', { class: 'pill' }, [
      document.createTextNode(`#${tag}`),
      (() => {
        const x = el('button', { type: 'button', 'aria-label': `Remove ${tag}` });
        x.textContent = '×';
        x.addEventListener('click', () => { keywords.delete(tag); renderPills(container); });
        return x;
      })(),
    ]);
    container.insertBefore(pill, input);
  }
}

function normaliseTag(raw) {
  return String(raw).replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-');
}

function setupKeywordInput(container) {
  const input = container.querySelector('input');
  const commit = () => {
    const parts = input.value.split(',');
    let added = false;
    parts.forEach((p) => {
      const tag = normaliseTag(p);
      if (tag) { keywords.add(tag); added = true; }
    });
    input.value = '';
    if (added) renderPills(container);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && input.value === '' && keywords.size) {
      const last = [...keywords].pop();
      keywords.delete(last);
      renderPills(container);
    }
  });
  input.addEventListener('blur', commit);
  // Clicking anywhere in the box focuses the input.
  container.addEventListener('click', (e) => { if (e.target === container) input.focus(); });
}

/* — Add-new-source mini form ————————————————————————————— */
function setupAddSource(els) {
  const { toggleBtn, panel, nameInput, colourInput, saveBtn, cancelBtn, select, preview } = els;
  toggleBtn.addEventListener('click', () => panel.classList.toggle('hidden'));
  cancelBtn.addEventListener('click', () => {
    panel.classList.add('hidden');
    nameInput.value = '';
  });
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Give the source a name.', 'error'); nameInput.focus(); return; }
    saveBtn.disabled = true;
    try {
      const created = await apiFetch('/sources', {
        method: 'POST',
        body: JSON.stringify({ name, colour: colourInput.value }),
      });
      const opt = el('option', { value: String(created.id), text: created.name });
      opt.dataset.colour = created.colour;
      opt.dataset.textColour = created.text_colour;
      select.appendChild(opt);
      select.value = String(created.id);
      updateSourcePreview(select, preview);
      toast('Source added.', 'ok');
      panel.classList.add('hidden');
      nameInput.value = '';
    } catch (err) {
      toast(errorMessage(err, 'Could not add the source.'), 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/* — Load existing entry (edit mode) ——————————————————————— */
async function loadEntry(form, sourceSelect, sourcePreview, fileInfo) {
  const entry = await apiFetch(`/entries/${encodeURIComponent(entryId)}`);
  if (!entry) return false; // 401 → redirected

  form.title.value = entry.title || '';
  form.topic.value = entry.topic || '';
  form.gist.value = entry.gist || '';
  if (entry.stance) form.stance.value = entry.stance;
  if (entry.society_alignment) form.society_alignment.value = entry.society_alignment;
  if (entry.argument_type) form.argument_type.value = entry.argument_type;
  if (entry.source_type) form.source_type.value = entry.source_type;
  form.link.value = entry.link || '';
  form.is_private.checked = !!entry.is_private;

  if (entry.source?.id != null) {
    sourceSelect.value = String(entry.source.id);
    updateSourcePreview(sourceSelect, sourcePreview);
  }

  if (entry.date_published) {
    form.date_published.value = String(entry.date_published).slice(0, 10);
  }

  (entry.keywords || []).forEach((t) => keywords.add(t));
  renderPills($('#keyword-input'));

  existingLocalPath = entry.local_path || null;
  if (existingLocalPath) {
    clear(fileInfo);
    fileInfo.appendChild(el('span', { class: 'text-sm muted', text: 'A file is currently attached. ' }));
    fileInfo.appendChild(el('span', { class: 'text-sm', text: 'Choosing a new file replaces it.' }));
  }
  document.title = `Edit · ${entry.title}`;
  return true;
}

/* — Submit ————————————————————————————————————————————————— */
function gatherCommon(form) {
  return {
    title: form.title.value.trim(),
    topic: form.topic.value.trim(),
    gist: form.gist.value.trim(),
    stance: form.stance.value,
    society_alignment: form.society_alignment.value,
    argument_type: form.argument_type.value,
    source_type: form.source_type.value,
    source_id: form.source_id.value || '',
    date_published: form.date_published.value || '',
    link: form.link.value.trim(),
    is_private: form.is_private.checked,
  };
}

function clientValidate(data, hasFile) {
  const fields = {};
  if (!data.title) fields.title = 'Required.';
  if (!data.topic) fields.topic = 'Required.';
  if (!data.gist) fields.gist = 'Required.';
  if (!STANCES.includes(data.stance)) fields.stance = 'Choose a stance.';
  if (!ALIGNMENTS.includes(data.society_alignment)) fields.society_alignment = 'Choose an alignment.';
  if (!ARG_TYPES.includes(data.argument_type)) fields.argument_type = 'Choose a type.';
  if (!SRC_TYPES.includes(data.source_type)) fields.source_type = 'Choose a category.';
  if (!data.link && !hasFile) fields.link = 'Provide a link, attach a file, or write a note.';
  return fields;
}

async function submitCreate(form, fileInput, submitBtn) {
  const data = gatherCommon(form);
  let file = fileInput.files[0] || null;

  // No file chosen but the author typed a note → save the note as a .txt file.
  const note = (form.note_text ? form.note_text.value : '').trim();
  if (!file && note) file = noteToFile(note);

  const typeErr = fileTypeError(file);
  if (typeErr) { toast(typeErr, 'error'); return; }

  const fields = clientValidate(data, !!file);
  if (Object.keys(fields).length) { showFieldErrors(form, fields); return; }

  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => {
    if (k === 'is_private') fd.set(k, v ? 'true' : 'false');
    else if (v !== '') fd.set(k, v);
  });
  fd.set('anonymise_uploader', form.anonymise_uploader.checked ? 'true' : 'false');
  fd.set('keywords', [...keywords].join(','));
  if (file) fd.set('file', file);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    const entry = await apiUpload('/entries', fd, 'POST');
    toast('Entry created.', 'ok');
    window.location.href = `/entry.html?id=${encodeURIComponent(entry.id)}`;
  } catch (err) {
    if (err.fields) showFieldErrors(form, err.fields);
    toast(errorMessage(err, 'Could not create the entry.'), 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create entry';
  }
}

async function submitEdit(form, fileInput, submitBtn) {
  const data = gatherCommon(form);
  let file = fileInput.files[0] || null;

  // No new file chosen but the author typed a note → save the note as a .txt file.
  const note = (form.note_text ? form.note_text.value : '').trim();
  if (!file && note) file = noteToFile(note);

  const typeErr = fileTypeError(file);
  if (typeErr) { toast(typeErr, 'error'); return; }

  const willHaveFile = !!file || !!existingLocalPath;
  const fields = clientValidate(data, willHaveFile);
  if (Object.keys(fields).length) { showFieldErrors(form, fields); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  try {
    // If a new file (or note) was provided, upload it first to obtain its stored path.
    let localPath;
    if (file) {
      const fd = new FormData();
      fd.set('file', file);
      const up = await apiUpload('/files', fd, 'POST');
      localPath = up.local_path;
    }

    const body = {
      title: data.title,
      topic: data.topic,
      gist: data.gist,
      stance: data.stance,
      society_alignment: data.society_alignment,
      argument_type: data.argument_type,
      source_type: data.source_type,
      source_id: data.source_id === '' ? null : data.source_id,
      date_published: data.date_published === '' ? null : data.date_published,
      link: data.link === '' ? null : data.link,
      is_private: data.is_private,
      keywords: [...keywords].join(','),
    };
    if (localPath) body.local_path = localPath;
    if (anonTouched) body.anonymise_uploader = form.anonymise_uploader.checked;

    await apiFetch(`/entries/${encodeURIComponent(entryId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    toast('Changes saved.', 'ok');
    window.location.href = `/entry.html?id=${encodeURIComponent(entryId)}`;
  } catch (err) {
    if (err.fields) showFieldErrors(form, err.fields);
    toast(errorMessage(err, 'Could not save changes.'), 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save changes';
  }
}

/* — Init ——————————————————————————————————————————————————— */
async function init() {
  entryId = queryParam('id');
  mode = entryId ? 'edit' : 'create';

  // upload.html needs Write+, edit.html needs Write+ (own) / Admin+ — both Write gate here.
  const session = await bootstrap({ require: 'Write' });
  if (!session || session.force_reset) return;

  const form = $('#entry-form');
  const sourceSelect = form.source_id;
  const sourcePreview = $('#source-preview');
  const fileInput = form.file;
  const fileInfo = $('#file-info');
  const submitBtn = $('#submit-btn');

  // Page chrome depends on the mode.
  if (mode === 'edit') {
    $('#form-eyebrow').textContent = 'Amend record';
    $('#form-title').textContent = 'Edit entry';
    submitBtn.textContent = 'Save changes';
    $('#anon-hint').textContent = 'Leave unchanged unless you want to alter attribution.';
  }

  // Static selects.
  fillSelect(form.stance, STANCES, { placeholder: '— Choose stance —' });
  fillSelect(form.society_alignment, ALIGNMENTS, { placeholder: '— Choose alignment —' });
  fillSelect(form.argument_type, ARG_TYPES, { placeholder: '— Choose type —' });
  fillSelect(form.source_type, SRC_TYPES, { placeholder: '— Choose category —' });

  // Keyword pills + source preview + add-source.
  setupKeywordInput($('#keyword-input'));

  // Existing-value suggestions: a custom, site-styled autocomplete (not the
  // unstyleable native <datalist>). Data loads async; getItems reads the live
  // pools so the menus populate as soon as the fetch resolves.
  loadSuggestions();
  attachAutocomplete(form.topic, {
    getItems: () => allTopics.map((t) => ({ value: t })),
    onSelect: (it) => { form.topic.value = it.value; form.topic.focus(); },
  });
  const kwInput = $('#f-keyword-input');
  attachAutocomplete(kwInput, {
    host: $('#keyword-input'),
    getItems: () => allKeywords
      .filter((k) => !keywords.has(k.tag))
      .map((k) => ({
        value: k.tag,
        hint: (k.alias_of != null && k.canonical_tag) ? `→ ${k.canonical_tag}` : '',
      })),
    onSelect: (it) => {
      keywords.add(it.value);
      renderPills($('#keyword-input'));
      kwInput.value = '';
      kwInput.focus();
    },
  });
  sourceSelect.addEventListener('change', () => updateSourcePreview(sourceSelect, sourcePreview));
  form.anonymise_uploader.addEventListener('change', () => { anonTouched = true; });

  setupAddSource({
    toggleBtn: $('#add-source-toggle'),
    panel: $('#add-source-panel'),
    nameInput: $('#new-source-name'),
    colourInput: $('#new-source-colour'),
    saveBtn: $('#new-source-save'),
    cancelBtn: $('#new-source-cancel'),
    select: sourceSelect,
    preview: sourcePreview,
  });

  // Load sources for the selector.
  try {
    const sources = await apiFetch('/sources', { noRedirect: true });
    populateSourceSelect(sources || [], sourceSelect, sourcePreview, null);
  } catch (_e) {
    sourcePreview.appendChild(el('span', { class: 'faint text-sm', text: 'Could not load sources.' }));
  }

  // In edit mode, hydrate the form from the existing entry (after sources load
  // so the source <select> can be preselected).
  if (mode === 'edit') {
    try {
      const ok = await loadEntry(form, sourceSelect, sourcePreview, fileInfo);
      if (!ok) return;
    } catch (err) {
      if (err.status === 404) {
        $('#form-card').classList.add('hidden');
        $('#not-found').classList.remove('hidden');
        return;
      }
      if (err.status === 403) {
        toast('You can only edit your own entries.', 'error');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 900);
        return;
      }
      toast(errorMessage(err, 'Could not load the entry.'), 'error');
    }
  }

  submitBtn.addEventListener('click', () => {
    if (mode === 'edit') submitEdit(form, fileInput, submitBtn);
    else submitCreate(form, fileInput, submitBtn);
  });
}

init();
