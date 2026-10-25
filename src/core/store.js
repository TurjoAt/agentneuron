import { EventEmitter } from 'node:events';
import { scanFiles, readEntry } from './scanner.js';
import { isCandidate } from './classify.js';
import { createHistory } from './history.js';
import { lineDiff } from './diff.js';

const RING = 500;

/** opts.record=false: read-only use (lint, status, export) - no history snapshots written. */
export function createStore(root, config, { record = true } = {}) {
  const emitter = new EventEmitter();
  const files = new Map();
  const contents = new Map();
  const events = [];
  const history = createHistory(root, config);
  let nextId = 1;
  const extra = config.extraPatterns || [];
  const maxSize = config.maxFileSize;

  function push(ev) {
    events.push(ev);
    if (events.length > RING) events.splice(0, events.length - RING);
    emitter.emit('event', ev);
    emitter.emit('changed', ev);
    return ev;
  }

  async function init() {
    files.clear();
    contents.clear();
    for (const r of await scanFiles(root, config)) {
      files.set(r.entry.path, r.entry);
      contents.set(r.entry.path, r.content);
      if (record) try { history.record(r.entry.path, r.content); } catch { /* history is best-effort */ }
    }
  }

  async function handleFsEvent({ type, path: p }) {
    const known = files.get(p);
    let r = null;
    if (type !== 'unlink' && isCandidate(p, config)) r = await readEntry(root, p, maxSize, extra);

    if (!r) {
      if (!known) return null;
      const old = contents.get(p) || '';
      files.delete(p);
      contents.delete(p);
      return push({
        id: nextId++, type: 'unlink', path: p, ts: Date.now(),
        stats: { added: 0, removed: lineDiff(old, '').removed }, agent: null,
      });
    }

    if (known && known.hash === r.entry.hash) return null;
    const prev = contents.get(p) ?? '';
    const { added, removed } = lineDiff(prev, r.content);
    files.set(p, r.entry);
    contents.set(p, r.content);
    let historyId;
    if (record) try { historyId = history.record(p, r.content)?.id; } catch { /* best-effort */ }
    const ev = {
      id: nextId++, type: known ? 'change' : 'add', path: p, ts: Date.now(),
      file: r.entry, stats: { added, removed }, agent: null,
    };
    if (historyId) ev.historyId = historyId;
    return push(ev);
  }

  return Object.assign(emitter, { files, contents, events, history, init, handleFsEvent });
}
