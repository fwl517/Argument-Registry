/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// entries.js — renders the entry list (cards) and pagination for the public and
// dashboard listings. Consumes the GET /api/entries payload:
//   { total, page, per_page, entries: [...] }

import {
  el, clear, esc, formatShortDate,
  sourceTag, stanceTag, keywordTag, privateBadge, groupTag,
} from './utils.js';
import { renderMarkdown } from './markdown.js';
import { argumentTypeIcon } from './icons.js';

function formatUploader(uploader) {
  if (!uploader || !uploader.name) return 'Unknown';
  const name = String(uploader.name).trim();
  // Never abbreviate an anonymised attribution; show it as-is.
  if (uploader.anonymous || /^anonymous\b/i.test(name)) {
    return uploader.role ? `${name} · ${uploader.role}` : name;
  }
  const parts = name.split(/\s+/);
  let display = parts[0];
  if (parts.length > 1 && parts[parts.length - 1][0]) {
    display = `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
  }
  return uploader.role ? `${display} · ${uploader.role}` : display;
}

function entryCard(entry) {
  const card = el('a', {
    class: 'entry-card',
    href: `/entry.html?id=${encodeURIComponent(entry.id)}`,
    dataset: { stance: entry.stance || '' },
  });

  // Argument-type glyph, pinned to the top-right corner.
  const typeIcon = argumentTypeIcon(entry.argument_type);
  if (typeIcon) card.appendChild(typeIcon);

  // Badges row: stance, party source, private flag. The source *category*
  // (source_type) is intentionally omitted here to keep cards uncluttered — it
  // is surfaced by the corner icon (argument type) and the full entry page.
  const badges = el('div', { class: 'entry-card__badges' });
  const stance = stanceTag(entry.stance);
  if (stance) badges.appendChild(stance);
  const src = sourceTag(entry.source);
  if (src) badges.appendChild(src);
  if (entry.is_private) badges.appendChild(privateBadge());
  card.appendChild(badges);

  if (entry.topic) {
    card.appendChild(el('div', { class: 'entry-card__topic', text: entry.topic }));
  }
  card.appendChild(el('h3', { class: 'entry-card__title', text: entry.title }));

  if (entry.gist) {
    // Render Markdown, but with links disabled — the whole card is already an
    // <a>, so nested anchors would be invalid. Safe: renderMarkdown escapes HTML.
    card.appendChild(el('div', {
      class: 'entry-card__gist',
      html: renderMarkdown(entry.gist, { links: false }),
    }));
  }

  // Keywords — confined to a single line. The tags clip to the card width with a
  // soft right fade; the overflow count is pinned outside the clip so it always
  // shows. Cap the rendered tags at 6 anyway to bound DOM on heavily-tagged rows.
  if (Array.isArray(entry.keywords) && entry.keywords.length) {
    const row = el('div', { class: 'keyword-row keyword-row--card' });
    const tags = el('div', { class: 'keyword-row__tags' });
    entry.keywords.slice(0, 6).forEach((t) => tags.appendChild(keywordTag(t)));
    row.appendChild(tags);
    if (entry.keywords.length > 6) {
      row.appendChild(el('span', { class: 'keyword-row__more', text: `+${entry.keywords.length - 6}` }));
    }
    card.appendChild(row);
  }

  // Footer meta: uploader + group pill + dates + attachment hint.
  const meta = el('div', { class: 'entry-card__meta' });
  meta.appendChild(el('span', { class: 'entry-card__uploader', text: formatUploader(entry.uploader) }));
  const group = groupTag(entry.uploader?.group);
  if (group) meta.appendChild(group);
  meta.appendChild(el('span', { class: 'meta-dot', text: '•' }));
  meta.appendChild(el('span', { text: formatShortDate(entry.created_at) }));
  if (entry.local_path) {
    meta.appendChild(el('span', { class: 'meta-dot', text: '•' }));
    meta.appendChild(el('span', { text: 'File attached' }));
  } else if (entry.link) {
    meta.appendChild(el('span', { class: 'meta-dot', text: '•' }));
    meta.appendChild(el('span', { text: 'External link' }));
  }
  card.appendChild(meta);

  return card;
}

export function renderLoading(container, count = 3) {
  clear(container);
  const wrap = el('div', { class: 'entry-list' });
  for (let i = 0; i < count; i += 1) wrap.appendChild(el('div', { class: 'skeleton' }));
  container.appendChild(wrap);
}

function emptyState() {
  const box = el('div', { class: 'empty-state' });
  box.appendChild(el('h3', { text: 'No entries found' }));
  box.appendChild(el('p', { class: 'muted mb-0', text: 'Try adjusting or clearing your filters.' }));
  return box;
}

/**
 * Render a page of results.
 * @param {HTMLElement} container
 * @param {object} data  GET /api/entries payload
 * @param {object} [opts]
 *   - onPage(pageNumber): called when a pagination control is used
 *   - countEl: element to render "N results" into
 */
export function renderEntries(container, data, opts = {}) {
  clear(container);
  const entries = data?.entries || [];
  const total = data?.total ?? entries.length;
  const page = data?.page ?? 1;
  const perPage = data?.per_page ?? 25;

  if (opts.countEl) {
    opts.countEl.textContent = total === 1 ? '1 result' : `${total} results`;
  }

  if (!entries.length) {
    container.appendChild(emptyState());
    return;
  }

  const list = el('div', { class: 'entry-list' });
  entries.forEach((e) => list.appendChild(entryCard(e)));
  container.appendChild(list);

  // Pagination
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages > 1 && typeof opts.onPage === 'function') {
    const pager = el('div', { class: 'pagination' });
    const prev = el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', text: '← Newer',
    });
    prev.disabled = page <= 1;
    prev.addEventListener('click', () => opts.onPage(page - 1));

    const next = el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', text: 'Older →',
    });
    next.disabled = page >= pages;
    next.addEventListener('click', () => opts.onPage(page + 1));

    pager.appendChild(prev);
    pager.appendChild(el('span', { class: 'page-label', text: `Page ${page} of ${pages}` }));
    pager.appendChild(next);
    container.appendChild(pager);
  }
}

export function renderError(container, message) {
  clear(container);
  const box = el('div', { class: 'empty-state' });
  box.appendChild(el('h3', { text: 'Could not load entries' }));
  box.appendChild(el('p', { class: 'muted mb-0', text: message || 'Please try again.' }));
  container.appendChild(box);
}

// Exposed for reuse (e.g. tests / other views).
export { entryCard };
