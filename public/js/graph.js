/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */

// graph.js — shared force-directed graph renderer for the clash map.
//
// Hand-rolled because the project is deliberately zero-build / zero-deps;
// the entire feature is one SVG + a tiny Euler-integrated force simulation
// (no d3, no canvas).
//
// Two consumer modes:
//   * Mini (interactive: false) — entry.html aside. Pre-converges the layout,
//     auto-fits the viewBox to the bounding box, no pan/zoom/drag.
//   * Full (interactive: true)  — /graph.html. Animates the sim visually as
//     it settles, then enables pan + zoom + node drag.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Physics constants. Tuned by feel for graphs in the 5–150 node range.
const PHYSICS = {
  repulsion: 4000,      // node–node Coulomb-style
  springK: 0.05,        // edge spring constant
  springLength: 90,     // natural edge length
  centering: 0.015,     // gentle pull toward (0,0)
  damping: 0.85,        // velocity decay per tick
  dt: 0.5,              // integration step
  maxTicks: 350,        // hard ceiling for synchronous runs
  minVelocity: 0.05,    // convergence threshold
  stableFrames: 30,     // animated mode: stop after N frames below threshold
};

// Visual constants used by both SVG construction and per-tick render.
const NODE_R = 8;
const NODE_R_CURRENT = 11;
const ARROW_GAP = 2;     // svg-units between arrowhead tip and target circle
const EDGE_CURVE = 26;   // perpendicular offset per parallel-edge slot

// Relation type → edge colour. Mirrors the four clash-card tones used on the
// entry detail page (see CLASH_GROUPS in entry.js).
const RELATION_COLOURS = {
  Rebuts: '#C62828',
  Counters: '#B5701F',
  'Evidence For': '#2E7D32',
  Updates: '#5A6472',
  Related: '#6A4C93',
};

// Symmetric relations carry no direction, so their edges are drawn without an
// arrowhead (see buildSvg).
const SYMMETRIC_RELATIONS = new Set(['Related']);

/**
 * Render a force-directed graph into `container`.
 *
 * @param {HTMLElement} container  the host element (will be cleared).
 * @param {{nodes: Array, edges: Array, capped?: boolean, shown?: number,
 *          total_visible_entries?: number}} data
 * @param {{currentId?: string, interactive?: boolean, autoFit?: boolean,
 *          showCappedNote?: boolean}} [opts]
 */
export function renderGraph(container, data, opts = {}) {
  const {
    currentId = null,
    interactive = false,
    autoFit: shouldFit = true,
    showCappedNote = true,
  } = opts;

  while (container.firstChild) container.removeChild(container.firstChild);
  container.classList.add('graph-host');
  container.classList.toggle('graph-host--interactive', interactive);

  if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'graph-empty';
    empty.textContent = 'No connected entries to graph.';
    container.appendChild(empty);
    return null;
  }

  const state = buildState(data, currentId);
  const svg = buildSvg(container, state, { currentId });

  if (interactive) {
    animateSim(svg, state, shouldFit);
    attachPanZoom(svg);
    attachNodeDrag(svg, state);
  } else {
    runSimSync(state);
    renderPositions(svg, state);
    if (shouldFit) autoFitViewBox(svg, state, 40);
  }

  attachClicks(svg, state, currentId);
  attachHoverDim(svg, state);

  if (showCappedNote && data.capped) {
    const note = document.createElement('p');
    note.className = 'graph-note';
    note.textContent = `Showing ${data.shown} of ${data.total_visible_entries} entries.`;
    container.appendChild(note);
  }

  return { svg, state };
}

// ── State initialisation ────────────────────────────────────────────────────

