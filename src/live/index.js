// Live agent activity: tails this project's active Claude Code / Codex transcripts incrementally and turns
// them into structured events (agent.session / edit / command / prompt / thinking / collision), correlated
// with the project watcher (pending -> confirmed). Bounded rings, unref'd timers, no full re-reads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectDirName, firstCwd } from '../agents/sessions.js';
import { createConflictRadar } from '../agents/conflicts.js';
import { claudeItems, codexItems } from './extract.js';

const RING_EDITS = 500;
const RING_COMMANDS = 200;
const RING_NOTES = 60;
const RING_COLLISIONS = 50;
const MAX_CHUNK = 4 * 1024 * 1024; // most bytes read from one transcript per poll
const MATCH_MS = 20000; // transcript edit <-> watcher event correlation window
const HUMAN_GRACE_MS = 1500; // wait this long for a transcript before calling a watcher change "human/unknown"
const VERIFY_MS = 1200; // then stat untracked files to confirm an edit landed
const EDITING_MS = 120000;
const FORBIDDEN = new Set(['.git', '.agentneuron', '.mdctl']);
const pad = (n) => String(n).padStart(2, '0');

const push = (ring, item, max) => { ring.push(item); if (ring.length > max) ring.splice(0, ring.length - max); };
/** claude-code / Claude Desktop -> claude, codex-mcp-client -> codex ... (used to tell a session's own claims apart). */
export const family = (agent) => { const a = String(agent || '').toLowerCase(); return /claude/.test(a) ? 'claude' : /codex/.test(a) ? 'codex' : /cursor/.test(a) ? 'cursor' : a; };

function realish(abs) {
  let cur = path.resolve(abs);
  const rest = [];
  for (let i = 0; i < 128; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...rest); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
  return path.resolve(abs);
}

/**
 * @param {object} o
 * @param {string} o.root project root
 * @param {string} [o.home] home dir holding .claude/ and .codex/
 * @param {object} [o.store] core store (for Write diffs against known content and tracked-file checks)
 * @param {(name:string, data:object, kind?:'prompt'|'diff'|'session')=>void} [o.emit] kind marks payloads the caller filters per role
 * @param {{list:Function, holders:Function, changed:Function}} [o.claims]
 * @param {{list:Function, changed:Function}} [o.handoffs]
 */
