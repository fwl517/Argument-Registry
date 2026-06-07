/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// utils.js — small DOM + formatting helpers shared across pages.
// XSS policy: never assign API data via innerHTML. Use textContent or esc().

/** HTML-escape a string ( & < > " ' ). For safe interpolation into innerHTML. */
export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** querySelector shorthand. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Create an element with attributes/props and children.
 * el('a', { href: '/x', class: 'btn', text: 'Go' })
 * el('div', { class: 'card' }, [childNode, 'text'])
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only for trusted/static strings
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else {
      node.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Format a date-only or timestamp value as e.g. "14 March 2025". */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Relative-ish short date for list meta, e.g. "14 Mar 2025". */
export function formatShortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* — Badge builders ———————————————————————————————————————— */

/** Source (party) badge — colour comes from the DB-driven source object. */
export function sourceTag(source) {
  if (!source) return null;
  const span = el('span', { class: 'badge badge--source', text: source.name });
  span.style.backgroundColor = source.colour;
  span.style.color = source.text_colour;
  return span;
}

/** Argument-stance badge (Pro / Con / Neutral / Background). */
export function stanceTag(stance) {
  if (!stance) return null;
  return el('span', { class: 'badge badge--stance', dataset: { stance }, text: stance });
}

/** Source-type category badge (e.g. "Academic"). */
export function metaBadge(text) {
  if (!text) return null;
  return el('span', { class: 'badge badge--meta', text });
}

export function keywordTag(tag) {
  return el('span', { class: 'badge badge--keyword', text: `#${tag}` });
}

export function privateBadge() {
  return el('span', { class: 'badge badge--private', text: 'Members only' });
}

/* — Toasts ————————————————————————————————————————————————— */

function toastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = el('div', { id: 'toast-root' });
    document.body.appendChild(root);
  }
  return root;
}

/**
 * Show a transient toast.
 * @param {string} message
 * @param {'info'|'ok'|'error'} [type]
 * @param {number} [ms]
 */
export function toast(message, type = 'info', ms = 3800) {
  const node = el('div', { class: `toast toast--${type}`, role: 'status', text: message });
  toastRoot().appendChild(node);
  const remove = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(remove, ms);
  node.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return node;
}

/** Read a URL query param from the current location. */
export function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Apply field errors ({ fieldName: message }) onto a form's .field-error nodes. */
export function showFieldErrors(formEl, fields) {
  if (!formEl) return;
  $$('.field-error', formEl).forEach((n) => { n.textContent = ''; });
  $$('[aria-invalid]', formEl).forEach((n) => n.removeAttribute('aria-invalid'));
  if (!fields) return;
  for (const [name, message] of Object.entries(fields)) {
    const input = formEl.querySelector(`[name="${name}"]`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      const slot = input.closest('.field')?.querySelector('.field-error');
      if (slot) slot.textContent = message;
    }
  }
}
