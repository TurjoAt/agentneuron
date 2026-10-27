// MCP tools for Change review (agent B). All read-only: never spawn processes (other than read-only git)
// and never touch the network: check_package uses only registry facts already cached by the dashboard/CLI
// when packages.online is enabled.
import { reviewChanges } from './review.js';
import { analyzeImpact } from './impact.js';
import { checkPackage } from './packages.js';
import { packagesOnline } from './index.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'review_changes', description: 'Risk-classified review of the current diff: sensitive areas touched, removed checks, missing tests, files to read first.',
    inputSchema: obj({ base: { type: 'string', description: 'Git base ref (default: HEAD)' } }, []) },
  { name: 'get_change_impact', description: 'What the changed functions, exports and files may affect: importers, callers, routes, tests and API contracts.',
    inputSchema: obj({ paths: { type: 'string', description: 'Comma list of project-relative paths (default: changed files)' }, base: { type: 'string' } }, []) },
  { name: 'check_package', description: 'Check a dependency before installing it: exists in the lockfile, look-alike of a popular package, suspicious name or source. Offline unless packages.online is enabled.',
    inputSchema: obj({ manager: { type: 'string', enum: ['npm', 'pnpm', 'yarn', 'bun', 'composer', 'pip', 'poetry'] }, name: { type: 'string' }, version: { type: 'string' } }, ['manager', 'name']) },
];

const str = (v, k) => { if (v !== undefined && typeof v !== 'string') throw new Error(`${k} must be a string`); return v || undefined; };

/** ctx: { root, config, store, home }. Returns { [name]: async (args) => result }. */
export function makeTools(ctx) {
  const root = ctx.root;
  return {
    async review_changes({ base } = {}) {
      const r = await reviewChanges(root, { base: str(base, 'base') });
      // agents get the reasons, not the per-hunk breakdown
      return { ...r, files: r.files.slice(0, 150).map(({ hunks, ...f }) => ({ ...f, hunks: hunks.length })) };
    },
    async get_change_impact({ paths, base } = {}) {
      const r = await analyzeImpact(root, { paths: str(paths, 'paths'), base: str(base, 'base') });
      return { available: r.available, reason: r.reason, changed: r.changed, affected: r.affected, truncated: r.truncated, stats: r.stats, graph: { nodes: r.nodes.length, edges: r.edges.length } };
    },
    async check_package({ manager, name, version } = {}) {
      return checkPackage(root, { manager, name, version: str(version, 'version') }, { online: false, cacheOnly: packagesOnline(ctx.config) });
    },
  };
}
