/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// markdown.js — tiny, safe Markdown renderer shared across the app.
//
// All HTML is escaped before any formatting is applied, so user content (an
// uploaded note, an entry gist) can never inject markup — the returned string is
// safe to assign via innerHTML. Deliberately a small subset: headings,
// bold/italic, code, links, lists, quotes, rules.
//
// Originally lived in entry.js for the attached-file preview; lifted here so the
// entry gist and entry cards can reuse the exact same renderer.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeHref(url) {
  const u = String(url).trim();
  if (/^(https?:|mailto:)/i.test(u)) return u; // external / mail
  if (/^[/#]/.test(u)) return u;               // relative / anchor
  return '';                                   // block javascript:, data:, etc.
}

function mdInline(t, allowLinks) {
  let s = escapeHtml(t);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => {
    if (!allowLinks) return txt; // e.g. gist rendered inside a card's <a> wrapper
    const href = safeHref(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt;
  });
  return s;
}

/**
 * Render a small Markdown subset to a safe HTML string.
 * @param {string} src
 * @param {{ links?: boolean }} [options]  links:false renders [text](url) as
 *   plain text — required when the output sits inside another <a> (card links).
 */
export function renderMarkdown(src, options = {}) {
  const allowLinks = options.links !== false;
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false, codeBuf = [], list = null, para = [];
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '), allowLinks)}</p>`); para = []; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) { out.push(`<pre class="md-code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); codeBuf = []; inCode = false; }
      else { flushPara(); closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*$/.test(line)) { flushPara(); closeList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${mdInline(h[2], allowLinks)}</h${h[1].length}>`); continue; }
    if (/^\s*>\s?/.test(line)) { flushPara(); closeList(); out.push(`<blockquote>${mdInline(line.replace(/^\s*>\s?/, ''), allowLinks)}</blockquote>`); continue; }
    if (/^\s*[-*+]\s+/.test(line)) { flushPara(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${mdInline(line.replace(/^\s*[-*+]\s+/, ''), allowLinks)}</li>`); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { flushPara(); if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${mdInline(line.replace(/^\s*\d+\.\s+/, ''), allowLinks)}</li>`); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }
    para.push(line.trim());
  }
  if (inCode) out.push(`<pre class="md-code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  flushPara(); closeList();
  return out.join('\n');
}
