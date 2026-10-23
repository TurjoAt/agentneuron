// Graph data model (owner: UI-B): normalizes /api/graph + file index + live
// events + health issues into one structure the layouts and renderer share.

import { toolOf } from '../../lib/tools.js';

const DAY = 86_400_000;

/** Neural layers: 0 input (context/rules) → 1 agents → 2 docs → 3 outputs (tasks/decisions). */
export const TIERS = [
  { id: 0, label: 'Context & rules', kinds: ['context', 'rules', 'memory', 'config'] },
  { id: 1, label: 'Agents · skills · commands', kinds: ['agent', 'skill', 'command'] },
  { id: 2, label: 'Docs & plans', kinds: ['doc', 'plan', 'readme', 'changelog', 'other'] },
  { id: 3, label: 'Tasks & decisions', kinds: ['todo', 'decision'] },
];
const TIER_OF = Object.fromEntries(TIERS.flatMap((t) => t.kinds.map((k) => [k, t.id])));
export const tierOf = (kind) => TIER_OF[kind] ?? 2;

export const topFolder = (p) => {
  const i = p.indexOf('/');
  if (i < 0) return '(root)';
  // keep two levels for dot-folders and monorepo app dirs: .claude/agents, apps/api
  const parts = p.split('/');
  if (parts.length > 2 && (parts[0].startsWith('.') || ['apps', 'packages', 'docs', 'services', 'libs'].includes(parts[0]))) return parts[0] + '/' + parts[1];
  return parts[0];
};

export const AGE_BUCKETS = [
  { id: 'any', label: 'Any age' },
  { id: '1d', label: '< 1 day', max: DAY },
  { id: '7d', label: '< 7 days', max: 7 * DAY },
  { id: '30d', label: '< 30 days', max: 30 * DAY },
  { id: 'stale', label: 'Stale > 30d', min: 30 * DAY },
];

/**
 * @param {{nodes:any[], edges:any[]}} graph
 * @param {{ files?: any[], events?: any[], issues?: any[], now?: number }} extra
 */
export function buildModel(graph, extra = {}) {
  const now = extra.now || Date.now();
  const fileBy = new Map((extra.files || []).map((f) => [f.path, f]));
  const churn = new Map();
  for (const e of extra.events || []) {
    if (!e?.path) continue;
    churn.set(e.path, (churn.get(e.path) || 0) + 1 + ((e.stats?.added || 0) + (e.stats?.removed || 0)) / 25);
  }
  const issues = new Map();
  for (const i of extra.issues || []) {
    if (!i?.path) continue;
    const r = issues.get(i.path) || { error: 0, warn: 0, info: 0 };
    r[i.severity] = (r[i.severity] || 0) + 1;
    issues.set(i.path, r);
  }

  const nodes = [];
  const byId = new Map();
  const add = (n) => {
    byId.set(n.id, n);
    nodes.push(n);
    return n;
  };
  for (const raw of graph?.nodes || []) {
    if (!raw?.id || byId.has(raw.id)) continue;
    const f = fileBy.get(raw.id);
    const kind = raw.kind || f?.kind || 'other';
    const mtime = raw.mtime || f?.mtime || 0;
    add({
      id: raw.id,
      label: raw.id.slice(raw.id.lastIndexOf('/') + 1),
      tool: toolOf(raw.tool || f?.tool),
      rawTool: raw.tool || f?.tool || 'generic',
      kind,
      tier: tierOf(kind),
      folder: topFolder(raw.id),
      tokens: raw.tokens ?? f?.tokens ?? 0,
      mtime,
      age: mtime ? Math.max(0, now - mtime) : Infinity,
      churn: churn.get(raw.id) || 0,
      issues: issues.get(raw.id) || null,
      gitStatus: f?.gitStatus || null,
      missing: false,
      degree: 0,
      inDeg: 0,
      outDeg: 0,
    });
  }

  const edges = [];
  const seen = new Set();
  for (const raw of graph?.edges || []) {
    if (!raw?.from || !raw?.to || raw.from === raw.to) continue;
    const key = raw.from + '\u0000' + raw.to + '\u0000' + (raw.type || '');
    if (seen.has(key)) continue;
    seen.add(key);
    const src = byId.get(raw.from);
    if (!src) continue;
    let dst = byId.get(raw.to);
    if (!dst) {
      // dangling target → ghost node (broken link)
      dst = add({
        id: raw.to, label: raw.to.slice(raw.to.lastIndexOf('/') + 1), tool: 'generic', rawTool: 'generic', kind: 'other', tier: 2,
        folder: topFolder(raw.to), tokens: 0, mtime: 0, age: Infinity, churn: 0, issues: null, gitStatus: null,
        missing: true, degree: 0, inDeg: 0, outDeg: 0,
      });
    }
    const broken = !!raw.broken || dst.missing;
    edges.push({ source: src, target: dst, type: raw.type || 'md-link', broken, line: raw.line || 0, raw: raw.raw || '' });
  }

  const adj = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of edges) {
    e.source.outDeg++;
    e.target.inDeg++;
    e.source.degree++;
    e.target.degree++;
    adj.get(e.source.id).add(e.target.id);
    adj.get(e.target.id).add(e.source.id);
    if (e.broken) {
      e.source.hasBroken = true;
    }
  }
  // disambiguate duplicate basenames (CLAUDE.md ×5) with their parent folder
  const baseCount = new Map();
  for (const n of nodes) baseCount.set(n.label, (baseCount.get(n.label) || 0) + 1);
  for (const n of nodes) {
    if (baseCount.get(n.label) > 1) {
      const parts = n.id.split('/');
      n.label = parts.length > 1 ? parts.slice(-2).join('/') : n.label;
    }
  }
  const maxChurn = Math.max(1, ...nodes.map((n) => n.churn));
  const maxTok = Math.max(1, ...nodes.map((n) => n.tokens));
  for (const n of nodes) {
    n.heat = n.churn / maxChurn;
    n.r = n.missing ? 3.5 : 3 + Math.sqrt(n.tokens / maxTok) * 9 + Math.min(3, Math.sqrt(n.degree) * 0.6);
  }
  const edgesOf = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    edgesOf.get(e.source.id).push(e);
    edgesOf.get(e.target.id).push(e);
  }
  return { nodes, edges, byId, adj, edgesOf };
}

