// MCP tools for Change review (agent B). All read-only: never spawn processes or touch the network.
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'review_changes', description: 'Risk-classified review of the current diff: sensitive areas touched, removed checks, missing tests, files to read first.',
    inputSchema: obj({ base: { type: 'string', description: 'Git base ref (default: HEAD)' } }, []) },
  { name: 'get_change_impact', description: 'What the changed functions, exports and files may affect: importers, callers, routes, tests and API contracts.',
    inputSchema: obj({ paths: { type: 'string', description: 'Comma list of project-relative paths (default: changed files)' }, base: { type: 'string' } }, []) },
  { name: 'check_package', description: 'Check a dependency before installing it: exists in the lockfile, look-alike of a popular package, suspicious name or source. Offline unless packages.online is enabled.',
    inputSchema: obj({ manager: { type: 'string', enum: ['npm', 'pnpm', 'yarn', 'bun', 'composer', 'pip', 'poetry'] }, name: { type: 'string' }, version: { type: 'string' } }, ['manager', 'name']) },
];

/** ctx: { root, config, store, home }. Returns { [name]: async (args) => result }. */
export function makeTools(_ctx) {
  return {
    async review_changes() { return { note: 'not implemented yet' }; },
    async get_change_impact() { return { note: 'not implemented yet' }; },
    async check_package() { return { note: 'not implemented yet' }; },
  };
}
