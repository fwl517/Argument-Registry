/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

/**
 * Import a zip produced by GET /api/export or /api/export/backup.
 *
 *   node scripts/import.js <path-to-export.zip>
 *
 * Behaviour depends on the manifest's `scope`:
 *
 *   - public / member  → additive port. Sources are upserted by name, keywords
 *     by tag, entries always insert as new rows (new UUIDs), and uploader info
 *     lands on each entry as a display-only foreign_uploader_name/role pair.
 *     Re-running on the same DB will create duplicate entries.
 *
 *   - backup           → exact restore. Requires the target DB to be empty (no
 *     users / entries / relations). The 13 preset sources seeded by schema.sql
 *     are wiped first so the backup's source IDs survive.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const unzipper = require('unzipper');

const config = require('../server/config');
const db = require('../server/db');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/import.js <path-to-export.zip>');
    process.exit(1);
  }

  const zipPath = path.resolve(arg);
  if (!fs.existsSync(zipPath)) {
    console.error(`File not found: ${zipPath}`);
    process.exit(1);
  }

  console.log(`Reading export: ${zipPath}`);
  const { manifest, data, files } = await readExport(zipPath);

  console.log(`Scope:    ${manifest.scope}`);
  console.log(`Exported: ${manifest.exported_at}`);
  console.log(`Counts:   ${JSON.stringify(manifest.record_counts)}`);
  console.log('');

  if (manifest.scope === 'backup') {
    await importBackup(data, files);
  } else if (manifest.scope === 'public' || manifest.scope === 'member') {
    await importPortable(data, files);
  } else {
    console.error(`Unknown scope: ${manifest.scope}`);
    process.exit(1);
  }
}

// ── Zip reading ──────────────────────────────────────────────────────────────

async function readExport(zipPath) {
  const directory = await unzipper.Open.file(zipPath);
  let manifest = null;
  let data = null;
  const files = new Map();

  for (const entry of directory.files) {
    if (entry.type !== 'File') continue;
    const buf = await entry.buffer();
    if (entry.path === 'manifest.json') {
      manifest = JSON.parse(buf.toString('utf8'));
    } else if (entry.path === 'data.json') {
      data = JSON.parse(buf.toString('utf8'));
    } else if (entry.path.startsWith('files/')) {
      files.set(path.basename(entry.path), buf);
    }
  }

  if (!manifest) throw new Error('Export is missing manifest.json');
  if (!data) throw new Error('Export is missing data.json');
  return { manifest, data, files };
}

// ── Portable (public/member) import ──────────────────────────────────────────

async function importPortable(data, files) {
  fs.mkdirSync(config.fileStorePath, { recursive: true });

  const stats = {
    sources: 0,
    keywords: 0,
    entries: 0,
    entriesSkipped: 0,
    relations: 0,
    relationsSkipped: 0,
  };

  await db.withTransaction(async (client) => {
    // 1. Upsert sources by name. Preset sources keep their existing row.
    const sourceIdByName = new Map();
    for (const s of data.sources || []) {
      const { rows } = await client.query(
        `INSERT INTO sources (name, colour, text_colour, is_preset)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [s.name, s.colour, s.text_colour]
      );
      sourceIdByName.set(s.name, rows[0].id);
      stats.sources++;
    }

    // 2. Upsert keywords by tag.
    const keywordIdByTag = new Map();
    for (const k of data.keywords || []) {
      const { rows } = await client.query(
        `INSERT INTO keywords (tag) VALUES ($1)
         ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag
         RETURNING id`,
        [k.tag]
      );
      keywordIdByTag.set(k.tag, rows[0].id);
      stats.keywords++;
    }

    // 2b. Apply alias links best-effort. Only link a tag that has no existing
    //     local alias, and only onto a canonical local keyword — so an import
    //     never overrides this instance's own keyword curation.
    for (const k of data.keywords || []) {
      if (!k.alias_of_tag) continue;
      const aliasId = keywordIdByTag.get(k.tag);
      const canonicalId = keywordIdByTag.get(k.alias_of_tag);
      if (!aliasId || !canonicalId || aliasId === canonicalId) continue;
      await client.query(
        `UPDATE keywords k SET alias_of = $1
           WHERE k.id = $2
             AND k.alias_of IS NULL
             AND NOT EXISTS (SELECT 1 FROM keywords m WHERE m.alias_of = k.id)
             AND (SELECT alias_of FROM keywords WHERE id = $1) IS NULL`,
        [canonicalId, aliasId]
      );
    }

    // 3. Insert entries with fresh UUIDs. Build an old→new id map so
    //    relations can be remapped after.
    const newIdByOldId = new Map();
    for (const e of data.entries || []) {
      const localPath = copyEntryFile(e, files, /* preserveName */ false);
      if (e.local_path && !localPath && !e.link) {
        console.warn(`Skipping "${e.title}" — file missing from export and no link.`);
        stats.entriesSkipped++;
        continue;
      }

      let foreignName = null;
      let foreignRole = null;
      let anonymise = false;
      if (e.uploader === null) {
        anonymise = true;
      } else if (e.uploader && e.uploader.username) {
        foreignName = e.uploader.username;
        foreignRole = e.uploader.role || null;
      } else {
        // No uploader info supplied — treat as anonymous so the row validates.
        anonymise = true;
      }

      // uploader_group survives anonymisation — anonymous entries on the
      // source instance still carry their group label.
      const foreignGroup = e.uploader_group || null;

      const sourceId = e.source_name ? sourceIdByName.get(e.source_name) || null : null;

      const { rows } = await client.query(
        `INSERT INTO entries
           (title, topic, stance, argument_type, source_type, source_id,
            date_published, gist, is_private, link, local_path,
            uploader_id, foreign_uploader_name, foreign_uploader_role,
            foreign_uploader_group,
            anonymise_uploader, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 NULL, $12, $13, $14, $15, $16, $17)
         RETURNING id`,
        [
          e.title,
          e.topic,
          e.stance,
          e.argument_type,
          e.source_type,
          sourceId,
          e.date_published || null,
          e.gist,
          e.is_private,
          e.link || null,
          localPath,
          foreignName,
          foreignRole,
          foreignGroup,
          anonymise,
          e.created_at || new Date().toISOString(),
          e.updated_at || new Date().toISOString(),
        ]
      );

      newIdByOldId.set(e.id, rows[0].id);
      stats.entries++;

      // 4. Link keywords.
      for (const tag of e.keywords || []) {
        const kwId = keywordIdByTag.get(tag);
        if (!kwId) continue;
        await client.query(
          `INSERT INTO entry_keywords (entry_id, keyword_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [rows[0].id, kwId]
        );
      }
    }

    // 5. Insert relations with remapped IDs. created_by is NULL — these are
    //    imported and we have no local user to attribute them to.
    for (const r of data.relations || []) {
      const sourceNewId = newIdByOldId.get(r.source_entry_id);
      const targetNewId = newIdByOldId.get(r.target_entry_id);
      if (!sourceNewId || !targetNewId) {
        stats.relationsSkipped++;
        continue;
      }
      try {
        await client.query(
          `INSERT INTO argument_relations
             (source_id, target_id, relation_type, context_note, created_by, created_at)
           VALUES ($1, $2, $3, $4, NULL, $5)
           ON CONFLICT (source_id, target_id, relation_type) DO NOTHING`,
          [
            sourceNewId,
            targetNewId,
            r.relation_type,
            r.context_note || '',
            r.created_at || new Date().toISOString(),
          ]
        );
        stats.relations++;
      } catch (err) {
        console.warn(`Skipping relation: ${err.message}`);
        stats.relationsSkipped++;
      }
    }
  });

  console.log('Import complete:');
  console.log(`  Sources upserted:    ${stats.sources}`);
  console.log(`  Keywords upserted:   ${stats.keywords}`);
  console.log(`  Entries inserted:    ${stats.entries}`);
  console.log(`  Entries skipped:     ${stats.entriesSkipped}`);
  console.log(`  Relations inserted:  ${stats.relations}`);
  console.log(`  Relations skipped:   ${stats.relationsSkipped}`);
}

// ── Backup import ────────────────────────────────────────────────────────────

async function importBackup(data, files) {
  fs.mkdirSync(config.fileStorePath, { recursive: true });

  // Pre-check: the target DB must be a fresh migrate (no users/entries/relations).
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users)::int               AS users,
      (SELECT COUNT(*) FROM entries)::int             AS entries,
      (SELECT COUNT(*) FROM argument_relations)::int  AS relations
  `);
  const c = rows[0];
  if (c.users + c.entries + c.relations > 0) {
    console.error('Refusing backup restore: target database is not empty.');
    console.error(`  users: ${c.users}, entries: ${c.entries}, relations: ${c.relations}`);
    console.error('  Run npm run migrate against a fresh database, do NOT run');
    console.error('  npm run seed-root, then re-run this script.');
    process.exit(1);
  }

  await db.withTransaction(async (client) => {
    // Drop the schema-seeded preset rows so the backup's IDs survive.
    // TRUNCATE skips row-level triggers (the preset-deletion / home-group
    // guards) and CASCADE handles anything dangling (which the pre-check
    // already confirmed is empty).
    await client.query('TRUNCATE TABLE sources CASCADE');
    await client.query('TRUNCATE TABLE groups CASCADE');

    // ── Groups (must precede users for the FK) ──────────────────────────────
    for (const g of data.groups || []) {
      // Restore the logo file (kept under its original basename so logo_path
      // stays valid). Drop the reference if the file is missing from the zip.
      let logoPath = g.logo_path || null;
      if (logoPath) {
        const basename = path.basename(logoPath);
        const buf = files.get(basename);
        if (buf) {
          fs.writeFileSync(path.join(config.fileStorePath, basename), buf);
          logoPath = basename;
        } else {
          console.warn(`Warning: backup is missing logo ${basename} for group "${g.name}".`);
          logoPath = null;
        }
      }
      await client.query(
        `INSERT INTO groups
           (id, name, colour, text_colour, is_home, is_archived,
            member_quota, link, logo_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          g.id,
          g.name,
          g.colour,
          g.text_colour,
          g.is_home,
          g.is_archived,
          g.member_quota,
          g.link || null,
          logoPath,
          g.created_at,
        ]
      );
    }

    // ── Users (two-phase to satisfy the self-referential created_by FK) ─────
    for (const u of data.users || []) {
      await client.query(
        `INSERT INTO users
           (id, username, password_hash, permission, society_role, group_id,
            is_active, force_reset, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          u.id,
          u.username,
          u.password_hash,
          u.permission,
          u.society_role,
          u.group_id,
          u.is_active,
          u.force_reset,
          u.created_at,
        ]
      );
    }
    for (const u of data.users || []) {
      if (u.created_by) {
        await client.query(
          'UPDATE users SET created_by = $1 WHERE id = $2',
          [u.created_by, u.id]
        );
      }
    }

    // ── Sources (preserve IDs) ──────────────────────────────────────────────
    for (const s of data.sources || []) {
      await client.query(
        `INSERT INTO sources
           (id, name, colour, text_colour, is_preset, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          s.id,
          s.name,
          s.colour,
          s.text_colour,
          s.is_preset,
          s.created_by || null,
          s.created_at,
        ]
      );
    }
    await client.query(
      "SELECT setval('sources_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM sources), 0), 1))"
    );

    // ── Keywords (preserve IDs) ─────────────────────────────────────────────
    // Two passes: insert every row canonical first, then set alias_of. This
    // avoids forward-reference FK failures when an alias precedes its canonical.
    for (const k of data.keywords || []) {
      await client.query(
        'INSERT INTO keywords (id, tag) VALUES ($1, $2)',
        [k.id, k.tag]
      );
    }
    for (const k of data.keywords || []) {
      if (k.alias_of != null) {
        await client.query('UPDATE keywords SET alias_of = $1 WHERE id = $2', [k.alias_of, k.id]);
      }
    }
    await client.query(
      "SELECT setval('keywords_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM keywords), 0), 1))"
    );

    // ── Entries (preserve IDs) ──────────────────────────────────────────────
    for (const e of data.entries || []) {
      // Restore the file with its original basename so e.local_path stays valid.
      if (e.local_path) {
        const basename = path.basename(e.local_path);
        const buf = files.get(basename);
        if (buf) {
          fs.writeFileSync(path.join(config.fileStorePath, basename), buf);
        } else {
          console.warn(`Warning: backup is missing file ${basename} for "${e.title}".`);
        }
      }

      await client.query(
        `INSERT INTO entries
           (id, title, topic, stance, argument_type, source_type, source_id,
            date_published, gist, is_private, link, local_path,
            uploader_id, foreign_uploader_name, foreign_uploader_role,
            foreign_uploader_group, anonymise_uploader,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          e.id,
          e.title,
          e.topic,
          e.stance,
          e.argument_type,
          e.source_type,
          e.source_id,
          e.date_published,
          e.gist,
          e.is_private,
          e.link,
          e.local_path,
          e.uploader_id,
          e.foreign_uploader_name,
          e.foreign_uploader_role,
          e.foreign_uploader_group,
          e.anonymise_uploader,
          e.created_at,
          e.updated_at,
        ]
      );
    }

    // ── entry_keywords ──────────────────────────────────────────────────────
    for (const ek of data.entry_keywords || []) {
      await client.query(
        'INSERT INTO entry_keywords (entry_id, keyword_id) VALUES ($1, $2)',
        [ek.entry_id, ek.keyword_id]
      );
    }

    // ── argument_relations (preserve IDs) ───────────────────────────────────
    for (const r of data.argument_relations || []) {
      await client.query(
        `INSERT INTO argument_relations
           (id, source_id, target_id, relation_type, context_note,
            created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          r.id,
          r.source_id,
          r.target_id,
          r.relation_type,
          r.context_note,
          r.created_by,
          r.created_at,
        ]
      );
    }
  });

  console.log('Backup restored.');
  console.log(`  groups:     ${(data.groups || []).length}`);
  console.log(`  users:      ${(data.users || []).length}`);
  console.log(`  sources:    ${(data.sources || []).length}`);
  console.log(`  keywords:   ${(data.keywords || []).length}`);
  console.log(`  entries:    ${(data.entries || []).length}`);
  console.log(`  relations:  ${(data.argument_relations || []).length}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Copy a file from the export zip into the local FILE_STORE_PATH.
 * Returns the new public path (/uploads/<name>) or null if there was no file.
 *
 * When preserveName is true, the basename from the export is kept (backup
 * restore semantics). When false, a fresh UUID name is generated to avoid
 * collisions with files already on the importing system (portable import).
 */
function copyEntryFile(entry, files, preserveName) {
  if (!entry.local_path) return null;
  const basename = path.basename(entry.local_path);
  const buf = files.get(basename);
  if (!buf) return null;

  let outName;
  if (preserveName) {
    outName = basename;
  } else {
    const ext = path.extname(basename);
    outName = `${crypto.randomUUID()}${ext}`;
  }
  fs.writeFileSync(path.join(config.fileStorePath, outName), buf);
  return `/uploads/${outName}`;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Import failed:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
