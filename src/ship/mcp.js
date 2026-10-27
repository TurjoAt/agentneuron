// MCP tools for Ship check (agent A). All read-only: never run project commands or touch the network
// (only read-only git queries and bounded file reads).
import { validRev } from '../git2/run.js';
import { completionReport, readiness, placeholders } from './index.js';
import { allScope, taskScope } from './scope.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'get_ship_report', description: 'Completion report for the current changes: verdict, changed files, last test/build/lint runs, acceptance criteria with evidence, readiness blockers. Read-only; never runs commands.',
    inputSchema: obj({ base: { type: 'string', description: 'Git base ref (default: HEAD, i.e. uncommitted changes)' } }, []) },
  { name: 'get_task_scope', description: 'Acceptance criteria of board tasks with status verified / incomplete / untested / failed and the evidence for each.',
    inputSchema: obj({ task: { type: 'string', description: 'Task id (default: all open tasks)' } }, []) },
];

/** ctx: { root, config, store, home }. Returns { [name]: async (args) => result }. */
export function makeTools(ctx) {
  const root = ctx.root;
  return {
    async get_ship_report({ base } = {}) {
      if (base !== undefined && (typeof base !== 'string' || !validRev(base))) throw new Error('base must be a git revision (branch, tag, hash, HEAD~n)');
      const [r, ready, ph] = await Promise.all([completionReport(root, { base: base || 'HEAD', store: ctx.store }), readiness(root), placeholders(root)]);
      return {
        verdict: r.verdict, reasons: r.reasons, base: r.base, head: r.head,
        changedFiles: r.changedFiles.slice(0, 200), totals: r.totals,
        checks: r.checks.map((c) => ({ id: c.id, kind: c.kind, command: c.command, status: c.status, stale: c.stale, last: c.last ? { id: c.last.id, endedAt: c.last.endedAt, exitCode: c.last.exitCode, passed: c.last.passed, failed: c.last.failed, skipped: c.last.skipped } : null })),
        failures: r.failures.slice(0, 50),
        criteria: r.criteria.map((c) => ({ task: c.task, id: c.id, text: c.text, status: c.status, evidence: c.evidence.slice(0, 6) })),
        criteriaSummary: r.criteriaSummary,
        readiness: { ready: ready.ready, blockers: ready.blockers, counts: ready.counts, top: ready.findings.filter((f) => f.severity === 'high').slice(0, 15) },
        placeholders: { count: ph.count, counts: ph.counts, top: ph.findings.filter((f) => f.severity !== 'low').slice(0, 15) },
        howToRun: 'Run checks in the dashboard (Ship check > Report > Run, needs actions.exec) or with `agentneuron ship --run`.',
      };
    },
    async get_task_scope({ task } = {}) {
      if (task !== undefined) {
        if (typeof task !== 'string' || !/^[\w-]{1,80}$/.test(task)) throw new Error('task must be a task id');
        const s = await taskScope(root, task, { store: ctx.store });
        if (!s) throw new Error(`task not found: ${task}`);
        return s;
      }
      return allScope(root, { store: ctx.store, openOnly: true });
    },
  };
}

