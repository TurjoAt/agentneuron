// View registry: order defines the 1–9 keyboard shortcuts; `group` gives the sidebar sections.
export const VIEWS = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Monitor' },
  { id: 'live', label: 'Live', icon: 'radar', group: 'Monitor' },
  { id: 'sessions', label: 'Sessions', icon: 'agents', group: 'Monitor' },
  { id: 'graph', label: 'Graph', icon: 'graph', group: 'Monitor' },
  { id: 'usage', label: 'Usage & cost', icon: 'activity', group: 'Analytics' },
  { id: 'insights', label: 'Insights', icon: 'sparkles', group: 'Analytics' },
  { id: 'reports', label: 'Reports', icon: 'activity', group: 'Analytics' },
  { id: 'files', label: 'Files', icon: 'files', group: 'Context' },
  { id: 'diff', label: 'Diff', icon: 'diff', group: 'Context' },
  { id: 'context', label: 'Context', icon: 'context', group: 'Context' },
  { id: 'memory', label: 'Memory & plans', icon: 'layers', group: 'Context' },
  { id: 'health', label: 'Health', icon: 'health', group: 'Context' },
  { id: 'verify', label: 'Truth & safety', icon: 'shield', group: 'Context' },
  { id: 'rules', label: 'Rules studio', icon: 'flag', group: 'Context' },
  { id: 'agents', label: 'Agents', icon: 'agents', group: 'Agents' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', group: 'Agents' },
  { id: 'git', label: 'Git', icon: 'git', group: 'Project' },
  { id: 'project', label: 'Project', icon: 'layers', group: 'Project' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export const VIEW_IDS = new Set(VIEWS.map((v) => v.id));

/** Build an in-app hash href. */
export function href(view, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return `#/${view}${s ? '?' + s : ''}`;
}

/** Old locations that moved: [view, tab] -> new view (other params are kept). */
const MOVED = { 'agents:sessions': 'sessions', 'insights:replay': 'sessions' };

export function parseHash(hash) {
  const h = (hash || '').replace(/^#\/?/, '');
  const [view, qs] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const moved = MOVED[`${view}:${params.tab}`];
  if (moved) {
    const { tab: _t, session, ...rest } = params;
    return { view: moved, params: session && !rest.id ? { ...rest, id: session } : rest };
  }
  return { view: VIEW_IDS.has(view) ? view : 'overview', params };
}
