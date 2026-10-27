// Ship check routes (agent A). Contract: docs/internal/quality-contract.md.
// All GET, level read. They never run project commands; only read-only git queries and bounded file reads.
// No session-derived text is returned (board tasks, git, runs, static scans), so no prompt redaction applies.
import { HttpError } from '../router.js';
import { maskDeep } from '../mask.js';
import { guard } from './files.js';
import { howToEnable } from '../../actions/registry.js';
import { validRev } from '../../git2/run.js';
import {
  completionReport, shipSummary, checksWithRuns, runSummary, listRuns, getRun, allScope, taskScope, readiness, placeholders,
} from '../../ship/index.js';
import { validRunId } from '../../ship/runs.js';

const baseOf = (q) => {
  const b = q.get('base') || 'HEAD';
  if (!validRev(b)) throw new HttpError(400, 'invalid base ref');
  return b;
};

// Test-output excerpts (failures[].message) are raw command output: admin-only, like the run log.
function hideFailureText(v) {
  if (Array.isArray(v)) return v.map(hideFailureText);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = k === 'failures' && Array.isArray(x)
      ? x.map((f) => (f && typeof f === 'object' ? (({ message: _m, ...rest }) => ({ ...rest, messageHidden: f.message != null }))(f) : f))
      : hideFailureText(x);
  }
  return out;
}

export default async function register(router, ctx) {
  const root = ctx.root;
  const R = (p, fn) => router.get(p, guard(async (a) => {
    const v = maskDeep(await fn(a));
    return ctx.can('state', a.role) ? v : hideFailureText(v);
  }), { level: 'read' });

  /** Can this role run checks? (exec level, admin, actions.exec on, and checks detected) */
  async function runGate(role, hasChecks) {
    const level = 'exec';
    if (!ctx.can(level, role)) return { actionId: 'ship.verify.run', level, enabled: false, reason: role !== 'admin' ? `requires the admin role (you are ${role})` : howToEnable(level) };
    if (!hasChecks) return { actionId: 'ship.verify.run', level, enabled: false, reason: 'no test, build, lint or typecheck command detected' };
    return { actionId: 'ship.verify.run', level, enabled: true, reason: '' };
  }
  const canSet = (role) => (ctx.can('state', role) ? { enabled: true, reason: '' } : { enabled: false, reason: howToEnable('state') });

  R('/api/ship/summary', () => shipSummary(root, { store: ctx.store }));

  R('/api/ship/checks', async ({ role }) => {
    const checks = await checksWithRuns(root);
    return { checks, run: await runGate(role, checks.length > 0) };
  });

  R('/api/ship/runs', async ({ q }) => {
    const limit = Math.max(1, Math.min(200, Number(q.get('limit')) || 50));
    return { runs: (await listRuns(root, { limit })).map(runSummary) };
  });

  R('/api/ship/run', async ({ q, role }) => {
    const id = q.get('id') || '';
    if (!validRunId(id)) throw new HttpError(400, 'invalid run id');
    // raw output (even secret-masked) is admin-only, like /api/job
    const admin = ctx.can('state', role);
    const run = await getRun(root, id, { withLog: admin, logCap: 128 * 1024 });
    if (!run) throw new HttpError(404, 'run not found');
    return { ...run, logHidden: !admin };
  });

  R('/api/ship/report', async ({ q, role }) => {
    const report = await completionReport(root, { base: baseOf(q), store: ctx.store });
    return { ...report, run: await runGate(role, report.checks.length > 0), override: canSet(role) };
  });

  R('/api/ship/scope', async ({ q, role }) => {
    const task = q.get('task');
    if (task) {
      if (!/^[\w-]{1,80}$/.test(task)) throw new HttpError(400, 'invalid task id');
      const s = await taskScope(root, task, { store: ctx.store });
      if (!s) throw new HttpError(404, 'task not found');
      return { tasks: [{ ...s.task, criteria: s.criteria, commits: s.commits, summary: s.summary }], totals: { tasks: 1, ...s.summary }, override: canSet(role) };
    }
    return { ...(await allScope(root, { store: ctx.store })), override: canSet(role) };
  });

  R('/api/ship/readiness', () => readiness(root));
  R('/api/ship/placeholders', () => placeholders(root));
}