function buildState(data, currentId) {
  const n = data.nodes.length;
  // Ring initial positions — gives the simulation a non-degenerate starting
  // configuration so repulsion has something to act on.
  const radius = Math.max(80, n * 6);
  // Node degree drives a gentle size boost so well-connected entries read as
  // more prominent — a cheap bit of visual hierarchy.
  const degree = new Map();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const nodes = data.nodes.map((node, i) => ({
    id: node.id,
    title: node.title,
    stance: node.stance,
    society_alignment: node.society_alignment,
    x: Math.cos((i / n) * 2 * Math.PI) * radius,
    y: Math.sin((i / n) * 2 * Math.PI) * radius,
    vx: 0,
    vy: 0,
    pinned: false,
    // Stored so renderPositions can shorten lines to the circle edge.
    radius: (node.id === currentId ? NODE_R_CURRENT : NODE_R)
      + Math.min(5, Math.sqrt(degree.get(node.id) || 0) * 1.4),
  }));
  const nodeIndex = new Map();
  nodes.forEach((node, i) => nodeIndex.set(node.id, i));

  const edges = data.edges
    .filter((e) => nodeIndex.has(e.source) && nodeIndex.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relation_type: e.relation_type,
      slot: 0, // assigned below
    }));

  // Group edges by undirected pair and assign each one a perpendicular-offset
  // slot. With slot 0 the edge renders as a straight line; non-zero slots
  // curve outward by ±EDGE_CURVE so parallel edges don't overlap. Slots are
  // centered around zero: a pair with 2 edges gets {-0.5, +0.5}, a pair with
  // 3 gets {-1, 0, +1}, etc.
  const pairs = new Map();
  for (const e of edges) {
    const key = e.source < e.target
      ? `${e.source}|${e.target}`
      : `${e.target}|${e.source}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(e);
  }
  for (const list of pairs.values()) {
    const total = list.length;
    if (total === 1) continue;
    // Sign flip when the edge's natural direction opposes the canonical pair
    // direction — keeps reciprocal A→B / B→A on opposite sides.
    list.forEach((e, i) => {
      const offset = i - (total - 1) / 2;
      const flip = e.source < e.target ? 1 : -1;
      e.slot = offset * flip;
    });
  }

  const adj = new Map();
  for (const node of nodes) adj.set(node.id, new Set());
  for (const e of edges) {
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }

  return { nodes, edges, nodeIndex, adj };
}

// ── Simulation ──────────────────────────────────────────────────────────────

function tick(state) {
  const n = state.nodes;
  const len = n.length;

  // Pairwise repulsion. O(n²) — fine up to a few hundred nodes.
  for (let i = 0; i < len; i += 1) {
    const a = n[i];
    if (a.pinned) continue;
    let fx = 0;
    let fy = 0;
    for (let j = 0; j < len; j += 1) {
      if (i === j) continue;
      const b = n[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy + 0.01;
      const d = Math.sqrt(d2);
      const f = PHYSICS.repulsion / d2;
      fx += (dx / d) * f;
      fy += (dy / d) * f;
    }
    fx -= PHYSICS.centering * a.x;
    fy -= PHYSICS.centering * a.y;
    a.vx = (a.vx + fx * PHYSICS.dt) * PHYSICS.damping;
    a.vy = (a.vy + fy * PHYSICS.dt) * PHYSICS.damping;
  }

  // Edge springs.
  for (const e of state.edges) {
    const a = n[state.nodeIndex.get(e.source)];
    const b = n[state.nodeIndex.get(e.target)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const f = PHYSICS.springK * (d - PHYSICS.springLength);
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    if (!a.pinned) { a.vx += fx * PHYSICS.dt; a.vy += fy * PHYSICS.dt; }
    if (!b.pinned) { b.vx -= fx * PHYSICS.dt; b.vy -= fy * PHYSICS.dt; }
  }

  // Integrate. Track peak velocity for convergence detection.
  let maxV = 0;
  for (const node of n) {
    if (node.pinned) continue;
    node.x += node.vx * PHYSICS.dt;
    node.y += node.vy * PHYSICS.dt;
    const v = Math.hypot(node.vx, node.vy);
    if (v > maxV) maxV = v;
  }
  return maxV;
}

function runSimSync(state) {
  for (let i = 0; i < PHYSICS.maxTicks; i += 1) {
    if (tick(state) < PHYSICS.minVelocity) break;
  }
}

function animateSim(svg, state, shouldFit) {
  let stable = 0;
  let didFit = false;
  function step() {
    const v = tick(state);
    renderPositions(svg, state);
    // Auto-fit once shortly after the start so the user doesn't see the
    // graph fly off-screen during initial settling.
    if (shouldFit && !didFit) {
      autoFitViewBox(svg, state, 60);
      didFit = true;
    }
    if (v < PHYSICS.minVelocity) {
      stable += 1;
      if (stable > PHYSICS.stableFrames) return;
    } else {
      stable = 0;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── SVG construction ────────────────────────────────────────────────────────

function buildSvg(container, state, { currentId }) {
  const svgEl = document.createElementNS(SVG_NS, 'svg');
  svgEl.setAttribute('class', 'graph');
  svgEl.setAttribute('viewBox', '-300 -300 600 600');
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  container.appendChild(svgEl);

  // One arrow marker per relation colour. orient="auto" rotates each marker
  // to follow its line's direction. The visible arrow runs from x=0 to x=10
  // in viewBox coords with refX=10, so the tip sits exactly at the line
  // endpoint — and renderPositions already shortens lines to leave ARROW_GAP
  // of clearance outside the target circle.
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const [type, colour] of Object.entries(RELATION_COLOURS)) {
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', `arrow-${slug(type)}`);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z');
    path.setAttribute('fill', colour);
    marker.appendChild(path);
    defs.appendChild(marker);
  }
  svgEl.appendChild(defs);

  const edgesG = document.createElementNS(SVG_NS, 'g');
  edgesG.setAttribute('class', 'graph-edges');
  const nodesG = document.createElementNS(SVG_NS, 'g');
  nodesG.setAttribute('class', 'graph-nodes');
  const labelsG = document.createElementNS(SVG_NS, 'g');
  labelsG.setAttribute('class', 'graph-labels');
  svgEl.appendChild(edgesG);
  svgEl.appendChild(nodesG);
  svgEl.appendChild(labelsG);

  const edgeEls = state.edges.map((e) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'graph-edge');
    path.setAttribute('data-rel', e.relation_type);
    path.setAttribute('data-edge-id', e.id);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', RELATION_COLOURS[e.relation_type] || '#888');
    if (!SYMMETRIC_RELATIONS.has(e.relation_type)) {
      path.setAttribute('marker-end', `url(#arrow-${slug(e.relation_type)})`);
    }
    edgesG.appendChild(path);
    return path;
  });

  const nodeEls = state.nodes.map((node) => {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', 'graph-node');
    // Node fill = society alignment (Aligned / Opposed / Neutral). data-stance is
    // kept too for any consumers that still key off it, but colour comes from
    // data-alignment in the stylesheet.
    circle.setAttribute('data-stance', node.stance || '');
    circle.setAttribute('data-alignment', node.society_alignment || '');
    circle.setAttribute('data-node-id', node.id);
    circle.setAttribute('r', String(node.radius));
    if (node.id === currentId) circle.setAttribute('data-current', 'true');
    const t = document.createElementNS(SVG_NS, 'title');
    t.textContent = node.title;
    circle.appendChild(t);
    nodesG.appendChild(circle);
    return circle;
  });

  const labelEls = state.nodes.map((node) => {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'graph-label');
    text.setAttribute('data-node-id', node.id);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dy', '20');
    text.textContent = truncate(node.title, 28);
    labelsG.appendChild(text);
    return text;
  });

  return { svg: svgEl, defs, edgesG, nodesG, labelsG, edgeEls, nodeEls, labelEls };
}

