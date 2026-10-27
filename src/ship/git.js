// Read-only git queries for Ship check (runGit: no shell, timeouts, never writes).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { runGit, validRev, US, RS } from '../git2/run.js';
import { parseNumstatZ, parseNameStatusZ } from '../git2/index.js';
import { readRegularAsync } from '../files/safeio.js';

const T = { timeout: 8000 };
const cache = new Map(); // key -> { sig, value }
const memo = async (key, sig, fn) => {
  const c = cache.get(key);
  if (c && c.sig === sig) return c.value;
  const value = await fn();
  if (cache.size > 200) cache.clear();
  cache.set(key, { sig, value });
  return value;
};

/** { available, head, reason } */
export async function gitHead(root) {
  const r = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], T);
  if (r.ok) return { available: true, head: r.out.trim() };
  const w = await runGit(root, ['rev-parse', '--is-inside-work-tree'], T);
  if (w.ok && w.out.trim() === 'true') return { available: true, head: null };
  return { available: false, head: null, reason: 'not a git repository' };
}

async function indexSig(root) {
  try { const st = await fsp.stat(path.join(root, '.git', 'index')); return `${st.mtimeMs}:${st.size}`; } catch { return String(Date.now()); }
}

/** Tracked files (`git ls-files`), cached by .git/index mtime. null when git is unavailable. */
export async function trackedFiles(root) {
  const sig = await indexSig(root);
  return memo(`ls:${root}`, sig, async () => {
    const r = await runGit(root, ['ls-files', '-z', '--cached'], { timeout: 10000 });
    if (!r.ok) return null;
    return r.out.split('\0').filter(Boolean);
  });
}

/** Untracked, not ignored files. */
export async function untrackedFiles(root, cap = 5000) {
  const r = await runGit(root, ['ls-files', '-z', '--others', '--exclude-standard'], { timeout: 10000 });
  if (!r.ok) return [];
  return r.out.split('\0').filter(Boolean).slice(0, cap);
}

/**
 * Files changed in the working tree compared to `base` (default HEAD), including untracked files.
 * @returns {Promise<{ available, base, head, files: [{ path, status, added, removed, binary? }], error? }>}
 */
export async function changedFiles(root, base = 'HEAD') {
  const h = await gitHead(root);
  if (!h.available) return { available: false, base, head: null, files: [], error: h.reason };
  if (base && !validRev(base)) return { available: true, base, head: h.head, files: [], error: 'invalid base ref' };
  const files = [];
  if (h.head) {
    const ok = await runGit(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], T);
    if (!ok.ok) return { available: true, base, head: h.head, files: [], error: `unknown base ref: ${base}` };
    const [ns, num] = await Promise.all([
      runGit(root, ['diff', '--name-status', '-z', '-M', base, '--'], T),
      runGit(root, ['diff', '--numstat', '-z', '-M', base, '--'], T),
    ]);
    const counts = parseNumstatZ(num.out || '');
    for (const f of parseNameStatusZ(ns.out || '')) {
      const c = counts.get(f.path) || { added: 0, removed: 0 };
      files.push({ path: f.path, status: f.status, added: c.added, removed: c.removed, ...(c.binary ? { binary: true } : {}), ...(f.from ? { from: f.from } : {}) });
    }
  }
  const untracked = await untrackedFiles(root, 2000);
  let budget = 200; // line-count at most 200 untracked files
  for (const p of untracked) {
    if (files.some((f) => f.path === p)) continue;
    let added = 0;
    if (budget-- > 0) {
      const r = await readRegularAsync(path.join(root, p), { maxBytes: 2 * 1024 * 1024 });
      if (r) { const t = r.buf.toString('utf8'); added = t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0; }
    }
    files.push({ path: p, status: '?', added, removed: 0 });
  }
  return { available: true, base: base || 'HEAD', head: h.head, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Recent commits with changed files, cached by HEAD. [{ hash, short, subject, body, date, files }] */
export async function recentCommits(root, limit = 300) {
  const h = await gitHead(root);
  if (!h.available || !h.head) return [];
  return memo(`log:${root}:${limit}`, h.head, async () => {
    const r = await runGit(root, ['log', `-n${limit}`, `--format=${RS}%H${US}%h${US}%aI${US}%s${US}%b${US}`, '--name-only', '--no-renames'], { timeout: 10000 });
    if (!r.ok) return [];
    const out = [];
    for (const chunk of r.out.split(RS)) {
      if (!chunk.trim()) continue;
      const [hash, short, date, subject, body, rest] = chunk.split(US);
      if (!hash) continue;
      out.push({ hash, short, date, subject: subject || '', body: (body || '').slice(0, 2000), files: String(rest || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 200) });
    }
    return out;
  });
}

export function _clearGitCache() { cache.clear(); }
