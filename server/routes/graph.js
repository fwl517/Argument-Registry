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
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const DEFAULT_MAX = 150;
const MIN_MAX = 10;
const MAX_MAX = 500;

// =============================================================================
// GET /api/graph
// =============================================================================
//
// Returns nodes (entries) and directed edges (argument_relations) for the
// clash-map visualisation. Public, but private entries are filtered out for
// unauthenticated viewers (mirrors the buildRelations rule in entries.js).
//
// Query params:
//   from=<entry_id>  optional. When set, return only the connected component
//                    that contains this entry.
//   max=<n>          optional. Node cap. Default 150, clamped to [10, 500].
//
// Response: { nodes, edges, total_visible_entries, shown, capped }
//
// Sampling algorithm when `from` is omitted: random Fisher-Yates shuffle of
// visible entry ids, then for each un-displayed id walk its connected
// component (BFS) up to the remaining cap. This means complete connected
// components are preferred over partial ones, but a single component bigger
// than the cap is truncated at the BFS frontier (preserving its dense core).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const authed = Boolean(req.user);
    const max = clampMax(req.query.max);
    const fromId = typeof req.query.from === 'string' && req.query.from.trim() !== ''
      ? req.query.from.trim()
      : null;

    const visibilityClause = authed ? '' : 'WHERE is_private = FALSE';

    // 1. All visible entry ids (used to know the total + to drive the random
    //    seed sample when no `from` is given).
    const { rows: idRows } = await db.query(
      `SELECT id FROM entries ${visibilityClause}`
    );
    const allVisibleIds = idRows.map((r) => r.id);
    const totalVisible = allVisibleIds.length;
    const visibleSet = new Set(allVisibleIds);

    // 2. All edges whose *both* endpoints are visible. Done in one query
    //    rather than filtering JS-side so we never touch private rows in
    //    response paths.
    const edgeVisibility = authed
      ? ''
      : 'WHERE es.is_private = FALSE AND et.is_private = FALSE';
    const { rows: edgeRows } = await db.query(
      `SELECT ar.id, ar.source_id, ar.target_id, ar.relation_type
         FROM argument_relations ar
         JOIN entries es ON es.id = ar.source_id
         JOIN entries et ON et.id = ar.target_id
        ${edgeVisibility}`
    );

    // 3. Build an undirected adjacency map for connected-component traversal.
    const adj = new Map();
    for (const id of allVisibleIds) adj.set(id, new Set());
    for (const e of edgeRows) {
      adj.get(e.source_id)?.add(e.target_id);
      adj.get(e.target_id)?.add(e.source_id);
    }

    // 4. Select node ids per the requested mode.
    let selectedIds;
    if (fromId) {
      // If the seed is hidden from this viewer, return empty.
      if (!visibleSet.has(fromId)) {
        return res.json({
          nodes: [],
          edges: [],
          total_visible_entries: totalVisible,
          shown: 0,
          capped: false,
        });
      }
      selectedIds = bfsComponent(adj, fromId, max);
    } else {
      selectedIds = sampleByComponent(adj, allVisibleIds, max);
    }

    // 5. Hydrate node rows for the selected ids.
    let nodes = [];
    if (selectedIds.size > 0) {
      const ids = Array.from(selectedIds);
      const { rows: nodeRows } = await db.query(
        `SELECT id, title, stance, society_alignment, is_private
           FROM entries
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      nodes = nodeRows.map((n) => ({
        id: n.id,
        title: n.title,
        stance: n.stance,
        society_alignment: n.society_alignment,
        is_private: n.is_private,
      }));
    }

    // 6. Filter edges to those with both endpoints in the selected set.
    const edges = [];
    for (const e of edgeRows) {
      if (selectedIds.has(e.source_id) && selectedIds.has(e.target_id)) {
        edges.push({
          id: e.id,
          source: e.source_id,
          target: e.target_id,
          relation_type: e.relation_type,
        });
      }
    }

    res.json({
      nodes,
      edges,
      total_visible_entries: totalVisible,
      shown: nodes.length,
      capped: nodes.length < totalVisible,
    });
  })
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function clampMax(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_MAX;
  return Math.min(MAX_MAX, Math.max(MIN_MAX, n));
}

/**
 * BFS from a single seed, collecting up to `cap` ids in the same connected
 * component. When the cap is reached, peripheral nodes are dropped — the
 * dense core remains intact.
 */
function bfsComponent(adj, seed, cap) {
  const out = new Set([seed]);
  if (cap <= 0) return out;
  const queue = [seed];
  while (queue.length > 0 && out.size < cap) {
    const v = queue.shift();
    for (const n of adj.get(v) || []) {
      if (out.has(n)) continue;
      if (out.size >= cap) break;
      out.add(n);
      queue.push(n);
    }
  }
  return out;
}

/**
 * Random seed-and-fill sampling: Fisher-Yates shuffle of all visible ids;
 * walk the shuffled list; for each id not yet displayed, BFS its component
 * up to the remaining cap. Stops when the cap is filled or the list is
 * exhausted.
 */
function sampleByComponent(adj, allIds, cap) {
  if (cap <= 0 || allIds.length === 0) return new Set();
  const shuffled = allIds.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = new Set();
  for (const id of shuffled) {
    if (selected.size >= cap) break;
    if (selected.has(id)) continue;
    const remaining = cap - selected.size;
    const component = bfsComponent(adj, id, remaining);
    for (const n of component) selected.add(n);
  }
  return selected;
}

module.exports = router;
