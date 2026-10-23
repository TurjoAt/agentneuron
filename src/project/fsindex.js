// Capped file walk shared by all detectors.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isIgnored } from '../core/classify.js';

export const WALK_CAP = 50000;
const EXTRA_SKIP = new Set(['.venv', 'venv', '__pycache__', 'target', '.cache', 'coverage', '.nuxt', '.svelte-kit', '.turbo', '.gradle', '.idea', '.output', '.parcel-cache', '.pytest_cache', '.mypy_cache', '.tox', 'obj']);

export async function buildIndex(root, { cap = WALK_CAP } = {}) {
  const files = []; let truncated = false;
  const queue = [''];
  while (queue.length && !truncated) {
    const rel = queue.shift();
    let ents;
    try { ents = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    const batch = [];
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (EXTRA_SKIP.has(e.name) || isIgnored(p)) continue;
        queue.push(p);
      } else if (e.isFile()) {
        if (isIgnored(p)) continue;
        batch.push(p);
      }
    }
    for (let i = 0; i < batch.length; i += 64) {
      const chunk = batch.slice(i, i + 64);
      const stats = await Promise.all(chunk.map((p) => fsp.stat(path.join(root, p)).catch(() => null)));
      chunk.forEach((p, k) => {
        if (!stats[k]) return;
        if (files.length >= cap) { truncated = true; return; }
        files.push({ path: p, size: stats[k].size });
      });
      if (truncated) break;
    }
  }
  const paths = new Set(files.map((f) => f.path));
  const idx = {
    root, files, paths, truncated,
    has: (p) => paths.has(p),
    /** files matching a predicate on path */
    find: (fn) => files.filter((f) => fn(f.path)).map((f) => f.path),
    /** direct children files of dir ('' = root) */
    ls: (dir = '') => files.filter((f) => { const d = f.path.lastIndexOf('/'); return (d < 0 ? '' : f.path.slice(0, d)) === dir; }).map((f) => f.path),
    async read(p, max = 2 * 1024 * 1024) {
      try {
        const abs = path.join(root, p);
        const st = await fsp.stat(abs);
        if (!st.isFile() || st.size > max) return null;
        return await fsp.readFile(abs, 'utf8');
      } catch { return null; }
    },
    async readJson(p) {
      const t = await idx.read(p);
      if (t == null) return null;
      try { return JSON.parse(t.replace(/^\uFEFF/, '')); } catch { return null; }
    },
    dirExists: (p) => { try { return fs.statSync(path.join(root, p)).isDirectory(); } catch { return false; } },
  };
  return idx;
}
