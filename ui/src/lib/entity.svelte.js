// Entity side panel: any session, file, commit, task, tool, model or agent can be opened from anywhere.
import { href } from './nav.js';

export const ENTITY_KINDS = ['session', 'file', 'commit', 'task', 'tool', 'model', 'agent'];

class EntityState {
  current = $state(null); // { kind, id, label? }
  history = $state([]);
}
export const entity = new EntityState();

export function openEntity(kind, id, label) {
  if (!ENTITY_KINDS.includes(kind) || id == null || id === '') return;
  if (entity.current) entity.history = [...entity.history.slice(-19), entity.current];
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
