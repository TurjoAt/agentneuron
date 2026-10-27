// Smart session recovery (#4): an evidence-backed resume brief of one session or one board task, built from the
// usage session data (timeline + digest), git commits, verification runs, checkpoints and the board.
// Session-derived text only ever sits under prompt / title / quote / lastPrompt (redacted for viewers);
// generated text uses `label`; shell commands use `command` and tool output `quote`.
import { getUsage } from '../usage/index.js';
import { detectCorrection, toRule } from '../insights/lessons.js';
import { readState } from '../insights/index.js';
import { FileError } from '../files/paths.js';
import { ev, clipText, gitCommits, isRel, plural, relPath, safeCall, validId } from './util.js';
import { resumeMarkdown } from './markdown.js';

const HOUR = 3600e3;
const SHELL = new Set(['Bash', 'shell', 'exec_command', 'local_shell']);

const usageOf = (b) => getUsage({ root: b.root, config: b.config, home: b.home, store: b.store, usageBudgetMs: b.usageBudgetMs ?? 2500 });

/** Pair tool rows with their results (FIFO per tool name). Returns [{ row, result }]. */
function pairResults(timeline) {
  const pending = new Map();
  const out = [];
  for (const r of timeline) {
    if (r.kind === 'tool' || r.kind === 'edit') {
      const item = { row: r, result: null };
      out.push(item);
      const q = pending.get(r.tool) || [];
      q.push(item);
      pending.set(r.tool, q);
    } else if (r.kind === 'result' || r.kind === 'denied') {
      const q = pending.get(r.tool);
      const item = q && q.shift();
      if (item) item.result = r;
    }
  }
  return out;
}

/** The parts of a brief derived from one session. */
export async function sessionParts(b, sessionId) {
  const detail = await usageOf(b).session(sessionId, { todos: true });
  if (!detail.session) return null;
  const s = detail.session;
  const tl = detail.timeline || [];
  const sref = (ts) => ev('session', s.sessionId, ts);
  const prompts = tl.filter((r) => r.kind === 'prompt' && typeof r.prompt === 'string' && r.prompt.trim());
  const pairs = pairResults(tl);

  // done: successful edits per file
  const edits = new Map();
  const failed = [];
  for (const { row, result } of pairs) {
    if (row.kind !== 'edit') continue;
    const p = row.path || null;
    if (result && (result.isError || result.kind === 'denied')) {
      failed.push({ kind: 'edit', label: `Edit of ${!p ? 'a file' : isRel(p) ? p : 'a file outside the project'} ${result.kind === 'denied' ? 'was denied' : 'failed'}`, path: isRel(p) ? p : null, evidence: [sref(row.ts)] });
      continue;
    }
    if (!p) continue;
    const e = edits.get(p) || { path: p, edits: 0, firstAt: row.ts, lastAt: row.ts };
    e.edits++; e.lastAt = row.ts;
    edits.set(p, e);
  }
  const done = [...edits.values()].sort((a, b2) => a.firstAt - b2.firstAt).map((e) => ({
    kind: 'edit', label: `Edited ${isRel(e.path) ? e.path : 'a file outside the project'}${e.edits > 1 ? ` (${e.edits} edits)` : ''}`, path: isRel(e.path) ? e.path : null,
    evidence: [sref(e.lastAt), ...(isRel(e.path) ? [ev('file', e.path, e.lastAt)] : [])],
  }));

  // failed: shell commands that errored (grouped), denied tools, interrupts
  const cmds = new Map();
  pairs.forEach(({ row, result }, i) => {
    if (row.kind !== 'tool' || !SHELL.has(row.tool) || !result) return;
    const cmd = String(row.input || '').trim();
    if (!cmd) return;
    const c = cmds.get(cmd) || { command: cmd, fails: 0, ok: 0, lastFail: null, lastOkAfterFail: false, err: '', evidence: [], i };
    if (result.isError) {
      c.fails++; c.lastFail = row.ts;
      if (result.text) c.err = clipText(result.text, 200);
      if (c.evidence.length < 4) c.evidence.push(sref(row.ts));
    } else { c.ok++; if (c.fails) c.lastOkAfterFail = true; }
    cmds.set(cmd, c);
  });
  for (const c of cmds.values()) {
    if (!c.fails) continue;
    failed.push({ kind: 'command', label: `Command failed ${c.fails}×${c.lastOkAfterFail ? ', later passed' : ''}`, command: c.command, quote: c.err || null, resolved: c.lastOkAfterFail, count: c.fails, evidence: c.evidence });
  }
  for (const { row, result } of pairs) {
    if (row.kind === 'tool' && result?.kind === 'denied') failed.push({ kind: 'denied', label: `${row.tool} call was denied (${result.text || 'denied'})`, evidence: [sref(row.ts)] });
  }
  const interrupts = tl.filter((r) => r.kind === 'interrupt');
  if (interrupts.length) failed.push({ kind: 'interrupt', label: `Interrupted by the user ${plural(interrupts.length, 'time')}`, count: interrupts.length, evidence: interrupts.slice(-3).map((r) => sref(r.ts)) });

  // decisions: user corrections after an agent action, answers to the agent's questions
  const decisions = [];
  let after = null;
  for (const r of tl) {
    if (r.kind === 'edit') after = 'edit';
    else if (r.kind === 'tool' && after !== 'edit') after = 'command';
    else if (r.kind === 'prompt') {
      if (r !== prompts[0] && detectCorrection({ k: 'prompt', text: r.prompt, after })) {
        decisions.push({ kind: 'correction', label: 'User correction', quote: clipText(r.prompt, 300), title: toRule(r.prompt) || null, evidence: [sref(r.ts)] });
      }
      after = null;
    } else if (r.kind === 'result' && typeof r.quote === 'string' && r.quote) {
      decisions.push({ kind: 'answer', label: `User answered (${r.tool || 'question'})`, quote: r.quote, evidence: [sref(r.ts)] });
    }
  }

  // todos: the last TodoWrite list of the session
  const todoRow = [...tl].reverse().find((r) => r.tool === 'TodoWrite' && Array.isArray(r.todos));
  const todos = (todoRow?.todos || []).map((t) => ({ kind: 'todo', title: t.title, status: t.status, evidence: [sref(todoRow.ts)] }));

  const files = new Map();
  for (const e of edits.values()) files.set(e.path, { path: e.path, edits: e.edits, lastAt: e.lastAt });
  for (const f of detail.files || []) if (!files.has(f.path)) files.set(f.path, { path: f.path, edits: f.versions?.length || 0, lastAt: f.versions?.[f.versions.length - 1]?.ts || null });

  const lastEditAt = Math.max(0, ...[...edits.values()].map((e) => e.lastAt));
  return {
    session: s, prompts, done, failed, decisions, todos, files: [...files.values()], lastEditAt,
    unresolved: [...cmds.values()].filter((c) => c.fails && !c.lastOkAfterFail).sort((a, b2) => b2.lastFail - a.lastFail),
    interrupted: tl.length > 0 && tl.filter((r) => r.kind !== 'text' && r.kind !== 'thinking').slice(-1)[0]?.kind === 'interrupt',
  };
}

