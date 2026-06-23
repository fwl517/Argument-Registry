/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// tags.js — Write-gated keyword/synonym management. Lets contributors group
// synonymous tags (e.g. tax / taxation / taxes) so they match together in search
// and in the related-entry suggestions. Entries keep their literal tags; only the
// matching concept is shared.

import { apiFetch, errorMessage } from './api.js';
import { $, el, clear, toast, keywordTag } from './utils.js';
import { bootstrap } from './auth.js';

let keywords = []; // [{ id, tag, alias_of, canonical_tag, concept_id, group_tag, entry_count }]

async function load() {
  keywords = await apiFetch('/keywords');
  renderSelects();
  renderGroups();
}

/** Populate the two merge selects from the full keyword list. */
function renderSelects() {
  const source = $('#merge-source');
  const target = $('#merge-target');
  const prevSource = source.value;
  const prevTarget = target.value;
  clear(source);
  clear(target);

  const sorted = [...keywords].sort((a, b) => a.tag.localeCompare(b.tag));
  for (const k of sorted) {
    const inGroup = k.alias_of != null ? ` · in ${k.canonical_tag}` : '';
    const label = `${k.tag}${inGroup} (${k.entry_count})`;
    source.appendChild(el('option', { value: String(k.id), text: label }));
    target.appendChild(el('option', { value: String(k.id), text: label }));
  }
  // Preserve selections across reloads where the option still exists.
  if (prevSource) source.value = prevSource;
  if (prevTarget) target.value = prevTarget;
}

/** Render the synonym groups (only concepts with more than one member). */
function renderGroups() {
  const host = clear($('#groups-list'));
  const filter = $('#group-filter').value.trim().toLowerCase();

  const byConcept = new Map();
  for (const k of keywords) {
    if (!byConcept.has(k.concept_id)) byConcept.set(k.concept_id, []);
    byConcept.get(k.concept_id).push(k);
  }

  const groups = [...byConcept.values()]
    .filter((members) => members.length > 1)
    .map((members) => members.slice().sort((a, b) => {
      // Canonical (alias_of == null) first, then alphabetical.
      if ((a.alias_of == null) !== (b.alias_of == null)) return a.alias_of == null ? -1 : 1;
      return a.tag.localeCompare(b.tag);
    }))
    .filter((members) => !filter || members.some((m) => m.tag.includes(filter)))
    .sort((a, b) => a[0].tag.localeCompare(b[0].tag));

  if (groups.length === 0) {
    host.appendChild(el('p', { class: 'muted text-sm', text: filter
      ? 'No synonym groups match that filter.'
      : 'No synonym groups yet. Use the form above to link two tags.' }));
    return;
  }

  for (const members of groups) {
    host.appendChild(renderGroupCard(members));
  }
}

function renderGroupCard(members) {
  const card = el('div', { class: 'panel' });
  card.style.padding = '0.85rem 1rem';
  card.style.marginBottom = '0.75rem';

  const row = el('div');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.alignItems = 'center';
  row.style.gap = '0.5rem';

  for (const m of members) {
    const chip = keywordTag(m.tag);
    chip.title = `${m.entry_count} entr${m.entry_count === 1 ? 'y' : 'ies'}`;
    if (m.alias_of == null) {
      // Canonical anchor of the group.
      chip.style.fontWeight = '700';
      row.appendChild(chip);
    } else {
      const wrap = el('span');
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '0.25rem';
      wrap.appendChild(chip);
      const del = el('button', { class: 'linkbtn', type: 'button', text: '✕', title: `Detach “${m.tag}”` });
      del.style.lineHeight = '1';
      del.addEventListener('click', () => detach(m));
      wrap.appendChild(del);
      row.appendChild(wrap);
    }
  }

  card.appendChild(row);
  return card;
}

async function detach(member) {
  if (!window.confirm(`Detach “${member.tag}” from the “${member.canonical_tag}” group? It will stand alone again.`)) return;
  try {
    await apiFetch(`/keywords/${member.id}/alias`, { method: 'DELETE' });
    toast(`“${member.tag}” detached.`, 'ok');
    await load();
  } catch (err) {
    toast(errorMessage(err, 'Could not detach that tag.'), 'error');
  }
}

async function merge() {
  const sourceId = Number($('#merge-source').value);
  const targetId = Number($('#merge-target').value);
  if (!sourceId || !targetId) { toast('Pick two tags first.', 'info'); return; }
  if (sourceId === targetId) { toast('Pick two different tags.', 'error'); return; }

  const btn = $('#merge-btn');
  btn.disabled = true;
  btn.textContent = 'Linking…';
  try {
    await apiFetch(`/keywords/${sourceId}/alias`, {
      method: 'POST',
      body: JSON.stringify({ target_id: targetId }),
    });
    toast('Synonyms linked.', 'ok');
    await load();
  } catch (err) {
    toast(errorMessage(err, 'Could not link those tags.'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Link synonyms';
  }
}

async function init() {
  const session = await bootstrap({ require: 'Write' });
  if (!session || session.force_reset) return;

  $('#merge-btn').addEventListener('click', merge);
  $('#group-filter').addEventListener('input', renderGroups);
  await load();
}

init();
