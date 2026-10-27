// #10 Safe checkpoints: working-tree snapshots stored as commits under refs/agentneuron/checkpoints/<id>.
// Created with a temporary GIT_INDEX_FILE (the real index, HEAD and branches are never touched).
// Selective restore writes only the chosen paths; an automatic checkpoint of the current state is taken first.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runGit, cleanRelPath } from '../git2/run.js';
import { repoInfo, hasHead } from './diff.js';
import { resolveSafe, atomicWrite } from '../files/paths.js';
import { readRegularAsync } from '../files/safeio.js';

export const REF_PREFIX = 'refs/agentneuron/checkpoints/';
const ID_RE = /^[A-Za-z0-9][\w-]{0,63}$/;
const MAX_UNTRACKED_FILE = 20 * 1024 * 1024;
const MAX_UNTRACKED_COUNT = 20000;
const MAX_LISTED_FILES = 500;
const MAX_TEXT = 512 * 1024;
const ID_ENV = { GIT_AUTHOR_NAME: 'agentneuron', GIT_AUTHOR_EMAIL: 'agentneuron@localhost', GIT_COMMITTER_NAME: 'agentneuron', GIT_COMMITTER_EMAIL: 'agentneuron@localhost' };
const SOURCES = new Set(['manual', 'auto', 'task']);
const META = 'agentneuron-checkpoint: ';

const fail = (status, m) => Object.assign(new Error(m), { status });
export const validId = (id) => typeof id === 'string' && ID_RE.test(id);
function idOrThrow(id) { if (!validId(id)) throw fail(400, 'invalid checkpoint id'); return id; }

