/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// dead-ends.js — controller for dead-ends.html (members only). Lists every
// "Opposed" entry that nothing in the database counters or rebuts, so the team
// can see at a glance which opposing arguments still need a rebuttal uploaded.

import { apiFetch, errorMessage } from './api.js';
import { $, el, clear } from './utils.js';
import { bootstrap } from './auth.js';
import { renderEntries, renderLoading, renderError } from './entries.js';
import { mountGroupBanner } from './banner.js';

function renderEmpty(container) {
  clear(container);
  const box = el('div', { class: 'empty-state' });
  box.appendChild(el('h3', { text: 'No dead ends' }));
  box.appendChild(el('p', {
    class: 'muted mb-0',
    text: 'Every entry marked Opposed already has something countering or rebutting it. Nothing to chase.',
  }));
  container.appendChild(box);
}

async function init() {
  const session = await bootstrap({ require: 'auth' });
  if (!session || session.force_reset) return;

  mountGroupBanner();

  const listEl = $('#entry-results');
  const countEl = $('#result-count');

  renderLoading(listEl);
  try {
    const data = await apiFetch('/entries/dead-ends');
    if (!data || !(data.entries || []).length) {
      if (countEl) countEl.textContent = '0 dead ends';
      renderEmpty(listEl);
      return;
    }
    if (countEl) {
      countEl.textContent = data.total === 1 ? '1 dead end' : `${data.total} dead ends`;
    }
    // No pagination: the endpoint returns the full worklist in one shot.
    renderEntries(listEl, data);
  } catch (err) {
    if (countEl) countEl.textContent = '';
    renderError(listEl, errorMessage(err, 'Could not load dead ends.'));
  }
}

init();
