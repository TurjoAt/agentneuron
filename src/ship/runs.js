// Verification runs stored under .agentneuron/ship/runs/ (agent A).
// One `<id>.json` per run (summary + parsed tests/failures) and a capped, secret-masked `<id>.log`.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { maskSecretsInText } from '../health/secrets.js';
import { readRegularAsync } from '../files/safeio.js';

export const KEEP_RUNS = 200;
export const LOG_CAP = 256 * 1024;
const ID = /^r[0-9a-z]{6,40}$/;
export const validRunId = (id) => typeof id === 'string' && ID.test(id);

export const runsDir = (root) => path.join(root, '.agentneuron', 'ship', 'runs');

function publicRun(r) {
  if (!r || typeof r !== 'object' || !validRunId(r.id)) return null;
  return {
    id: r.id, check: r.check || null, kind: r.kind || 'test', command: String(r.command || ''), source: r.source || null,
    startedAt: Number(r.startedAt) || 0, endedAt: Number(r.endedAt) || 0, exitCode: r.exitCode ?? null,
    passed: Number(r.passed) || 0, failed: Number(r.failed) || 0, skipped: Number(r.skipped) || 0,
    format: r.format || null, failures: Array.isArray(r.failures) ? r.failures : [], tests: Array.isArray(r.tests) ? r.tests : [],
    head: r.head || null, job: r.job || null,
  };
}

/** Make paths in failures project-relative (node:test reports absolute file:// locations); drop paths outside the project. */
export function relFailures(root, failures = []) {
  const base = path.resolve(root);
  return failures.map((f) => {
    let file = f.file ? String(f.file).replace(/^file:\/\//, '').replace(/\\/g, '/') : null;
    if (file && /^\/[A-Za-z]:\//.test(file)) file = file.slice(1); // Windows file URL: file:///C:/x
    // path.relative (not a string prefix): on Windows the drive letter / case may differ and POSIX-style roots resolve onto a drive
    if (file && path.isAbsolute(file)) { const r = path.relative(base, path.resolve(file)); file = r && !path.isAbsolute(r) ? r.replace(/\\/g, '/') : null; }
    if (file && (file.startsWith('/') || /^[A-Za-z]:\//.test(file) || file.split('/').includes('..'))) file = null;
    if (file) file = file.replace(/^\.\//, '');
    return { name: maskSecretsInText(String(f.name || '')).slice(0, 300), file, line: Number.isInteger(f.line) ? f.line : null, message: maskSecretsInText(String(f.message || '')).slice(0, 600) };
  });
}

/**
 * Store one run. `run`: { check, kind, command (string), source, startedAt, endedAt, exitCode, passed, failed, skipped,
 * format, tests, failures, head, job }. `log`: raw output (masked + capped here). Returns the stored run.
 */
export async function saveRun(root, run, log = '') {
  const dir = runsDir(root);
  await fsp.mkdir(dir, { recursive: true });
  // time-ordered id: names sort chronologically
  const id = 'r' + Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex');
  const rec = publicRun({
    ...run, id, command: maskSecretsInText(String(run.command || '')), failures: relFailures(root, run.failures || []),
    tests: (run.tests || []).slice(0, 500).map((t) => ({ name: maskSecretsInText(String(t.name || '')).slice(0, 300), status: t.status })),
  });
  let text = maskSecretsInText(String(log || ''));
  if (text.length > LOG_CAP) text = `[... ${text.length - LOG_CAP} earlier characters dropped ...]\n` + text.slice(-LOG_CAP);
  await fsp.writeFile(path.join(dir, `${id}.log`), text);
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(rec, null, 1));
  await prune(dir).catch(() => {});
  return rec;
}

async function prune(dir) {
  const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  for (const n of names.slice(0, Math.max(0, names.length - KEEP_RUNS))) {
    const id = n.slice(0, -5);
    await fsp.rm(path.join(dir, n), { force: true });
    await fsp.rm(path.join(dir, `${id}.log`), { force: true });
  }
}

const cache = new Map(); // abs path -> { mtimeMs, size, run }

async function readRun(file) {
  let st; try { st = await fsp.stat(file); } catch { return null; }
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.run;
  const r = await readRegularAsync(file, { maxBytes: 4 * 1024 * 1024 });
  let run = null;
  try { run = r ? publicRun(JSON.parse(r.buf.toString('utf8'))) : null; } catch { run = null; }
  if (cache.size > 2000) cache.clear();
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, run });
  return run;
}

/** @returns {Promise<Array<{id,kind,command,startedAt,endedAt,exitCode,passed,failed,skipped,failures}>>} newest first. */
export async function listRuns(root, opts = {}) {
  const limit = Math.max(1, Math.min(KEEP_RUNS, Number(opts.limit) || 50));
  let names; try { names = await fsp.readdir(runsDir(root)); } catch { return []; }
  const files = names.filter((n) => n.endsWith('.json') && validRunId(n.slice(0, -5))).sort().reverse().slice(0, limit);
  const out = (await Promise.all(files.map((n) => readRun(path.join(runsDir(root), n))))).filter(Boolean);
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** One run with its log tail (when `withLog`). null when missing. */
export async function getRun(root, id, { withLog = true, logCap = LOG_CAP } = {}) {
  if (!validRunId(id)) return null;
  const run = await readRun(path.join(runsDir(root), `${id}.json`));
  if (!run) return null;
  if (!withLog) return { ...run, log: '' };
  const r = await readRegularAsync(path.join(runsDir(root), `${id}.log`), { maxBytes: 64 * 1024 * 1024, tail: logCap });
  return { ...run, log: r ? maskSecretsInText(r.buf.toString('utf8')) : '' };
}

/** Latest run per check id, from a newest-first list. */
export function latestByCheck(runs) {
  const m = new Map();
  for (const r of runs) { const k = r.check || `${r.kind}:${r.command}`; if (!m.has(k)) m.set(k, r); }
  return m;
}

export const runPassed = (r) => !!r && r.exitCode === 0 && !r.failed;
