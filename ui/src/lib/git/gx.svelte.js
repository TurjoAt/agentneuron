// Shared git-page state + helpers.
import { runAction, canRun, levelReason } from '../actions.js';

export const gx = $state({ tick: 0 });
export const bump = () => { gx.tick++; };

/** Run a git action; refresh all git resources when the job finished. */
export async function act(id, params = {}, opts = {}) {
  const job = await runAction(id, params, opts);
  if (job) bump();
  return job;
}
export const ok = (job) => !!job && (job.status === 'ok' || job.status === 'done' || job.status === 'success' || job.status === undefined);
export const why = (level) => (canRun(level) ? '' : levelReason(level) || `Requires ${level} permission`);

export const hue = (n = '') => [...String(n)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
export const initials = (n = '') => String(n).split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
export const STATUS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'untracked' };
