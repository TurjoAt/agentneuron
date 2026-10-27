// Ship check (agent A): verification engine, scope tracker, readiness and placeholder scanners.
// Everything here is read-only and never runs project commands (only read-only git queries).
// Contract: docs/internal/quality-contract.md.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { detectChecks } from './checks.js';
import { listRuns, latestByCheck, runPassed } from './runs.js';
import { changedFiles, recentCommits } from './git.js';
import { allScope, loadTasks, scopeInputs, summarize } from './scope.js';
import { readiness, placeholders } from './scan.js';
import { runGit, validRev } from '../git2/run.js';
import { maskDeep } from '../server/mask.js';

export { detectChecks } from './checks.js';
export { listRuns, getRun, saveRun } from './runs.js';
export { taskScope, allScope, setOverride } from './scope.js';
export { readiness, placeholders } from './scan.js';
export { parseOutput } from './parse.js';

export const VERDICTS = ['verified', 'partial', 'failing', 'unverified'];
const RECENT_DONE_MS = 7 * 24 * 3600 * 1000;

/** Drop the bulky per-test list from a run for list views. */
export const runSummary = (r) => (r ? { id: r.id, check: r.check, kind: r.kind, command: r.command, source: r.source, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, passed: r.passed, failed: r.failed, skipped: r.skipped, format: r.format, failures: r.failures.slice(0, 20), head: r.head } : null);

async function latestMtime(root, files) {
  let max = 0;
  for (let i = 0; i < Math.min(files.length, 500); i += 50) {
    const sts = await Promise.all(files.slice(i, i + 50).map((f) => fsp.stat(path.join(root, f.path)).catch(() => null)));
    for (const s of sts) if (s && s.mtimeMs > max) max = s.mtimeMs;
  }
  return max;
}

/** Checks with their latest run and whether that run predates the current changes. */
export async function checksWithRuns(root, { runs, changed } = {}) {
  const [checks, rs] = await Promise.all([detectChecks(root), runs || listRuns(root, { limit: 100 })]);
  const latest = latestByCheck(rs);
  const ch = changed || (await changedFiles(root, 'HEAD').catch(() => ({ files: [] })));
  const lastChange = await latestMtime(root, ch.files || []);
  return checks.map((c) => {
    const last = latest.get(c.id) || null;
    return { id: c.id, kind: c.kind, label: c.label, command: c.command.join(' '), source: c.source, script: c.script || null, last: runSummary(last), stale: !!last && lastChange > last.startedAt, status: !last ? 'never' : runPassed(last) ? 'passed' : 'failed' };
  });
}

/** Verdict + human reasons from checks and criteria. */
export function verdictOf(checks, criteria) {
  const reasons = [];
  const R = (level, code, text) => reasons.push({ level, code, text });
  const failedChecks = checks.filter((c) => c.status === 'failed');
  const never = checks.filter((c) => c.status === 'never');
  const stale = checks.filter((c) => c.stale && c.status !== 'never');
  const s = summarize(criteria);
  for (const c of failedChecks) R('err', 'check-failed', `${c.label} failed${c.last?.failed ? ` (${c.last.failed} failing)` : ''}`);
  if (s.failed) R('err', 'criteria-failed', `${s.failed} acceptance criteri${s.failed === 1 ? 'on has' : 'a have'} failing tests`);
  if (!checks.length) R('warn', 'no-checks', 'No test, build, lint or typecheck command detected');
  for (const c of never) R('warn', 'check-never', `${c.label} has never run here`);
  for (const c of stale) R('warn', 'check-stale', `${c.label} ran before the latest changes`);
  if (s.incomplete) R('warn', 'criteria-incomplete', `${s.incomplete} criteri${s.incomplete === 1 ? 'on is' : 'a are'} not done`);
  if (s.untested) R('warn', 'criteria-untested', `${s.untested} criteri${s.untested === 1 ? 'on has' : 'a have'} no test evidence`);
  const passedFresh = checks.filter((c) => c.status === 'passed' && !c.stale);
  for (const c of passedFresh) R('ok', 'check-passed', `${c.label} passed${c.last?.passed ? ` (${c.last.passed} tests)` : ''}`);
  if (s.criteria && s.verified === s.criteria) R('ok', 'criteria-verified', `All ${s.criteria} acceptance criteria verified`);
  let verdict;
  if (failedChecks.length || s.failed) verdict = 'failing';
  else if ((!checks.length && !s.criteria) || (checks.length && never.length === checks.length && !s.verified)) verdict = 'unverified';
  else if (checks.length && passedFresh.length === checks.length && s.verified === s.criteria) verdict = 'verified';
  else if (!checks.length && s.criteria && s.verified === s.criteria) verdict = 'verified';
  else verdict = checks.some((c) => c.status === 'passed') || s.verified ? 'partial' : 'unverified';
  return { verdict, reasons };
}

