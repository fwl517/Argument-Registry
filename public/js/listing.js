/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// listing.js — page controller shared by index.html (public) and dashboard.html
// (members). The two pages render an identical listing UI; the server decides
// which entries are visible based on the session cookie. dashboard.html sets
// data-require-auth="true" on <body> to gate access.

import { apiFetch, errorMessage } from './api.js';
import { $, el, clear } from './utils.js';
import { bootstrap } from './auth.js';
import { initSearch } from './search.js';
import { renderEntries, renderLoading, renderError } from './entries.js';

async function populateSourceFilter() {
  const select = $('#filter-source');
  if (!select) return;
  try {
    const sources = await apiFetch('/sources', { noRedirect: true });
    (sources || []).forEach((s) => {
      select.appendChild(el('option', { value: String(s.id), text: s.name }));
    });
    // Re-apply any value pre-filled from the URL (the option may not have existed
    // when search.js hydrated the form).
    const urlVal = new URLSearchParams(location.search).get('source_id');
    if (urlVal) select.value = urlVal;
  } catch (_e) {
    /* a failed source list just leaves the party filter empty */
  }
}

async function populateGroupFilter() {
  const select = $('#filter-group');
  if (!select) return;
  try {
    const groups = await apiFetch('/groups', { noRedirect: true });
    (groups || []).forEach((g) => {
      const label = g.is_archived ? `${g.name} (archived)` : g.name;
      select.appendChild(el('option', { value: g.id, text: label }));
    });
    const urlVal = new URLSearchParams(location.search).get('group_id');
    if (urlVal) select.value = urlVal;
  } catch (_e) {
    /* a failed group list just leaves the filter empty */
  }
}

async function init() {
  const requireAuth = document.body.dataset.requireAuth === 'true';
  const session = await bootstrap(requireAuth ? { require: 'auth' } : {});
  if (requireAuth && (!session || session.force_reset)) return;

  const form = $('#filter-form');
  const listEl = $('#entry-results');
  const countEl = $('#result-count');

  await Promise.all([populateSourceFilter(), populateGroupFilter()]);

  let controller;
  const onResults = (data) => {
    renderEntries(listEl, data, { countEl, onPage: (n) => controller.goToPage(n) });
  };

  controller = initSearch(form, onResults, {
    onStart: () => renderLoading(listEl),
    onError: (err) => renderError(listEl, errorMessage(err, 'Could not load entries.')),
  });

  const clearBtn = $('#clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      controller.reset();
      const src = $('#filter-source');
      if (src) src.value = '';
      const grp = $('#filter-group');
      if (grp) grp.value = '';
    });
  }
}

init();
