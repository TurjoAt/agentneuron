// Tool + kind metadata (labels, colors). Colors are also mirrored as CSS vars
// (--tool-<name>) in app.css; canvas code reads from here.

export const TOOLS = {
  claude: { label: 'Claude', color: '#ff8a4c', light: '#d9622b' },
  codex: { label: 'Codex', color: '#2dd4a7', light: '#0f9f7b' },
  cursor: { label: 'Cursor', color: '#8b7dff', light: '#5b4ee0' },
  copilot: { label: 'Copilot', color: '#c07bff', light: '#9445e0' },
  windsurf: { label: 'Windsurf', color: '#22d3ee', light: '#0891b2' },
  gemini: { label: 'Gemini', color: '#4f8dff', light: '#2563eb' },
  generic: { label: 'Generic', color: '#8b97a8', light: '#64748b' },
};

export const TOOL_ORDER = Object.keys(TOOLS);

export function toolOf(t) {
  return TOOLS[t] ? t : 'generic';
}

export function toolColor(t, theme = 'dark') {
  const m = TOOLS[toolOf(t)];
  return theme === 'light' ? m.light : m.color;
}

export const KINDS = {
  context: 'Context',
  rules: 'Rules',
  agent: 'Agent',
  skill: 'Skill',
  command: 'Command',
  memory: 'Memory',
  config: 'Config',
  doc: 'Doc',
  todo: 'Todo',
  decision: 'Decision',
  plan: 'Plan',
  readme: 'Readme',
  changelog: 'Changelog',
  other: 'Other',
};

export const KIND_SHORT = {
  context: 'ctx', rules: 'rule', agent: 'agent', skill: 'skill', command: 'cmd', memory: 'mem', config: 'cfg',
  doc: 'doc', todo: 'todo', decision: 'adr', plan: 'plan', readme: 'readme', changelog: 'log', other: '',
};

export const LINK_TYPES = {
  'md-link': { label: 'Markdown link', dash: [], width: 1.1 },
  wiki: { label: 'Wiki link', dash: [2, 3], width: 1.1 },
  import: { label: '@import', dash: [], width: 2.2 },
  mention: { label: 'Mention', dash: [1, 4], width: 0.8 },
  hierarchy: { label: 'Hierarchy', dash: [8, 4], width: 1.6 },
  ref: { label: 'Reference', dash: [6, 3, 1, 3], width: 1 },
};

export const SEVERITY = {
  error: { label: 'Error', rank: 0 },
  warn: { label: 'Warning', rank: 1 },
  info: { label: 'Info', rank: 2 },
};

export const GIT_STATUS = {
  M: { label: 'Modified', cls: 'mod' },
  A: { label: 'Added', cls: 'add' },
  D: { label: 'Deleted', cls: 'del' },
  '?': { label: 'Untracked', cls: 'unt' },
  R: { label: 'Renamed', cls: 'ren' },
};

export const CONTEXT_TOOLS = ['claude', 'codex', 'cursor', 'copilot', 'windsurf', 'gemini'];
