/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * True if `value` is a valid 6-digit hex colour like "#1B3A6B".
 * @param {unknown} value
 * @returns {boolean}
 */
function isHexColour(value) {
  return typeof value === 'string' && HEX_RE.test(value);
}

/**
 * Perceptual luminance of a hex colour, normalised to 0..1 using the
 * standard YIQ weighting (0.299 R + 0.587 G + 0.114 B).
 * @param {string} hex  e.g. "#E4003B"
 * @returns {number}
 */
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Choose a legible text colour for a given background.
 * Bright backgrounds (luminance > 0.5) → black, otherwise white.
 * Matches the seeded preset palette in db/schema.sql.
 * @param {string} backgroundHex
 * @returns {'#000000' | '#FFFFFF'}
 */
function textColourFor(backgroundHex) {
  return luminance(backgroundHex) > 0.5 ? '#000000' : '#FFFFFF';
}

module.exports = { isHexColour, luminance, textColourFor };
