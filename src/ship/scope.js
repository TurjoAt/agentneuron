// Acceptance criteria per board task (agent A).
//
// Criteria come from the board itself, nothing extra to maintain:
//   - checklist items of a task (`- [ ]` sub-items of a markdown task, or the checklist of a native task)
//   - lines under a `Criteria:` / `Acceptance criteria:` / `Done when:` line in the task description
// Manual overrides (action ship.criterion.set) live in .agentneuron/ship/criteria.json:
//   { "version": 1, "overrides": { "<taskId>": { "<criterionId>": { "status", "note", "at" } } } }
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createBoard } from '../board/index.js';
import { agentneuronPath, readJson, atomicJson } from '../files/paths.js';
import { listRuns, latestByCheck } from './runs.js';
import { recentCommits, changedFiles } from './git.js';

export const STATUSES = ['verified', 'incomplete', 'untested', 'failed'];
const HEADER = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:acceptance(?:\s+criteria)?|criteria|done when|definition of done)(?:\*\*)?\s*:\s*(.*)$/i;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'then', 'should', 'must', 'can', 'are', 'was', 'has', 'have', 'not', 'all', 'any', 'each', 'its', 'via', 'use', 'uses', 'used', 'test', 'tests', 'works', 'work', 'able', 'user', 'users', 'page', 'add', 'adds', 'added', 'new', 'make', 'sure', 'show', 'shows', 'get', 'set', 'it', 'is', 'be', 'to', 'of', 'in', 'on', 'a', 'an', 'or', 'if', 'by', 'as', 'at']);

const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
export const criterionId = (taskId, text) => 'c' + crypto.createHash('sha1').update(`${taskId}\n${norm(text)}`).digest('hex').slice(0, 10);

