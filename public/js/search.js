/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// search.js — debounced filter engine shared by index.html and dashboard.html.
// Reads filter inputs from a <form>, keeps the URL query in sync (so filtered
// views are shareable/bookmarkable), and fetches GET /api/entries.

import { apiFetch } from './api.js';

const DEBOUNCE_MS = 300;

/**
 * Wire a filter form to the entries API.
 *
 * @param {HTMLFormElement} formEl
 * @param {(data:object)=>void} onResults  receives the API payload
 * @param {object} [opts]
 *   - onError(err)
 *   - onStart()  called right before each fetch (e.g. show a skeleton)
 * @returns {{ refresh:Function, goToPage:Function, reset:Function, getPage:()=>number }}
 */
export function initSearch(formEl, onResults, opts = {}) {
  let page = 1;
  let timer = null;
  let seq = 0; // guards against out-of-order responses

  function buildParams() {
    const params = new URLSearchParams();
    const fd = new FormData(formEl);
    for (const [key, raw] of fd.entries()) {
      const value = String(raw).trim();
      if (value !== '') params.set(key, value);
    }
    if (page > 1) params.set('page', String(page));
    return params;
  }

  async function run(updateUrl = true) {
    const params = buildParams();
    if (updateUrl) {
      const qs = params.toString();
      history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    }
    if (opts.onStart) opts.onStart();
    const mine = ++seq;
    try {
      const data = await apiFetch(`/entries?${params.toString()}`);
      if (mine !== seq) return; // a newer request superseded this one
      if (data) onResults(data);
    } catch (err) {
      if (mine !== seq) return;
      if (opts.onError) opts.onError(err);
    }
  }

  function schedule() {
    clearTimeout(timer);
    page = 1; // any filter edit returns to the first page
    timer = setTimeout(() => run(), DEBOUNCE_MS);
  }

  formEl.addEventListener('input', schedule);
  formEl.addEventListener('change', schedule);

  // Hydrate inputs from the URL on first load.
  const initial = new URLSearchParams(location.search);
  for (const [key, value] of initial.entries()) {
    if (key === 'page') {
      const p = parseInt(value, 10);
      if (!Number.isNaN(p) && p > 0) page = p;
      continue;
    }
    const field = formEl.querySelector(`[name="${key}"]`);
    if (field) field.value = value;
  }

  function goToPage(n) {
    page = Math.max(1, n);
    run();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    formEl.reset();
    page = 1;
    run();
  }

  // Initial fetch (don't rewrite the URL we just read from).
  run(false);

  return { refresh: () => { page = 1; run(); }, goToPage, reset, getPage: () => page };
}
