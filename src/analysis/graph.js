import { posix } from 'node:path';
import { extractLinks } from './links.js';

const HIERARCHY_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);

export function buildGraph(files, contents) {
  const allPaths = new Set(files.map((f) => f.path));
  const edges = [];
  for (const f of files) {
    const c = contents.get(f.path);
    if (typeof c !== 'string') continue;
    edges.push(...extractLinks(f.path, c, allPaths));
  }
  for (const f of files) {
    if (!HIERARCHY_NAMES.has(f.name) || !f.dir) continue;
    let dir = posix.dirname(f.dir);
    for (;;) {
      const d = dir === '.' ? '' : dir;
      const cand = d ? `${d}/${f.name}` : f.name;
      if (allPaths.has(cand)) {
        edges.push({ from: f.path, to: cand, type: 'hierarchy', line: 0, broken: false, raw: f.name });
        break;
      }
      if (!d) break;
      dir = posix.dirname(d);
    }
  }
  const degree = new Map();
  for (const e of edges) {
    if (e.broken) continue;
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const nodes = files.map((f) => ({
    id: f.path, tool: f.tool, kind: f.kind, tokens: f.tokens, size: f.size, mtime: f.mtime,
    degree: degree.get(f.path) || 0,
  }));
  return { nodes, edges };
}
