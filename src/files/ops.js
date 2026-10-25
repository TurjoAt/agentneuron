// File operations used by routes and actions: save/create/rename/delete(trash)/replace/links.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { isCandidate } from '../core/classify.js';
import { readEntry } from '../core/scanner.js';
import {
  FileError, resolveSafe, cleanRel, atomicWrite, writeNew, readTextIfExists, agentneuronPath, readJson, atomicJson, sha1,
} from './paths.js';
import { rewriteContent, makeIndex, resolveWiki, resolveRel } from './rewrite.js';
import { closestFiles } from './fuzzy.js';

const WALK_CAP = 20000;
const REGEX_BUDGET_MS = 2000; // total CPU time one find/replace request may spend in user regexes
// Files that make agent tools run commands (hooks, MCP stdio servers): writing them needs actions.exec, not just edit.
const EXEC_CONFIG = /(^|\/)(\.claude\/settings(\.local)?\.json|\.mcp\.json|\.cursor\/mcp\.json|\.codex\/config\.toml|\.gemini\/settings\.json)$/;
const cache = new WeakMap();
export function getOps(ctx) {
  if (!cache.has(ctx)) cache.set(ctx, createFileOps(ctx));
  return cache.get(ctx);
}

function walkFiles(abs, rel, out = []) {
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (out.length > WALK_CAP) break;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (e.name === '.git') continue; walkFiles(path.join(abs, e.name), r, out); } else if (e.isFile()) out.push(r);
  }
  return out;
}

export function buildRegex({ q, regex = false, caseSensitive = false, word = false }) {
  if (typeof q !== 'string' || !q) throw new FileError(400, 'q required');
  if (q.length > 500) throw new FileError(400, 'pattern too long');
  let src = regex ? q : q.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  if (word) src = `\\b(?:${src})\\b`;
  let re;
  try { re = new RegExp(src, caseSensitive ? 'g' : 'gi'); } catch (e) { throw new FileError(400, `invalid pattern: ${e.message}`); }
  if (new RegExp(src, caseSensitive ? '' : 'i').test('')) throw new FileError(400, 'pattern matches the empty string');
  return re;
}

