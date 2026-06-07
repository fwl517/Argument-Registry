/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const archiver = require('archiver');

const db = require('../db');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

const EXPORT_VERSION = '1.0';

// =============================================================================
// GET /api/export  — public scope (anon) or member scope (authed)
// =============================================================================
//
// Public/member exports strip everything that cannot meaningfully cross to a
// foreign instance:
//   - users table is omitted entirely (uploaders are denormalised into entries).
//   - sources have no `id` (matched on `name` at import; name is UNIQUE).
//   - anonymised entries get uploader = null.
//   - non-anonymised entries get uploader = { username, role } (display string).
// Entries keep their UUIDs purely so relations can link to them in the JSON.
//
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.user ? 'member' : 'public';
    const data = await collectPortableData(scope === 'member');
    await streamZip(res, scope, data);
  })
);

// =============================================================================
// GET /api/export/backup  — Root-only full backup
// =============================================================================
//
// Every table verbatim (except `sessions` — restoring would leave pre-backup
// sessions valid post-restore, which is undesirable). Round-trippable into an
// empty database via scripts/import.js.
//
router.get(
  '/backup',
  requirePermission('Root'),
  asyncHandler(async (req, res) => {
    const data = await collectBackupData();
    await streamZip(res, 'backup', data);
  })
);

// ── Data collection ──────────────────────────────────────────────────────────

async function collectPortableData(includePrivate) {
  const visibilityClause = includePrivate ? '' : 'WHERE e.is_private = FALSE';

  const sourcesQ = db.query(
    'SELECT name, colour, text_colour, is_preset FROM sources ORDER BY id'
  );
  const keywordsQ = db.query('SELECT tag FROM keywords ORDER BY tag');
  const entriesQ = db.query(
    `SELECT e.id, e.title, e.topic, e.stance, e.argument_type, e.source_type,
            e.date_published, e.gist, e.is_private, e.link, e.local_path,
            e.anonymise_uploader, e.created_at, e.updated_at,
            s.name        AS src_name,
            u.username    AS uploader_username,
            u.society_role AS uploader_role,
            ug.name       AS uploader_group_name,
            e.foreign_uploader_name,
            e.foreign_uploader_role,
            e.foreign_uploader_group
       FROM entries e
       LEFT JOIN sources s ON e.source_id = s.id
       LEFT JOIN users   u ON e.uploader_id = u.id
       LEFT JOIN groups  ug ON ug.id = u.group_id
       ${visibilityClause}
       ORDER BY e.created_at`
  );

  const [sources, keywords, entries] = await Promise.all([
    sourcesQ,
    keywordsQ,
    entriesQ,
  ]);

  // Per-entry tags (batch)
  const entryIds = entries.rows.map((r) => r.id);
  const kwByEntry = new Map();
  if (entryIds.length) {
    const ek = await db.query(
      `SELECT ek.entry_id, k.tag
         FROM entry_keywords ek
         JOIN keywords k ON ek.keyword_id = k.id
        WHERE ek.entry_id = ANY($1)
        ORDER BY k.tag`,
      [entryIds]
    );
    for (const r of ek.rows) {
      if (!kwByEntry.has(r.entry_id)) kwByEntry.set(r.entry_id, []);
      kwByEntry.get(r.entry_id).push(r.tag);
    }
  }

  // Relations: only between visible entries. The visibility filter on the
  // entries table above already constrains the universe; the JOIN here re-checks
  // both endpoints so a public export can never expose a private title.
  const relationsQ = await db.query(
    `SELECT ar.source_id AS source_entry_id,
            ar.target_id AS target_entry_id,
            ar.relation_type,
            ar.context_note,
            ar.created_at
       FROM argument_relations ar
       JOIN entries s ON s.id = ar.source_id
       JOIN entries t ON t.id = ar.target_id
      ${includePrivate ? '' : 'WHERE s.is_private = FALSE AND t.is_private = FALSE'}
      ORDER BY ar.created_at`
  );

  const shapedEntries = entries.rows.map((row) =>
    shapePortableEntry(row, kwByEntry.get(row.id) || [])
  );

  // Tags that actually appear (so foreign instances do not import dead tags
  // from rows they cannot see).
  const usedTags = new Set();
  for (const list of kwByEntry.values()) for (const t of list) usedTags.add(t);
  const filteredKeywords = keywords.rows.filter((k) => usedTags.has(k.tag));

  return {
    sources: sources.rows,
    keywords: filteredKeywords,
    entries: shapedEntries,
    relations: relationsQ.rows,
    // Raw entry rows are kept on the side so streamZip can find local files.
    _entryRows: entries.rows,
  };
}

