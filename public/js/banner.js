/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// banner.js — the thin "associated groups" strip below the masthead on the
// front page and dashboard. Pulls partner groups from /api/groups and renders
// each as a logo (if present) + name, made clickable when the group has a link.
//
// When the chips overflow the available width the row becomes a gentle,
// continuously-cycling marquee (chips fade out at the edges) so every group is
// seen in turn; otherwise they sit statically. The strip never renders when
// there are no groups to show.

import { apiFetch } from './api.js';
import { el, clear } from './utils.js';

// Groups never shown in the banner: the host society itself and the catch-all
// "Independent" bucket (which isn't a real affiliated partner).
const EXCLUDED_NAMES = new Set(['independent']);

function isShowable(g) {
  if (g.is_home || g.is_archived) return false;
  return !EXCLUDED_NAMES.has(String(g.name || '').trim().toLowerCase());
}

export async function mountGroupBanner() {
  const host = document.getElementById('group-banner');
  if (!host) return;

  let groups;
  try {
    groups = await apiFetch('/groups', { noRedirect: true });
  } catch (_e) {
    return; // a failed fetch just leaves the strip hidden
  }

  const shown = (groups || []).filter(isShowable);
  if (!shown.length) return; // nothing to show → no banner at all

  clear(host);
  const track = el('div', { class: 'group-banner__track' }, shown.map(groupChip));
  const list = el('div', { class: 'group-banner__list' }, [track]);
  const inner = el('div', { class: 'group-banner__inner container' }, [
    el('span', { class: 'group-banner__label', text: 'Associated groups' }),
    list,
  ]);
  host.appendChild(inner);
  host.hidden = false;

  // Decide on the marquee once the row has been laid out and measured.
  requestAnimationFrame(() => maybeMarquee(list, track));
}

function groupChip(g) {
  const kids = [];
  if (g.logo_url) {
    kids.push(el('img', { class: 'group-banner__logo', src: g.logo_url, alt: '', loading: 'lazy' }));
  }
  kids.push(el('span', { class: 'group-banner__name', text: g.name }));

  if (g.link) {
    return el('a', {
      class: 'group-banner__item',
      href: g.link, target: '_blank', rel: 'noopener noreferrer',
      title: `${g.name} — visit website`,
    }, kids);
  }
  return el('span', {
    class: 'group-banner__item group-banner__item--static', title: g.name,
  }, kids);
}

// Turn the row into a seamless marquee when its content is wider than the
// viewport. The track is duplicated so a translate of exactly one set length
// loops without a visible jump; speed is held roughly constant per pixel.
function maybeMarquee(list, track) {
  const oneSet = track.scrollWidth;
  if (oneSet <= list.clientWidth + 4) return; // fits — leave it static

  const clones = Array.from(track.children).map((node) => {
    const c = node.cloneNode(true);
    c.setAttribute('aria-hidden', 'true');
    c.tabIndex = -1;
    return c;
  });
  clones.forEach((c) => track.appendChild(c));

  const full = track.scrollWidth;
  const gap = full - oneSet * 2;          // the single inter-set gap
  const shift = oneSet + gap;             // distance for one whole set + its gap
  track.style.setProperty('--marquee-shift', `${shift}px`);
  track.style.animationDuration = `${Math.max(14, Math.round(shift / 36))}s`; // ~36px/s
  list.classList.add('is-marquee');
}
