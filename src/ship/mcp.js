// MCP tools for Ship check (agent A). All read-only: never spawn processes or touch the network.
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'get_ship_report', description: 'Completion report for the current changes: verdict, changed files, last test/build/lint runs, acceptance criteria with evidence, readiness blockers. Read-only; never runs commands.',
    inputSchema: obj({ base: { type: 'string', description: 'Git base ref (default: HEAD, i.e. uncommitted changes)' } }, []) },
  { name: 'get_task_scope', description: 'Acceptance criteria of board tasks with status verified / incomplete / untested / failed and the evidence for each.',
    inputSchema: obj({ task: { type: 'string', description: 'Task id (default: all open tasks)' } }, []) },
];

/** ctx: { root, config, store, home }. Returns { [name]: async (args) => result }. */
export function makeTools(_ctx) {
  return {
    async get_ship_report() { return { note: 'not implemented yet' }; },
    async get_task_scope() { return { note: 'not implemented yet' }; },
  };
}
