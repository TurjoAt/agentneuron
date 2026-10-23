// Layout engines (owner: UI-B). Each returns target positions in world units
// (px at zoom 1, centered on 0,0) plus decorations the renderer draws.
//   { pos: Map<id,{x,y,z}>, deco, projection: 0|1, curve: 'neural'|'line' }

import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
import { hierarchy, tree, pack } from 'd3-hierarchy';
import { TIERS } from './model.js';
import { TOOL_ORDER } from '../../lib/tools.js';

export const LAYOUTS = [
  { id: 'neural', label: 'Neural', icon: 'layers', hint: 'Layered: context → agents → docs → tasks' },
  { id: 'force', label: 'Force', icon: 'graph', hint: 'Organic overview' },
  { id: 'orbit', label: 'Orbit', icon: 'globe', hint: 'Rotatable 3D sphere — drag to orbit' },
  { id: 'radial', label: 'Radial', icon: 'target', hint: 'Hops outward from a root file' },
  { id: 'clusters', label: 'Clusters', icon: 'archive', hint: 'Grouped by folder, tool or kind' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline', hint: 'X = last modified — alive vs stale' },
  { id: 'matrix', label: 'Matrix', icon: 'table', hint: 'Adjacency matrix for dense projects' },
];

const sortKey = (n) => `${String(TOOL_ORDER.indexOf(n.tool)).padStart(2, '0')}|${n.folder}|${n.id}`;
const byKey = (a, b) => (sortKey(a) < sortKey(b) ? -1 : 1);

export function groupKey(n, mode) {
  if (mode === 'tool') return n.tool;
  if (mode === 'kind') return n.missing ? 'missing' : n.kind;
  return n.missing ? '(missing)' : n.folder;
}

// ------------------------------------------------------------------ neural
function neural(nodes, edges) {
  const cols = TIERS.map((t) => ({ ...t, nodes: [] }));
  for (const n of nodes) cols[n.tier].nodes.push(n);
  const used = cols.filter((c) => c.nodes.length);
  for (const c of used) c.nodes.sort(byKey);
  // barycenter sweeps to reduce crossings
  const nb = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    nb.get(e.source.id)?.push(e.target);
    nb.get(e.target.id)?.push(e.source);
  }
  const rank = new Map();
  const reRank = () => used.forEach((c) => c.nodes.forEach((n, i) => rank.set(n.id, (i + 0.5) / c.nodes.length)));
  reRank();
  for (let s = 0; s < 6; s++) {
    for (const c of s % 2 ? used.slice().reverse() : used) {
      const bc = new Map();
      for (const n of c.nodes) {
        const others = nb.get(n.id).filter((m) => m.tier !== n.tier);
        bc.set(n.id, others.length ? others.reduce((a, m) => a + rank.get(m.id), 0) / others.length : rank.get(n.id));
      }
      c.nodes.sort((a, b) => bc.get(a.id) - bc.get(b.id));
      c.nodes.forEach((n, i) => rank.set(n.id, (i + 0.5) / c.nodes.length));
    }
  }
  const N = nodes.length;
  const maxRows = Math.max(16, Math.ceil(Math.sqrt(N) * 2.4));
  const pos = new Map();
  const colsOut = [];
  let x = 0;
  const gap = N > 400 ? 15 : N > 120 ? 20 : 28;
  for (const c of used) {
    const sub = Math.ceil(c.nodes.length / maxRows);
    const rows = Math.ceil(c.nodes.length / sub);
    const h = (rows - 1) * gap;
    c.nodes.forEach((n, i) => {
      const sc = i % sub;
      const row = Math.floor(i / sub);
      pos.set(n.id, { x: x + sc * 30 + (row % 2 ? 6 : 0) * (sub > 1 ? 1 : 0), y: -h / 2 + row * gap, z: 0 });
    });
    colsOut.push({ x: x + ((sub - 1) * 30) / 2, label: c.label, count: c.nodes.length, top: -h / 2 - 46, bottom: h / 2 + 20 });
    x += (sub - 1) * 30 + Math.max(260, Math.min(520, 160 + N * 0.6));
  }
  const shift = (x - Math.max(260, Math.min(520, 160 + N * 0.6))) / 2;
  for (const p of pos.values()) p.x -= shift;
  for (const c of colsOut) c.x -= shift;
  return { pos, deco: { columns: colsOut }, projection: 0, curve: 'neural' };
}

