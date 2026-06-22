/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// icons.js — inline SVG glyphs for the entry argument types. Rendered into the
// top-right corner of each card. The SVG strings are static and trusted, so they
// are injected via the `html` channel of el() (never with API data). The CSP
// forbids external icon fonts and <style>, so hand-rolled inline SVG is used.
//
// Each glyph is a 24×24 line icon drawn in currentColor; the wrapper sets the
// colour and size. To add a new argument type, add a matching entry to ARG_ICONS
// — anything missing falls back to ARG_ICON_DEFAULT so a forgotten type still
// renders a sensible badge rather than a blank corner.

import { el } from './utils.js';

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const ARG_ICONS = {
  // Study — laboratory beaker (empirical research).
  Study: `${SVG_OPEN}<path d="M9 3h6"/><path d="M10 3v6.5L5.4 17a2 2 0 0 0 1.7 3h9.8a2 2 0 0 0 1.7-3L14 9.5V3"/><path d="M7.5 14h9"/></svg>`,
  // Article — newspaper.
  Article: `${SVG_OPEN}<path d="M4 5h13v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 8.5h7M7 11.5h7M7 14.5h4"/></svg>`,
  // Raw Statistic — bar chart.
  'Raw Statistic': `${SVG_OPEN}<path d="M4 20h16"/><path d="M7 20v-6"/><path d="M12 20V8"/><path d="M17 20v-9"/></svg>`,
  // Policy Paper — document with folded corner.
  'Policy Paper': `${SVG_OPEN}<path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h6"/></svg>`,
  // Argument — two opposing speech bubbles (debate). Built from two copies of a
  // chat-bubble path: the second is mirrored and shifted down-right so the tails
  // point at each other. `non-scaling-stroke` keeps the 1.6 weight under the
  // scale transforms so both bubbles read at the same line weight as other icons.
  Argument: `${SVG_OPEN}`
    + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" transform="translate(0.5 -0.5) scale(0.62)" vector-effect="non-scaling-stroke"/>'
    + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" transform="translate(23 7) scale(-0.62 0.62)" vector-effect="non-scaling-stroke"/>'
    + '</svg>',
  // Other — generic tag.
  Other: `${SVG_OPEN}<path d="M4 12.5V5a1 1 0 0 1 1-1h7.5L20 11.5 12.5 19 4 12.5z"/><circle cx="8.5" cy="8.5" r="1.3"/></svg>`,
};

// Fallback for any argument type not present in ARG_ICONS — a document outline.
const ARG_ICON_DEFAULT = `${SVG_OPEN}<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v5h4"/></svg>`;

// Per-type accent (muted, low-saturation to sit on parchment). The glyph stroke
// takes this colour; the chip's faint background/border are derived from it via
// `currentColor` + color-mix in CSS, so only `color` is set here. A type with no
// entry falls back to the neutral default colour defined on the CSS class.
const ARG_COLOURS = {
  Study: '#3B8C7A',          // muted teal
  Article: '#41618F',        // muted slate-blue
  'Raw Statistic': '#B07C2E',// brass/amber
  'Policy Paper': '#7A5AA0', // muted violet
  Argument: '#B05540',       // muted terracotta
  Other: '#5A6472',          // neutral slate
};

/**
 * Build the argument-type corner badge for a card.
 * @param {string} type  one of the ARG_TYPES enum values (server-side)
 * @returns {HTMLElement|null} a labelled icon span, or null if no type given
 */
export function argumentTypeIcon(type) {
  if (!type) return null;
  const svg = ARG_ICONS[type] || ARG_ICON_DEFAULT;
  const span = el('span', {
    class: 'entry-card__type-icon',
    html: svg,
    title: type,
    'aria-label': type,
    role: 'img',
  });
  // DB-driven-style colour application (mirrors sourceTag): set the glyph colour
  // inline; the chip tint is derived from it in CSS via currentColor.
  const colour = ARG_COLOURS[type];
  if (colour) span.style.color = colour;
  return span;
}