/** Pick the sessions of a task: those that edited its files or mention its id in the title. */
async function taskSessions(b, task) {
  const files = new Set((task.files || []).filter(Boolean));
  const list = (await usageOf(b).sessions({ range: '90d' })).sessions || [];
  const hit = list.filter((s) => (s.filesTouched || []).some((f) => files.has(f)) || (task.id && String(s.title || '').includes(task.id)));
  return hit.slice(0, 3).map((s) => s.sessionId);
}

const runView = (r) => ({
  id: r.id, kind: r.kind, command: r.command || null, startedAt: r.startedAt || null, endedAt: r.endedAt || null, exitCode: r.exitCode ?? null,
  passed: r.passed ?? null, failed: r.failed ?? null, skipped: r.skipped ?? null,
  failures: (Array.isArray(r.failures) ? r.failures : []).slice(0, 10).map((f) => ({ name: clipText(f?.name, 200), file: isRel(f?.file) ? f.file : null, quote: f?.message ? clipText(f.message, 300) : null })),
});

/** Latest run per kind (newest first). */
function latestRuns(runs) {
  const seen = new Set();
  const out = [];
  for (const r of [...runs].sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0))) {
    if (!r || seen.has(r.kind)) continue;
    seen.add(r.kind);
    out.push(r);
  }
  return out;
}

/**
 * Build a resume brief. opts: { session, task } (neither: the most recent session of the project).
 * b: briefCtx(...). Throws FileError 404 when the session / task does not exist.
 */
