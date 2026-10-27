// Ship check actions (agent A). Contract: docs/internal/quality-contract.md.
//   ship.verify.run     (exec)  run detected checks through the job runner, parse and store the results
//   ship.criterion.set  (state) manual status for one acceptance criterion
// Commands come only from detectChecks() (looked up by id), never from params; no shell.
import { detectChecks, CHECK_ID } from '../ship/checks.js';
import { parseOutput, stripAnsi } from '../ship/parse.js';
import { saveRun } from '../ship/runs.js';
import { setOverride, STATUSES, loadTasks, extractCriteria } from '../ship/scope.js';
import { gitHead } from '../ship/git.js';

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const RUN_ENV = { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', npm_config_color: 'false' };
export const CHECK_TIMEOUT_MS = 15 * 60 * 1000;

async function pick(root, ids) {
  const all = await detectChecks(root);
  if (!ids || !ids.length) return all;
  const out = [];
  for (const id of ids) {
    const c = all.find((x) => x.id === id);
    if (!c) throw bad(`unknown check: ${String(id).slice(0, 80)} (detected: ${all.map((x) => x.id).join(', ') || 'none'})`);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Run checks with job.exec, store one run per check. Exported for tests and the CLI. */
export async function runChecks(root, checks, job) {
  const head = (await gitHead(root).catch(() => ({}))).head || null;
  const stored = [];
  for (const c of checks) {
    if (job.signal?.aborted) break;
    const startedAt = Date.now();
    job.log?.('info', `\n▶ ${c.label}`);
    let r;
    try { r = await job.exec(c.command[0], c.command.slice(1), { cwd: '.', env: RUN_ENV, timeoutMs: CHECK_TIMEOUT_MS }); } catch (e) { r = { code: 127, stdout: '', stderr: String(e?.message || e) }; }
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const p = parseOutput(out, { exitCode: r.code });
    const run = await saveRun(root, {
      check: c.id, kind: c.kind, command: c.command.join(' '), source: c.source, startedAt, endedAt: Date.now(), exitCode: r.code,
      passed: p.passed, failed: p.failed, skipped: p.skipped, format: p.format, tests: p.tests, failures: p.failures, head, job: job.id || null,
    }, stripAnsi(out));
    stored.push(run);
    job.log?.('info', `${run.exitCode === 0 && !run.failed ? '✓' : '✗'} ${c.label}: ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`);
  }
  return stored;
}

export default function register(registry, ctx) {
  registry.register({
    id: 'ship.verify.run', title: 'Run verification checks', category: 'ship', level: 'exec',
    description: 'Run the detected test/build/lint/typecheck commands and store the results for the Ship check report',
    params: { checks: { type: 'string[]', label: 'Checks (empty = all detected)', pattern: CHECK_ID.source, default: [] } },
    available: async () => { try { return (await detectChecks(ctx.root)).length > 0; } catch { return false; } },
    preview: async (p) => {
      const checks = await pick(ctx.root, p.checks);
      return { command: checks[0]?.command || null, commands: checks.map((c) => c.command), summary: `Runs ${checks.map((c) => c.label).join(', ') || 'nothing'} (no shell, CI=1)` };
    },
    run: async (p, c, job) => {
      const checks = await pick(ctx.root, p.checks);
      if (!checks.length) throw bad('no checks detected in this project');
      const runs = await runChecks(ctx.root, checks, job);
      try { ctx.broadcast?.('ship', { runs: runs.map((r) => r.id) }); } catch { /* ignore */ }
      const failed = runs.filter((r) => r.exitCode !== 0 || r.failed);
      const result = { runs: runs.map((r) => ({ id: r.id, check: r.check, kind: r.kind, exitCode: r.exitCode, passed: r.passed, failed: r.failed, skipped: r.skipped })) };
      // results are stored before failing the job (a failed job drops its result)
      if (failed.length) throw new Error(`${failed.length} of ${runs.length} check${runs.length === 1 ? '' : 's'} failed: ${failed.map((r) => r.check).join(', ')}`);
      return result;
    },
  });

  registry.register({
    id: 'ship.criterion.set', title: 'Set acceptance criterion status', category: 'ship', level: 'state',
    description: 'Mark an acceptance criterion verified / incomplete / untested / failed by hand (or back to automatic)',
    params: {
      task: { type: 'string', required: true, label: 'Task id', pattern: '^[\\w-]{1,80}$' },
      criterion: { type: 'string', required: true, label: 'Criterion id', pattern: '^c[0-9a-f]{10}$' },
      status: { type: 'enum', enum: [...STATUSES, 'auto'], required: true, label: 'Status' },
      note: { type: 'string', label: 'Note', maxLength: 500 },
    },
    preview: (p) => ({ command: null, summary: p.status === 'auto' ? 'Remove the manual status' : `Mark the criterion ${p.status}` }),
    run: async (p) => {
      const task = (await loadTasks(ctx.root, { store: ctx.store })).find((t) => t.id === p.task);
      if (!task) throw bad('task not found');
      if (!extractCriteria(task).some((x) => x.id === p.criterion)) throw bad('criterion not found on this task');
      const r = setOverride(ctx.root, p);
      try { ctx.broadcast?.('ship', { criterion: r.criterion }); } catch { /* ignore */ }
      return r;
    },
  });
}
