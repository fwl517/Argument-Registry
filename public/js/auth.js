/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// auth.js — session retrieval, route guards, force-reset gate, and the nav bar.
// Session state lives ONLY in the HTTP-only cookie; nothing is stored in JS
// persistent storage. Role-gated UI here is a convenience — the API is the real
// authority on every action.

import { apiFetch } from './api.js';
import { el, clear, esc } from './utils.js';

export const LEVELS = { Read: 0, Write: 1, Admin: 2, Root: 3 };

/** Current user object ({ id, username, permission, society_role, force_reset }) or null. */
export async function getSession() {
  // /auth/session always responds 200 with { user: ... | null }, so suppress the
  // automatic 401 redirect to avoid any chance of a loop.
  const data = await apiFetch('/auth/session', { noRedirect: true }).catch(() => null);
  return data?.user ?? null;
}

export function requireAuth(session) {
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.href = `/login.html?next=${next}`;
    return false;
  }
  return true;
}

export function requirePermission(session, minLevel) {
  if (!session || LEVELS[session.permission] < LEVELS[minLevel]) {
    if (!session) {
      const next = encodeURIComponent(location.pathname + location.search);
      window.location.href = `/login.html?next=${next}`;
    } else {
      // Authenticated but under-privileged: send to the dashboard, not login.
      window.location.href = '/dashboard.html';
    }
    return false;
  }
  return true;
}

export function hasPermission(session, minLevel) {
  return !!session && LEVELS[session.permission] >= LEVELS[minLevel];
}

/** If the account is flagged for a forced reset, divert to the reset page. */
export function enforceForceReset(session) {
  if (session?.force_reset && !location.pathname.includes('reset-password')) {
    window.location.href = '/reset-password.html';
    return true;
  }
  return false;
}

export async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST', noRedirect: true });
  } catch (_e) {
    /* ignore — clearing the cookie server-side is best-effort here */
  }
  window.location.href = '/index.html';
}

/**
 * Populate <nav id="main-nav"> for the given session.
 * @param {object|null} session
 */
export function buildNav(session) {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  clear(nav);

  const here = location.pathname.split('/').pop() || 'index.html';
  const link = (href, label) => {
    const a = el('a', { href, class: 'nav-link', text: label });
    if (href.endsWith(here)) a.classList.add('is-active');
    return a;
  };

  if (!session) {
    nav.appendChild(link('/index.html', 'Browse'));
    nav.appendChild(link('/graph.html', 'Clash map'));
    nav.appendChild(el('span', { class: 'nav-sep' }));
    nav.appendChild(el('a', { href: '/login.html', class: 'btn btn--brass btn--sm', text: 'Sign in' }));
    return;
  }

  nav.appendChild(link('/dashboard.html', 'Dashboard'));
  nav.appendChild(link('/graph.html', 'Clash map'));

  if (hasPermission(session, 'Write')) {
    nav.appendChild(link('/upload.html', 'New entry'));
    nav.appendChild(link('/tags.html', 'Tags'));
  }
  if (hasPermission(session, 'Admin')) {
    nav.appendChild(link('/admin.html', 'Members'));
  }

  nav.appendChild(el('span', { class: 'nav-sep' }));

  const role = session.society_role ? ` · ${esc(session.society_role)}` : '';
  const chip = el('a', {
    class: 'nav-user',
    href: '/account.html',
    title: 'Manage your account',
  });
  if (here === 'account.html') chip.classList.add('is-active');
  chip.innerHTML = `<strong>${esc(session.username)}</strong><span>${esc(session.permission)}${role}</span>`;
  nav.appendChild(chip);

  const out = el('button', { class: 'linkbtn', type: 'button', text: 'Sign out' });
  out.style.color = '#D9E0EC';
  out.addEventListener('click', logout);
  const wrap = el('span', { class: 'nav-link' });
  wrap.style.padding = '0';
  wrap.appendChild(out);
  nav.appendChild(wrap);
}

/**
 * Common page bootstrap. Resolves the session, enforces the force-reset gate,
 * optionally enforces a minimum permission, then builds the nav.
 *
 * @param {object} [opts]
 *   - require: 'auth' | 'Read' | 'Write' | 'Admin' | 'Root'  (optional gate)
 * @returns {Promise<object|null>} the session (null only on public pages)
 */
export async function bootstrap(opts = {}) {
  const session = await getSession();

  // The reset gate takes precedence over everything except the reset page itself.
  if (enforceForceReset(session)) return session;

  if (opts.require === 'auth') {
    if (!requireAuth(session)) return session;
  } else if (opts.require && LEVELS[opts.require] !== undefined) {
    if (!requirePermission(session, opts.require)) return session;
  }

  buildNav(session);
  return session;
}
