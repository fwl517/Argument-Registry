/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

/**
 * Build the nested `source` object for an entry response, or null when the
 * entry has no linked source. Expects the joined source columns to be present
 * on the row (aliased as source_pk / source_name / source_colour / ...).
 */
function buildSource(row) {
  if (row.source_pk == null) return null;
  return {
    id: row.source_pk,
    name: row.source_name,
    colour: row.source_colour,
    text_colour: row.source_text_colour,
    is_preset: row.source_is_preset,
  };
}

/**
 * Serialise a single entry row into the public API shape.
 *
 * THE ANONYMISATION RULE (server-wide, see 02_api_design.md):
 *   - `uploader_id` (raw UUID) is removed from every payload unconditionally.
 *   - anonymise_uploader = TRUE  -> uploader = { name: "Anonymous Member", role: null }
 *   - anonymise_uploader = FALSE, real user        -> { name: <username>, role: <society_role> }
 *   - anonymise_uploader = FALSE, foreign import   -> { name: <foreign_name>, role: <foreign_role> }
 *   - the `anonymise_uploader` flag itself is stripped from the payload.
 *
 * The row is expected to carry joined uploader columns
 * (uploader_username, uploader_role) and the denormalised foreign_uploader_*
 * columns so no extra query is needed.
 *
 * @param {object} row    a joined entries row
 * @param {string[]} [keywords]  tag slugs for this entry
 * @returns {object} clean entry object safe to send to any client
 */
function serialiseEntry(row, keywords = []) {
  const entry = {
    id: row.id,
    title: row.title,
    topic: row.topic,
    stance: row.stance,
    argument_type: row.argument_type,
    source_type: row.source_type,
    source: buildSource(row),
    date_published: row.date_published,
    gist: row.gist,
    is_private: row.is_private,
    link: row.link ?? null,
    local_path: row.local_path ?? null,
    keywords,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (row.anonymise_uploader) {
    entry.uploader = { name: 'Anonymous Member', role: null };
  } else if (row.uploader_username) {
    entry.uploader = { name: row.uploader_username, role: row.uploader_role };
  } else if (row.foreign_uploader_name) {
    entry.uploader = {
      name: row.foreign_uploader_name,
      role: row.foreign_uploader_role || null,
    };
  } else {
    // Uploader row missing (e.g. dangling reference) — fail safe.
    entry.uploader = { name: 'Unknown', role: null };
  }

  // uploader_id, foreign_uploader_*, and anonymise_uploader are deliberately
  // never copied across — the resolved `uploader` field is the only identity
  // surface in the public API.
  return entry;
}

module.exports = { serialiseEntry, buildSource };