function renderPositions(svg, state) {
  for (let i = 0; i < state.nodes.length; i += 1) {
    const node = state.nodes[i];
    svg.nodeEls[i].setAttribute('cx', node.x);
    svg.nodeEls[i].setAttribute('cy', node.y);
    svg.labelEls[i].setAttribute('x', node.x);
    svg.labelEls[i].setAttribute('y', node.y);
  }
  for (let i = 0; i < state.edges.length; i += 1) {
    const e = state.edges[i];
    const a = state.nodes[state.nodeIndex.get(e.source)];
    const b = state.nodes[state.nodeIndex.get(e.target)];
    svg.edgeEls[i].setAttribute('d', edgePath(a, b, e.slot));
  }
}

/**
 * Build the SVG path `d` for an edge.
 *
 *   * Endpoints are pushed back so the line stops at the circle edge (source)
 *     and the arrow tip sits just outside the target circle (ARROW_GAP).
 *   * For multiple edges between the same pair of nodes, `slot` is non-zero
 *     and the path becomes a quadratic bezier curved by EDGE_CURVE per slot
 *     unit — perpendicular to the source→target direction.
 */
function edgePath(a, b, slot) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) {
    // Coincident nodes — collapse to a near-invisible stub at the source.
    return `M ${a.x} ${a.y} L ${a.x + 0.1} ${a.y + 0.1}`;
  }
  const ux = dx / d;
  const uy = dy / d;
  // Shorten both ends. Source side stops at the circle edge; target side
  // leaves room for the arrowhead marker.
  const sx = a.x + ux * a.radius;
  const sy = a.y + uy * a.radius;
  const ex = b.x - ux * (b.radius + ARROW_GAP);
  const ey = b.y - uy * (b.radius + ARROW_GAP);

  if (slot === 0) {
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }
  // Perpendicular unit vector (rotated 90° CCW).
  const perpX = -uy;
  const perpY = ux;
  const mx = (sx + ex) / 2 + perpX * slot * EDGE_CURVE;
  const my = (sy + ey) / 2 + perpY * slot * EDGE_CURVE;
  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

function autoFitViewBox(svg, state, padding = 40) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of state.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  // Handle the degenerate single-node case.
  if (!isFinite(minX) || (maxX === minX && maxY === minY)) {
    svg.svg.setAttribute('viewBox', '-100 -100 200 200');
    return;
  }
  const w = (maxX - minX) + 2 * padding;
  const h = (maxY - minY) + 2 * padding;
  svg.svg.setAttribute('viewBox', `${minX - padding} ${minY - padding} ${w} ${h}`);
}

