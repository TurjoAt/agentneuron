// Change review UI helpers.
export const RISK_TONE = { high: 'err', medium: 'warn', low: 'ok' };
export const SEV_TONE = { high: 'err', medium: 'warn', low: 'info', info: 'info' };
export const CONF_TONE = { high: 'err', medium: 'warn', low: 'info' };
export const VERDICT = {
  ok: { tone: 'ok', label: 'Looks fine', icon: 'check' },
  warn: { tone: 'warn', label: 'Check first', icon: 'alert' },
  block: { tone: 'err', label: 'Do not install', icon: 'shield' },
  unknown: { tone: 'info', label: 'Unknown', icon: 'info' },
};
export const GROUP_LABEL = { feature: 'Feature', refactor: 'Refactor', config: 'Config & infra', deps: 'Dependencies', tests: 'Tests', docs: 'Docs' };
export const STATUS_LABEL = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' };
export const CP_STATUS = { changed: 'warn', deleted: 'err', added: 'info', same: 'ok' };
export const RESTORE_LABEL = { overwrite: 'Overwrite', create: 'Re-create', delete: 'Delete', skip: 'Skip' };
export const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'composer', 'pip', 'poetry'];
export const plural = (n, w, many = w + 's') => `${n} ${n === 1 ? w : many}`;
/** What a selective restore does to a file, derived from its checkpoint status (preview fallback). */
export const actionFor = (status) => (status === 'added' ? 'delete' : status === 'deleted' ? 'create' : status === 'changed' ? 'overwrite' : 'skip');
