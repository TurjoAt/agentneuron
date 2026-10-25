// Advisory file claims (soft locks with TTL) shared by every agent process through .agentneuron/claims.json.
// Nothing blocks a filesystem write: a conflicting claim is refused (unless forced) and reported loudly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { agentneuronPath, atomicJson, readJson, FileError } from '../files/paths.js';
import { globMatch } from '../core/glob.js';
import { maskSecretsInText } from '../health/secrets.js';

export const DEFAULT_TTL = 15 * 60000;
export const MAX_TTL = 4 * 3600000;
const MAX_CLAIMS = 500;
const MAX_PATHS = 50;
const LOCK_STALE_MS = 5000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const WILD = /[*?[{]/;
const isGlob = (p) => WILD.test(p);

/** Normalise a project-relative path or glob; throws FileError(400). */
export function cleanPattern(p) {
  if (typeof p !== 'string' || !p.trim() || p.length > 300 || p.includes('\0')) throw new FileError(400, 'invalid path');
  const s = p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) throw new FileError(400, `invalid path: ${p.slice(0, 80)}`);
  return s;
}

/** Agent / session identifiers: short, printable, no separators that could forge another holder. */
export function cleanId(v, fallback, max = 80) {
  const s = typeof v === 'string' ? v.trim().replace(/[^\w.@-]/g, '-').slice(0, max) : '';
  return s || fallback;
}

/** Does pattern `pat` cover concrete path `rel`? A plain path also covers everything below it (a directory). */
export function covers(pat, rel) {
  if (!isGlob(pat)) return rel === pat || rel.startsWith(pat + '/');
  return globMatch(pat, rel) || globMatch(pat + '/**', rel);
}

const staticPrefix = (p) => { const i = p.search(WILD); const head = i < 0 ? p : p.slice(0, i); return head.slice(0, head.lastIndexOf('/') + 1); };

/** Approximate overlap of two patterns: exact for plain paths, conservative (shared static prefix) for two globs. */
export function overlaps(a, b) {
  if (!isGlob(a) && !isGlob(b)) return covers(a, b) || covers(b, a);
  if (!isGlob(a)) return covers(b, a);
  if (!isGlob(b)) return covers(a, b);
  const pa = staticPrefix(a).toLowerCase(), pb = staticPrefix(b).toLowerCase();
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function createClaims(root, { now = Date.now } = {}) {
  const file = () => agentneuronPath(root, 'claims.json');

  /** Cross-process mutex: O_EXCL lockfile, stolen when stale. */
  function locked(fn) {
    const lock = file() + '.lock';
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    let fd = null;
    for (let i = 0; i < 400 && fd === null; i++) {
      try { fd = fs.openSync(lock, 'wx'); } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch { continue; }
        sleep(5);
      }
    }
    if (fd === null) throw new FileError(503, 'claims are busy, try again');
    try { return fn(); } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(lock); } catch { /* ignore */ }
    }
  }

  function load() {
    const d = readJson(file(), null);
    const list = Array.isArray(d?.claims) ? d.claims : [];
    const t = now();
    return list.filter((c) => c && typeof c.pattern === 'string' && Number(c.expiresAt) > t).slice(-MAX_CLAIMS);
  }
  const save = (claims) => atomicJson(file(), { version: 1, claims });
  const key = (c) => `${c.agent}:${c.sessionId}`;
  const view = (c) => ({ id: c.id, pattern: c.pattern, agent: c.agent, sessionId: c.sessionId, taskId: c.taskId || null, note: c.note || '', createdAt: c.createdAt, expiresAt: c.expiresAt });

  /** Claim paths/globs. Conflicting paths are not granted unless `force`; conflicts are always returned. */
  function claim({ agent, sessionId, paths, ttlMs, note, taskId, force = false } = {}) {
    const list = (Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : []).slice(0, MAX_PATHS + 1);
    if (!list.length) throw new FileError(400, 'paths required');
    if (list.length > MAX_PATHS) throw new FileError(400, `at most ${MAX_PATHS} paths per claim`);
    const pats = [...new Set(list.map(cleanPattern))];
    const ttl = Math.max(10000, Math.min(MAX_TTL, Number(ttlMs) || DEFAULT_TTL));
    const who = { agent: cleanId(agent, 'agent', 40), sessionId: cleanId(sessionId, 'default') };
    const n = typeof note === 'string' ? maskSecretsInText(note.trim()).slice(0, 500) : '';
    const tid = typeof taskId === 'string' && /^[\w:.-]{1,120}$/.test(taskId) ? taskId : null;
    return locked(() => {
      const claims = load();
      const t = now();
      const granted = [], conflicts = [];
      for (const pattern of pats) {
        const other = claims.filter((c) => key(c) !== key(who) && overlaps(c.pattern, pattern));
        for (const c of other) conflicts.push({ path: pattern, heldBy: { agent: c.agent, sessionId: c.sessionId }, pattern: c.pattern, expiresAt: c.expiresAt, taskId: c.taskId || null });
        if (other.length && !force) continue;
        const mine = claims.find((c) => key(c) === key(who) && c.pattern === pattern);
        if (mine) Object.assign(mine, { expiresAt: t + ttl, note: n || mine.note, taskId: tid || mine.taskId || null });
        else claims.push({ id: 'c' + crypto.randomBytes(5).toString('hex'), pattern, ...who, taskId: tid, note: n, createdAt: t, expiresAt: t + ttl });
        granted.push(pattern);
      }
      if (claims.length > MAX_CLAIMS) claims.splice(0, claims.length - MAX_CLAIMS);
      save(claims);
      return { granted, conflicts, claims: claims.filter((c) => key(c) === key(who)).map(view) };
    });
  }

  /** Release a holder's claims: all, the given paths, or one claim id. */
  function release({ agent, sessionId, paths, id } = {}) {
    const who = { agent: cleanId(agent, 'agent', 40), sessionId: cleanId(sessionId, 'default') };
    const pats = Array.isArray(paths) && paths.length ? new Set(paths.map(cleanPattern)) : null;
    return locked(() => {
      const claims = load();
      const keep = claims.filter((c) => !(key(c) === key(who) && (id ? c.id === id : !pats || pats.has(c.pattern))));
      save(keep);
      return { released: claims.length - keep.length };
    });
  }

  const list = () => load().map(view);
  /** Active claims covering a concrete project-relative path. */
  const holders = (rel) => load().filter((c) => covers(c.pattern, rel)).map(view);
  let sig = '';
  /** True when claims.json changed since the last call (cheap stat; used by the server to notice other processes). */
  function changed() {
    let s = '';
    try { const st = fs.statSync(file()); s = `${st.mtimeMs}:${st.size}`; } catch { /* none */ }
    if (s === sig) return false;
    sig = s;
    return true;
  }
  return { claim, release, list, holders, changed, file };
}
