// Entity side panel: any session, file, commit, task, tool, model or agent can be opened from anywhere.
// Public API (used by other views): openEntity(kind, id, label), closeEntity(), backEntity(), entityHref(kind, id), <EntityLink />.
import { href } from './nav.js';

export const ENTITY_KINDS = ['session', 'file', 'commit', 'task', 'tool', 'model', 'agent'];

/** Display metadata per kind: icon (Icon.svelte name) and a human label. */
export const ENTITY_META = {
  session: { icon: 'message', label: 'Session' },
  file: { icon: 'file', label: 'File' },
  commit: { icon: 'commit', label: 'Commit' },
  task: { icon: 'checkSquare', label: 'Task' },
  tool: { icon: 'terminal', label: 'Tool' },
  model: { icon: 'sparkles', label: 'Model' },
  agent: { icon: 'agents', label: 'Agent' },
};

class EntityState {
  current = $state(null); // { kind, id, label? }
  history = $state([]);
}
export const entity = new EntityState();

export function openEntity(kind, id, label) {
  if (!ENTITY_KINDS.includes(kind) || id == null || id === '') return;
  const cur = entity.current;
  if (cur && cur.kind === kind && cur.id === String(id)) return;
  if (cur) entity.history = [...entity.history.slice(-19), cur];
  entity.current = { kind, id: String(id), label };
}
export function closeEntity() { entity.current = null; entity.history = []; }
export function backEntity() {
  const prev = entity.history[entity.history.length - 1];
  entity.history = entity.history.slice(0, -1);
  entity.current = prev || null;
}

/** Deep link for an entity's own page. */
export function entityHref(kind, id) {
  switch (kind) {
    case 'session': return href('sessions', { id });
    case 'file': return href('files', { path: id });
    case 'commit': return href('git', { tab: 'log', commit: id });
    case 'task': return href('tasks', { task: id });
    case 'tool': return href('usage', { tab: 'tools', tool: id });
    case 'model': return href('usage', { tab: 'overview', model: id });
    case 'agent': return href('usage', { tab: 'overview', tool: id });
    default: return href('overview');
  }
}

/** Short display label for an id when no title is known. */
export function entityLabel(kind, id) {
  const s = String(id ?? '');
  if (kind === 'commit') return s.slice(0, 7);
  if (kind === 'session') return s.length > 12 ? s.slice(0, 8) : s;
  if (kind === 'file') return s.slice(s.lastIndexOf('/') + 1) || s;
  if (kind === 'agent') return s === 'claude' ? 'Claude Code' : s === 'codex' ? 'Codex' : s;
  return s;
}