/** Significant lowercase words (camelCase/snake split, stems trimmed). */
export function keywords(text) {
  const words = String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./:>`'"()[\]{}]/g, ' ').toLowerCase().split(/[^a-z0-9]+/);
  const out = new Set();
  for (let w of words) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    w = w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 4 ? '' : m));
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

/** Does `name` (a test name, commit subject) match criterion keywords? */
export function matches(critWords, name) {
  if (!critWords.size) return false;
  const nw = keywords(name);
  let hit = 0;
  for (const w of critWords) if (nw.has(w)) hit++;
  if (critWords.size === 1) return hit === 1;
  return hit >= 2 && hit / critWords.size >= 0.5;
}

/** Criteria of one task: [{ id, text, done: true|false|null, source: 'checklist'|'description' }]. */
export function extractCriteria(task) {
  const out = [];
  const seen = new Set();
  const add = (text, done, source) => {
    const t = String(text || '').replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/]\]\s+)?/, '').trim();
    if (!t || t.length > 500) return;
    const id = criterionId(task.id, t);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, text: t, done, source });
  };
  for (const c of task.checklist || []) add(c.text, !!c.done, 'checklist');
  const lines = String(task.description || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = HEADER.exec(lines[i]);
    if (!h) continue;
    if (h[1].trim()) for (const part of h[1].split(/\s*;\s*/)) add(part, null, 'description');
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || /^\s*#/.test(l) || (/:\s*$/.test(l) && !/^\s*[-*+]/.test(l))) break;
      const box = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s+/.exec(l);
      add(l, box ? box[1] !== ' ' : null, 'description');
    }
  }
  return out;
}

// ---- overrides --------------------------------------------------------------
const overridesFile = (root) => agentneuronPath(root, 'ship', 'criteria.json');
export function readOverrides(root) {
  const d = readJson(overridesFile(root), null);
  return d && typeof d === 'object' && d.overrides && typeof d.overrides === 'object' ? d.overrides : {};
}
/** status: one of STATUSES, or 'auto' to remove the override. */
export function setOverride(root, { task, criterion, status, note = '' }) {
  if (!/^[\w-]{1,80}$/.test(String(task || '')) || /^(__proto__|constructor|prototype)$/.test(task) || !/^c[0-9a-f]{10}$/.test(String(criterion || ''))) throw Object.assign(new Error('invalid task or criterion id'), { status: 400 });
  if (status !== 'auto' && !STATUSES.includes(status)) throw Object.assign(new Error('invalid status'), { status: 400 });
  const file = overridesFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const overrides = readOverrides(root);
  const t = overrides[task] || {};
  if (status === 'auto') delete t[criterion];
  else t[criterion] = { status, note: String(note || '').slice(0, 500), at: Date.now() };
  if (Object.keys(t).length) overrides[task] = t; else delete overrides[task];
  atomicJson(file, { version: 1, overrides });
  return { task, criterion, status };
}

// ---- tasks without a server store (CLI, other slices) ------------------------
const storeCache = new Map(); // root -> { ts, store }
async function fallbackStore(root) {
  const c = storeCache.get(root);
  if (c && Date.now() - c.ts < 10000) return c.store;
  const { loadConfig } = await import('../core/config.js');
  const { createStore } = await import('../core/store.js');
  const store = createStore(root, loadConfig(root), { record: false });
  await store.init();
  storeCache.set(root, { ts: Date.now(), store });
  return store;
}
/** All board tasks (markdown + native + overlay), the same ids the board shows. */
export async function loadTasks(root, { store } = {}) {
  const s = store || (await fallbackStore(root));
  return createBoard({ root, store: s }).collect();
}

// ---- evidence + status -------------------------------------------------------
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Gather shared inputs once (runs, commits, changed files). */
export async function scopeInputs(root, { runs, commits, changed } = {}) {
  const [r, c, ch] = await Promise.all([
    runs || listRuns(root, { limit: 100 }),
    commits || recentCommits(root, 300).catch(() => []),
    changed || changedFiles(root, 'HEAD').catch(() => ({ files: [] })),
  ]);
  return { runs: r, commits: c, changed: ch };
}

const fileExists = async (root, p) => {
  if (!p || p.includes('\0') || p.startsWith('/') || p.split('/').includes('..')) return false;
  try { return (await fsp.stat(path.join(root, p))).isFile(); } catch { return false; }
};

/** Evaluate one task. */
export async function evaluateTask(root, task, inputs, overrides = readOverrides(root)) {
  const latest = [...latestByCheck(inputs.runs).values()];
  const testRuns = latest.filter((r) => r.kind === 'test');
  const changedSet = new Set((inputs.changed?.files || []).map((f) => f.path));
  const idRe = new RegExp(`(^|[^\\w])${ESC(task.id)}($|[^\\w])`);
  const titleN = norm(task.title || '');
  const taskCommits = inputs.commits.filter((c) => idRe.test(`${c.subject}\n${c.body}`) || (titleN.length >= 12 && norm(`${c.subject}\n${c.body}`).includes(titleN)));
  const ov = overrides[task.id] || {};
  const criteria = [];
  for (const c of extractCriteria(task)) {
    const words = keywords(c.text);
    const evidence = [];
    let failing = false, passing = false;
    // tests from the latest run of each test check
    for (const r of testRuns) {
      const failedNames = new Set(r.failures.map((f) => f.name));
      for (const t of r.tests) {
        if (!matches(words, t.name)) continue;
        const bad = t.status === 'failed' || failedNames.has(t.name);
        if (t.status === 'skipped') continue;
        if (bad) failing = true; else passing = true;
        if (evidence.length < 12) evidence.push({ kind: 'test', ref: r.id, label: `${bad ? 'failed' : 'passed'}: ${t.name}`.slice(0, 200), status: bad ? 'failed' : 'passed' });
      }
      for (const f of r.failures) {
        if (r.tests.some((t) => t.name === f.name) || !matches(words, f.name)) continue;
        failing = true;
        evidence.push({ kind: 'test', ref: r.id, label: `failed: ${f.name}`.slice(0, 200), status: 'failed', ...(f.file ? { path: f.file, line: f.line } : {}) });
      }
    }
    // files named in the criterion (backticks) or on the task
    const named = [...new Set([...(c.text.match(/`([^`\s]+\.[A-Za-z0-9]{1,8})`/g) || []).map((s) => s.slice(1, -1)), ...(task.files || [])])].slice(0, 20);
    for (const p of named) {
      if (!(await fileExists(root, p))) continue;
      const failure = latest.find((r) => r.failures.some((f) => f.file === p));
      if (failure) { failing = true; evidence.push({ kind: 'run', ref: failure.id, label: `${failure.check || failure.kind} fails in ${p}`, status: 'failed', path: p }); }
      if (c.text.includes(p) || changedSet.has(p) || taskCommits.some((k) => k.files.includes(p))) evidence.push({ kind: 'file', ref: p, label: changedSet.has(p) ? `${p} (changed)` : p });
    }
    // commits that mention the task and match the criterion (or touch its files)
    for (const k of taskCommits) {
      if (matches(words, k.subject) || named.some((p) => k.files.includes(p))) evidence.push({ kind: 'commit', ref: k.hash, label: `${k.short} ${k.subject}`.slice(0, 160) });
    }
    let status;
    if (failing) status = 'failed';
    else if (c.done === false) status = 'incomplete';
    else if (passing) status = 'verified';
    else if (c.done === true || evidence.length || task.status === 'done') status = 'untested';
    else status = 'incomplete';
    const o = ov[c.id];
    if (o && STATUSES.includes(o.status)) {
      evidence.unshift({ kind: 'manual', ref: c.id, label: `marked ${o.status}${o.note ? `: ${o.note}` : ''}`.slice(0, 300), at: o.at });
      status = o.status;
    }
    criteria.push({ id: c.id, text: c.text, done: c.done, source: c.source, status, auto: !o, evidence: evidence.slice(0, 20) });
  }
  return {
    task: { id: task.id, title: task.title, status: task.status, source: task.source, path: task.path || null, line: task.line || null, labels: task.labels || [] },
    criteria,
    commits: taskCommits.slice(0, 10).map((k) => ({ hash: k.hash, short: k.short, subject: k.subject, date: k.date })),
    summary: summarize(criteria),
  };
}

export function summarize(criteria) {
  const s = { criteria: criteria.length, verified: 0, incomplete: 0, untested: 0, failed: 0 };
  for (const c of criteria) s[c.status]++;
  return s;
}

/** Scope of one task: { task, criteria, summary } or null. `opts.store` reuses a server store. */
export async function taskScope(root, taskId, opts = {}) {
  if (typeof taskId !== 'string' || !taskId) return null;
  const tasks = opts.tasks || (await loadTasks(root, opts));
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  return evaluateTask(root, task, opts.inputs || (await scopeInputs(root)));
}

/** All tasks that have acceptance criteria (open ones first). */
export async function allScope(root, opts = {}) {
  const tasks = opts.tasks || (await loadTasks(root, opts));
  const inputs = opts.inputs || (await scopeInputs(root));
  const overrides = readOverrides(root);
  const out = [];
  for (const t of tasks) {
    if (!extractCriteria(t).length) continue;
    if (opts.openOnly && t.status === 'done') continue;
    const e = await evaluateTask(root, t, inputs, overrides);
    out.push({ ...e.task, criteria: e.criteria, commits: e.commits, summary: e.summary });
  }
  out.sort((a, b) => (a.status === 'done') - (b.status === 'done'));
  const totals = summarize(out.flatMap((t) => t.criteria));
  return { tasks: out, totals: { tasks: out.length, ...totals } };
}
