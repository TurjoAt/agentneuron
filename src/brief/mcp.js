// MCP tools for Agent brief (agent C). All read-only: they never spawn processes (apart from a read-only
// `git log` with a timeout, like the other read tools) and never touch the network.
// Session text follows the MCP prompt policy of get_session_replay: included, secrets masked.
import { briefCtx, buildResume, checkAction, buildPack, buildDebug, getBrief, MAX_ERROR } from './index.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'get_resume_brief', description: 'Evidence-backed resume brief of a session or task: goal, done, failed attempts, decisions, changed files, last test results, next steps. Without arguments: the latest session. `brief` loads a saved brief (id from a handoff note).',
    inputSchema: obj({ session: { type: 'string' }, task: { type: 'string' }, brief: { type: 'string', description: 'Saved brief id (b + 10 hex)' } }, []) },
  { name: 'preflight_check', description: 'Warnings for an action you are about to take (a shell command or files to edit), based on past mistakes, rules and repo facts. Call before installing packages or running risky commands.',
    inputSchema: obj({ command: { type: 'string' }, paths: { type: 'string', description: 'Comma list of project-relative paths' } }, []) },
  { name: 'get_context_pack', description: 'Task-specific context: the files, rules, facts and tests most relevant to a task, within a token budget.',
    inputSchema: obj({ task: { type: 'string', description: 'Task description or board task id' }, budget: { type: 'number', description: 'Token budget (default 8000)' } }, ['task']) },
  { name: 'get_debug_report', description: 'Diagnostic report for an error or stack trace (or, without one, the last failing run): frames mapped to project files, recent changes, related config and dependencies, past similar failures, ranked hypotheses.',
    inputSchema: obj({ error: { type: 'string', description: 'Error text or stack trace' }, run: { type: 'string', description: "Without error: a failing run id, or 'last' (default) for the last failing test/build run" } }, []) },
];

const str = (v, max, what) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error(`${what} must be a string`);
  if (v.length > max) throw new Error(`${what} is too long (max ${max})`);
  return v;
};
const optId = (v, what) => {
  const s = str(v, 200, what);
  if (s && !/^[\w.@:-]{1,200}$/.test(s)) throw new Error(`invalid ${what}`);
  return s || null;
};

/** ctx: { root, config, store, home }. Returns { [name]: async (args) => result }. Never throws at construction. */
export function makeTools(ctx) {
  const B = () => briefCtx(ctx);
  return {
    async get_resume_brief(a = {}) {
      const saved = optId(a.brief, 'brief');
      if (saved) return getBrief(B().root, saved);
      return buildResume(B(), { session: optId(a.session, 'session'), task: optId(a.task, 'task') });
    },
    async preflight_check(a = {}) {
      const r = await checkAction(B(), { command: str(a.command, 4000, 'command'), paths: str(a.paths, 20000, 'paths') });
      return { ...r, verdict: r.blocking ? 'block' : r.warnings.some((w) => w.severity === 'warn') ? 'warn' : 'ok' };
    },
    async get_context_pack(a = {}) {
      const task = str(a.task, 4000, 'task').trim();
      if (!task) throw new Error('task is required');
      return buildPack(B(), { task, budget: a.budget });
    },
    async get_debug_report(a = {}) {
      const error = str(a.error, MAX_ERROR, 'error');
      const run = error.trim() ? null : (optId(a.run, 'run') || 'last');
      return buildDebug(B(), { error, run });
    },
  };
}
