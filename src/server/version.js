import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The bundle has these injected by scripts/build.mjs; from source, read package.json once.
// Never logs: the MCP server's stdout must stay protocol-only.
let pkg = null;
function readPkg() {
  if (pkg) return pkg;
  try { pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')); } catch { pkg = {}; }
  return pkg;
}

export const VERSION = globalThis.__AGENTNEURON_VERSION__ || readPkg().version || '0.0.0';
/** Minimum Node major from package.json "engines.node" (">=18"). */
export const NODE_MIN = Number(/\d+/.exec(globalThis.__AGENTNEURON_NODE_ENGINE__ || readPkg().engines?.node || '')?.[0]) || 18;