function newId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${String(d.getUTCMilliseconds()).padStart(3, '0')}-${crypto.randomBytes(3).toString('hex')}`;
}
const clip = (s, n) => (typeof s === 'string' ? s.replace(/[\r\n\0]+/g, ' ').trim().slice(0, n) : '');

async function git(root, args, opts) {
  const r = await runGit(root, args, opts);
  if (!r.ok) throw fail(500, String(r.err || `git ${args[0]} failed`).trim().split('\n').slice(-2).join(' '));
  return r;
}
async function requireRepo(root) {
  const info = await repoInfo(root);
  if (!info.ok) throw fail(409, info.reason);
  return info;
}

function parseMeta(msg) {
  for (const l of String(msg || '').split('\n')) {
    if (!l.startsWith(META)) continue;
    try { const v = JSON.parse(l.slice(META.length)); return v && typeof v === 'object' ? v : null; } catch { return null; }
  }
  return null;
}

function toCheckpoint(ref, hash, created, msg) {
  const meta = parseMeta(msg) || {};
  return {
    id: ref.slice(REF_PREFIX.length), ref, hash, label: typeof meta.label === 'string' ? meta.label : '',
    createdAt: Number(created) * 1000 || null, base: typeof meta.base === 'string' ? meta.base : null,
    files: Array.isArray(meta.files) ? meta.files.filter((f) => typeof f === 'string') : [],
    filesTruncated: meta.filesTruncated === true,
    source: SOURCES.has(meta.source) ? meta.source : 'manual',
    task: typeof meta.task === 'string' ? meta.task : null, session: typeof meta.session === 'string' ? meta.session : null,
    branch: typeof meta.branch === 'string' ? meta.branch : null,
  };
}

/** Checkpoints, newest first. Read-only (one for-each-ref). Shape per docs/internal/quality-contract.md. */
export async function listCheckpoints(root, { limit = 50 } = {}) {
  const info = await repoInfo(root);
  if (!info.ok) return [];
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const US = '\x1f', RS = '\x1e';
  const r = await runGit(root, ['for-each-ref', '--sort=-refname', `--count=${n}`, `--format=%(refname)${US}%(objectname)${US}%(creatordate:unix)${US}%(contents)${RS}`, REF_PREFIX]);
  if (!r.ok) return [];
  const out = [];
  for (const chunk of r.out.split(RS)) {
    const c = chunk.replace(/^\n+/, '');
    if (!c) continue;
    const [ref, hash, created, msg] = c.split(US);
    if (!ref || !ref.startsWith(REF_PREFIX)) continue;
    out.push(toCheckpoint(ref, hash, created, msg));
  }
  return out;
}

export async function getCheckpoint(root, id) {
  idOrThrow(id);
  const r = await runGit(root, ['for-each-ref', `--format=%(refname)\x1f%(objectname)\x1f%(creatordate:unix)\x1f%(contents)`, REF_PREFIX + id]);
  const [ref, hash, created, msg] = (r.ok ? r.out : '').replace(/\n$/, '').split('\x1f');
  if (!r.ok || ref !== REF_PREFIX + id) throw fail(404, 'checkpoint not found');
  return toCheckpoint(ref, hash, created, msg);
}

/** Paths that differ between HEAD and the working tree incl. untracked (read-only). */
async function dirtyPaths(root) {
  const r = await runGit(root, ['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = r.out.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1];
    if (x === '!') continue;
    out.push(e.slice(3));
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
  }
  return out;
}

/**
 * Create a checkpoint of the working tree (tracked + untracked, ignored files excluded).
 * opts: { label, source: 'manual'|'auto'|'task', task, session }. Returns the checkpoint + `skipped` (untracked files over 20 MB).
 */
export async function createCheckpoint(root, opts = {}) {
  await requireRepo(root);
  const source = SOURCES.has(opts.source) ? opts.source : 'manual';
  const headOk = await hasHead(root);
  const base = headOk ? (await git(root, ['rev-parse', 'HEAD'])).out.trim() : null;
  const branch = headOk ? ((await runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).out.trim() || null) : null;
  const realIndex = path.resolve(root, (await git(root, ['rev-parse', '--git-path', 'index'])).out.trim());
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentneuron-cp-'));
  const tmpIndex = path.join(tmpDir, 'index');
  const env = { GIT_INDEX_FILE: tmpIndex, ...ID_ENV };
  const skipped = [];
  try {
    try { await fsp.copyFile(realIndex, tmpIndex); } catch { /* no index yet: start empty */ }
    const u = await runGit(root, ['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard', '-z']);
    const untracked = u.out.split('\0').filter(Boolean);
    if (untracked.length > MAX_UNTRACKED_COUNT) throw fail(413, `too many untracked files (${untracked.length}); add them to .gitignore first`);
    for (const p of untracked) {
      let st; try { st = await fsp.lstat(path.join(root, p)); } catch { continue; }
      if (st.isFile() && st.size > MAX_UNTRACKED_FILE) skipped.push(p);
    }
    const excludes = skipped.slice(0, 2000).map((p) => `:(exclude,literal)${p}`);
    await git(root, ['add', '-A', '--', '.', ...excludes], { env, timeout: 120000 });
    const tree = (await git(root, ['write-tree'], { env })).out.trim();
    const dirty = await dirtyPaths(root);
    const meta = {
      label: clip(opts.label, 200), source, task: clip(opts.task, 120) || null, session: clip(opts.session, 120) || null,
      base, branch, files: dirty.slice(0, MAX_LISTED_FILES), filesTruncated: dirty.length > MAX_LISTED_FILES,
    };
    const msg = `agentneuron checkpoint${meta.label ? `: ${meta.label}` : ''}\n\n${META}${JSON.stringify(meta)}\n`;
    const commit = (await git(root, ['commit-tree', tree, ...(base ? ['-p', base] : []), '-m', msg], { env })).out.trim();
    let id = newId();
    for (let i = 0; ; i++) {
      const r = await runGit(root, ['update-ref', REF_PREFIX + id, commit, ''], { env: ID_ENV });
      if (r.ok) break;
      if (i === 2) throw fail(500, String(r.err || 'update-ref failed').trim());
      id = newId();
    }
    return { ...toCheckpoint(REF_PREFIX + id, commit, Math.floor(Date.now() / 1000), msg), skipped };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function deleteCheckpoint(root, id) {
  idOrThrow(id);
  await requireRepo(root);
  const ref = REF_PREFIX + id;
  if (!(await runGit(root, ['rev-parse', '--verify', '--quiet', ref])).ok) throw fail(404, 'checkpoint not found');
  await git(root, ['update-ref', '-d', ref]);
  return { id, deleted: true };
}

/** Keep the newest `keep` checkpoints, delete the rest. */
export async function pruneCheckpoints(root, { keep = 20 } = {}) {
  const all = await listCheckpoints(root, { limit: 500 });
  const k = Math.max(0, Math.floor(Number(keep) || 0));
  const gone = [];
  for (const c of all.slice(k)) { await deleteCheckpoint(root, c.id); gone.push(c.id); }
  return { kept: Math.min(k, all.length), deleted: gone };
}

// ---- checkpoint vs now (read-only git only) ----------------------------------------

/** Map path -> { mode, oid } of a commit, cwd-relative. */
async function treeMap(root, commit) {
  const r = await git(root, ['-c', 'core.quotepath=off', 'ls-tree', '-r', '-z', commit]);
  const m = new Map();
  for (const e of r.out.split('\0')) {
    const mm = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(e);
    if (mm && (mm[2] === 'blob' || mm[2] === 'commit')) m.set(mm[4], { mode: mm[1], oid: mm[3] });
  }
  return m;
}

/** Hash working-tree files the way `git add` would, without writing objects (no -w). */
async function hashFiles(root, paths) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200);
    const r = await runGit(root, ['hash-object', '--', ...chunk]);
    if (r.ok) { r.out.split('\n').filter(Boolean).forEach((h, k) => out.set(chunk[k], h.trim())); continue; }
    for (const p of chunk) { const s = await runGit(root, ['hash-object', '--', p]); if (s.ok) out.set(p, s.out.trim()); }
  }
  return out;
}

/**
 * Per-file comparison of a checkpoint with the working tree now.
 * -> { checkpoint, files: [{ path, status: 'same'|'changed'|'deleted'|'added', added, removed }], truncated }
 *   changed = differs now, deleted = in the checkpoint but gone now, added = new since the checkpoint.
 * `same` is listed only for files that were dirty when the checkpoint was taken.
 */
export async function compareCheckpoint(root, id) {
  const cp = await getCheckpoint(root, id);
  const q = ['-c', 'core.quotepath=off'];
  const [tree, tracked, untracked, diffNs, diffNum] = await Promise.all([
    treeMap(root, cp.hash),
    runGit(root, [...q, 'ls-files', '-z', '--cached']),
    runGit(root, [...q, 'ls-files', '-z', '--others', '--exclude-standard']),
    runGit(root, [...q, 'diff', '--no-renames', '--relative', '--name-status', '-z', cp.hash, '--']),
    runGit(root, [...q, 'diff', '--no-renames', '--relative', '--numstat', '-z', cp.hash, '--']),
  ]);
  const trackedSet = new Set(tracked.out.split('\0').filter(Boolean));
  const untrackedSet = new Set(untracked.out.split('\0').filter(Boolean));
  const nums = new Map();
  for (const e of diffNum.out.split('\0')) { const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(e); if (m) nums.set(m[3], { added: m[1] === '-' ? 0 : +m[1], removed: m[2] === '-' ? 0 : +m[2] }); }
  const res = new Map();
  const exists = (p) => fsp.lstat(path.join(root, p)).then(() => true, () => false);
  const parts = diffNs.out.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const st = parts[i][0], p = parts[i + 1];
    if (!st || !p) continue;
    if (!trackedSet.has(p)) continue; // not in the index: decided below from the tree and the untracked list
    if (st === 'A' && !(await exists(p))) continue;
    res.set(p, { path: p, status: st === 'A' ? 'added' : st === 'D' ? 'deleted' : 'changed', ...(nums.get(p) || { added: 0, removed: 0 }) });
  }
  const toHash = [];
  for (const p of tree.keys()) {
    if (trackedSet.has(p)) continue;
    if (untrackedSet.has(p)) toHash.push(p);
    else res.set(p, { path: p, status: 'deleted', added: 0, removed: 0 });
  }
  const hashes = await hashFiles(root, toHash.slice(0, 5000));
  for (const p of toHash) res.set(p, { path: p, status: hashes.get(p) === tree.get(p).oid ? 'same' : 'changed', added: 0, removed: 0 });
  for (const p of untrackedSet) if (!tree.has(p)) res.set(p, { path: p, status: 'added', added: 0, removed: 0 });
  for (const p of cp.files) if (!res.has(p) && tree.has(p)) res.set(p, { path: p, status: 'same', added: 0, removed: 0 });
  const ORDER = { changed: 0, deleted: 1, added: 2, same: 3 };
  const files = [...res.values()].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.path.localeCompare(b.path));
  return { checkpoint: cp, files: files.slice(0, 2000), truncated: files.length > 2000 };
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
/** Checkpoint content of one path, with the repo's smudge filters (line endings) applied. */
async function blob(root, oid, p) {
  let r = await runGit(root, ['cat-file', '--filters', `--path=${p}`, oid], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (!r.ok) r = await runGit(root, ['cat-file', 'blob', oid], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (!r.ok) throw fail(500, 'could not read checkpoint content');
  return r.out;
}

/** Text of one path in the checkpoint (`before`) and now (`after`). null = absent; binary content is never returned. */
export async function checkpointFileDiff(root, id, rel) {
  const cp = await getCheckpoint(root, id);
  const c = cleanRelPath(root, rel);
  if (!c) throw fail(400, 'invalid path');
  const p = c.replace(/^\.\//, '');
  const tree = await treeMap(root, cp.hash);
  const t = tree.get(p);
  const text = (buf) => (buf == null ? { text: null } : isBinary(buf) ? { text: null, binary: true } : buf.length > MAX_TEXT ? { text: buf.subarray(0, MAX_TEXT).toString('utf8'), truncated: true } : { text: buf.toString('utf8') });
  const b = t && t.mode !== '160000' ? text(await blob(root, t.oid, p)) : { text: null };
  let a = { text: null };
  try {
    const { abs } = resolveSafe(root, p);
    const r = await readRegularAsync(abs, { maxBytes: 64 * 1024 * 1024 });
    if (r) a = text(r.buf);
  } catch { /* outside the project or not accessible: absent */ }
  return { path: p, before: b.text, after: a.text, binary: !!(b.binary || a.binary), truncated: !!(b.truncated || a.truncated) };
}

/**
 * What a selective restore of `paths` would do -> { checkpoint, files: [{ path, action: 'overwrite'|'create'|'delete'|'skip', reason? }] }.
 * Paths unchanged since the checkpoint are skipped.
 */
export async function planRestore(root, id, paths) {
  if (!Array.isArray(paths) || !paths.length) throw fail(400, 'paths required');
  if (paths.length > 1000) throw fail(400, 'too many paths');
  const cmp = await compareCheckpoint(root, id);
  const byPath = new Map(cmp.files.map((f) => [f.path, f]));
  const tree = await treeMap(root, cmp.checkpoint.hash);
  const files = [];
  const seen = new Set();
  for (const raw of paths) {
    const c = cleanRelPath(root, raw);
    if (!c) throw fail(400, `invalid path: ${String(raw).slice(0, 80)}`);
    const p = c.replace(/^\.\//, '');
    if (seen.has(p)) continue;
    seen.add(p);
    try { resolveSafe(root, p); } catch (e) { files.push({ path: p, action: 'skip', reason: e.message }); continue; }
    const f = byPath.get(p);
    const t = tree.get(p);
    if (!f || f.status === 'same') { files.push({ path: p, action: 'skip', reason: 'unchanged since the checkpoint' }); continue; }
    if (t && t.mode === '120000') { files.push({ path: p, action: 'skip', reason: 'symlinks are not restored' }); continue; }
    if (t && t.mode === '160000') { files.push({ path: p, action: 'skip', reason: 'submodules are not restored' }); continue; }
    files.push({ path: p, action: f.status === 'added' ? 'delete' : f.status === 'deleted' ? 'create' : 'overwrite' });
  }
  return { checkpoint: cmp.checkpoint, files };
}

/**
 * Restore only `paths` to their checkpoint content. An automatic checkpoint of the current state is taken first.
 * Never touches HEAD, the index, branches or other files. -> { restored, skipped, undo }
 */
export async function restoreCheckpoint(root, id, paths, { log } = {}) {
  const plan = await planRestore(root, id, paths);
  const todo = plan.files.filter((f) => f.action !== 'skip');
  if (!todo.length) return { restored: [], skipped: plan.files, undo: null };
  const undo = await createCheckpoint(root, { label: `before restoring ${todo.length} file(s) from ${id}`, source: 'auto' });
  log?.(`undo point: checkpoint ${undo.id}`);
  const tree = await treeMap(root, plan.checkpoint.hash);
  const restored = [];
  for (const f of todo) {
    const { abs } = resolveSafe(root, f.path); // re-checked right before writing: no symlinked parents, stays inside root
    if (f.action === 'delete') {
      try { await fsp.unlink(abs); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } else {
      const t = tree.get(f.path);
      atomicWrite(abs, await blob(root, t.oid, f.path));
      try {
        const cur = fs.statSync(abs).mode & 0o777;
        await fsp.chmod(abs, t.mode === '100755' ? cur | ((cur & 0o444) >> 2) : cur & ~0o111);
      } catch { /* best effort */ }
    }
    restored.push(f);
    log?.(`${f.action} ${f.path}`);
  }
  return { restored, skipped: plan.files.filter((f) => f.action === 'skip'), undo };
}
