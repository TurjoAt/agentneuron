// Change review (agent B): review guardian, impact analyzer, checkpoints, package guard.
// Contract: docs/internal/quality-contract.md (Slice B). User doc: docs/changes.md.
export { reviewChanges, reviewMarkdown, classifyFile } from './review.js';
export { analyzeImpact, impactMarkdown } from './impact.js';
export {
  listCheckpoints, getCheckpoint, createCheckpoint, deleteCheckpoint, pruneCheckpoints,
  compareCheckpoint, checkpointFileDiff, planRestore, restoreCheckpoint, REF_PREFIX,
} from './checkpoints.js';
export { scanPackages, checkPackage, lookalike, readLockfiles } from './packages.js';

/** Online package lookups need `"packages": { "online": true }` in config; the server additionally requires admin. */
export const packagesOnline = (config) => !!(config && config.packages && typeof config.packages === 'object' && config.packages.online === true);
