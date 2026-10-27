// Permission level metadata (labels, icons, tones) shared by dialogs, palette, settings.
export const LEVELS = {
  read: { label: 'Read', icon: 'eye', tone: 'muted', desc: 'View files, graph, reports. Always on.' },
  state: { label: 'State', icon: 'bookmark', tone: 'info', desc: "agentneuron's own data in .agentneuron/ — board, pins, annotations. Needs the admin role." },
  edit: { label: 'Edit', icon: 'edit', tone: 'accent', desc: 'Write project files, rename, trash, git stage & commit.' },
  exec: { label: 'Exec', icon: 'terminal', tone: 'warn', desc: 'Run commands: packages, scripts, artisan, fetch/pull/push, MCP tests.' },
  danger: { label: 'Danger', icon: 'alert', tone: 'err', desc: 'Discard changes, delete branches, migrate, purge trash.' },
  terminal: { label: 'Terminal', icon: 'terminal', tone: 'err', desc: 'Free-form command lines (no shell). Off unless explicitly enabled.' },
};
export const LEVEL_KEYS = Object.keys(LEVELS);

export const CATEGORY_ICON = {
  files: 'file',
  git: 'git',
  packages: 'archive',
  scripts: 'play',
  framework: 'layers',
  agents: 'agents',
  tasks: 'tasks',
  agentneuron: 'settings',
  workspace: 'folder',
  ship: 'check',
  changes: 'merge',
  brief: 'target',
};

export const HOW_TO_ENABLE = {
  state: 'Sign in with the admin token (or run without tokens on localhost).',
  edit: 'Set "actions": { "edit": true } in .agentneuron/config.json, or start with: agentneuron start --enable edit',
  exec: 'Set "actions": { "exec": true } in .agentneuron/config.json, or start with: agentneuron start --enable exec',
  danger: 'Set "actions": { "danger": true } in .agentneuron/config.json, or start with: agentneuron start --enable danger',
  terminal: 'Set "actions": { "terminal": true } in .agentneuron/config.json, or start with: agentneuron start --enable terminal',
};