// ------------------------------------------------------------------ force
function force(nodes, edges, prev) {
  const sim = nodes.map((n, i) => {
    const p = prev?.get(n.id);
    const a = i * 2.39996;
    const r = 10 * Math.sqrt(i + 1);
    return { id: n.id, r: n.r, tool: n.tool, x: p && Number.isFinite(p.x) ? p.x : Math.cos(a) * r, y: p && Number.isFinite(p.y) ? p.y : Math.sin(a) * r };
  });
  const idx = new Map(sim.map((s) => [s.id, s]));
  const links = edges.map((e) => ({ source: idx.get(e.source.id), target: idx.get(e.target.id), type: e.type })).filter((l) => l.source && l.target);
  const N = sim.length;
  const toolAngle = (t) => (TOOL_ORDER.indexOf(t) / TOOL_ORDER.length) * Math.PI * 2;
  const spread = Math.max(120, Math.sqrt(N) * 14);
  const s = forceSimulation(sim)
    .force('link', forceLink(links).distance((l) => (l.type === 'hierarchy' ? 70 : l.type === 'mention' ? 90 : 55)).strength((l) => (l.type === 'mention' ? 0.15 : 0.5)))
    .force('charge', forceManyBody().strength(N > 600 ? -35 : -110).distanceMax(N > 600 ? 260 : 420).theta(0.9))
    .force('collide', forceCollide((d) => d.r + 3).iterations(1))
    .force('x', forceX((d) => Math.cos(toolAngle(d.tool)) * spread * 0.35).strength(0.045))
    .force('y', forceY((d) => Math.sin(toolAngle(d.tool)) * spread * 0.35).strength(0.045))
    .stop();
  const ticks = N > 900 ? 140 : N > 300 ? 220 : 320;
  for (let i = 0; i < ticks; i++) s.tick();
  const pos = new Map(sim.map((d) => [d.id, { x: d.x, y: d.y, z: 0 }]));
  return { pos, deco: {}, projection: 0, curve: 'line' };
}

// ------------------------------------------------------------------ orbit (pseudo-3D sphere)
function orbit(nodes) {
  const list = nodes.slice().sort((a, b) => (a.tier - b.tier) || byKey(a, b));
  const N = list.length;
  const R = Math.max(170, Math.sqrt(N) * 24);
  const pos = new Map();
  const golden = Math.PI * (3 - Math.sqrt(5));
  list.forEach((n, i) => {
    const y = N === 1 ? 0 : 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = golden * i;
    pos.set(n.id, { x: Math.cos(th) * rad * R, y: y * R, z: Math.sin(th) * rad * R });
  });
  return { pos, deco: { sphere: R }, projection: 1, curve: 'line' };
}

