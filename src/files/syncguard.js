// Confines agent-file sync (source + targets) to tracked, non-symlinked project files.
import { SYNC_FILES } from '../agentcenter/sync.js';
import { getOps } from './ops.js';
import { resolveSafe } from './paths.js';

const BY_TOOL = new Map(SYNC_FILES.map((f) => [f.tool, f.path]));

/** -> { source, targets } with every entry a validated project-relative path. Throws FileError. */
export function guardSync(ctx, { source, targets } = {}) {
  const ops = getOps(ctx);
  const one = (v) => {
    const { rel } = resolveSafe(ctx.root, BY_TOOL.get(v) || v);
    ops.assertEditable(rel);
    return rel;
  };
  return { source: one(source), targets: (Array.isArray(targets) ? targets : []).map(one) };
}