export async function buildResume(b, { session = null, task = null } = {}) {
  if (session && !validId(session)) throw new FileError(400, 'invalid session id');
  if (task && !validId(task)) throw new FileError(400, 'invalid task id');
  let taskRow = null, scope = null, ids = [];
  if (task) {
    taskRow = b.tasks().find((t) => t.id === task) || null;
    scope = await safeCall(b.deps.taskScope, [b.root, task], null);
    if (!taskRow && !scope?.task) throw new FileError(404, 'task not found');
    taskRow = taskRow || scope.task;
  }
  if (session) ids = [session];
  else if (taskRow) ids = await taskSessions(b, taskRow);
  else {
    const list = (await usageOf(b).sessions({ range: '30d' })).sessions || [];
    if (list[0]) ids = [list[0].sessionId];
  }
  const parts = [];
  for (const id of ids) { const p = await sessionParts(b, id); if (p) parts.push(p); }
  if (session && !parts.length) throw new FileError(404, 'session not found');
  parts.sort((a, b2) => (a.session.startedAt || 0) - (b2.session.startedAt || 0));
  const last = parts[parts.length - 1] || null;

  // commits in the session windows (or touching the task's files)
  let commits = [];
  if (parts.length) {
    const from = Math.min(...parts.map((p) => p.session.startedAt || p.session.lastAt)) - HOUR;
    const to = Math.max(...parts.map((p) => p.session.lastAt || 0)) + HOUR;
    commits = await gitCommits(b.root, { since: from, until: to, limit: 30 });
    const touched = new Set(parts.flatMap((p) => p.files.map((f) => f.path)));
    if (touched.size) commits = commits.filter((c) => !c.files.length || c.files.some((f) => touched.has(f)) || c.ts >= from);
  } else if (taskRow?.files?.length) commits = await gitCommits(b.root, { paths: taskRow.files, limit: 10 });

  const runs = latestRuns(await safeCall(b.deps.listRuns, [b.root, { limit: 20 }], []) || []).map(runView);
  const cps = (await safeCall(b.deps.listCheckpoints, [b.root, { limit: 50 }], []) || []).filter((c) => c && ((session || last) && c.session === (session || last?.session.sessionId) || (task && c.task === task))).slice(0, 5);

  const done = [...parts.flatMap((p) => p.done), ...commits.map((c) => ({ kind: 'commit', label: `Commit ${c.short}: ${c.subject}`, evidence: [ev('commit', c.hash, c.ts)] }))];
  const failed = parts.flatMap((p) => p.failed);
  for (const r of runs) if (r.failed > 0 || (r.exitCode !== null && r.exitCode !== 0)) failed.push({ kind: 'run', label: `${r.kind} run failed${r.failed ? ` (${r.failed} failing)` : ''}`, command: r.command, evidence: [ev('run', r.id, r.endedAt)] });
  const decisions = parts.flatMap((p) => p.decisions);
  const st = readState(b.root);
  const fromTs = parts.length ? Math.min(...parts.map((p) => p.session.startedAt || 0)) : Infinity;
  for (const a of st.accepted) if (a.ts >= fromTs) decisions.push({ kind: 'rule', label: `Accepted rule: ${clipText(a.rule, 200)}`, path: isRel(a.target) ? a.target : null, evidence: isRel(a.target) ? [ev('file', a.target, a.ts)] : [] });

  const fileMap = new Map();
  for (const p of parts) for (const f of p.files) {
    const rel = isRel(f.path) ? f.path : relPath(b.root, f.path) || f.path;
    const e = fileMap.get(rel) || { path: rel, edits: 0, lastAt: null, evidence: [] };
    e.edits += f.edits; e.lastAt = Math.max(e.lastAt || 0, f.lastAt || 0) || null;
    if (e.evidence.length < 3) e.evidence.push(ev('session', p.session.sessionId, f.lastAt));
    fileMap.set(rel, e);
  }
  for (const c of commits) for (const f of c.files) { const e = fileMap.get(f); if (e && e.evidence.length < 4) e.evidence.push(ev('commit', c.hash, c.ts)); }
  for (const f of taskRow?.files || []) if (!fileMap.has(f)) fileMap.set(f, { path: f, edits: 0, lastAt: null, evidence: [ev('task', taskRow.id)] });

  const todos = [...(last?.todos || [])];
  if (taskRow) {
    for (const c of taskRow.checklist || []) todos.push({ kind: 'checklist', label: c.text ? clipText(c.text, 200) : '', status: c.done ? 'completed' : 'pending', evidence: [ev('task', taskRow.id)] });
  }
  const criteria = (scope?.criteria || []).map((c) => ({ id: c.id || null, label: clipText(c.text, 200), status: c.status || 'untested', evidence: (c.evidence || []).slice(0, 5).map((e) => ev(['commit', 'file', 'test', 'run', 'task'].includes(e.kind) ? (e.kind === 'test' ? 'run' : e.kind) : 'task', e.ref, e.ts)) }));

  // next steps: generated from failures, open todos, criteria and missing verification
  const next = [];
  for (const r of runs) for (const f of r.failures.slice(0, 5)) next.push({ kind: 'fix-test', label: `Fix failing ${r.kind}: ${f.name || 'unnamed'}`, path: f.file, evidence: [ev('run', r.id, r.endedAt)] });
  for (const c of (last?.unresolved || []).slice(0, 3)) next.push({ kind: 'command', label: `Resolve the command that failed ${c.fails}× and never passed`, command: c.command, quote: c.err || null, evidence: c.evidence.slice(-1) });
  for (const t of todos.filter((x) => x.status !== 'completed').slice(0, 8)) next.push({ kind: 'todo', label: t.kind === 'checklist' ? `Finish checklist item: ${t.label}` : 'Finish open todo', ...(t.title !== undefined && { title: t.title }), evidence: t.evidence });
  for (const c of criteria.filter((x) => x.status !== 'verified').slice(0, 8)) next.push({ kind: 'criterion', label: `${c.status === 'failed' ? 'Fix' : 'Verify'} acceptance criterion: ${c.label}`, evidence: c.evidence.length ? c.evidence : [ev('task', task)] });
  const lastRunAt = Math.max(0, ...runs.map((r) => r.endedAt || r.startedAt || 0));
  const lastEditAt = Math.max(0, ...parts.map((p) => p.lastEditAt));
  if (lastEditAt && lastRunAt < lastEditAt) next.push({ kind: 'verify', label: runs.length ? 'Re-run the checks: the last edit is newer than the last recorded run' : 'Run the tests: no verification run is recorded for this work', evidence: [ev('session', last?.session.sessionId, lastEditAt)] });
  for (const c of cps.slice(0, 1)) next.push({ kind: 'checkpoint', label: `Checkpoint "${clipText(c.label || c.id, 80)}" is available to roll back to`, evidence: [ev('checkpoint', c.id, c.createdAt)] });
  if (last?.interrupted) next.push({ kind: 'continue', label: 'The session ended on an interrupt: confirm the last request is still wanted', evidence: [ev('session', last.session.sessionId, last.session.lastAt)] });

  const first = parts[0]?.prompts[0] || null;
  const lastPrompt = last?.prompts[last.prompts.length - 1] || null;
  const out = {
    generatedAt: Date.now(),
    source: { session: session || (parts.length === 1 ? parts[0].session.sessionId : null), task: task || null, sessions: parts.map((p) => p.session.sessionId) },
    title: taskRow ? taskRow.title || task : last ? last.session.title : '',
    goal: { prompt: first ? clipText(first.prompt, 1000) : '', ...(taskRow && { title: taskRow.title || '' }), evidence: [...(first ? [ev('session', parts[0].session.sessionId, first.ts)] : []), ...(taskRow ? [ev('task', taskRow.id)] : [])] },
    lastPrompt: lastPrompt && lastPrompt !== first ? clipText(lastPrompt.prompt, 600) : '',
    sessions: parts.map((p) => ({ sessionId: p.session.sessionId, tool: p.session.tool, title: p.session.title, startedAt: p.session.startedAt, lastAt: p.session.lastAt, branch: p.session.branch, errors: p.session.errors, prompts: p.session.prompts })),
    task: taskRow ? { id: taskRow.id, title: taskRow.title || '', status: taskRow.status || null } : null,
    done, failed, decisions,
    files: [...fileMap.values()].sort((a, b2) => (b2.lastAt || 0) - (a.lastAt || 0)).slice(0, 100),
    runs, todos, criteria, checkpoints: cps.map((c) => ({ id: c.id, label: c.label || null, createdAt: c.createdAt || null, files: (c.files || []).length })),
    next,
    counts: { done: done.length, failed: failed.length, decisions: decisions.length, files: fileMap.size, next: next.length },
  };
  out.markdown = resumeMarkdown(out);
  return out;
}

/** Sessions and tasks to pick from in the UI. */
export async function resumeSources(b) {
  const list = (await usageOf(b).sessions({ range: '30d' })).sessions || [];
  return {
    sessions: list.slice(0, 50).map((s) => ({ sessionId: s.sessionId, tool: s.tool, title: s.title, startedAt: s.startedAt, lastAt: s.lastAt, branch: s.branch, errors: s.errors, files: (s.filesTouched || []).length })),
    tasks: b.tasks().filter((t) => t.status !== 'done').slice(0, 100).map((t) => ({ id: t.id, title: t.title, status: t.status, files: (t.files || []).length })),
  };
}
