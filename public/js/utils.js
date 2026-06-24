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

/**
 * Wrap a DB-driven badge colour so its fill is slightly translucent — the pill
 * reads as a tint over the card surface rather than a solid block. Falls back to
 * the raw colour if color-mix is unsupported (the browser drops the value).
 */
function softFill(colour, amount = 82) {
  if (!colour) return colour;
  return `color-mix(in srgb, ${colour} ${amount}%, transparent)`;
}

/**
 * Source (party) badge — colour comes from the DB-driven source object. Rendered
 * as a tinted chip: a soft translucent fill with a thin full-opacity outline in
 * the party colour. Text keeps its DB-chosen colour (white/black) at full opacity.
 */
export function sourceTag(source) {
  if (!source) return null;
  const span = el('span', { class: 'badge badge--source', text: source.name });
  span.style.backgroundColor = softFill(source.colour, 80);
  span.style.borderColor = source.colour;
  span.style.color = source.text_colour;
  return span;
}

/** Argument-stance badge (Pro / Con / Neutral / Background). */
export function stanceTag(stance) {
  if (!stance) return null;
  return el('span', { class: 'badge badge--stance', dataset: { stance }, text: stance });
}

/**
 * Society-alignment badge (Aligned / Opposed / Neutral). Where the entry sits
 * relative to OUR society — distinct from stance, which is its position on its
 * own topic. The leading mark keeps it visually separate from the stance badge.
 */
export function alignmentTag(alignment) {
  if (!alignment) return null;
  return el('span', {
    class: 'badge badge--alignment',
    dataset: { alignment },
    title: 'Alignment with our society',
    text: `Alignment: ${alignment}`,
  });
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

/**
 * Group affiliation badge (the uploader's group pill). Mirrors sourceTag exactly
 * — tinted fill with a full-opacity outline and text in the group colour — so
 * the uploader pill reads as a sibling of the party-source pill. With no DB
 * colour (foreign-imported entries that only carry the name), falls back to the
 * default `.badge--group` styling defined in CSS.
 */
export function groupTag(group) {
  if (!group || !group.name) return null;
  const span = el('span', { class: 'badge badge--group', text: group.name });
  if (group.colour) {
    span.style.backgroundColor = softFill(group.colour, 80);
    span.style.borderColor = group.colour;
    if (group.text_colour) span.style.color = group.text_colour;
  }
  return span;
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

/* — Autocomplete ——————————————————————————————————————————— */

/**
 * Attach a custom, site-styled suggestion menu to a text input. Replaces the
 * native <datalist> (which can't be CSS-styled) with a .ac-menu rendered from
 * design tokens. CSP-safe: styling is via classes, not inline styles.
 *
 * @param {HTMLInputElement} input
 * @param {object} opts
 *   - getItems(): () => Array<{ value: string, hint?: string }>  current candidates
 *   - onSelect(item): called when an item is chosen
 *   - host: positioned ancestor to anchor the menu to (defaults to a wrapper
 *           created around the input). Pass the field container to span its width.
 *   - max: maximum suggestions shown (default 8)
 */
export function attachAutocomplete(input, opts = {}) {
  const { getItems, onSelect, max = 8 } = opts;

  // The menu is absolutely positioned, so it needs a positioned ancestor.
  let host = opts.host;
  if (host) {
    host.classList.add('ac-host');
  } else {
    host = el('div', { class: 'ac-host' });
    input.parentNode.insertBefore(host, input);
    host.appendChild(input);
  }

  const menu = el('ul', { class: 'ac-menu', role: 'listbox' });
  menu.hidden = true;
  host.appendChild(menu);

  let matches = [];
  let active = -1;

  const close = () => {
    menu.hidden = true;
    active = -1;
    clear(menu);
    input.setAttribute('aria-expanded', 'false');
  };

  const highlight = (idx) => {
    active = idx;
    [...menu.children].forEach((li, i) => li.classList.toggle('is-active', i === idx));
  };

  const choose = (idx) => {
    const it = matches[idx];
    if (!it) return;
    onSelect?.(it);
    close();
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    const all = getItems?.() || [];
    matches = (q ? all.filter((it) => it.value.toLowerCase().includes(q)) : all.slice())
      // Prefix matches first, then keep the source order.
      .sort((a, b) => {
        if (!q) return 0;
        return (a.value.toLowerCase().startsWith(q) ? 0 : 1)
             - (b.value.toLowerCase().startsWith(q) ? 0 : 1);
      })
      .slice(0, max);

    clear(menu);
    active = -1;
    if (!matches.length) { close(); return; }

    matches.forEach((it, idx) => {
      const li = el('li', { class: 'ac-item', role: 'option' }, [
        el('span', { class: 'ac-item__label', text: it.value }),
      ]);
      if (it.hint) li.appendChild(el('span', { class: 'ac-item__hint', text: it.hint }));
      // mousedown (not click) so selection fires before the input's blur.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(idx); });
      li.addEventListener('mousemove', () => highlight(idx));
      menu.appendChild(li);
    });
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(close, 120));

  // Capture phase so we can preempt other keydown handlers (e.g. the keyword
  // pill committer) — but only stop propagation when we actually consume the key.
  input.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      highlight(active + 1 >= matches.length ? 0 : active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      highlight(active - 1 < 0 ? matches.length - 1 : active - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); e.stopPropagation();
      choose(active);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }, true);

  return { close, refresh: render };
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