export function createFileOps(ctx) {
  const { root, store, config } = ctx;
  const maxSize = config?.maxFileSize ?? 1048576;
  const files = () => store.files;
  const touch = () => { try { ctx.invalidate?.(); } catch { /* ignore */ } };
  const announce = (data) => { try { ctx.broadcast?.('files', data); } catch { /* ignore */ } };

  function assertEditable(rel) {
    if (!isCandidate(rel, config)) throw new FileError(403, 'only tracked project files (markdown and agent config) can be accessed');
  }

  /** assertEditable + files that can make agent tools execute commands need actions.exec. */
  function assertWritable(rel) {
    assertEditable(rel);
    if (EXEC_CONFIG.test(rel) && !(config?.actions && config.actions.exec)) {
      throw new FileError(403, 'this file can make agent tools run commands; enable actions.exec to modify it');
    }
  }

  async function sync(type, rel) {
    try { await store.handleFsEvent({ type, path: rel }); } catch { /* best effort */ }
  }

  /** Core writer: history before + after, atomic write, store update. */
  async function writeFile(rel, abs, content) {
    const before = readTextIfExists(abs);
    if (before) { try { store.history.record(rel, before.content); } catch { /* best effort */ } }
    atomicWrite(abs, content);
    try { store.history.record(rel, content); } catch { /* best effort */ }
    await sync('change', rel);
    touch();
    const r = await readEntry(root, rel, Math.max(maxSize, Buffer.byteLength(content)), config?.extraPatterns || []);
    return { entry: store.files.get(rel) || r?.entry || null, hash: sha1(content), existed: !!before };
  }

  /** Internal helper: write content to a tracked project file (no hash check). */
  async function writeTracked(relIn, content) {
    const { rel, abs } = resolveSafe(root, relIn);
    assertWritable(rel);
    return writeFile(rel, abs, content);
  }

  function readFresh(rel) {
    const r = readTextIfExists(path.join(resolveSafe(root, rel).abs), maxSize);
    return r ? r.content : (store.contents.get(rel) ?? null);
  }

  // ---- raw / save / create ------------------------------------------------
  function readRaw(input) {
    const { rel, abs } = resolveSafe(root, input);
    assertEditable(rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { throw new FileError(404, 'file not found'); }
    if (!st.isFile()) throw new FileError(404, 'not a file');
    if (st.size > maxSize) throw new FileError(413, 'file too large');
    const r = readTextIfExists(abs);
    if (!r) throw new FileError(415, 'binary file');
    return { path: rel, content: r.content, hash: r.hash, mtime: r.mtime };
  }

  async function save({ path: input, content, baseHash }) {
    if (typeof content !== 'string') throw new FileError(400, 'content must be a string');
    if (Buffer.byteLength(content) > maxSize) throw new FileError(413, 'content too large');
    const { rel, abs } = resolveSafe(root, input);
    assertWritable(rel);
    let st = null;
    try { st = fs.lstatSync(abs); } catch { /* new file */ }
    if (st && !st.isFile()) throw new FileError(400, 'not a file');
    if (st && st.size > maxSize) throw new FileError(413, 'file too large');
    const cur = st ? readTextIfExists(abs) : null;
    if (st && !cur) throw new FileError(415, 'binary file');
    if (cur) {
      if (!baseHash || baseHash !== cur.hash) {
        throw new FileError(409, 'file changed on disk', { conflict: true, current: cur.content, currentHash: cur.hash });
      }
      if (cur.content === content) return { entry: store.files.get(rel) || null, hash: cur.hash, unchanged: true };
    } else if (baseHash) {
      throw new FileError(409, 'file was deleted on disk', { conflict: true, current: null, currentHash: null });
    }
    const r = await writeFile(rel, abs, content);
    return { entry: r.entry, hash: r.hash };
  }

  async function create({ path: input, content, template, vars }) {
    let p = input;
    let body = typeof content === 'string' ? content : '';
    if (template) {
      let mod;
      try { mod = await import('../agentcenter/templates.js'); } catch { mod = null; }
      if (!mod || typeof mod.renderTemplate !== 'function') throw new FileError(501, 'templates are not available');
      let out;
      try { out = mod.renderTemplate(template, vars && typeof vars === 'object' ? vars : {}); } catch (e) { throw new FileError(400, String(e.message || e)); }
      if (!out || typeof out.content !== 'string') throw new FileError(404, 'unknown template');
      body = out.content;
      if (!p) p = out.path;
    }
    if (!p) throw new FileError(400, 'path required');
    if (Buffer.byteLength(body) > maxSize) throw new FileError(413, 'content too large');
    const { rel, abs } = resolveSafe(root, p);
    assertWritable(rel);
    if (fs.existsSync(abs)) throw new FileError(409, 'file already exists');
    writeNew(abs, body);
    try { store.history.record(rel, body); } catch { /* ignore */ }
    await sync('add', rel);
    touch();
    announce({ created: rel });
    return { path: rel, entry: store.files.get(rel) || null, hash: sha1(body) };
  }

  // ---- rename / move ------------------------------------------------------
  async function rename({ from, to, rewriteLinks = true, dryRun = false }) {
    const f = resolveSafe(root, from);
    const t = resolveSafe(root, to);
    if (f.rel === t.rel) throw new FileError(400, 'source and destination are the same');
    let st;
    try { st = fs.lstatSync(f.abs); } catch { throw new FileError(404, 'source not found'); }
    const isDir = st.isDirectory();
    if (!isDir && !st.isFile()) throw new FileError(400, 'unsupported file type');
    if (isDir && t.rel.startsWith(f.rel + '/')) throw new FileError(400, 'cannot move a directory into itself');
    if (!isDir) { assertWritable(f.rel); assertWritable(t.rel); } // the destination must be a tracked file type too
    const caseOnly = isCaseAlias(f.abs, t.abs, st);
    if (!caseOnly) try { fs.lstatSync(t.abs); throw new FileError(409, 'destination already exists'); } catch (e) { if (e instanceof FileError) throw e; }

    const moves = new Map();
    if (isDir) {
      for (const r of walkFiles(f.abs, f.rel)) moves.set(r, t.rel + r.slice(f.rel.length));
    } else moves.set(f.rel, t.rel);

    const rewritten = [];
    const pending = []; // {oldPath,newPath,content}
    if (rewriteLinks) {
      const all = new Set([...files().keys(), ...moves.keys()]);
      const index = makeIndex(all);
      const exists = (p) => { try { return fs.existsSync(path.join(root, p)); } catch { return false; } };
      for (const P of files().keys()) {
        const content = readFresh(P);
        if (content == null) continue;
        const newP = moves.get(P) || P;
        const res = rewriteContent({
          from: P, newFrom: newP, content, index, exists, mentions: moves,
          map: (T) => (T && moves.has(T) ? moves.get(T) : undefined),
        });
        if (res.count > 0 && res.content !== content) {
          rewritten.push({ path: newP, count: res.count, edits: res.edits.slice(0, 50) });
          pending.push({ oldPath: P, newPath: newP, before: content, content: res.content });
        }
      }
    }
    const result = { from: f.rel, to: t.rel, rewritten, moved: moves.size };
    if (dryRun) return { ...result, dryRun: true };

    const trackedMoved = [...moves.keys()].filter((p) => files().has(p));
    fs.mkdirSync(path.dirname(t.abs), { recursive: true });
    if (caseOnly) { // case-insensitive FS: go through a temporary name so the new casing sticks
      const tmp = path.join(path.dirname(f.abs), `.${path.basename(f.abs)}.${crypto.randomBytes(4).toString('hex')}.rename`);
      fs.renameSync(f.abs, tmp);
      try { fs.renameSync(tmp, t.abs); } catch (e) { try { fs.renameSync(tmp, f.abs); } catch { /* ignore */ } throw e; }
    } else fs.renameSync(f.abs, t.abs);
    for (const p of pending) {
      try { store.history.record(p.newPath, p.before); } catch { /* ignore */ }
      atomicWrite(resolveSafe(root, p.newPath).abs, p.content);
      try { store.history.record(p.newPath, p.content); } catch { /* ignore */ }
    }
    for (const p of trackedMoved) await sync('unlink', p);
    for (const p of trackedMoved) await sync('add', moves.get(p));
    for (const p of pending) if (!moves.has(p.oldPath)) await sync('change', p.newPath);
    touch();
    announce({ renamed: { from: f.rel, to: t.rel } });
    return result;
  }

  // ---- trash ---------------------------------------------------------------
  const trashDir = () => agentneuronPath(root, 'trash');
  const validId = (id) => typeof id === 'string' && /^[\w-]{3,64}$/.test(id);

  async function remove({ path: input }) {
    const { rel, abs } = resolveSafe(root, input);
    let st;
    try { st = fs.lstatSync(abs); } catch { throw new FileError(404, 'not found'); }
    const isDir = st.isDirectory();
    if (!isDir && !st.isFile()) throw new FileError(400, 'unsupported file type');
    if (!isDir) assertEditable(rel);
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join(trashDir(), id);
    fs.mkdirSync(dir, { recursive: true });
    const tracked = isDir ? [...files().keys()].filter((p) => p.startsWith(rel + '/')) : (files().has(rel) ? [rel] : []);
    const meta = { id, path: rel, type: isDir ? 'dir' : 'file', ts: Date.now(), size: isDir ? 0 : st.size };
    if (!isDir) { const r = readTextIfExists(abs); if (r) meta.hash = r.hash; }
    atomicJson(path.join(dir, 'meta.json'), meta);
    fs.renameSync(abs, path.join(dir, 'data'));
    for (const p of tracked) await sync('unlink', p);
    touch();
    announce({ deleted: rel });
    return { id, path: rel };
  }

  function listTrash() {
    let ids = [];
    try { ids = fs.readdirSync(trashDir()); } catch { return []; }
    const out = [];
    for (const id of ids) {
      const m = readJson(path.join(trashDir(), id, 'meta.json'), null);
      if (m && m.id === id) out.push(m);
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  async function restore({ id }) {
    if (!validId(id)) throw new FileError(400, 'invalid id');
    const dir = path.join(trashDir(), id);
    const meta = readJson(path.join(dir, 'meta.json'), null);
    if (!meta) throw new FileError(404, 'trash entry not found');
    const t = resolveSafe(root, meta.path);
    try { fs.lstatSync(t.abs); throw new FileError(409, 'a file already exists at the original path'); } catch (e) { if (e instanceof FileError) throw e; }
    fs.mkdirSync(path.dirname(t.abs), { recursive: true });
    fs.renameSync(path.join(dir, 'data'), t.abs);
    fs.rmSync(dir, { recursive: true, force: true });
    const added = meta.type === 'dir' ? walkFiles(t.abs, t.rel) : [t.rel];
    for (const p of added) if (isCandidate(p, config)) await sync('add', p);
    touch();
    announce({ restored: t.rel });
    return { id, path: t.rel };
  }

  function purge({ id }) {
    if (!validId(id)) throw new FileError(400, 'invalid id');
    const dir = path.join(trashDir(), id);
    if (!fs.existsSync(dir)) throw new FileError(404, 'trash entry not found');
    fs.rmSync(dir, { recursive: true, force: true });
    return { id };
  }

  // ---- find & replace ------------------------------------------------------
  function targetPaths(paths) {
    if (Array.isArray(paths) && paths.length) {
      const out = [];
      for (const p of paths) { const { rel } = resolveSafe(root, p); assertEditable(rel); out.push(rel); }
      return out;
    }
    return [...files().keys()].sort();
  }

  async function replace({ q, replace: rep = '', regex = false, caseSensitive = false, word = false, paths }, { apply = false } = {}) {
    const re = buildRegex({ q, regex, caseSensitive, word });
    const rs = String(rep ?? '');
    const results = [];
    const changed = [];
    const writes = [];
    const deadline = Date.now() + REGEX_BUDGET_MS;
    const sandbox = vm.createContext({});
    // The user regex runs under a vm watchdog: catastrophic backtracking is interrupted instead of freezing the server.
    const guarded = (fn) => {
      sandbox.fn = fn;
      try { return vm.runInContext('fn()', sandbox, { timeout: Math.max(10, deadline - Date.now()) }); } catch (e) {
        if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new FileError(400, 'pattern is too slow (possible catastrophic backtracking)');
        throw e;
      }
    };
    for (const rel of targetPaths(paths)) {
      const content = readFresh(rel);
      if (content == null) continue;
      const lines = content.split('\n');
      let count = 0;
      let touched = false;
      guarded(() => {
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          if (raw.length > 20000) continue;
          const cr = raw.endsWith('\r');
          const line = cr ? raw.slice(0, -1) : raw;
          let n = 0;
          re.lastIndex = 0;
          const after = regex
            ? line.replace(re, (...a) => { n++; return expandRep(rs, a); })
            : line.replace(re, () => { n++; return rs; });
          if (!n || after === line) continue;
          count += n;
          touched = true;
          if (!apply) { if (results.length < 2000) results.push({ path: rel, line: i + 1, before: line, after }); else break; } else lines[i] = after + (cr ? '\r' : '');
        }
      });
      if (apply && touched) writes.push({ rel, text: lines.join('\n'), count });
      if (!apply && results.length >= 2000) break;
    }
    // writes happen only after every file scanned cleanly, so a timeout never leaves a half-applied replace
    for (const w of writes) { await writeTracked(w.rel, w.text); changed.push({ path: w.rel, count: w.count }); }
    return apply ? { changed } : results;
  }

  // ---- links ---------------------------------------------------------------
  function resolveLink(from, target) {
    const set = new Set(files().keys());
    let t = String(target || '').trim();
    const w = /^\[\[(.+?)\]\]$/.exec(t);
    if (w) t = w[1].split('|')[0];
    if (t.startsWith('@')) t = t.slice(1);
    t = t.split('#')[0].split('?')[0];
    try { t = decodeURIComponent(t); } catch { /* keep */ }
    if (!t) return { path: null, exists: false, candidates: [] };
    const fromRel = from ? cleanRel(from) : '';
    const tries = [];
    if (fromRel) { const r = resolveRel(fromRel, t); if (r) tries.push(r); }
    const rootRel = path.posix.normalize(t.replace(/^\//, ''));
    if (!rootRel.startsWith('..')) tries.push(rootRel);
    let hit = null;
    for (const c of tries) {
      for (const v of [c, c + '.md']) if (set.has(v)) { hit = v; break; }
      if (hit) break;
    }
    if (!hit) {
      for (const c of tries) {
        try {
          const { rel, abs } = resolveSafe(root, c);
          if (fs.lstatSync(abs).isFile()) { hit = rel; break; }
        } catch { /* not there */ }
      }
    }
    if (!hit && !/[#?]/.test(t)) hit = resolveWiki(fromRel, t, makeIndex(set));
    const base = path.posix.basename(t).toLowerCase().replace(/\.[^.]+$/, '');
    const same = [...set].filter((p) => p !== hit && path.posix.basename(p).toLowerCase().replace(/\.[^.]+$/, '') === base).slice(0, 8);
    const candidates = hit ? same : [...new Set([...same, ...closestFiles(t, set, { from: fromRel, limit: 5 })])].slice(0, 8);
    return { path: hit, exists: !!hit, candidates };
  }

  async function backlinks(input) {
    const rel = cleanRel(input);
    const a = await ctx.analysis();
    return (a.graph?.edges || []).filter((l) => l.to === rel && !l.broken && l.from !== rel);
  }

  return {
    readRaw, save, create, rename, remove, listTrash, restore, purge, replace, resolveLink, backlinks,
    writeTracked, readFresh, assertEditable, assertWritable,
  };
}

/**
 * True when `to` differs from `from` only by case and resolves to the very same directory entry
 * (a case-insensitive FS: Windows, macOS). Hard links that happen to differ by case are two entries
 * (readdir lists the target name) and stay a 409.
 */
export function isCaseAlias(from, to, fromStat = fs.lstatSync(from)) {
  if (from === to || from.toLowerCase() !== to.toLowerCase()) return false;
  let ts;
  try { ts = fs.lstatSync(to); } catch { return false; }
  if (ts.ino !== fromStat.ino || ts.dev !== fromStat.dev) return false;
  try { return !fs.readdirSync(path.dirname(to)).includes(path.basename(to)); } catch { return false; }
}

function expandRep(rep, a) {
  // a = [match, ...groups, offset, string, (namedGroups)]
  const hasNamed = typeof a[a.length - 1] === 'object' && a[a.length - 1] !== null;
  const groups = a.slice(1, a.length - (hasNamed ? 3 : 2));
  const named = hasNamed ? a[a.length - 1] : null;
  return rep.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/g, (m, g) => {
    if (g === '$') return '$';
    if (g === '&') return a[0];
    if (g[0] === '<') return named && named[g.slice(1, -1)] !== undefined ? named[g.slice(1, -1)] : '';
    const n = Number(g);
    return n >= 1 && n <= groups.length ? (groups[n - 1] ?? '') : m;
  });
}