/** Commits in base..HEAD (when base is not HEAD). */
async function rangeCommits(root, base, head) {
  if (!head || !base || base === 'HEAD' || !validRev(base)) return [];
  const r = await runGit(root, ['log', '-n200', '--format=%H%x1f%h%x1f%aI%x1f%s', `${base}..HEAD`], { timeout: 8000 });
  if (!r.ok) return [];
  return r.out.split('\n').filter(Boolean).map((l) => { const [hash, short, date, subject] = l.split('\x1f'); return { hash, short, date, subject }; });
}

/**
 * Completion report: changed files since `base`, checks with last runs, criteria with evidence, failures, verdict.
 * opts: { base = 'HEAD', store }
 */
export async function completionReport(root, opts = {}) {
  const base = opts.base || 'HEAD';
  const changed = await changedFiles(root, base);
  const runs = await listRuns(root, { limit: 100 });
  const headChanged = base === 'HEAD' ? changed : await changedFiles(root, 'HEAD').catch(() => ({ files: [] }));
  const [checks, tasks, commits] = await Promise.all([
    checksWithRuns(root, { runs, changed: headChanged }),
    loadTasks(root, { store: opts.store }).catch(() => []),
    recentCommits(root, 300).catch(() => []),
  ]);
  const now = Date.now();
  const relevant = tasks.filter((t) => t.status !== 'done' || now - (Number(t.updatedAt) || 0) < RECENT_DONE_MS);
  const inputs = await scopeInputs(root, { runs, commits, changed: headChanged });
  const scope = await allScope(root, { tasks: relevant, inputs });
  const criteria = scope.tasks.flatMap((t) => t.criteria.map((c) => ({ ...c, task: { id: t.id, title: t.title, status: t.status } })));
  const { verdict, reasons } = verdictOf(checks, criteria);
  const failures = [];
  for (const c of checks) {
    if (c.status !== 'failed' || !c.last) continue;
    for (const f of c.last.failures) failures.push({ check: c.id, kind: c.kind, run: c.last.id, ...f });
  }
  const evidence = [
    ...(await rangeCommits(root, base, changed.head)).map((k) => ({ kind: 'commit', ref: k.hash, label: `${k.short} ${k.subject}`.slice(0, 160), at: Date.parse(k.date) || null })),
    ...checks.filter((c) => c.last).map((c) => ({ kind: 'run', ref: c.last.id, label: `${c.label}: ${c.status}${c.stale ? ' (stale)' : ''}`, at: c.last.endedAt })),
  ];
  const totals = { files: changed.files.length, added: changed.files.reduce((a, f) => a + (f.added || 0), 0), removed: changed.files.reduce((a, f) => a + (f.removed || 0), 0) };
  return maskDeep({
    generatedAt: now, base, head: changed.head, git: { available: changed.available, error: changed.error || null },
    verdict, reasons, changedFiles: changed.files.slice(0, 1000), totals, checks, criteria, criteriaSummary: summarize(criteria), failures: failures.slice(0, 200), evidence,
  });
}

/** Dashboard summary for the header of the view and the MCP report. */
export async function shipSummary(root, opts = {}) {
  const report = await completionReport(root, { store: opts.store });
  const [ready, ph] = await Promise.all([readiness(root), placeholders(root)]);
  const runs = await listRuns(root, { limit: 100 });
  const latest = [...latestByCheck(runs).values()].map(runSummary);
  const tasksWithCriteria = new Set(report.criteria.map((c) => c.task.id));
  return {
    generatedAt: Date.now(), verdict: report.verdict, reasons: report.reasons,
    readiness: { ready: ready.ready, blockers: ready.blockers, counts: ready.counts },
    placeholders: { count: ph.count, counts: ph.counts },
    lastRuns: latest,
    scope: { tasks: tasksWithCriteria.size, ...report.criteriaSummary },
    changed: report.totals,
  };
}
