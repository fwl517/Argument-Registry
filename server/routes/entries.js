/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');
const { requirePermission, requireAuth, atLeast, sameScope } = require('../middleware/auth');
const { upload, publicPathFor, removeUploaded } = require('../middleware/upload');
const { serialiseEntry } = require('../utils/serialise');
const { normaliseTag } = require('./keywords');

const router = express.Router();

// ── Enumerations (mirrors the DB enum types) ─────────────────────────────────
const STANCES = ['Pro', 'Con', 'Neutral/Background'];
const ALIGNMENTS = ['Aligned', 'Opposed', 'Neutral'];
const ARG_TYPES = ['Study', 'Article', 'Raw Statistic', 'Policy Paper', 'Argument', 'Other'];
const SRC_TYPES = [
  'Our Party Platform',
  'Opposition Platform',
  'Academic',
  'News',
  'Original Society Material',
  'Other',
];
const RELATIONS = ['Counters', 'Rebuts', 'Evidence For', 'Updates', 'Related'];
// Symmetric relations read the same in both directions, so a single stored row
// covers both entries and a reverse A→B / B→A pair would be a duplicate.
const SYMMETRIC_RELATIONS = new Set(['Related']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Small parsing helpers ─────────────────────────────────────────────────────
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function isValidDate(v) {
  return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

function parseKeywords(v) {
  let list = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string' && v.trim() !== '') list = v.split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = normaliseTag(raw);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

// ── Shared DB helpers ─────────────────────────────────────────────────────────
const ENTRY_SELECT = `
  SELECT e.*,
         s.id          AS source_pk,
         s.name        AS source_name,
         s.colour      AS source_colour,
         s.text_colour AS source_text_colour,
         s.is_preset   AS source_is_preset,
         u.username    AS uploader_username,
         u.society_role AS uploader_role,
         u.group_id    AS uploader_group_id,
         ug.name        AS uploader_group_name,
         ug.colour      AS uploader_group_colour,
         ug.text_colour AS uploader_group_text_colour
    FROM entries e
    LEFT JOIN sources s ON e.source_id = s.id
    LEFT JOIN users   u ON e.uploader_id = u.id
    LEFT JOIN groups  ug ON ug.id = u.group_id
`;

async function fetchEntryRow(executor, id) {
  let result;
  try {
    result = await executor.query(`${ENTRY_SELECT} WHERE e.id = $1`, [id]);
  } catch {
    return null; // malformed uuid
  }
  return result.rows[0] || null;
}

async function fetchKeywords(executor, id) {
  const { rows } = await executor.query(
    `SELECT k.tag
       FROM entry_keywords ek
       JOIN keywords k ON ek.keyword_id = k.id
      WHERE ek.entry_id = $1
      ORDER BY k.tag`,
    [id]
  );
  return rows.map((r) => r.tag);
}

async function linkKeywords(client, entryId, tags) {
  for (const tag of tags) {
    const { rows } = await client.query(
      `INSERT INTO keywords (tag) VALUES ($1)
       ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag
       RETURNING id`,
      [tag]
    );
    await client.query(
      `INSERT INTO entry_keywords (entry_id, keyword_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [entryId, rows[0].id]
    );
  }
}

/** Fetch + serialise a single entry by id (no relations block). */
async function serialiseById(executor, id) {
  const row = await fetchEntryRow(executor, id);
  if (!row) return null;
  const keywords = await fetchKeywords(executor, id);
  return serialiseEntry(row, keywords);
}

// ── Clash map (relations block) ───────────────────────────────────────────────
const EMPTY_RELATIONS = () => ({
  counters: [],
  countered_by: [],
  rebuts: [],
  rebutted_by: [],
  evidence_for: [],
  evidenced_by: [],
  updates: [],
  updated_by: [],
  related: [],
});

// 'Related' is symmetric, so it maps to the same key whether the current entry
// is the source (forward) or the target (reverse) of the stored row.
const FORWARD_KEY = {
  Counters: 'counters',
  Rebuts: 'rebuts',
  'Evidence For': 'evidence_for',
  Updates: 'updates',
  Related: 'related',
};
const REVERSE_KEY = {
  Counters: 'countered_by',
  Rebuts: 'rebutted_by',
  'Evidence For': 'evidenced_by',
  Updates: 'updated_by',
  Related: 'related',
};

/**
 * Build the 8-category relations block for an entry. When the viewer is not
 * authenticated, relations pointing at private entries are omitted so private
 * titles never leak to the public.
 */
async function buildRelations(id, authed) {
  const visibility = authed ? '' : 'AND e.is_private = FALSE';
  const sql = `
    SELECT ar.id AS relation_id, ar.relation_type, 'forward' AS dir,
           e.id AS entry_id, e.title, e.stance, e.society_alignment, ar.context_note
      FROM argument_relations ar
      JOIN entries e ON e.id = ar.target_id
     WHERE ar.source_id = $1 ${visibility}
    UNION ALL
    SELECT ar.id AS relation_id, ar.relation_type, 'reverse' AS dir,
           e.id AS entry_id, e.title, e.stance, e.society_alignment, ar.context_note
      FROM argument_relations ar
      JOIN entries e ON e.id = ar.source_id
     WHERE ar.target_id = $1 ${visibility}
  `;
  const { rows } = await db.query(sql, [id]);
  const block = EMPTY_RELATIONS();
  for (const r of rows) {
    const key = r.dir === 'forward' ? FORWARD_KEY[r.relation_type] : REVERSE_KEY[r.relation_type];
    if (!key) continue;
    block[key].push({
      relation_id: r.relation_id,
      entry_id: r.entry_id,
      title: r.title,
      stance: r.stance,
      society_alignment: r.society_alignment,
      context_note: r.context_note,
    });
  }
  return block;
}

// =============================================================================
// GET /api/entries  — list with filters + pagination
// =============================================================================
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const authed = Boolean(req.user);
    const q = req.query;

    const where = [];
    const params = [];
    let i = 1;

    if (!authed) where.push('e.is_private = FALSE');

    if (typeof q.q === 'string' && q.q.trim() !== '') {
      where.push(
        `to_tsvector('english', e.title || ' ' || e.gist) @@ plainto_tsquery('english', $${i++})`
      );
      params.push(q.q.trim());
    }
    if (typeof q.topic === 'string' && q.topic.trim() !== '') {
      where.push(`e.topic ILIKE $${i++}`);
      params.push(`%${q.topic.trim()}%`);
    }
    if (STANCES.includes(q.stance)) {
      where.push(`e.stance = $${i++}`);
      params.push(q.stance);
    }
    if (ALIGNMENTS.includes(q.society_alignment)) {
      where.push(`e.society_alignment = $${i++}`);
      params.push(q.society_alignment);
    }
    if (ARG_TYPES.includes(q.argument_type)) {
      where.push(`e.argument_type = $${i++}`);
      params.push(q.argument_type);
    }
    if (SRC_TYPES.includes(q.source_type)) {
      where.push(`e.source_type = $${i++}`);
      params.push(q.source_type);
    }
    if (q.source_id !== undefined && q.source_id !== '') {
      const sid = parseInt(q.source_id, 10);
      if (!Number.isNaN(sid)) {
        where.push(`e.source_id = $${i++}`);
        params.push(sid);
      }
    }
    if (typeof q.group_id === 'string' && q.group_id.trim() !== '') {
      // Filters entries whose real uploader belongs to the given group.
      // Foreign-imported entries (uploader_id NULL) are not matched here
      // because the foreign group is a display string, not the same entity.
      where.push(
        `EXISTS (SELECT 1 FROM users uf WHERE uf.id = e.uploader_id AND uf.group_id = $${i++})`
      );
      params.push(q.group_id.trim());
    }
    if (typeof q.keyword === 'string' && q.keyword.trim() !== '') {
      // Match by concept, not exact tag: any synonym of the searched tag counts.
      // The concept of a keyword is COALESCE(alias_of, id). An unknown tag yields
      // a NULL subselect, so nothing matches (same as the old exact behaviour).
      where.push(
        `EXISTS (SELECT 1 FROM entry_keywords ek JOIN keywords k ON ek.keyword_id = k.id
                  WHERE ek.entry_id = e.id
                    AND COALESCE(k.alias_of, k.id) =
                        (SELECT COALESCE(alias_of, id) FROM keywords WHERE tag = $${i++}))`
      );
      params.push(normaliseTag(q.keyword));
    }
    if (isValidDate(q.from)) {
      where.push(`e.created_at >= $${i++}::date`);
      params.push(q.from);
    }
    if (isValidDate(q.to)) {
      where.push(`e.created_at < ($${i++}::date + INTERVAL '1 day')`);
      params.push(q.to);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Pagination
    let page = parseInt(q.page, 10);
    if (Number.isNaN(page) || page < 1) page = 1;
    let perPage = parseInt(q.per_page, 10);
    if (Number.isNaN(perPage) || perPage < 1) perPage = 25;
    if (perPage > 100) perPage = 100;
    const offset = (page - 1) * perPage;

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM entries e ${whereSql}`, params);
    const total = countResult.rows[0].total;

    const listParams = params.slice();
    listParams.push(perPage, offset);
    const listResult = await db.query(
      `${ENTRY_SELECT} ${whereSql}
        ORDER BY e.created_at DESC
        LIMIT $${i++} OFFSET $${i}`,
      listParams
    );

    // Batch-fetch keywords for the page.
    const ids = listResult.rows.map((r) => r.id);
    const kwMap = new Map();
    if (ids.length) {
      const kwResult = await db.query(
        `SELECT ek.entry_id, k.tag
           FROM entry_keywords ek
           JOIN keywords k ON ek.keyword_id = k.id
          WHERE ek.entry_id = ANY($1)
          ORDER BY k.tag`,
        [ids]
      );
      for (const r of kwResult.rows) {
        if (!kwMap.has(r.entry_id)) kwMap.set(r.entry_id, []);
        kwMap.get(r.entry_id).push(r.tag);
      }
    }

    const entries = listResult.rows.map((row) => serialiseEntry(row, kwMap.get(row.id) || []));
    res.json({ total, page, per_page: perPage, entries });
  })
);

// =============================================================================
// GET /api/entries/topics  — distinct topics, for the upload-form suggestions.
// Registered before '/:id' so the literal path is not parsed as an entry id.
// Applies the same public/member visibility boundary as the listing.
// =============================================================================
router.get(
  '/topics',
  asyncHandler(async (req, res) => {
    const where = ["topic IS NOT NULL", "topic <> ''"];
    if (!req.user) where.push('is_private = FALSE');
    const { rows } = await db.query(
      `SELECT DISTINCT topic FROM entries WHERE ${where.join(' AND ')} ORDER BY topic ASC`
    );
    res.json(rows.map((r) => r.topic));
  })
);

// =============================================================================
// GET /api/entries/dead-ends  — unanswered opposing material (members only)
// -----------------------------------------------------------------------------
// An entry is a "dead end" when its society_alignment is 'Opposed' but nothing
// in the database counters or rebuts it — i.e. no incoming Counters/Rebuts
// relation points at it. These are the opposing arguments we have not yet
// pushed back on, so the page is a worklist for uploading counter-arguments.
//
// This is a cheap anti-join (NOT EXISTS), served by the existing
// idx_rel_target and idx_entries_society_alignment indexes, so there is no need
// for a maintained/denormalised index that would have to be kept in sync across
// every entry, relation, alignment, and import write path. Registered before
// '/:id' so the literal path is not parsed as an entry id.
// =============================================================================
router.get(
  '/dead-ends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `${ENTRY_SELECT}
        WHERE e.society_alignment = 'Opposed'
          AND NOT EXISTS (
            SELECT 1 FROM argument_relations ar
             WHERE ar.target_id = e.id
               AND ar.relation_type IN ('Counters', 'Rebuts')
          )
        ORDER BY e.created_at DESC`
    );

    // Batch-fetch keywords, mirroring the listing endpoint.
    const ids = rows.map((r) => r.id);
    const kwMap = new Map();
    if (ids.length) {
      const kwResult = await db.query(
        `SELECT ek.entry_id, k.tag
           FROM entry_keywords ek
           JOIN keywords k ON ek.keyword_id = k.id
          WHERE ek.entry_id = ANY($1)
          ORDER BY k.tag`,
        [ids]
      );
      for (const r of kwResult.rows) {
        if (!kwMap.has(r.entry_id)) kwMap.set(r.entry_id, []);
        kwMap.get(r.entry_id).push(r.tag);
      }
    }

    const entries = rows.map((row) => serialiseEntry(row, kwMap.get(row.id) || []));
    res.json({ total: entries.length, entries });
  })
);

// =============================================================================
// GET /api/entries/:id  — single entry + clash map
// =============================================================================
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await fetchEntryRow(db, req.params.id);
    if (!row) throw new HttpError(404, 'NOT_FOUND');

    // Private entries require authentication (member/public boundary).
    if (row.is_private && !req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    const keywords = await fetchKeywords(db, row.id);
    const entry = serialiseEntry(row, keywords);
    entry.relations = await buildRelations(row.id, Boolean(req.user));
    res.json(entry);
  })
);

// =============================================================================
// GET /api/entries/:id/related  — suggestion list for the relation editor.
// =============================================================================
//
// Surfaces other entries worth linking to, as the UNION of three signals:
//   (a) topic   — same exact topic as this entry
//   (b) keyword — shares at least one keyword (the matched tags are reported)
//   (c) cluster — sits in the same clash-map component (undirected reachability
//                 via argument_relations, not necessarily a direct link)
// Each suggestion lists the reason(s) it appeared so the UI can label it.
// Write-gated: this is an authoring aid for the link editor, and Write+ viewers
// see every entry, so no public/private visibility filtering is needed.
const MAX_SUGGESTIONS = 60;
const MAX_CLUSTER = 200; // cap BFS so a giant component can't blow up the payload

router.get(
  '/:id/related',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const entry = await fetchEntryRow(db, req.params.id);
    if (!entry) throw new HttpError(404, 'NOT_FOUND');
    const selfId = entry.id;

    // id -> { reasons:Set, matched_keywords:Set }
    const hits = new Map();
    const note = (id, reason, tag) => {
      if (id === selfId) return;
      let h = hits.get(id);
      if (!h) { h = { reasons: new Set(), matched_keywords: new Set() }; hits.set(id, h); }
      h.reasons.add(reason);
      if (tag) h.matched_keywords.add(tag);
    };

    // (a) Same topic.
    if (typeof entry.topic === 'string' && entry.topic.trim() !== '') {
      const { rows } = await db.query(
        'SELECT id FROM entries WHERE topic = $1 AND id <> $2',
        [entry.topic, selfId]
      );
      for (const r of rows) note(r.id, 'topic');
    }

    // (b) Shared keyword *concept* — synonyms count as a match. Report the other
    //     entry's actual tag so the UI shows what it was tagged with.
    {
      const { rows } = await db.query(
        `SELECT ek2.entry_id AS id, k2.tag
           FROM entry_keywords ek1
           JOIN keywords k1 ON k1.id = ek1.keyword_id
           JOIN keywords k2 ON COALESCE(k2.alias_of, k2.id) = COALESCE(k1.alias_of, k1.id)
           JOIN entry_keywords ek2 ON ek2.keyword_id = k2.id AND ek2.entry_id <> ek1.entry_id
          WHERE ek1.entry_id = $1`,
        [selfId]
      );
      for (const r of rows) note(r.id, 'keyword', r.tag);
    }

    // (c) Same clash-map cluster (undirected BFS over all relations, capped).
    {
      const { rows: edges } = await db.query('SELECT source_id, target_id FROM argument_relations');
      const adj = new Map();
      const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
      for (const e of edges) { link(e.source_id, e.target_id); link(e.target_id, e.source_id); }
      const seen = new Set([selfId]);
      const queue = [selfId];
      while (queue.length > 0 && seen.size <= MAX_CLUSTER) {
        const v = queue.shift();
        for (const n of adj.get(v) || []) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
          note(n, 'cluster');
        }
      }
    }

    if (hits.size === 0) return res.json({ suggestions: [], total: 0 });

    // Hydrate display fields for the union.
    const { rows } = await db.query(
      'SELECT id, title, topic, stance, society_alignment FROM entries WHERE id = ANY($1::uuid[])',
      [Array.from(hits.keys())]
    );
    const RANK = { topic: 0, keyword: 1, cluster: 2 };
    const suggestions = rows.map((r) => {
      const h = hits.get(r.id);
      return {
        id: r.id,
        title: r.title,
        topic: r.topic,
        stance: r.stance,
        society_alignment: r.society_alignment,
        reasons: Array.from(h.reasons).sort((a, b) => RANK[a] - RANK[b]),
        matched_keywords: Array.from(h.matched_keywords).sort(),
      };
    });
    // Strongest signals first: more reasons, then topic/keyword over cluster-only.
    suggestions.sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
      const ra = Math.min(...a.reasons.map((x) => RANK[x]));
      const rb = Math.min(...b.reasons.map((x) => RANK[x]));
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title);
    });

    res.json({ suggestions: suggestions.slice(0, MAX_SUGGESTIONS), total: suggestions.length });
  })
);

// =============================================================================
// POST /api/entries  — create (multipart/form-data)
// =============================================================================
router.post(
  '/',
  requirePermission('Write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const fields = {};

    const title = typeof b.title === 'string' ? b.title.trim() : '';
    const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
    const gist = typeof b.gist === 'string' ? b.gist.trim() : '';
    if (!title) fields.title = 'Required.';
    if (!topic) fields.topic = 'Required.';
    if (!gist) fields.gist = 'Required.';
    if (!STANCES.includes(b.stance)) fields.stance = 'Invalid stance.';
    if (!ALIGNMENTS.includes(b.society_alignment)) fields.society_alignment = 'Invalid society alignment.';
    if (!ARG_TYPES.includes(b.argument_type)) fields.argument_type = 'Invalid argument type.';
    if (!SRC_TYPES.includes(b.source_type)) fields.source_type = 'Invalid source type.';

    const isPrivate = parseBool(b.is_private);
    if (isPrivate === undefined) fields.is_private = 'Must be true or false.';

    const anonymise = parseBool(b.anonymise_uploader);
    const anonymiseFinal = anonymise === undefined ? false : anonymise;

    let sourceId = null;
    if (b.source_id !== undefined && b.source_id !== '' && b.source_id !== null) {
      sourceId = parseInt(b.source_id, 10);
      if (Number.isNaN(sourceId)) fields.source_id = 'Must be an integer.';
    }

    let datePublished = null;
    if (b.date_published !== undefined && b.date_published !== '' && b.date_published !== null) {
      if (!isValidDate(b.date_published)) fields.date_published = 'Must be an ISO 8601 date.';
      else datePublished = b.date_published;
    }

    const link = typeof b.link === 'string' && b.link.trim() !== '' ? b.link.trim() : null;
    const localPath = req.file ? publicPathFor(req.file.filename) : null;
    if (!link && !localPath) {
      fields.link = 'Provide a link or upload a file.';
    }

    if (Object.keys(fields).length > 0) {
      removeUploaded(req.file);
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    const tags = parseKeywords(b.keywords);

    let entryId;
    try {
      entryId = await db.withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO entries
             (title, topic, stance, society_alignment, argument_type, source_type, source_id,
              date_published, gist, is_private, link, local_path,
              uploader_id, anonymise_uploader)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [
            title,
            topic,
            b.stance,
            b.society_alignment,
            b.argument_type,
            b.source_type,
            sourceId,
            datePublished,
            gist,
            isPrivate,
            link,
            localPath,
            req.user.id, // uploader_id ALWAYS from session, never the body
            anonymiseFinal,
          ]
        );
        const id = rows[0].id;
        await linkKeywords(client, id, tags);
        return id;
      });
    } catch (err) {
      removeUploaded(req.file);
      if (err.code === '23503') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { source_id: 'Unknown source.' } });
      }
      throw err;
    }

    const entry = await serialiseById(db, entryId);
    res.status(201).json(entry);
  })
);

// =============================================================================
// PATCH /api/entries/:id  — edit (JSON)
// =============================================================================
router.patch(
  '/:id',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const current = await fetchEntryRow(db, req.params.id);
    if (!current) throw new HttpError(404, 'NOT_FOUND');

    // Write may edit only their own entries; Admin+ may edit any in scope.
    // Scope here = same group as the uploader, or actor is a home-group Admin.
    // Foreign-imported entries (uploader_id NULL) are editable only by
    // home-group admins.
    if (current.uploader_id !== req.user.id) {
      if (!atLeast(req.user.permission, 'Admin')) {
        throw new HttpError(403, 'PERMISSION_DENIED');
      }
      if (current.uploader_id) {
        if (!sameScope(req.user, { group_id: current.uploader_group_id })) {
          throw new HttpError(403, 'PERMISSION_DENIED');
        }
      } else if (!req.user.is_home_group) {
        throw new HttpError(403, 'PERMISSION_DENIED');
      }
    }

    const b = req.body || {};
    const fields = {};
    const sets = [];
    const params = [];
    let i = 1;

    const addText = (key, col, { allowEmpty = false } = {}) => {
      if (b[key] === undefined) return;
      const val = typeof b[key] === 'string' ? b[key].trim() : '';
      if (!allowEmpty && val === '') {
        fields[key] = 'Cannot be empty.';
        return;
      }
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };

    addText('title', 'title');
    addText('topic', 'topic');
    addText('gist', 'gist');

    if (b.stance !== undefined) {
      if (!STANCES.includes(b.stance)) fields.stance = 'Invalid stance.';
      else {
        sets.push(`stance = $${i++}`);
        params.push(b.stance);
      }
    }
    if (b.society_alignment !== undefined) {
      if (!ALIGNMENTS.includes(b.society_alignment)) fields.society_alignment = 'Invalid society alignment.';
      else {
        sets.push(`society_alignment = $${i++}`);
        params.push(b.society_alignment);
      }
    }
    if (b.argument_type !== undefined) {
      if (!ARG_TYPES.includes(b.argument_type)) fields.argument_type = 'Invalid argument type.';
      else {
        sets.push(`argument_type = $${i++}`);
        params.push(b.argument_type);
      }
    }
    if (b.source_type !== undefined) {
      if (!SRC_TYPES.includes(b.source_type)) fields.source_type = 'Invalid source type.';
      else {
        sets.push(`source_type = $${i++}`);
        params.push(b.source_type);
      }
    }
    if (b.source_id !== undefined) {
      if (b.source_id === null || b.source_id === '') {
        sets.push(`source_id = $${i++}`);
        params.push(null);
      } else {
        const sid = parseInt(b.source_id, 10);
        if (Number.isNaN(sid)) fields.source_id = 'Must be an integer.';
        else {
          sets.push(`source_id = $${i++}`);
          params.push(sid);
        }
      }
    }
    if (b.date_published !== undefined) {
      if (b.date_published === null || b.date_published === '') {
        sets.push(`date_published = $${i++}`);
        params.push(null);
      } else if (!isValidDate(b.date_published)) {
        fields.date_published = 'Must be an ISO 8601 date.';
      } else {
        sets.push(`date_published = $${i++}`);
        params.push(b.date_published);
      }
    }
    if (b.is_private !== undefined) {
      const v = parseBool(b.is_private);
      if (v === undefined) fields.is_private = 'Must be true or false.';
      else {
        sets.push(`is_private = $${i++}`);
        params.push(v);
      }
    }
    if (b.anonymise_uploader !== undefined) {
      const v = parseBool(b.anonymise_uploader);
      if (v === undefined) fields.anonymise_uploader = 'Must be true or false.';
      else {
        sets.push(`anonymise_uploader = $${i++}`);
        params.push(v);
      }
    }

    // link / local_path may be cleared, but at least one must remain.
    let newLink = current.link;
    let newLocal = current.local_path;
    if (b.link !== undefined) {
      newLink = typeof b.link === 'string' && b.link.trim() !== '' ? b.link.trim() : null;
      sets.push(`link = $${i++}`);
      params.push(newLink);
    }
    if (b.local_path !== undefined) {
      newLocal =
        typeof b.local_path === 'string' && b.local_path.trim() !== '' ? b.local_path.trim() : null;
      sets.push(`local_path = $${i++}`);
      params.push(newLocal);
    }
    if (!newLink && !newLocal) {
      fields.link = 'An entry must keep at least a link or a file.';
    }

    const tagsProvided = b.keywords !== undefined;
    const tags = tagsProvided ? parseKeywords(b.keywords) : null;

    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }
    if (sets.length === 0 && !tagsProvided) {
      return res.status(422).json({ error: 'VALIDATION', fields: { _: 'No changes supplied.' } });
    }

    try {
      await db.withTransaction(async (client) => {
        if (sets.length > 0) {
          params.push(current.id);
          await client.query(`UPDATE entries SET ${sets.join(', ')} WHERE id = $${i}`, params);
        }
        if (tagsProvided) {
          await client.query('DELETE FROM entry_keywords WHERE entry_id = $1', [current.id]);
          await linkKeywords(client, current.id, tags);
        }
      });
    } catch (err) {
      if (err.code === '23503') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { source_id: 'Unknown source.' } });
      }
      if (err.code === '23514') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { link: 'An entry must keep a link or a file.' } });
      }
      throw err;
    }

    const entry = await serialiseById(db, current.id);
    res.json(entry);
  })
);

// =============================================================================
// DELETE /api/entries/:id  — Admin, Root
// =============================================================================
router.delete(
  '/:id',
  requirePermission('Admin'),
  asyncHandler(async (req, res) => {
    const current = await fetchEntryRow(db, req.params.id);
    if (!current) throw new HttpError(404, 'NOT_FOUND');

    // Scope: admins can delete entries from uploaders in their own group, or
    // any entry if they're a home-group admin. Foreign-imported entries
    // (uploader_id NULL) are home-group-only.
    if (current.uploader_id) {
      if (!sameScope(req.user, { group_id: current.uploader_group_id })) {
        throw new HttpError(403, 'PERMISSION_DENIED');
      }
    } else if (!req.user.is_home_group) {
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    // Cascades to entry_keywords and argument_relations via FK ON DELETE CASCADE.
    await db.query('DELETE FROM entries WHERE id = $1', [current.id]);

    // Best-effort removal of the backing file, if any.
    if (current.local_path) {
      const path = require('path');
      const fs = require('fs');
      const filename = path.basename(current.local_path);
      fs.unlink(path.join(config.fileStorePath, filename), () => {});
    }

    res.status(204).end();
  })
);

// =============================================================================
// POST /api/entries/:id/relations  — add a clash link
// =============================================================================
router.post(
  '/:id/relations',
  requirePermission('Write'),
  asyncHandler(async (req, res) => {
    const source = await fetchEntryRow(db, req.params.id);
    if (!source) throw new HttpError(404, 'NOT_FOUND');

    const { target_id: targetId, relation_type: relationType, context_note: contextNote } =
      req.body || {};

    const fields = {};
    if (typeof targetId !== 'string' || targetId.trim() === '') fields.target_id = 'Required.';
    if (!RELATIONS.includes(relationType)) fields.relation_type = 'Invalid relation type.';
    if (typeof contextNote !== 'string' || contextNote.trim() === '')
      fields.context_note = 'Required.';
    if (targetId === source.id) fields.target_id = 'An entry cannot clash with itself.';
    if (Object.keys(fields).length > 0) {
      return res.status(422).json({ error: 'VALIDATION', fields });
    }

    // Confirm the target exists for a clean 404 rather than an FK error.
    const target = await fetchEntryRow(db, targetId);
    if (!target) {
      return res.status(422).json({ error: 'VALIDATION', fields: { target_id: 'Unknown entry.' } });
    }

    // Symmetric relations are stored as a single row. The directional UNIQUE
    // constraint only catches an identical-direction duplicate, so guard the
    // reverse (target → source) direction here.
    if (SYMMETRIC_RELATIONS.has(relationType)) {
      const { rowCount } = await db.query(
        `SELECT 1 FROM argument_relations
          WHERE source_id = $1 AND target_id = $2 AND relation_type = $3`,
        [targetId, source.id, relationType]
      );
      if (rowCount > 0) {
        return res.status(422).json({ error: 'DUPLICATE_RELATION' });
      }
    }

    let row;
    try {
      const result = await db.query(
        `INSERT INTO argument_relations (source_id, target_id, relation_type, context_note, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, source_id, target_id, relation_type, context_note, created_by, created_at`,
        [source.id, targetId, relationType, contextNote.trim(), req.user.id]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(422).json({ error: 'DUPLICATE_RELATION' });
      }
      if (err.code === '23514') {
        return res
          .status(422)
          .json({ error: 'VALIDATION', fields: { target_id: 'An entry cannot clash with itself.' } });
      }
      throw err;
    }

    res.status(201).json(row);
  })
);

module.exports = router;