/** Node ids within `hops` of `id` (undirected). Returns Map id → hop distance. */
export function neighborhood(model, id, hops = 1) {
  const dist = new Map([[id, 0]]);
  let frontier = [id];
  for (let h = 1; h <= hops; h++) {
    const next = [];
    for (const v of frontier) {
      for (const w of model.adj.get(v) || []) {
        if (!dist.has(w)) {
          dist.set(w, h);
          next.push(w);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** Shortest path (undirected BFS) → array of node ids, or null. */
export function shortestPath(model, from, to, allowed = null) {
  if (!model.byId.has(from) || !model.byId.has(to)) return null;
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const v = q.shift();
    for (const w of model.adj.get(v) || []) {
      if (prev.has(w) || (allowed && !allowed.has(w))) continue;
      prev.set(w, v);
      if (w === to) {
        const path = [to];
        let c = v;
        while (c != null) {
          path.unshift(c);
          c = prev.get(c);
        }
        return path;
      }
      q.push(w);
    }
  }
  return null;
}

/** Apply UI filters; returns { nodes, edges } subsets (edges only between kept nodes). */
export function filterModel(model, f) {
  const age = AGE_BUCKETS.find((a) => a.id === f.age) || AGE_BUCKETS[0];
  const keep = (n) => {
    if (n.missing) return f.broken !== false;
    if (f.tools?.size && !f.tools.has(n.tool)) return false;
    if (f.kinds?.size && !f.kinds.has(n.kind)) return false;
    if (age.max != null && !(n.age < age.max)) return false;
    if (age.min != null && !(n.age >= age.min)) return false;
    if (f.health === 'issues' && !n.issues && !n.hasBroken) return false;
    if (f.health === 'errors' && !(n.issues?.error || n.hasBroken)) return false;
    if (f.health === 'clean' && (n.issues || n.hasBroken)) return false;
    if (f.hideOrphans && n.degree === 0) return false;
    return true;
  };
  const set = new Set();
  const nodes = [];
  for (const n of model.nodes) {
    if (keep(n)) {
      set.add(n.id);
      nodes.push(n);
    }
  }
  const edges = model.edges.filter((e) => set.has(e.source.id) && set.has(e.target.id) && (f.broken !== false || !e.broken));
  // ghost nodes only survive if one of their edges did
  const live = new Set();
  for (const e of edges) {
    live.add(e.source.id);
    live.add(e.target.id);
  }
  const outNodes = nodes.filter((n) => !n.missing || live.has(n.id));
  return { nodes: outNodes, edges, set: new Set(outNodes.map((n) => n.id)) };
}

/** Synthetic large graph for stress tests (mock mode only: #/graph?synthetic=1500). */
export function syntheticGraph(n = 1200) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const kinds = ['context', 'rules', 'agent', 'skill', 'command', 'doc', 'doc', 'doc', 'plan', 'todo', 'decision', 'readme'];
  const tools = ['claude', 'claude', 'codex', 'cursor', 'copilot', 'generic', 'generic', 'gemini', 'windsurf'];
  const dirs = ['docs', 'docs/adr', 'docs/plans', 'apps/web', 'apps/api', 'apps/admin', 'packages/ui', '.claude/agents', '.claude/skills', '.cursor/rules', 'memory', 'notes'];
  const now = Date.now();
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const d = dirs[Math.floor(rnd() * dirs.length)];
    nodes.push({ id: `${d}/file-${i}.md`, tool: tools[Math.floor(rnd() * tools.length)], kind: kinds[Math.floor(rnd() * kinds.length)], tokens: Math.floor(40 + rnd() * rnd() * 4000), mtime: now - Math.floor(rnd() * rnd() * 200 * DAY) });
  }
  const edges = [];
  for (let i = 1; i < n; i++) {
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) {
      const t = Math.floor(Math.pow(rnd(), 2.2) * i);
      edges.push({ from: nodes[i].id, to: nodes[t].id, type: rnd() < 0.15 ? 'import' : rnd() < 0.3 ? 'mention' : 'md-link' });
    }
    if (rnd() < 0.01) edges.push({ from: nodes[i].id, to: `missing/gone-${i}.md`, type: 'md-link', broken: true });
  }
  return { nodes, edges };
}
