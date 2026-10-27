// Read-only diff collection for the change review: working tree vs a base (default HEAD, untracked files
// included) or base..head. Only read-only git commands; bounded file count and patch bytes.
import path from 'node:path';
import { runGit, validRev } from '../git2/run.js';
import { parseHunks, parseNameStatusZ, parseNumstatZ } from '../git2/index.js';
import { readRegularAsync } from '../files/safeio.js';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const MAX_FILES = 400;
const MAX_FILE_PATCH = 160 * 1024;
const MAX_TOTAL_PATCH = 3 * 1024 * 1024;
const MAX_UNTRACKED = 200;
const MAX_UNTRACKED_BYTES = 256 * 1024;

const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** Split "a..b" / "a...b" or separate base/head into validated revisions. Throws 400 on bad input. */
export function parseRange(base, head) {
  let b = typeof base === 'string' && base.trim() ? base.trim() : null;
  let h = typeof head === 'string' && head.trim() ? head.trim() : null;
  if (b && /\.\.\.?/.test(b)) {
    const [x, y] = b.split(/\.\.\.?/);
    b = x || null; if (y) h = y;
  }
  for (const r of [b, h]) if (r != null && !validRev(r)) throw bad(`invalid revision: ${String(r).slice(0, 60)}`);
  return { base: b, head: h };
}

/** { ok:true, prefix } or { ok:false, reason } */
export async function repoInfo(root) {
  const r = await runGit(root, ['rev-parse', '--is-inside-work-tree', '--show-prefix'], { timeout: 6000 });
  if (!r.ok || r.out.split('\n')[0].trim() !== 'true') {
    const e = String(r.err || '');
    return { ok: false, reason: /dubious ownership/i.test(e) ? 'git refuses this repository ("dubious ownership")' : /ENOENT/.test(e) ? 'git not found' : 'not a git repository' };
  }
  return { ok: true, prefix: r.out.split('\n')[1] || '' };
}

export async function hasHead(root) { return (await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).ok; }

const isBinaryBuf = (buf) => buf.subarray(0, 8000).includes(0);

/**
 * Collect the diff. Returns { available, reason?, base, head, files: [{ path, status, from?, added, removed, binary, hunks }], truncated }.
 * hunks: parseHunks() output ({ oldStart, oldLines, newStart, newLines, lines: ['+x', '-y', ' z'] }).
 */
export async function collectDiff(root, { base, head, maxFiles = MAX_FILES, untracked = true } = {}) {
  const info = await repoInfo(root);
  if (!info.ok) return { available: false, reason: info.reason, base: base || null, head: head || null, files: [], truncated: false };
  const range = parseRange(base, head);
  const headExists = await hasHead(root);
  let left = range.base || (headExists ? 'HEAD' : EMPTY_TREE);
  if (range.base && !(await runGit(root, ['rev-parse', '--verify', '--quiet', `${range.base}^{commit}`])).ok) throw bad(`unknown revision: ${range.base}`);
  if (range.head && !(await runGit(root, ['rev-parse', '--verify', '--quiet', `${range.head}^{commit}`])).ok) throw bad(`unknown revision: ${range.head}`);
  const sides = range.head ? [left, range.head] : [left];
  const common = ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '--relative'];
  const [ns, num, patch] = await Promise.all([
    runGit(root, [...common, '--name-status', '-z', ...sides, '--']),
    runGit(root, [...common, '--numstat', '-z', ...sides, '--']),
    runGit(root, [...common, '-U3', ...sides, '--'], { timeout: 30000 }),
  ]);
  if (!ns.ok) return { available: false, reason: (ns.err || 'git diff failed').trim().split('\n')[0], base: left, head: range.head, files: [], truncated: false };
  const stats = parseNumstatZ(num.out);
  const entries = parseNameStatusZ(ns.out);
  // patch sections appear in the same order as name-status entries
  const sections = patch.out ? patch.out.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git ')) : [];
  let total = 0;
  let truncated = entries.length > maxFiles;
  const files = [];
  for (let i = 0; i < entries.length && files.length < maxFiles; i++) {
    const e = entries[i];
    const s = stats.get(e.path) || { added: 0, removed: 0 };
    let sec = sections[i] || '';
    const binary = !!s.binary || /^Binary files /m.test(sec.slice(0, 2000));
    let fileTrunc = false;
    if (sec.length > MAX_FILE_PATCH) { sec = sec.slice(0, MAX_FILE_PATCH); fileTrunc = true; }
    if (total + sec.length > MAX_TOTAL_PATCH) { sec = ''; fileTrunc = true; truncated = true; }
    total += sec.length;
    const f = { path: e.path, status: e.status, added: s.added, removed: s.removed, binary, hunks: sec ? parseHunks(sec) : [], truncated: fileTrunc };
    if (e.from) f.from = e.from;
    files.push(f);
  }
  if (untracked && !range.head) {
    const u = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    const list = u.out.split('\0').filter(Boolean);
    const known = new Set(files.map((f) => f.path));
    let n = 0;
    for (const p of list) {
      if (known.has(p)) continue;
      if (files.length >= maxFiles || n >= MAX_UNTRACKED) { truncated = true; break; }
      n++;
      const r = await readRegularAsync(path.join(root, p), { maxBytes: MAX_UNTRACKED_BYTES });
      if (!r) { files.push({ path: p, status: 'A', untracked: true, added: 0, removed: 0, binary: false, hunks: [], truncated: true }); continue; }
      if (isBinaryBuf(r.buf)) { files.push({ path: p, status: 'A', untracked: true, added: 0, removed: 0, binary: true, hunks: [] }); continue; }
      const text = r.buf.toString('utf8');
      const lines = text.split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      total += text.length;
      files.push({ path: p, status: 'A', untracked: true, added: lines.length, removed: 0, binary: false,
        hunks: lines.length ? [{ header: `@@ -0,0 +1,${lines.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => '+' + l) }] : [] });
    }
  }
  return { available: true, base: left === EMPTY_TREE ? null : left, head: range.head || null, files, truncated };
}

/** Walk a hunk: yields { type: 'add'|'del'|'ctx', text, oldLine, newLine } */
export function* hunkLines(h) {
  let o = h.oldStart, n = h.newStart;
  for (const l of h.lines) {
    const c = l[0];
    if (c === '\\') continue;
    if (c === '+') { yield { type: 'add', text: l.slice(1), oldLine: null, newLine: n }; n++; }
    else if (c === '-') { yield { type: 'del', text: l.slice(1), oldLine: o, newLine: null }; o++; }
    else { yield { type: 'ctx', text: l.slice(1), oldLine: o, newLine: n }; o++; n++; }
  }
}
