/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// entry.js — single-entry detail view and the 8-category clash map.
// Loads GET /api/entries/:id (which embeds a `relations` block).

import { apiFetch, errorMessage } from './api.js';
import {
  $, el, clear, esc, formatDate, queryParam,
  sourceTag, stanceTag, alignmentTag, metaBadge, keywordTag, privateBadge, groupTag, toast,
} from './utils.js';
import { bootstrap, hasPermission } from './auth.js';
import { mountRelationEditor, removeRelation } from './relations.js';
import { renderGraph } from './graph.js';
import { renderMarkdown } from './markdown.js';

const RELATION_LABELS = {
  counters: 'Counters',
  countered_by: 'Countered By',
  rebuts: 'Rebuts',
  rebutted_by: 'Rebutted By',
  evidence_for: 'Evidence For',
  evidenced_by: 'Evidenced By',
  updates: 'Updates',
  updated_by: 'Updated By',
  related: 'Related to',
};

// Clash relations grouped into four colour-coded cards. A card shows only when
// it has at least one link. Sub-labels (from RELATION_LABELS) keep the direction
// of each link visible inside its card.
// Clash relations grouped into four colour-coded cards. A card shows only when
// it has at least one link. Sub-labels (from RELATION_LABELS) keep the direction
// of each link visible inside its card.
const CLASH_GROUPS = [
  { label: 'Rebuts',   tone: 'red',    members: ['rebuts', 'rebutted_by'] },
  { label: 'Counters', tone: 'orange', members: ['counters', 'countered_by'] },
  { label: 'Evidence', tone: 'green',  members: ['evidence_for', 'evidenced_by'] },
  { label: 'Updates',  tone: 'grey',   members: ['updates', 'updated_by'] },
  { label: 'Related',  tone: 'purple', members: ['related'] },
];

// File extensions the on-page previewer can render. Unknown types stay as a
// download link and the preview panel hides itself.
const PREVIEW = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'],
  pdf: ['pdf'],
  video: ['mp4', 'webm'],
  audio: ['mp3'],
  markdown: ['md', 'markdown'],
  text: ['txt', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log'],
};

