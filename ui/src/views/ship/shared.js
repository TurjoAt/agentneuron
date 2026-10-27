// Shared labels/tones for the Ship check view.
// ship-ignore-file: the labels below name placeholder patterns themselves.

export const VERDICT = {
  verified: { label: 'Verified', tone: 'ok', icon: 'check', line: 'Checks pass on the current changes and every acceptance criterion has passing test evidence.' },
  partial: { label: 'Partially verified', tone: 'warn', icon: 'target', line: 'Some checks or criteria are still missing evidence.' },
  failing: { label: 'Failing', tone: 'err', icon: 'error', line: 'At least one check or acceptance criterion fails.' },
  unverified: { label: 'Unverified', tone: 'info', icon: 'info', line: 'Nothing has been run against these changes yet.' },
};

export const CRIT = {
  verified: { label: 'verified', tone: 'ok', icon: 'check' },
  failed: { label: 'failed', tone: 'err', icon: 'x' },
  untested: { label: 'untested', tone: 'warn', icon: 'alert' },
  incomplete: { label: 'incomplete', tone: '', icon: 'clock' },
};
export const CRIT_ORDER = ['verified', 'untested', 'incomplete', 'failed'];

export const SEV = {
  high: { label: 'high', tone: 'err', icon: 'error' },
  medium: { label: 'medium', tone: 'warn', icon: 'alert' },
  low: { label: 'low', tone: 'info', icon: 'info' },
};

export const CATEGORY = {
  secrets: 'Secrets', env: 'Environment', debug: 'Debug & dev flags', auth: 'Authentication', cors: 'CORS', credentials: 'Default credentials',
  release: 'Release blockers', dependencies: 'Dependencies & lockfiles', scripts: 'Scripts', build: 'Build', migrations: 'Migrations',
};

export const RULE = {
  'empty-handler': 'Empty handlers', 'log-handler': 'Console-only handlers', 'alert-todo': '"Coming soon" alerts', 'not-implemented': 'Not implemented',
  'fake-api': 'Placeholder API calls', lorem: 'Lorem ipsum', 'dead-link': 'Links to "#"', 'mock-auth': 'Mock authentication', 'demo-data': 'Hard-coded demo data',
  'todo-implement': 'TODO: implement',
};

export const STATUS_LABEL = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', '?': 'new', T: 'type changed', U: 'conflict' };

export const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;

export function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = typeof key === 'function' ? key(x) : x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.entries()];
}

export function duration(a, b) {
  const ms = Math.max(0, (b || 0) - (a || 0));
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}
