// View registry: order defines the 1–9 keyboard shortcuts.
export const VIEWS = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'graph', label: 'Graph', icon: 'graph' },
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'diff', label: 'Diff', icon: 'diff' },
  { id: 'context', label: 'Context', icon: 'context' },
  { id: 'health', label: 'Health', icon: 'health' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'git', label: 'Git', icon: 'git' },
  { id: 'agents', label: 'Agents', icon: 'agents' },
];

export const VIEW_IDS = new Set(VIEWS.map((v) => v.id));

/** Build an in-app hash href. */
export function href(view, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return `#/${view}${s ? '?' + s : ''}`;
}

export function parseHash(hash) {
  const h = (hash || '').replace(/^#\/?/, '');
  const [view, qs] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  return { view: VIEW_IDS.has(view) ? view : 'overview', params };
}