function formatUploader(uploader) {
  if (!uploader || !uploader.name) return 'Unknown';
  const name = String(uploader.name).trim();
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

function fileExt(path) {
  const base = String(path || '').split('/').pop().split('?')[0];
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function previewKind(ext) {
  if (PREVIEW.image.includes(ext)) return 'image';
  if (PREVIEW.pdf.includes(ext)) return 'pdf';
  if (PREVIEW.video.includes(ext)) return 'video';
  if (PREVIEW.audio.includes(ext)) return 'audio';
  if (PREVIEW.markdown.includes(ext)) return 'markdown';
  if (PREVIEW.text.includes(ext)) return 'text';
  return null;
}


async function renderInlinePreview(localPath, label) {
  const wrap = $('#detail-preview');
  if (!wrap) return;
  clear(wrap);
  wrap.classList.add('hidden');
  if (!localPath) return;

  const kind = previewKind(fileExt(localPath));
  if (!kind) return; // not previewable → stay hidden

  const filename = localPath.split('/').pop();
  const src = `/api/files/${encodeURIComponent(filename)}`;
  const reveal = (node) => {
    wrap.appendChild(el('h3', { class: 'file-preview__label', text: 'Attached file' }));
    wrap.appendChild(node);
    wrap.classList.remove('hidden');
  };

  // Images and PDFs load by URL directly and stream natively (the server now
  // permits same-origin framing — see the header change below).
  if (kind === 'image') {
    const img = el('img', { class: 'file-preview__img', src, alt: label || 'Attached image', loading: 'lazy' });
    img.addEventListener('error', () => { clear(wrap); wrap.classList.add('hidden'); });
    reveal(img);
    return;
  }
  if (kind === 'pdf') {
    reveal(el('iframe', { class: 'file-preview__frame', src, title: label || 'Attached file', loading: 'lazy' }));
    return;
  }
  // Video / audio stream natively via the range-aware files endpoint.
  if (kind === 'video') {
    const video = el('video', { class: 'file-preview__video', src, controls: 'controls', preload: 'metadata' });
    video.addEventListener('error', () => { clear(wrap); wrap.classList.add('hidden'); });
    reveal(video);
    return;
  }
  if (kind === 'audio') {
    const audio = el('audio', { class: 'file-preview__audio', src, controls: 'controls', preload: 'metadata' });
    audio.addEventListener('error', () => { clear(wrap); wrap.classList.add('hidden'); });
    reveal(audio);
    return;
  }

  // Markdown / text are fetched and built into the page (no framing involved).
  try {
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) return;
    const text = await res.text();
    if (kind === 'markdown') {
      const doc = el('div', { class: 'file-preview__doc' });
      doc.innerHTML = renderMarkdown(text); // safe: renderMarkdown escapes all HTML first
      reveal(doc);
    } else {
      reveal(el('pre', { class: 'file-preview__pre', text }));
    }
  } catch (_e) {
    clear(wrap);
    wrap.classList.add('hidden');
  }
}

let session = null;
let entryId = null;

function metaRow(term, value) {
  if (value == null || value === '') return null;
  const dd = el('dd');
  if (value instanceof Node) dd.appendChild(value);
  else dd.textContent = value;
  return el('div', {}, [el('dt', { text: term }), dd]);
}

function renderClashCard(item) {
  const card = el('div', { class: 'clash-card', dataset: { stance: item.stance || '' } });

  const top = el('div', { class: 'clash-card__top' });
  const link = el('a', {
    class: 'clash-card__title',
    href: `/entry.html?id=${encodeURIComponent(item.entry_id)}`,
    text: item.title,
  });
  top.appendChild(link);
  const stance = stanceTag(item.stance);
  if (stance) top.appendChild(stance);
  const alignment = alignmentTag(item.society_alignment);
  if (alignment) top.appendChild(alignment);
  card.appendChild(top);

  if (item.context_note) {
    card.appendChild(el('p', { class: 'clash-card__note', text: item.context_note }));
  }

  // Admins (and Root) may sever a link.
  if (hasPermission(session, 'Admin')) {
    const del = el('button', { class: 'linkbtn linkbtn--danger text-sm', type: 'button', text: 'Remove link' });
    del.addEventListener('click', async () => {
      if (!window.confirm('Remove this link? This cannot be undone.')) return;
      del.disabled = true;
      try {
        await removeRelation(item.relation_id);
        toast('Link removed.', 'ok');
        load();
      } catch (err) {
        toast(errorMessage(err, 'Could not remove the link.'), 'error');
        del.disabled = false;
      }
    });
    card.appendChild(el('div', { class: 'clash-card__actions' }, [del]));
  }

  return card;
}

function renderClashMap(relations) {
  const mapEl = $('#clash-map');
  clear(mapEl);

  const rel = relations || {};
  const total = Object.values(rel).reduce((n, arr) => n + (arr?.length || 0), 0);
  const totalEl = $('#clash-total');
  if (totalEl) totalEl.textContent = total === 1 ? '1 link' : `${total} links`;

  let shown = 0;
  for (const group of CLASH_GROUPS) {
    const count = group.members.reduce((n, key) => n + (rel[key]?.length || 0), 0);
    if (!count) continue; // card appears only if the group has at least one link
    shown += 1;

    const head = el('summary', { class: 'clash-group__head' }, [
      el('span', { class: 'clash-group__name' }, [
        el('span', { class: 'clash-group__chevron', text: '▸' }),
        document.createTextNode(group.label),
      ]),
      el('span', { class: 'clash-group__count', text: String(count) }),
    ]);

    const body = el('div', { class: 'clash-group__body' });
    for (const key of group.members) {
      const items = rel[key] || [];
      if (!items.length) continue;
      body.appendChild(el('p', { class: 'clash-group__dir', text: RELATION_LABELS[key] }));
      items.forEach((it) => body.appendChild(renderClashCard(it)));
    }

    const card = el('details', { class: 'clash-group', dataset: { tone: group.tone } }, [head, body]);
    card.open = true;
    mapEl.appendChild(card);
  }

  if (!shown) {
    mapEl.appendChild(el('p', { class: 'empty-note', text: 'No links recorded yet.' }));
  }
}

function renderEntry(entry) {
  document.title = `${entry.title} · Argument Database`;

  // — Header — badges + title —
  const badges = $('#detail-badges');
  clear(badges);
  const stance = stanceTag(entry.stance);
  if (stance) badges.appendChild(stance);
  const alignment = alignmentTag(entry.society_alignment);
  if (alignment) badges.appendChild(alignment);
  const cat = metaBadge(entry.source_type);
  if (cat) badges.appendChild(cat);
  const src = sourceTag(entry.source);
  if (src) badges.appendChild(src);
  if (entry.is_private) badges.appendChild(privateBadge());

  $('#detail-topic').textContent = entry.topic || '';
  $('#detail-title').textContent = entry.title;

  // — Gist (rendered as Markdown) —
  const gistEl = $('#detail-gist');
  clear(gistEl);
  if (entry.gist) {
    gistEl.innerHTML = renderMarkdown(entry.gist); // safe: renderMarkdown escapes all HTML first
  } else {
    gistEl.appendChild(el('p', { class: 'mb-0', text: 'No summary provided.' }));
  }

  // — Source / link / file actions —
  const actions = $('#detail-actions');
  clear(actions);
  if (entry.link) {
    actions.appendChild(el('a', {
      class: 'btn btn--ghost btn--sm', href: entry.link,
      target: '_blank', rel: 'noopener noreferrer', text: 'Open external link ↗',
    }));
  }
  if (entry.local_path) {
    const filename = entry.local_path.split('/').pop();
    actions.appendChild(el('a', {
      class: 'btn btn--ghost btn--sm',
      href: `/api/files/${encodeURIComponent(filename)}`,
      target: '_blank', rel: 'noopener noreferrer', text: 'Open file in new tab ↗',
    }));
  }
  if (!entry.local_path && !entry.link) {
    actions.appendChild(el('span', { class: 'empty-note', text: 'No source document attached.' }));
  }

  // — Inline file preview (renders below the summary; stays hidden if not previewable) —
  renderInlinePreview(entry.local_path, entry.title);

  // — Metadata (compact, folded into the summary panel) —
  const meta = $('#detail-meta');
  clear(meta);
  [
    metaRow('Type', entry.argument_type),
    metaRow('Source', entry.source_type),
    metaRow('Party', entry.source ? sourceTag(entry.source) : null),
    metaRow('Published', entry.date_published ? formatDate(entry.date_published) : null),
    metaRow('Contributed by', formatUploader(entry.uploader)),
    metaRow('Affiliation', entry.uploader?.group ? groupTag(entry.uploader.group) : null),
    metaRow('Visibility', entry.is_private ? 'Members only' : 'Public'),
  ].forEach((r) => { if (r) meta.appendChild(r); });

  // — Keywords —
  const kw = $('#detail-keywords');
  clear(kw);
  if (Array.isArray(entry.keywords) && entry.keywords.length) {
    entry.keywords.forEach((t) => kw.appendChild(keywordTag(t)));
  } else {
    kw.appendChild(el('span', { class: 'empty-note', text: 'No keywords.' }));
  }

  // — Owner/admin controls —
  const owner = $('#owner-actions');
  clear(owner);
  if (hasPermission(session, 'Write')) {
    owner.appendChild(el('a', {
      class: 'btn btn--ghost btn--sm', href: `/edit.html?id=${encodeURIComponent(entry.id)}`,
      text: 'Edit entry',
    }));
  }
  if (hasPermission(session, 'Admin')) {
    const del = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Delete entry' });
    del.addEventListener('click', () => deleteEntry(entry));
    owner.appendChild(del);
  }

  // — Clash map + editor —
  renderClashMap(entry.relations);
  mountRelationEditor($('#relation-editor'), entry.id, session, load);
  // — Connected-component mini-graph (auto-fit, no pan/zoom) —
  loadMiniGraph(entry.id);

  // Reveal the populated view.
  $('#entry-loading').classList.add('hidden');
  $('#entry-view').classList.remove('hidden');
}

async function loadMiniGraph(id) {
  const host = $('#entry-graph');
  if (!host) return;
  try {
    const data = await apiFetch(`/graph?from=${encodeURIComponent(id)}&max=50`, {
      noRedirect: true,
    });
    if (!data) return;
    renderGraph(host, data, {
      currentId: id,
      interactive: false,
      autoFit: true,
      showCappedNote: true,
    });
  } catch (_err) {
    host.textContent = '';
    const p = el('p', { class: 'graph-empty', text: 'Could not load the graph.' });
    host.appendChild(p);
  }
}

async function deleteEntry(entry) {
  if (!window.confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
  try {
    await apiFetch(`/entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    toast('Entry deleted.', 'ok');
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 600);
  } catch (err) {
    toast(errorMessage(err, 'Could not delete the entry.'), 'error');
  }
}

function renderNotFound() {
  $('#entry-loading').classList.add('hidden');
  const box = $('#entry-error');
  box.classList.remove('hidden');
}

async function load() {
  try {
    const entry = await apiFetch(`/entries/${encodeURIComponent(entryId)}`);
    if (!entry) return; // 401 → already redirected to login
    renderEntry(entry);
  } catch (err) {
    if (err.status === 404) {
      renderNotFound();
    } else {
      $('#entry-loading').classList.add('hidden');
      const box = $('#entry-error');
      box.classList.remove('hidden');
      const msg = $('#entry-error-msg');
      if (msg) msg.textContent = errorMessage(err, 'Could not load this entry.');
    }
  }
}

async function init() {
  entryId = queryParam('id');
  session = await bootstrap(); // public page; private entries enforced by the API

  const back = document.getElementById('back-link');
  if (back) {
    back.addEventListener('click', () => {
      if (history.length > 1) history.back();
      else window.location.assign('/index.html');
    });
  }

  if (!entryId) {
    renderNotFound();
    return;
  }
  load();
}

init();
