import path from 'node:path';
import chokidar from 'chokidar';
import { isCandidate, isIgnored } from './classify.js';

const DEBOUNCE_MS = 150;

/**
 * Watch the project for candidate files. onEvent({type:'add'|'change'|'unlink', path}) is
 * debounced per path. Returns { close(), ready: Promise<void> }.
 */
export function createWatcher(root, config, onEvent) {
  const timers = new Map();
  const pending = new Map();
  const debounceMs = config?.debounceMs ?? DEBOUNCE_MS;

  const toRel = (abs) => path.relative(root, abs).split(path.sep).join('/');

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    ignored: (p, stats) => {
      const rel = toRel(p);
      if (!rel || rel.startsWith('..')) return false;
      if (isIgnored(rel, config)) return true;
      if (stats && stats.isFile()) return !isCandidate(rel, config);
      return false;
    },
  });

  function schedule(type, abs) {
    const rel = toRel(abs);
    if (!isCandidate(rel, config)) return;
    const prev = pending.get(rel);
    // add followed by change is still an add
    pending.set(rel, prev === 'add' && type === 'change' ? 'add' : type);
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => {
      const t = pending.get(rel);
      pending.delete(rel);
      timers.delete(rel);
      try { onEvent({ type: t, path: rel }); } catch { /* listener errors must not kill the watcher */ }
    }, debounceMs));
  }

  watcher.on('add', (p) => schedule('add', p));
  watcher.on('change', (p) => schedule('change', p));
  watcher.on('unlink', (p) => schedule('unlink', p));
  watcher.on('error', () => {});

  const ready = new Promise((resolve) => watcher.once('ready', resolve));

  return {
    ready,
    async close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      pending.clear();
      await watcher.close();
    },
  };
}
