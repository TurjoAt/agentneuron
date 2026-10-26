// Async discovery of the transcripts in scope: Claude Code project dirs (+ subagents) and Codex rollouts.
// No synchronous walks: this runs on request paths.
import path from 'node:path';
import { projectDirName } from '../agents/sessions.js';
import { listCodexTranscriptsAsync } from '../agentcenter/transcript.js';
import { safeReaddir, safeStat, safeRead } from './guard.js';

const TTL = 30000;
const SID = /^[\w.-]{1,200}$/;
const dirCache = new Map(); // `${home}|${root}` -> { at, dirs }
const codexCache = new Map(); // home -> { at, files }

const projectsDir = (home) => path.join(home, '.claude', 'projects');

async function headCwd(file, home) {
  const r = await safeRead(file, home, { head: 65536 }).catch(() => null);
  if (!r) return null;
  const text = r.buf.toString('utf8');
  const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

/** Claude Code project dirs for this scope: [{ dir, name }]. */
export async function claudeProjectDirs({ root, home, scope = 'project' }) {
  const base = projectsDir(home);
  const ents = (await safeReaddir(base, home)).filter((e) => e.isDirectory());
  if (scope === 'all') return ents.map((e) => ({ dir: path.join(base, e.name), name: e.name }));
  const absRoot = path.resolve(root);
  const key = `${home}|${absRoot}`;
  const c = dirCache.get(key);
  if (c && Date.now() - c.at < TTL) return c.dirs;
  const names = new Set([projectDirName(absRoot), absRoot.replace(/\//g, '-')]);
  let dirs = ents.filter((e) => names.has(e.name)).map((e) => ({ dir: path.join(base, e.name), name: e.name }));
  if (!dirs.length) {
    // fallback: a dir whose transcripts record this root as cwd (first 3 transcripts, first 64 KB each)
    for (const e of ents) {
      const d = path.join(base, e.name);
      const files = (await safeReaddir(d, home)).filter((f) => f.isFile() && f.name.endsWith('.jsonl')).slice(0, 3);
      for (const f of files) {
        const cwd = await headCwd(path.join(d, f.name), home);
        if (cwd && path.resolve(cwd) === absRoot) { dirs.push({ dir: d, name: e.name }); break; }
      }
    }
  }
  dirCache.set(key, { at: Date.now(), dirs });
  return dirs;
}

/**
 * Claude sessions in the given dirs: [{ sessionId, tool:'claude', file, mtimeMs, size, project, subagents: [{ file, meta, agentId, mtimeMs, size }] }]
 * `minMtime` skips sessions whose files were all last written before it.
 */
export async function claudeSessions(dirs, home, { minMtime = 0 } = {}) {
  const out = [];
  for (const { dir, name } of dirs) {
    const ents = await safeReaddir(dir, home);
    const subDirs = new Set(ents.filter((e) => e.isDirectory()).map((e) => e.name));
    await pool(ents.filter((e) => e.isFile() && e.name.endsWith('.jsonl')), 16, async (e) => {
      const sessionId = e.name.slice(0, -6);
      if (!SID.test(sessionId)) return;
      const file = path.join(dir, e.name);
      const st = await safeStat(file, home);
      if (!st || !st.isFile()) return;
      const subagents = [];
      if (subDirs.has(sessionId)) {
        const sd = path.join(dir, sessionId, 'subagents');
        for (const f of await safeReaddir(sd, home)) {
          if (!f.isFile() || !/^agent-[\w.-]+\.jsonl$/.test(f.name)) continue;
          const sf = path.join(sd, f.name);
          const sst = await safeStat(sf, home);
          if (sst) subagents.push({ file: sf, agentId: f.name.slice(6, -6), mtimeMs: sst.mtimeMs, size: sst.size, metaFile: path.join(sd, f.name.replace(/\.jsonl$/, '.meta.json')) });
        }
      }
      const mtimeMs = Math.max(st.mtimeMs, ...subagents.map((s) => s.mtimeMs));
      if (mtimeMs < minMtime) return;
      out.push({ sessionId, tool: 'claude', file, mtimeMs: st.mtimeMs, lastWrite: mtimeMs, size: st.size, project: name, subagents });
    });
  }
  return out;
}

/** Codex rollout files: [{ file, tool:'codex', mtimeMs, size }] (walk cached for TTL). */
export async function codexFiles(home, { minMtime = 0 } = {}) {
  let c = codexCache.get(home);
  if (!c || Date.now() - c.at > TTL) {
    const files = [];
    await pool(await listCodexTranscriptsAsync(home), 16, async (f) => {
      const st = await safeStat(f, home);
      if (st && st.isFile()) files.push({ file: f, tool: 'codex', mtimeMs: st.mtimeMs, lastWrite: st.mtimeMs, size: st.size, subagents: [] });
    });
    c = { at: Date.now(), files };
    codexCache.set(home, c);
  }
  return c.files.filter((f) => f.lastWrite >= minMtime);
}

const cwdCache = new Map(); // codex rollout -> cwd from its session_meta (never changes)

/** Codex rollouts whose recorded cwd is `root` or inside it (head read once per file, cached). */
export async function codexInRoot(files, root, home) {
  const absRoot = path.resolve(root);
  const out = [];
  await pool(files, 16, async (f) => {
    if (!cwdCache.has(f.file)) {
      const cwd = await headCwd(f.file, home);
      if (cwd === null) return; // not written yet: check again next time
      if (cwdCache.size > 20000) cwdCache.clear();
      cwdCache.set(f.file, cwd);
    }
    const r = path.relative(absRoot, path.resolve(cwdCache.get(f.file)));
    if (r === '' || (!r.startsWith('..') && !path.isAbsolute(r))) out.push(f);
  });
  return out;
}

/** Run fn over items with at most n in flight. */
export async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export function clearLocateCache() { dirCache.clear(); codexCache.clear(); cwdCache.clear(); }
