// MCP tools for Agent brief (agent C). All read-only: never spawn processes or touch the network.
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'get_resume_brief', description: 'Evidence-backed resume brief of a session or task: goal, done, failed attempts, decisions, changed files, last test results, next steps.',
    inputSchema: obj({ session: { type: 'string' }, task: { type: 'string' } }, []) },
  { name: 'preflight_check', description: 'Warnings for an action you are about to take (a shell command or files to edit), based on past mistakes, rules and repo facts. Call before installing packages or running risky commands.',
    inputSchema: obj({ command: { type: 'string' }, paths: { type: 'string', description: 'Comma list of project-relative paths' } }, []) },
  { name: 'get_context_pack', description: 'Task-specific context: the files, rules, facts and tests most relevant to a task, within a token budget.',
    inputSchema: obj({ task: { type: 'string', description: 'Task description or board task id' }, budget: { type: 'number', description: 'Token budget (default 8000)' } }, ['task']) },
  { name: 'get_debug_report', description: 'Diagnostic report for an error or stack trace: frames mapped to project files, recent changes, related config and dependencies, past similar failures, ranked hypotheses.',
    inputSchema: obj({ error: { type: 'string', description: 'Error text or stack trace' } }, ['error']) },
];

/** ctx: { root, config, store, home }. Returns { [name]: async (args) => result }. */
export function makeTools(_ctx) {
  return {
    async get_resume_brief() { return { note: 'not implemented yet' }; },
    async preflight_check() { return { note: 'not implemented yet' }; },
    async get_context_pack() { return { note: 'not implemented yet' }; },
    async get_debug_report() { return { note: 'not implemented yet' }; },
  };
}
