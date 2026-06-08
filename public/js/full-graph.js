/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// full-graph.js — page controller for /graph.html. Loads the entire visible
// graph (capped + sampled by the server) and mounts the interactive renderer.

import { apiFetch, errorMessage } from './api.js';
import { $, el, toast } from './utils.js';
import { bootstrap } from './auth.js';
import { renderGraph } from './graph.js';

const MAX_NODES = 150;

async function load() {
  const host = $('#graph-host');
  const count = $('#graph-count');
  count.textContent = 'Loading…';
  // Drop any previous render before fetching new data.
  while (host.firstChild) host.removeChild(host.firstChild);

  try {
    const data = await apiFetch(`/graph?max=${MAX_NODES}`, { noRedirect: true });
    if (!data) return;
    if (data.shown === 0) {
      count.textContent = 'No entries to graph yet.';
      host.appendChild(el('p', { class: 'graph-empty', text: 'No entries yet.' }));
      return;
    }
    count.textContent = data.capped
      ? `Showing ${data.shown} of ${data.total_visible_entries} entries`
      : `Showing all ${data.shown} entries`;
    renderGraph(host, data, {
      interactive: true,
      autoFit: true,
      showCappedNote: false, // we render it in the controls bar instead
    });
  } catch (err) {
    count.textContent = 'Could not load graph.';
    toast(errorMessage(err, 'Could not load the graph.'), 'error');
  }
}

async function init() {
  await bootstrap(); // public page; visibility is enforced by the API
  $('#graph-refresh').addEventListener('click', load);
  await load();
}

init();
