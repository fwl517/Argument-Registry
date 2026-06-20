// relations.js — UI for building the "clash map": adding directional links
/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// (this entry → another) and removing them.
//   POST   /api/entries/:id/relations   { target_id, relation_type, context_note }
//   DELETE /api/relations/:id

import { apiFetch, errorMessage } from './api.js';
import { el, clear, toast, showFieldErrors } from './utils.js';
import { hasPermission } from './auth.js';

// Relation types as stored in the DB (t_relation). 'Related' is symmetric —
// it reads the same from either entry, so it is stored as a single row.
const RELATION_TYPES = ['Counters', 'Rebuts', 'Evidence For', 'Updates', 'Related'];

// A small "?" help affordance matching the static forms (see .help-tip in
// components.css). The explanation rides in data-tip and is also exposed to
// assistive tech via aria-label.
function helpTip(text) {
  return el('span', {
    class: 'help-tip', tabindex: '0', 'data-tip': text, 'aria-label': text, text: '?',
  });
}

/**
 * Render the "add a link" editor into a container. No-op for sub-Write sessions.
 *
 * @param {HTMLElement} container
 * @param {string} entryId        the current (source) entry
 * @param {object|null} session
 * @param {()=>void} onChange      called after a successful add (re-render detail)
 */
export async function mountRelationEditor(container, entryId, session, onChange) {
  if (!container) return;
  clear(container);
  if (!hasPermission(session, 'Write')) return;

  const heading = el('h3', { text: 'Link another entry' });
  const help = el('p', {
    class: 'muted text-sm',
    text: 'Record how this entry relates to another — counters, rebuts, evidences, updates, or is generally related to it.',
  });

  const typeSelect = el('select', { class: 'select', name: 'relation_type' });
  RELATION_TYPES.forEach((t) => typeSelect.appendChild(el('option', { value: t, text: t })));

  const noteInput = el('input', {
    class: 'input', name: 'context_note', type: 'text',
    placeholder: 'Strategic note (optional) — why this link matters',
    maxlength: '500',
  });

  const errSlot = el('div', { class: 'field-error' });
  const submit = el('button', { class: 'btn btn--sm', type: 'button', text: 'Add link' });

  // — Searchable target picker (replaces the long <select>) —
  let entries = [];           // { id, title, topic }, sorted by title, self excluded
  let selectedTargetId = '';
  let activeIndex = -1;
  let shown = [];

  const searchInput = el('input', {
    class: 'input', type: 'text', id: 'rel-target',
    placeholder: 'Loading entries…', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'false',
    'aria-controls': 'rel-target-list', 'aria-autocomplete': 'list',
  });
  const list = el('div', { class: 'combobox__list hidden', id: 'rel-target-list', role: 'listbox' });
  const combo = el('div', { class: 'combobox' }, [searchInput, list]);

  const closeList = () => {
    list.classList.add('hidden');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };
  const setActive = (i) => {
    const opts = [...list.querySelectorAll('.combobox__option')];
    opts.forEach((o) => o.classList.remove('is-active'));
    activeIndex = i;
    if (i >= 0 && opts[i]) {
      opts[i].classList.add('is-active');
      searchInput.setAttribute('aria-activedescendant', opts[i].id);
      opts[i].scrollIntoView({ block: 'nearest' });
    } else {
      searchInput.removeAttribute('aria-activedescendant');
    }
  };
  const choose = (entry) => {
    selectedTargetId = entry.id;
    searchInput.value = entry.title;
    closeList();
  };
  const renderList = (query) => {
    const q = query.trim().toLowerCase();
    shown = (q ? entries.filter((e) => e.title.toLowerCase().includes(q)) : entries).slice(0, 50);
    clear(list);
    if (!entries.length) { closeList(); return; }
    if (!shown.length) {
      list.appendChild(el('div', { class: 'combobox__empty', text: 'No matching entries.' }));
    } else {
      shown.forEach((e, i) => {
        const opt = el('div', {
          class: 'combobox__option', id: `rel-opt-${i}`, role: 'option',
          'aria-selected': e.id === selectedTargetId ? 'true' : 'false',
        }, [
          el('span', { class: 'combobox__title', text: e.title }),
          e.topic ? el('span', { class: 'combobox__meta', text: e.topic }) : null,
        ].filter(Boolean));
        opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(e); });
        list.appendChild(opt);
      });
    }
    list.classList.remove('hidden');
    searchInput.setAttribute('aria-expanded', 'true');
    setActive(shown.length ? 0 : -1);
  };

  searchInput.addEventListener('input', () => {
    selectedTargetId = ''; // typing invalidates any prior pick
    renderList(searchInput.value);
  });
  searchInput.addEventListener('focus', () => { if (entries.length) renderList(searchInput.value); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.classList.contains('hidden')) renderList(searchInput.value);
      else setActive(Math.min(activeIndex + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (!list.classList.contains('hidden') && activeIndex >= 0 && shown[activeIndex]) {
        e.preventDefault(); choose(shown[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      closeList();
    }
  });
  searchInput.addEventListener('blur', () => { setTimeout(closeList, 120); });

  const form = el('form', { class: 'relation-form panel', autocomplete: 'off' }, [
    heading,
    help,
    el('div', { class: 'field' }, [
      el('label', { for: 'rel-target' }, [
        'Related entry ',
        helpTip('Search for the other entry you want to connect this one to.'),
      ]),
      combo,
    ]),
    el('div', { class: 'row row--wrap' }, [
      el('div', { class: 'field', style: { marginBottom: '0', flex: '0 0 auto', minWidth: '160px' } }, [
        el('label', {}, [
          'Relation ',
          helpTip('How this entry relates to the other — counters, rebuts, evidences, updates, or is generally related.'),
        ]),
        typeSelect,
      ]),
      el('div', { class: 'field', style: { marginBottom: '0', flex: '1 1 240px' } }, [
        el('label', {}, [
          'Context note ',
          helpTip('A short note explaining how or why the two entries are connected.'),
        ]),
        noteInput,
      ]),
    ]),
    errSlot,
    el('div', { class: 'row', style: { marginTop: '8px' } }, [submit]),
  ]);

  container.appendChild(form);

  // Populate the searchable list (authenticated view includes private entries).
  try {
    const data = await apiFetch('/entries?per_page=100');
    entries = (data?.entries || [])
      .filter((e) => e.id !== entryId)
      .map((e) => ({ id: e.id, title: e.title, topic: e.topic || '' }))
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!entries.length) {
      searchInput.placeholder = 'No other entries yet';
      searchInput.disabled = true;
      submit.disabled = true;
    } else {
      searchInput.placeholder = `Search ${entries.length} entries by title…`;
    }
  } catch (_e) {
    searchInput.placeholder = 'Could not load entries';
    searchInput.disabled = true;
  }

  submit.addEventListener('click', async () => {
    errSlot.textContent = '';
    if (!selectedTargetId) {
      errSlot.textContent = 'Search for and select an entry to link to.';
      searchInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Adding…';
    try {
      await apiFetch(`/entries/${encodeURIComponent(entryId)}/relations`, {
        method: 'POST',
        body: JSON.stringify({
          target_id: selectedTargetId,
          relation_type: typeSelect.value,
          context_note: noteInput.value.trim() || null,
        }),
      });
      toast('Link added.', 'ok');
      noteInput.value = '';
      searchInput.value = '';
      selectedTargetId = '';
      if (typeof onChange === 'function') onChange();
    } catch (err) {
      if (err.code === 'DUPLICATE_RELATION') {
        errSlot.textContent = 'These two entries are already linked that way.';
      } else if (err.fields) {
        showFieldErrors(form, err.fields);
        errSlot.textContent = errorMessage(err);
      } else {
        errSlot.textContent = errorMessage(err, 'Could not add the link.');
      }
    } finally {
      submit.disabled = false;
      submit.textContent = 'Add link';
    }
  });
}

/**
 * Delete a relation by id. Returns true on success.
 * @param {number|string} relationId
 */
export async function removeRelation(relationId) {
  await apiFetch(`/relations/${encodeURIComponent(relationId)}`, { method: 'DELETE' });
  return true;
}