// ── Interactivity ───────────────────────────────────────────────────────────

function parseViewBox(s) {
  const [x, y, w, h] = s.split(/\s+/).map(Number);
  return { x, y, w, h };
}
function viewBoxString(v) {
  return `${v.x} ${v.y} ${v.w} ${v.h}`;
}

function attachPanZoom(svg) {
  const svgEl = svg.svg;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  svgEl.addEventListener('pointerdown', (e) => {
    // Only pan if the click landed on bare SVG, not a node.
    if (e.target.closest('.graph-node')) return;
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    svgEl.setPointerCapture(e.pointerId);
  });
  svgEl.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const viewBox = parseViewBox(svgEl.getAttribute('viewBox'));
    const rect = svgEl.getBoundingClientRect();
    const scale = viewBox.w / rect.width;
    viewBox.x -= (e.clientX - lastX) * scale;
    viewBox.y -= (e.clientY - lastY) * scale;
    svgEl.setAttribute('viewBox', viewBoxString(viewBox));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const stop = (e) => {
    panning = false;
    try { svgEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  svgEl.addEventListener('pointerup', stop);
  svgEl.addEventListener('pointercancel', stop);

  svgEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const viewBox = parseViewBox(svgEl.getAttribute('viewBox'));
      const rect = svgEl.getBoundingClientRect();
      const cursorXRatio = (e.clientX - rect.left) / rect.width;
      const cursorYRatio = (e.clientY - rect.top) / rect.height;
      const cursorWorldX = viewBox.x + cursorXRatio * viewBox.w;
      const cursorWorldY = viewBox.y + cursorYRatio * viewBox.h;
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      viewBox.w *= factor;
      viewBox.h *= factor;
      // Keep the cursor's world point stationary while zooming.
      viewBox.x = cursorWorldX - cursorXRatio * viewBox.w;
      viewBox.y = cursorWorldY - cursorYRatio * viewBox.h;
      svgEl.setAttribute('viewBox', viewBoxString(viewBox));
    },
    { passive: false }
  );
}

function attachNodeDrag(svg, state) {
  const svgEl = svg.svg;
  let draggingIdx = null;

  svg.nodesG.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.graph-node');
    if (!target) return;
    const id = target.getAttribute('data-node-id');
    const idx = state.nodeIndex.get(id);
    if (idx == null) return;
    draggingIdx = idx;
    state.nodes[idx].pinned = true;
    target.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });

  svg.nodesG.addEventListener('pointermove', (e) => {
    if (draggingIdx == null) return;
    const viewBox = parseViewBox(svgEl.getAttribute('viewBox'));
    const rect = svgEl.getBoundingClientRect();
    const x = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
    const y = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
    const node = state.nodes[draggingIdx];
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
    renderPositions(svg, state);
  });

  const stop = () => {
    if (draggingIdx != null) {
      state.nodes[draggingIdx].pinned = false;
      draggingIdx = null;
    }
  };
  svg.nodesG.addEventListener('pointerup', stop);
  svg.nodesG.addEventListener('pointercancel', stop);
}

function attachClicks(svg, state, currentId) {
  svg.nodesG.addEventListener('click', (e) => {
    const target = e.target.closest('.graph-node');
    if (!target) return;
    const id = target.getAttribute('data-node-id');
    if (id && id !== currentId) {
      window.location.href = `/entry.html?id=${encodeURIComponent(id)}`;
    }
  });
}

function attachHoverDim(svg, state) {
  svg.nodesG.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.graph-node');
    if (!target) return;
    const id = target.getAttribute('data-node-id');
    const neighbours = new Set([id, ...(state.adj.get(id) || [])]);
    svg.svg.classList.add('graph--focused');
    svg.nodeEls.forEach((el, i) => {
      el.classList.toggle('is-focus', neighbours.has(state.nodes[i].id));
    });
    svg.edgeEls.forEach((el, i) => {
      const edge = state.edges[i];
      el.classList.toggle('is-focus', edge.source === id || edge.target === id);
    });
    svg.labelEls.forEach((el, i) => {
      el.classList.toggle('is-focus', neighbours.has(state.nodes[i].id));
    });
  });
  svg.nodesG.addEventListener('mouseout', (e) => {
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.graph-node')) return;
    svg.svg.classList.remove('graph--focused');
    svg.nodeEls.forEach((el) => el.classList.remove('is-focus'));
    svg.edgeEls.forEach((el) => el.classList.remove('is-focus'));
    svg.labelEls.forEach((el) => el.classList.remove('is-focus'));
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
function truncate(s, max) {
  const str = String(s || '');
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}