// ------------------------------------------------------------------ radial
function radial(nodes, edges, _prev, opts) {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.source.id)?.push(e.target.id);
    adj.get(e.target.id)?.push(e.source.id);
  }
  let root = opts.root && ids.has(opts.root) ? opts.root : null;
  if (!root) {
    const pref = nodes.find((n) => n.id === 'CLAUDE.md') || nodes.find((n) => n.id === 'AGENTS.md');
    root = pref?.id || nodes.slice().sort((a, b) => b.degree - a.degree)[0]?.id;
  }
  const pos = new Map();
  if (!root) return { pos, deco: {}, projection: 0, curve: 'line' };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map([[root, null]]);
  const q = [root];
  while (q.length) {
    const v = q.shift();
    const next = (adj.get(v) || []).slice().sort((a, b) => byKey(byId.get(a), byId.get(b)));
    for (const w of next) if (!parent.has(w)) { parent.set(w, v); q.push(w); }
  }
  const kids = new Map();
  for (const [c, p] of parent) if (p != null) (kids.get(p) || kids.set(p, []).get(p)).push(c);
  const h = hierarchy({ id: root }, (d) => (kids.get(d.id) || []).map((id) => ({ id })));
  const depth = Math.max(1, h.height);
  const N = nodes.length;
  const ring = Math.max(110, Math.sqrt(N) * 8.5);
  tree().size([Math.PI * 2, depth * ring]).separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(h);
  h.each((d) => {
    const a = d.x - Math.PI / 2;
    pos.set(d.data.id, { x: Math.cos(a) * d.y, y: Math.sin(a) * d.y, z: 0 });
  });
  const rest = nodes.filter((n) => !parent.has(n.id));
  const outer = (depth + 1.3) * ring;
  rest.forEach((n, i) => {
    const a = (i / Math.max(1, rest.length)) * Math.PI * 2 - Math.PI / 2;
    const jitter = (i % 3) * 14;
    pos.set(n.id, { x: Math.cos(a) * (outer + jitter), y: Math.sin(a) * (outer + jitter), z: 0 });
  });
  const rings = [];
  for (let d = 1; d <= depth; d++) rings.push({ r: d * ring, label: `${d} hop${d > 1 ? 's' : ''}` });
  if (rest.length) rings.push({ r: outer, label: `unreachable · ${rest.length}`, dashed: true });
  return { pos, deco: { rings, root }, projection: 0, curve: 'radial' };
}

// ------------------------------------------------------------------ clusters
function clusters(nodes, _edges, _prev, opts) {
  const mode = opts.groupBy || 'folder';
  const groups = new Map();
  for (const n of nodes) {
    const k = groupKey(n, mode);
    (groups.get(k) || groups.set(k, []).get(k)).push(n);
  }
  const data = {
    children: [...groups].map(([key, list]) => ({ key, children: list.sort(byKey).map((n) => ({ node: n, value: (n.r + 2.5) ** 2 })) })),
  };
  const area = nodes.reduce((a, n) => a + (n.r + 3) ** 2 * Math.PI, 0);
  const S = Math.max(400, Math.sqrt(area) * 2.3);
  const root = hierarchy(data).sum((d) => d.value || 0).sort((a, b) => b.value - a.value);
  pack().size([S, S]).padding((d) => (d.depth === 0 ? Math.max(30, S / 30) : 2.5))(root);
  const pos = new Map();
  const hulls = [];
  for (const g of root.children || []) {
    hulls.push({ key: g.data.key, x: g.x - S / 2, y: g.y - S / 2, r: g.r + 6, count: g.children?.length || 0, tool: mode === 'tool' ? g.data.key : null });
    for (const c of g.children || []) pos.set(c.data.node.id, { x: c.x - S / 2, y: c.y - S / 2, z: 0 });
  }
  return { pos, deco: { hulls }, projection: 0, curve: 'line', edgeAlpha: 0.45 };
}