function shapePortableEntry(row, keywords) {
  let uploader = null;
  if (!row.anonymise_uploader) {
    if (row.uploader_username) {
      uploader = { username: row.uploader_username, role: row.uploader_role };
    } else if (row.foreign_uploader_name) {
      uploader = {
        username: row.foreign_uploader_name,
        role: row.foreign_uploader_role,
      };
    }
  }
  // Group rides separately from uploader so it survives anonymisation —
  // anonymous entries still display their group on the receiving instance.
  const uploaderGroup = row.uploader_group_name || row.foreign_uploader_group || null;

  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    stance: row.stance,
    argument_type: row.argument_type,
    source_type: row.source_type,
    source_name: row.src_name || null,
    date_published: row.date_published,
    gist: row.gist,
    is_private: row.is_private,
    link: row.link,
    local_path: row.local_path,
    uploader,            // null when anonymised
    uploader_group: uploaderGroup, // string name, present even on anonymous rows
    keywords,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function collectBackupData() {
  const [groups, users, sources, keywords, entries, ek, ar] = await Promise.all([
    db.query(
      `SELECT id, name, colour, text_colour, is_home, is_archived,
              member_quota, created_at
         FROM groups ORDER BY created_at`
    ),
    db.query(
      `SELECT id, username, password_hash, permission, society_role, group_id,
              is_active, force_reset, created_at, created_by
         FROM users ORDER BY created_at`
    ),
    db.query(
      `SELECT id, name, colour, text_colour, is_preset, created_by, created_at
         FROM sources ORDER BY id`
    ),
    db.query('SELECT id, tag FROM keywords ORDER BY id'),
    db.query(
      `SELECT id, title, topic, stance, argument_type, source_type, source_id,
              date_published, gist, is_private, link, local_path,
              uploader_id, foreign_uploader_name, foreign_uploader_role,
              foreign_uploader_group, anonymise_uploader,
              created_at, updated_at
         FROM entries ORDER BY created_at`
    ),
    db.query('SELECT entry_id, keyword_id FROM entry_keywords'),
    db.query(
      `SELECT id, source_id, target_id, relation_type, context_note,
              created_by, created_at
         FROM argument_relations ORDER BY created_at`
    ),
  ]);

  return {
    groups: groups.rows,
    users: users.rows,
    sources: sources.rows,
    keywords: keywords.rows,
    entries: entries.rows,
    entry_keywords: ek.rows,
    argument_relations: ar.rows,
    _entryRows: entries.rows, // alias used by streamZip
  };
}

// ── Streaming ────────────────────────────────────────────────────────────────

async function streamZip(res, scope, data) {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `political-society-${scope}-${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[export] archive warning:', err.message);
  });
  archive.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[export] archive error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    } else {
      res.end();
    }
  });
  archive.pipe(res);

  const counts = {
    entries: (data.entries || []).length,
    sources: (data.sources || []).length,
    keywords: (data.keywords || []).length,
    relations: (data.relations || data.argument_relations || []).length,
  };
  if (scope === 'backup') {
    counts.groups = (data.groups || []).length;
    counts.users = (data.users || []).length;
    counts.entry_keywords = (data.entry_keywords || []).length;
  }

  const manifest = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    scope,
    record_counts: counts,
    notes:
      scope === 'backup'
        ? 'Complete backup. Round-trippable via scripts/import.js into an empty database.'
        : 'Portable export. Foreign uploaders land as display-only strings on import.',
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  // The data payload differs by scope; both shapes are described in the
  // import script.
  const payload =
    scope === 'backup'
      ? {
          groups: data.groups,
          users: data.users,
          sources: data.sources,
          keywords: data.keywords,
          entries: data.entries,
          entry_keywords: data.entry_keywords,
          argument_relations: data.argument_relations,
        }
      : {
          sources: data.sources,
          keywords: data.keywords,
          entries: data.entries,
          relations: data.relations,
        };

  archive.append(JSON.stringify(payload, null, 2), { name: 'data.json' });

  // Attach files. We deduplicate because nothing in the schema stops two
  // entries from sharing a local_path (unusual but possible).
  const seen = new Set();
  for (const row of data._entryRows || []) {
    if (!row.local_path) continue;
    const basename = path.basename(row.local_path);
    if (seen.has(basename)) continue;
    seen.add(basename);

    const filePath = path.join(config.fileStorePath, basename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: `files/${basename}` });
    }
  }

  await archive.finalize();
}

module.exports = router;
