/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// modal.js — inline file viewer. Opens a full-screen overlay containing an
// <iframe> pointed at /api/files/:filename. The server sends the file with
// Content-Disposition: inline so the browser renders PDFs/TXT natively.

import { el } from './utils.js';

let active = null;

function close() {
  if (!active) return;
  document.removeEventListener('keydown', onKey);
  active.remove();
  active = null;
  document.body.style.overflow = '';
}

function onKey(e) {
  if (e.key === 'Escape') close();
}

/**
 * Open the viewer for a stored file.
 * @param {string} localPath  the entry.local_path value, e.g. "/uploads/<uuid>.pdf"
 * @param {string} [label]    a human label for the title bar
 */
export function openFile(localPath, label = 'Attached file') {
  if (!localPath) return;
  close();

  // local_path is "/uploads/<filename>"; the served route is "/api/files/<filename>".
  const filename = localPath.split('/').pop();
  const src = `/api/files/${encodeURIComponent(filename)}`;

  const frame = el('iframe', {
    class: 'modal-frame',
    src,
    title: label,
  });

  const closeBtn = el('button', { class: 'modal-close', type: 'button', text: 'Close ✕' });
  closeBtn.addEventListener('click', close);

  const newTab = el('a', {
    class: 'modal-close',
    href: src,
    target: '_blank',
    rel: 'noopener',
    text: 'Open in new tab ↗',
  });

  const bar = el('div', { class: 'modal-bar' }, [
    el('span', { class: 'modal-bar__title', text: label }),
    el('div', { class: 'row' }, [newTab, closeBtn]),
  ]);

  const backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' }, [
    bar,
    frame,
  ]);

  // Click on the backdrop (but not its children) closes.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  active = backdrop;
  closeBtn.focus();
}

export { close as closeFile };