// ------------------------------------------------------------------ timeline
const H = 3600_000;
export const AGE_TICKS = [
  [0, 'now'], [H, '1h'], [6 * H, '6h'], [24 * H, '1d'], [7 * 24 * H, '1w'], [30 * 24 * H, '1mo'], [182 * 24 * H, '6mo'], [365 * 24 * H, '1y'], [3 * 365 * 24 * H, '3y'],
];
function timeline(nodes, _edges, _prev, opts) {
  const mode = opts.groupBy === 'kind' || opts.groupBy === 'folder' ? opts.groupBy : 'tool';
  const known = nodes.filter((n) => Number.isFinite(n.age));
  const maxAge = Math.max(24 * H, ...known.map((n) => n.age));
  const N = nodes.length;
  const W = Math.max(900, Math.min(2600, N * 2.2 + 700));
  const L = Math.log1p(maxAge / 60_000);
  const xOf = (age) => (Number.isFinite(age) ? W / 2 - (Math.log1p(age / 60_000) / L) * W : -W / 2 - 150);
  // lanes
  const groups = new Map();
  for (const n of nodes) {
    const k = groupKey(n, mode);
    (groups.get(k) || groups.set(k, []).get(k)).push(n);
  }
  let lanes = [...groups].sort((a, b) => b[1].length - a[1].length);
  if (lanes.length > 12) {
    const rest = lanes.slice(11).flatMap(([, l]) => l);
    lanes = [...lanes.slice(0, 11), ['other', rest]];
  }
  const pos = new Map();
  const out = [];
  let y = 0;
  for (const [key, list] of lanes) {
    list.sort((a, b) => xOf(a.age) - xOf(b.age));
    const placed = [];
    let lo = 0, hi = 0;
    for (const n of list) {
      const x = xOf(n.age);
      const near = placed.filter((p) => Math.abs(p.x - x) < p.r + n.r + 2);
      let off = 0;
      for (let k = 0; k < 400; k++) {
        const cand = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 4;
        if (near.every((p) => Math.hypot(p.x - x, p.y - cand) >= p.r + n.r + 1.5)) { off = cand; break; }
      }
      placed.push({ x, y: off, r: n.r });
      lo = Math.min(lo, off - n.r);
      hi = Math.max(hi, off + n.r);
      pos.set(n.id, { x, y: off, z: 0 });
    }
    const h = Math.max(36, hi - lo + 18);
    const center = y + h / 2 - (hi + lo) / 2;
    for (const n of list) pos.get(n.id).y += center;
    out.push({ key, y, h, count: list.length, tool: mode === 'tool' ? key : null });
    y += h + 8;
  }
  const shift = y / 2;
  for (const p of pos.values()) p.y -= shift;
  for (const l of out) l.y -= shift;
  const ticks = AGE_TICKS.filter(([a]) => a <= maxAge * 1.05).map(([a, label]) => ({ x: xOf(a), label }));
  return { pos, deco: { lanes: out, ticks, x0: -W / 2 - 20, x1: W / 2 + 20, unknownX: -W / 2 - 150 }, projection: 0, curve: 'line', edgeAlpha: 0.6 };
}

// ------------------------------------------------------------------ matrix
function matrix(nodes, _edges, _prev, opts) {
  const mode = opts.groupBy || 'folder';
  const list = nodes.slice().sort((a, b) => {
    const ga = groupKey(a, mode), gb = groupKey(b, mode);
    return ga < gb ? -1 : ga > gb ? 1 : b.degree - a.degree || (a.id < b.id ? -1 : 1);
  });
  const N = list.length;
  const s = N > 600 ? 5 : N > 250 ? 8 : N > 80 ? 12 : 18;
  const off = (N * s) / 2;
  const pos = new Map();
  const index = new Map();
  const groups = [];
  list.forEach((n, i) => {
    index.set(n.id, i);
    pos.set(n.id, { x: i * s + s / 2 - off, y: i * s + s / 2 - off, z: 0 });
    const g = groupKey(n, mode);
    if (!groups.length || groups[groups.length - 1].key !== g) groups.push({ key: g, start: i, end: i });
    else groups[groups.length - 1].end = i;
  });
  return { pos, deco: { matrix: { s, off, n: N, index, order: list.map((n) => n.id), groups } }, projection: 0, curve: 'none' };
}

const ENGINES = { neural, force, orbit, radial, clusters, timeline, matrix };

/**
 * @param {string} id layout id
 * @param {any[]} nodes  filtered nodes
 * @param {any[]} edges  filtered edges
 * @param {Map<string,{x,y}>} prev current positions (force warm start)
 * @param {{ root?: string, groupBy?: string }} opts
 */
export function computeLayout(id, nodes, edges, prev, opts = {}) {
  const fn = ENGINES[id] || neural;
  if (!nodes.length) return { pos: new Map(), deco: {}, projection: id === 'orbit' ? 1 : 0, curve: 'line' };
  return { id, ...fn(nodes, edges, prev, opts) };
}