export function createLive({
  root, home = os.homedir(), store = null, emit = () => {}, claims = null, handoffs = null, now = Date.now,
  pollMs = 750, discoverMs = 3000, idleMs = 90000, endMs = 20 * 60000, activeMs = 15 * 60000,
  backfillBytes = 256 * 1024, collisionWindowMs = 5 * 60000,
} = {}) {
  const absRoot = path.resolve(root);
  const realRoot = realish(absRoot);
  const startedAt = now();
  const files = new Map(); // transcript file -> tail state
  const known = new Map(); // file -> { offset, size } of files seen but not tracked (idle/at startup)
  const sessions = new Map(); // tool:sessionId -> session
  const edits = [], commands = [], notes = [], collisions = [];
  const byPath = new Map(); // rel -> last editor
  const fsRecent = new Map(); // rel -> { ev, at } watcher changes not yet matched to a transcript
  const verify = []; // { rec, at }
  const collSeen = new Map();
  const radar = createConflictRadar({ windowMs: collisionWindowMs, now });
  const dirWatchers = new Map();
  let timers = [];
  let seq = 0;
  let soon = null;
  let closed = false;

  // ---------------------------------------------------------------- confinement
  /** Project-relative POSIX path for a transcript path, or null when it is outside the project (realpath-checked). */
  function confine(raw, cwd) {
    if (typeof raw !== 'string' || !raw || raw.length > 4096 || raw.includes('\0')) return null;
    const base = typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : absRoot;
    const r = path.relative(realRoot, realish(path.isAbsolute(raw) ? raw : path.resolve(base, raw)));
    if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
    const rel = r.split(path.sep).join('/');
    return rel.split('/').some((s) => FORBIDDEN.has(s)) ? null : rel;
  }
  function inRoot(dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return false;
    const r = path.relative(realRoot, realish(dir));
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
  }
  const relDir = (dir) => { const r = inRoot(dir) ? path.relative(realRoot, realish(dir)).split(path.sep).join('/') : null; return r === null ? null : r || '.'; };

  // ---------------------------------------------------------------- discovery
  const claudeDirs = () => {
    const base = path.join(home, '.claude', 'projects');
    return [...new Set([projectDirName(absRoot), projectDirName(realRoot), absRoot.replace(/[\\/]/g, '-')])].map((n) => path.join(base, n));
  };
  const codexDirs = () => {
    const base = path.join(home, '.codex', 'sessions');
    const out = new Set();
    const t = now();
    for (const d of [new Date(t), new Date(t - 864e5)]) {
      out.add(path.join(base, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
      out.add(path.join(base, String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())));
    }
    return [...out];
  };

  function watchDir(dir) {
    if (dirWatchers.has(dir)) return;
    try {
      const w = fs.watch(dir, { persistent: false }, () => kick());
      w.on('error', () => { try { w.close(); } catch { /* gone */ } dirWatchers.delete(dir); });
      dirWatchers.set(dir, w);
    } catch { /* missing dir: polled by discover() */ }
  }

  function discover(initial = false) {
    const want = new Set();
    for (const [kind, dirs] of [['claude', claudeDirs()], ['codex', codexDirs()]]) {
      for (const dir of dirs) {
        let names;
        try { names = fs.readdirSync(dir); } catch { continue; }
        want.add(dir);
        watchDir(dir);
        for (const n of names) {
          if (!n.endsWith('.jsonl')) continue;
          const f = path.join(dir, n);
          if (files.has(f)) continue;
          let st;
          try { st = fs.statSync(f); } catch { continue; }
          if (!st.isFile()) continue;
          const k = known.get(f);
          if (st.mtimeMs < now() - activeMs) { if (!k) known.set(f, { offset: st.size }); continue; }
          if (k && k.ignored) continue;
          track(f, kind, st, initial ? 'backfill' : k ? 'resume' : 'new', k);
        }
      }
    }
    for (const [dir, w] of dirWatchers) if (!want.has(dir)) { try { w.close(); } catch { /* ignore */ } dirWatchers.delete(dir); }
  }

  function track(file, kind, st, mode, k) {
    const T = { file, kind, offset: 0, st: { tool: kind, sessionId: kind === 'claude' ? path.basename(file, '.jsonl') : null, cwd: null, curCwd: null }, inRoot: kind === 'claude' ? true : null, calls: new Map(), tries: 0 };
    if (kind === 'codex') {
      const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file);
      if (m) T.st.sessionId = m[1];
    }
    files.set(file, T);
    known.delete(file);
    if (mode === 'resume') T.offset = Math.min(k.offset, st.size);
    else if (mode === 'backfill' || st.size > backfillBytes * 4) {
      // seed recent history quietly (not broadcast), then go live from EOF
      T.offset = Math.max(0, st.size - backfillBytes);
      if (T.offset > 0) T.skipPartial = true;
      if (kind === 'codex' || T.offset > 0) headMeta(T);
      read(T, st.size, true);
      if (mode === 'backfill') return;
    }
  }

  /** cwd/session id from the head of a transcript when the tail is parsed alone. */
  function headMeta(T) {
    const cwd = firstCwd(T.file);
    if (cwd) { T.st.cwd = T.st.cwd || cwd; T.st.curCwd = T.st.curCwd || cwd; }
    if (T.kind === 'codex' && cwd) T.inRoot = inRoot(cwd);
  }

  // ---------------------------------------------------------------- tailing
  function read(T, size, hist) {
    if (size <= T.offset) return;
    let fd;
    try {
      fd = fs.openSync(T.file, 'r');
      let start = T.offset;
      if (size - start > MAX_CHUNK) { start = size - MAX_CHUNK; T.skipPartial = true; }
      const buf = Buffer.alloc(size - start);
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      let b = buf.subarray(0, n);
      let base = start;
      if (T.skipPartial) {
        const nl = b.indexOf(0x0a);
        if (nl < 0) { T.offset = start + n; return; }
        b = b.subarray(nl + 1); base += nl + 1; T.skipPartial = false;
      }
      const end = b.lastIndexOf(0x0a);
      if (end < 0) { T.offset = base; return; }
      T.offset = base + end + 1;
      for (const line of b.subarray(0, end).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        try { handle(T, o, hist); } catch { /* one bad line must not stop the tail */ }
      }
      if (!hist) for (const S of sessions.values()) if (S.dirty) { S.dirty = false; emitSession(S); }
    } catch { /* unreadable right now: retry next poll */ } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  const prevOf = (fp, st) => { const rel = confine(fp, st.curCwd || st.cwd); return rel && store?.contents?.has?.(rel) ? store.contents.get(rel) : null; };
  const skey = (tool, id) => `${tool}:${id}`;

  function sessionOf(T, ts, hist) {
    if (!T.st.sessionId) T.st.sessionId = path.basename(T.file, '.jsonl').slice(-60);
    const key = skey(T.kind, T.st.sessionId);
    let S = sessions.get(key);
    if (!S) {
      S = { tool: T.kind, sessionId: T.st.sessionId, title: T.st.title || null, model: T.st.model || null, cwd: relDir(T.st.cwd), state: 'start', startedAt: ts || now(), lastAt: ts || now(), edits: 0, commands: 0, lastPrompt: null, lastThinking: null, promptTitle: null };
      sessions.set(key, S);
      if (sessions.size > 300) for (const [k, v] of sessions) if (v.state === 'end') { sessions.delete(k); if (sessions.size <= 200) break; }
      if (hist) S.state = now() - S.lastAt > idleMs ? 'idle' : 'active';
      else S.dirty = true;
    } else if (!hist && (S.state === 'idle' || S.state === 'end')) { S.state = 'active'; S.lastAt = Math.max(S.lastAt, ts || now()); }
    if (!hist) S.dirty = true; // announced once per read batch (title, counts, model, state)
    if (ts) S.lastAt = Math.max(S.lastAt, ts);
    else if (!hist) S.lastAt = now();
    return S;
  }
  const sessionView = (S) => ({ tool: S.tool, sessionId: S.sessionId, state: S.state, title: S.title, model: S.model, cwd: S.cwd, startedAt: S.startedAt, lastAt: S.lastAt, edits: S.edits, commands: S.commands, promptTitle: S.promptTitle, lastPrompt: S.lastPrompt, lastThinking: S.lastThinking });
  function emitSession(S) {
    emit('agent.session', { ...sessionView(S), ts: now() }, 'session');
  }

  function handle(T, o, hist) {
    const items = T.kind === 'claude' ? claudeItems(o, T.st, prevOf) : codexItems(o, T.st);
    for (const it of items) {
      if (it.kind === 'meta') {
        if (it.sessionId && !T.st.sessionId) T.st.sessionId = it.sessionId;
        if (it.sessionId && T.kind === 'codex') T.st.sessionId = it.sessionId;
        if (it.cwd) { T.st.cwd = T.st.cwd || it.cwd; T.st.curCwd = it.cwd; if (T.kind === 'codex') T.inRoot = inRoot(it.cwd) || (T.inRoot === true && inRoot(T.st.cwd)); }
        if (it.model) T.st.model = it.model;
        if (it.title) T.st.title = it.title;
        const S = T.inRoot && T.st.sessionId ? sessions.get(skey(T.kind, T.st.sessionId)) : null;
        if (S) { if (it.model) S.model = it.model; if (it.title) S.title = it.title; if (!S.cwd && T.st.cwd) S.cwd = relDir(T.st.cwd); }
        continue;
      }
      if (!T.inRoot) continue; // a Codex session of another project: nothing leaves
      const S = sessionOf(T, it.ts, hist);
      if (T.st.model && !S.model) S.model = T.st.model;
      if (it.kind === 'edit') onEdit(T, S, it, hist);
      else if (it.kind === 'command') {
        const rec = { id: `${S.tool}:${S.sessionId}:${it.id || ++seq}`, tool: S.tool, sessionId: S.sessionId, cmd: it.cmd, ts: it.ts || now() };
        S.commands++;
        push(commands, rec, RING_COMMANDS);
        if (it.id) remember(T, it.id, rec);
        if (!hist) emit('agent.command', rec);
      } else if (it.kind === 'result') onResult(T, it, hist);
      else if (it.kind === 'prompt' || it.kind === 'thinking') {
        if (it.kind === 'prompt') { S.lastPrompt = it.text; if (!S.promptTitle) S.promptTitle = it.text.slice(0, 120); } else S.lastThinking = it.text;
        const n = { type: it.kind, tool: S.tool, sessionId: S.sessionId, text: it.text, ts: it.ts || now() };
        push(notes, n, RING_NOTES);
        if (!hist) emit(`agent.${it.kind}`, n, 'prompt');
      }
    }
  }

  function remember(T, id, rec) {
    const cur = T.calls.get(id);
    T.calls.set(id, cur ? [].concat(cur, rec) : rec);
    if (T.calls.size > 500) T.calls.delete(T.calls.keys().next().value);
  }

  function onEdit(T, S, it, hist) {
    const rel = confine(it.file, T.st.curCwd || T.st.cwd);
    if (!rel) return; // outside the project (or .git/.agentneuron): ignored
    const ts = it.ts || now();
    const rec = {
      id: `${S.tool}:${S.sessionId}:${it.id || 'e'}:${++seq}`, tool: S.tool, sessionId: S.sessionId, path: rel, op: it.op,
      linesAdded: it.linesAdded, linesRemoved: it.linesRemoved, hunk: it.hunk, truncated: !!it.truncated,
      status: hist ? 'unverified' : 'pending', ts, source: 'transcript',
    };
    if (it.from) { const from = confine(it.from, T.st.curCwd || T.st.cwd); if (from) rec.from = from; }
    S.edits++;
    push(edits, rec, RING_EDITS);
    if (it.id) remember(T, it.id, rec);
    byPath.set(rel, { path: rel, tool: S.tool, sessionId: S.sessionId, op: rec.op, ts, id: rec.id });
    if (byPath.size > 2000) byPath.delete(byPath.keys().next().value);
    if (hist) return;
    const w = fsRecent.get(rel);
    if (w && Math.abs(w.ev.ts - ts) <= MATCH_MS) { rec.status = 'confirmed'; fsRecent.delete(rel); }
    else verify.push({ rec, at: now() + VERIFY_MS });
    if (verify.length > 1000) verify.splice(0, verify.length - 1000);
    emit('agent.edit', rec, 'diff');
    noteCollision(S, rel, ts);
  }

  function onResult(T, it, hist) {
    const ref = it.id ? T.calls.get(it.id) : null;
    if (!ref) return;
    for (const rec of [].concat(ref)) {
      if (rec.cmd !== undefined) {
        rec.ok = it.ok;
        if (it.exitCode !== undefined) rec.exitCode = it.exitCode;
        else if (!it.ok) rec.exitCode = rec.exitCode ?? 1;
        if (!hist) emit('agent.command', rec);
      } else {
        let changed = false;
        if (it.type === 'create' && rec.op === 'write') { rec.op = 'create'; changed = true; }
        if (!it.ok && rec.status !== 'failed') { rec.status = 'failed'; changed = true; }
        if (changed && !hist) emit('agent.edit', rec, 'diff');
      }
    }
    T.calls.delete(it.id);
  }

  function noteCollision(S, rel, ts) {
    const agent = { tool: S.tool, sessionId: S.sessionId, title: S.title || undefined };
    radar.note({ path: rel, agent, ts });
    const hit = radar.active(now()).find((c) => c.path === rel);
    if (hit) raise({ path: rel, reason: 'overlap', sessions: hit.agents.map((a) => ({ tool: a.tool, sessionId: a.sessionId, title: a.title })), ts });
    if (!claims) return;
    let held = [];
    try { held = claims.holders(rel); } catch { /* unreadable claims: no warning */ }
    // a claim is "someone else's" when its agent family differs, or it names another session we can see
    const foreign = held.filter((c) => family(c.agent) !== S.tool || (c.sessionId !== S.sessionId && sessions.has(skey(family(c.agent), c.sessionId))));
    for (const c of foreign) raise({ path: rel, reason: 'claim', sessions: [{ tool: S.tool, sessionId: S.sessionId, title: S.title }], claim: { agent: c.agent, sessionId: c.sessionId, pattern: c.pattern, expiresAt: c.expiresAt, taskId: c.taskId }, ts });
  }
  function raise(c) {
    const k = `${c.reason}:${c.path}:${c.sessions.map((s) => s.sessionId).sort().join(',')}`;
    if (now() - (collSeen.get(k) || 0) < 60000) return;
    collSeen.set(k, now());
    if (collSeen.size > 500) collSeen.delete(collSeen.keys().next().value);
    push(collisions, c, RING_COLLISIONS);
    emit('agent.collision', c);
  }

  // ---------------------------------------------------------------- watcher correlation
  /** Store event ({type, path, ts, stats, agent}) from the project watcher. */
  function onFsEvent(ev) {
    if (closed || !ev || typeof ev.path !== 'string') return;
    const ts = Number(ev.ts) || now();
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i];
      if (ts - e.ts > MATCH_MS) break;
      if (e.path !== ev.path || e.source !== 'transcript' || Math.abs(ts - e.ts) > MATCH_MS) continue;
      if (e.status === 'pending' || e.status === 'unverified') { e.status = 'confirmed'; emit('agent.edit', e, 'diff'); }
      return;
    }
    fsRecent.set(ev.path, { ev, at: now() });
    if (fsRecent.size > 500) fsRecent.delete(fsRecent.keys().next().value);
  }

  function settle() {
    const t = now();
    for (const [rel, w] of fsRecent) {
      if (t - w.at < HUMAN_GRACE_MS) continue;
      fsRecent.delete(rel);
      const a = w.ev.agent && typeof w.ev.agent === 'object' ? w.ev.agent : null;
      const rec = {
        id: `watch:${w.ev.id ?? ++seq}:${++seq}`, tool: a?.tool || 'human', sessionId: a?.sessionId || null, path: rel,
        op: w.ev.type === 'add' ? 'create' : w.ev.type === 'unlink' ? 'delete' : 'edit',
        linesAdded: w.ev.stats?.added || 0, linesRemoved: w.ev.stats?.removed || 0, hunk: [], truncated: false,
        status: 'confirmed', ts: Number(w.ev.ts) || t, source: 'watcher',
      };
      if (w.ev.historyId) rec.historyId = w.ev.historyId;
      push(edits, rec, RING_EDITS);
      byPath.set(rel, { path: rel, tool: rec.tool, sessionId: rec.sessionId, op: rec.op, ts: rec.ts, id: rec.id });
      emit('agent.edit', rec, 'diff');
    }
    while (verify.length && verify[0].at <= t) {
      const { rec } = verify.shift();
      if (rec.status !== 'pending') continue;
      let st = null;
      try { st = fs.statSync(path.join(realRoot, rec.path)); } catch { /* missing */ }
      const landed = rec.op === 'delete' ? !st : !!st && st.mtimeMs >= rec.ts - 5000;
      if (landed) { rec.status = 'confirmed'; emit('agent.edit', rec, 'diff'); }
    }
  }

  // ---------------------------------------------------------------- loop
  function poll() {
    if (closed) return;
    for (const T of files.values()) {
      let st;
      try { st = fs.statSync(T.file); } catch { files.delete(T.file); continue; }
      if (st.size < T.offset) T.offset = 0; // truncated / replaced
      if (T.kind === 'codex' && T.inRoot === null) {
        headMeta(T);
        if (T.inRoot === null && ++T.tries > 40) T.inRoot = false;
        if (T.inRoot === null) continue;
      }
      if (T.kind === 'codex' && T.inRoot === false) { files.delete(T.file); known.set(T.file, { offset: st.size, ignored: true }); continue; }
      if (st.size > T.offset) read(T, st.size, false);
      T.mtimeMs = st.mtimeMs;
      if (now() - st.mtimeMs > activeMs) { files.delete(T.file); known.set(T.file, { offset: T.offset, ignored: T.inRoot === false }); }
    }
    settle();
    const t = now();
    for (const S of sessions.values()) {
      const idle = t - S.lastAt;
      if (S.state !== 'end' && idle > endMs) { S.state = 'end'; emitSession(S); } else if ((S.state === 'start' || S.state === 'active') && idle > idleMs) { S.state = 'idle'; emitSession(S); } else if (S.state === 'start' && idle > 5000) S.state = 'active';
    }
    try { if (claims?.changed()) emit('agent.claims', { claims: claims.list() }); } catch { /* ignore */ }
    try { if (handoffs?.changed()) emit('agent.handoff', { handoffs: handoffs.list({ limit: 20 }) }); } catch { /* ignore */ }
  }

  function kick() {
    if (soon || closed) return;
    soon = setTimeout(() => { soon = null; discover(); poll(); }, 60);
    soon.unref?.();
  }

  function start({ timers: useTimers = true } = {}) {
    try { claims?.changed(); handoffs?.changed(); } catch { /* prime */ }
    discover(true);
    if (useTimers && pollMs > 0) {
      const a = setInterval(poll, pollMs); a.unref?.();
      const b = setInterval(() => discover(), discoverMs); b.unref?.();
      timers = [a, b];
    }
    return api;
  }

  function close() {
    closed = true;
    for (const t of timers) clearInterval(t);
    clearTimeout(soon);
    for (const w of dirWatchers.values()) { try { w.close(); } catch { /* ignore */ } }
    dirWatchers.clear();
    files.clear();
  }

  /** Snapshot for GET /api/live. Prompts/diffs are included here; the route strips them per role. */
  function snapshot() {
    const t = now();
    const editing = [...byPath.values()].filter((e) => t - e.ts < EDITING_MS).sort((a, b) => b.ts - a.ts).slice(0, 100);
    return {
      now: t, startedAt,
      sessions: [...sessions.values()].filter((s) => s.state !== 'end' || t - s.lastAt < 3600000).sort((a, b) => b.lastAt - a.lastAt).slice(0, 100).map(sessionView),
      edits: edits.slice(), commands: commands.slice(), notes: notes.slice(), editing,
      collisions: collisions.slice(),
      claims: claims ? claims.list() : [],
      handoffs: handoffs ? handoffs.list({ limit: 20 }) : [],
    };
  }

  const api = { start, close, poll, discover, settle, onFsEvent, snapshot, confine, files, sessions };
  return api;
}
