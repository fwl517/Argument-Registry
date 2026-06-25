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

// 'Related' reads the same from both entries, so its direction can't be swapped.
const SYMMETRIC = new Set(['Related']);

// A small "?" help affordance matching the static forms (see .help-tip in
// components.css). The explanation rides in data-tip and is also exposed to
// assistive tech via aria-label.
function helpTip(text) {
  return el('span', {
    class: 'help-tip', tabindex: '0', 'data-tip': text, 'aria-label': text, text: '?',
  });
}

// A small badge explaining why a suggestion surfaced (see GET /:id/related).
function reasonChip(reason, matchedKeywords) {
  if (reason === 'keyword') {
    const tags = (matchedKeywords || []).slice(0, 3).map((t) => `#${t}`).join(' ');
    return el('span', { class: 'badge badge--keyword', text: tags || 'Shared keyword' });
  }
  return el('span', {
    class: 'badge badge--meta',
    text: reason === 'topic' ? 'Same topic' : 'Clash cluster',
  });
}

/**
 * Render the "add a link" editor into a container. No-op for sub-Write sessions.
 *
 * @param {HTMLElement} container
 * @param {string} entryId        the current (source) entry
 * @param {object|null} session
 * @param {()=>void} onChange      called after a successful add (re-render detail)
 * @param {string} [entryTitle]   title of the current entry, for the direction preview
 */
export async function mountRelationEditor(container, entryId, session, onChange, entryTitle) {
  if (!container) return;
  clear(container);
  if (!hasPermission(session, 'Write')) return;

  const selfLabel = entryTitle || 'This entry';

  const heading = el('h3', { text: 'Link another entry' });
  const help = el('p', {
    class: 'muted text-sm',
    text: 'Record how this entry relates to another — counters, rebuts, evidences, updates, or is generally related to it. Use Swap to record the inverse (the other entry → this one) without leaving this page.',
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
  let direction = 'out';      // 'out' = this → other, 'in' = other → this
  let activeIndex = -1;
  let shown = [];

  // Live preview of the directed relation, mirroring the stored source → target.
  const previewSrc = el('span', { class: 'rel-preview__node' });
  const previewVerb = el('span', { class: 'rel-preview__verb' });
  const previewDst = el('span', { class: 'rel-preview__node' });
  const swapBtn = el('button', {
    class: 'btn btn--ghost btn--sm', type: 'button',
    'aria-label': 'Swap relation direction', text: '⇄ Swap',
  });

  const renderPreview = () => {
    const symmetric = SYMMETRIC.has(typeSelect.value);
    if (symmetric) direction = 'out';
    const other = selectedTargetId ? searchInput.value : 'the other entry';
    const srcText = direction === 'in' ? other : selfLabel;
    const dstText = direction === 'in' ? selfLabel : other;
    previewSrc.textContent = srcText;
    previewDst.textContent = dstText;
    previewSrc.classList.toggle('is-self', direction !== 'in');
    previewDst.classList.toggle('is-self', direction === 'in');
    previewVerb.textContent = symmetric
      ? `◀ ${typeSelect.value} ▶`
      : `── ${typeSelect.value} ▶`;
    swapBtn.disabled = symmetric;
    swapBtn.title = symmetric
      ? '“Related” is symmetric — direction doesn’t apply.'
      : 'Swap which entry is the source of the relation.';
  };

  swapBtn.addEventListener('click', () => {
    if (SYMMETRIC.has(typeSelect.value)) return;
    direction = direction === 'in' ? 'out' : 'in';
    renderPreview();
  });

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
    renderPreview();
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
    renderPreview();
  });
  typeSelect.addEventListener('change', renderPreview);
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
    el('div', { class: 'field', style: { marginBottom: '0' } }, [
      el('label', {}, [
        'Direction ',
        helpTip('Which entry is the source. Swap to record the inverse — e.g. that the other entry counters this one — without opening its page.'),
      ]),
      el('div', { class: 'rel-direction' }, [
        el('div', { class: 'rel-preview' }, [previewSrc, previewVerb, previewDst]),
        swapBtn,
      ]),
    ]),
    errSlot,
    el('div', { class: 'row', style: { marginTop: '8px' } }, [submit]),
  ]);

  container.appendChild(form);
  renderPreview();

  // — Suggested entries to link (discovery aid; titles are easy to forget) —
  // Lists the union of same-topic, shared-keyword, and same-clash-cluster
  // entries. Clicking one fills the picker above so it can be linked.
  const suggestWrap = el('div', { class: 'relation-suggest' });
  container.appendChild(suggestWrap);

  const loadSuggestions = async () => {
    let data;
    try {
      data = await apiFetch(`/entries/${encodeURIComponent(entryId)}/related`);
    } catch (_e) {
      return; // optional aid — fail quietly
    }
    const items = data?.suggestions || [];
    clear(suggestWrap);
    if (!items.length) return;
    suggestWrap.appendChild(el('h3', { text: 'Related entries you might link' }));
    suggestWrap.appendChild(el('p', {
      class: 'muted text-sm',
      text: 'Entries sharing this one’s topic or keywords, or sitting in the same clash-map cluster. Click one to fill the picker above.',
    }));
    const listEl = el('div', { class: 'suggest-list' });
    items.forEach((s) => {
      const item = el('button', {
        class: 'suggest-item', type: 'button',
        onClick: () => {
          choose({ id: s.id, title: s.title });
          combo.scrollIntoView({ block: 'nearest' });
          typeSelect.focus();
        },
      }, [
        el('span', { class: 'suggest-main' }, [
          el('span', { class: 'suggest-title', text: s.title }),
          s.topic ? el('span', { class: 'suggest-topic', text: s.topic }) : null,
        ].filter(Boolean)),
        el('span', { class: 'suggest-reasons' }, s.reasons.map((r) => reasonChip(r, s.matched_keywords))),
      ]);
      listEl.appendChild(item);
    });
    suggestWrap.appendChild(listEl);
  };

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

  loadSuggestions();

  submit.addEventListener('click', async () => {
    errSlot.textContent = '';
    if (!selectedTargetId) {
      errSlot.textContent = 'Search for and select an entry to link to.';
      searchInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Adding…';
    // When swapped, the other entry is the source and this entry is the target,
    // so the row is created on the other entry's relations endpoint.
    const swapped = direction === 'in' && !SYMMETRIC.has(typeSelect.value);
    const sourceId = swapped ? selectedTargetId : entryId;
    const targetId = swapped ? entryId : selectedTargetId;
    try {
      await apiFetch(`/entries/${encodeURIComponent(sourceId)}/relations`, {
        method: 'POST',
        body: JSON.stringify({
          target_id: targetId,
          relation_type: typeSelect.value,
          context_note: noteInput.value.trim() || null,
        }),
      });
      toast('Link added.', 'ok');
      noteInput.value = '';
      searchInput.value = '';
      selectedTargetId = '';
      direction = 'out';
      renderPreview();
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
