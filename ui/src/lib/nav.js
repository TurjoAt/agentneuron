// View registry: order defines the 1–9 keyboard shortcuts; `group` gives the sidebar sections.
// `desc` is shown in the command palette and the product map; `related` drives the "related pages" strip.
export const VIEWS = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Monitor', desc: 'Everything at a glance: health, live agents, cost and tasks', related: ['live', 'usage', 'health', 'tasks'] },
  { id: 'live', label: 'Live', icon: 'radar', group: 'Monitor', desc: 'What each agent is editing right now', related: ['sessions', 'agents', 'diff', 'graph'] },
  { id: 'sessions', label: 'Sessions', icon: 'message', group: 'Monitor', desc: 'Every agent session with a step-by-step replay', related: ['live', 'usage', 'insights', 'files'] },
  { id: 'graph', label: 'Graph', icon: 'graph', group: 'Monitor', desc: 'How context files link to each other', related: ['files', 'context', 'health'] },
  { id: 'usage', label: 'Usage & cost', icon: 'activity', group: 'Analytics', desc: 'Tokens, cost, cache, tools, prompts and activity', related: ['sessions', 'insights', 'reports', 'verify'] },
  { id: 'insights', label: 'Insights', icon: 'sparkles', group: 'Analytics', desc: 'Lessons, cost by feature and rule effects', related: ['usage', 'sessions', 'rules', 'reports'] },
  { id: 'reports', label: 'Reports', icon: 'chart', group: 'Analytics', desc: 'Trends over time, exportable', related: ['usage', 'insights', 'health'] },
  { id: 'files', label: 'Files', icon: 'files', group: 'Context', desc: 'Browse, edit and pin context files', related: ['diff', 'graph', 'context', 'health'] },
  { id: 'diff', label: 'Diff', icon: 'diff', group: 'Context', desc: 'Compare any two versions of a file', related: ['files', 'git', 'live'] },
  { id: 'context', label: 'Context', icon: 'context', group: 'Context', desc: 'What each tool actually loads, per folder', related: ['files', 'memory', 'rules', 'verify'] },
  { id: 'memory', label: 'Memory & plans', icon: 'brain', group: 'Context', desc: "Claude's saved memory and plans, checked against the repo", related: ['context', 'verify', 'sessions'] },
  { id: 'health', label: 'Health', icon: 'health', group: 'Context', desc: 'Lint, broken links and secrets in context files', related: ['verify', 'files', 'graph'] },
  { id: 'verify', label: 'Truth & safety', icon: 'shield', group: 'Context', desc: 'False instructions, risky config and agent settings', related: ['health', 'memory', 'rules', 'agents'] },
  { id: 'rules', label: 'Rules studio', icon: 'flag', group: 'Context', desc: 'Write, compile and sync rules across tools', related: ['context', 'verify', 'insights'] },
  { id: 'agents', label: 'Agents', icon: 'agents', group: 'Agents', desc: 'Agent config, MCP servers, sync and radar', related: ['live', 'sessions', 'usage', 'verify'] },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', group: 'Agents', desc: 'Board, list and timeline of agent and human tasks', related: ['git', 'sessions', 'overview'] },
  { id: 'git', label: 'Git', icon: 'git', group: 'Project', desc: 'Status, history, branches and blame', related: ['diff', 'tasks', 'project'] },
  { id: 'project', label: 'Project', icon: 'box', group: 'Project', desc: 'Stack, scripts, dependencies and drift', related: ['git', 'context', 'rules'] },
  { id: 'settings', label: 'Settings', icon: 'settings', desc: 'Appearance, permissions, notifications and jobs', related: ['verify', 'agents'] },
];

/** Sidebar / map sections in order. */
export const GROUPS = [
  { id: 'Monitor', icon: 'radar', desc: 'What agents are doing' },
  { id: 'Analytics', icon: 'activity', desc: 'What it costs and what works' },
  { id: 'Context', icon: 'context', desc: 'What agents read' },
  { id: 'Agents', icon: 'agents', desc: 'Who does the work' },
  { id: 'Project', icon: 'git', desc: 'The repo itself' },
];

/** Bottom bar on phones: these views, then a "More" sheet with everything grouped. */
export const MOBILE_PRIMARY = ['overview', 'live', 'sessions', 'usage'];

export const VIEW_IDS = new Set(VIEWS.map((v) => v.id));
export const viewMeta = (id) => VIEWS.find((v) => v.id === id) || null;

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
  // contract form of commit links (#/git?tab=log&commit=) → what the Git view reads (tab=history&hash=)
  if (view === 'git' && (params.tab === 'log' || (params.commit && !params.tab))) {
    const { commit, ...rest } = params;
    return { view, params: { ...rest, tab: 'history', ...(commit && !rest.hash ? { hash: commit } : {}) } };
  }
  const moved = MOVED[`${view}:${params.tab}`];
  if (moved) {
    const { tab: _t, session, ...rest } = params;
    return { view: moved, params: session && !rest.id ? { ...rest, id: session } : rest };
  }
  return { view: VIEW_IDS.has(view) ? view : 'overview', params };
}
