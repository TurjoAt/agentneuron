// Bookmarks and annotations (.agentneuron only).
import crypto from 'node:crypto';
import { FileError, cleanRel, agentneuronPath, readJson, atomicJson } from './paths.js';

export function createState(ctx) {
  const bmFile = () => agentneuronPath(ctx.root, 'bookmarks.json');
  const anFile = () => agentneuronPath(ctx.root, 'annotations.json');
  const note = (what) => { try { ctx.broadcast?.('files', { changed: what }); } catch { /* ignore */ } };
  const arr = (f) => { const v = readJson(f, []); return Array.isArray(v) ? v : []; };

  // ---- bookmarks
  const bookmarks = () => arr(bmFile());
  function addBookmark({ path: p, label }) {
    const rel = cleanRel(p);
    const list = bookmarks();
    const lbl = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null;
    const i = list.findIndex((b) => b.path === rel);
    if (i >= 0) { if (lbl) list[i].label = lbl; } else list.push({ path: rel, label: lbl, ts: Date.now() });
    atomicJson(bmFile(), list);
    note('bookmarks');
    return list;
  }
  function removeBookmark({ path: p }) {
    const rel = cleanRel(p);
    const list = bookmarks().filter((b) => b.path !== rel);
    atomicJson(bmFile(), list);
    note('bookmarks');
    return list;
  }

  // ---- annotations
  const norm = (s) => String(s ?? '').trim().slice(0, 200);

  /** Find the line for an annotation after the file changed. Returns new line or null. */
  function reanchor(content, ann) {
    const lines = String(content).split('\n');
    const a = norm(ann.anchor);
    if (norm(lines[ann.line - 1]) === a) return ann.line;
    if (!a) return Math.min(Math.max(1, ann.line), lines.length);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      if (norm(lines[i]) === a && (best === null || Math.abs(i + 1 - ann.line) < Math.abs(best - ann.line))) best = i + 1;
    }
    return best;
  }

  function annotations(p) {
    let list = arr(anFile());
    if (p) {
      const rel = cleanRel(p);
      const content = ctx.store.contents.get(rel);
      list = list.filter((x) => x.path === rel);
      if (typeof content === 'string') {
        const all = arr(anFile());
        let changed = false;
        for (const a of list) {
          const nl = reanchor(content, a);
          if (nl === null) { if (!a.stale) { a.stale = true; changed = true; } } else {
            if (a.stale) { a.stale = false; changed = true; }
            if (nl !== a.line) { a.line = nl; changed = true; }
          }
        }
        if (changed) {
          const byId = new Map(list.map((a) => [a.id, a]));
          atomicJson(anFile(), all.map((a) => byId.get(a.id) || a));
        }
      }
    }
    return list;
  }

  function addAnnotation({ path: p, line, text }, role = 'admin') {
    const rel = cleanRel(p);
    const content = ctx.store.contents.get(rel);
    if (typeof content !== 'string') throw new FileError(404, 'file not found');
    const n = Number(line);
    const lines = content.split('\n');
    if (!Number.isInteger(n) || n < 1 || n > lines.length) throw new FileError(400, 'invalid line');
    if (typeof text !== 'string' || !text.trim()) throw new FileError(400, 'text required');
    const a = {
      id: crypto.randomBytes(5).toString('hex'), path: rel, line: n, anchor: norm(lines[n - 1]),
      text: text.trim().slice(0, 2000), author: role, ts: Date.now(), resolved: false,
    };
    const list = arr(anFile());
    list.push(a);
    atomicJson(anFile(), list);
    note('annotations');
    return a;
  }

  function mutate(id, fn) {
    const list = arr(anFile());
    const i = list.findIndex((a) => a.id === id);
    if (i < 0) throw new FileError(404, 'annotation not found');
    const out = fn(list, i);
    atomicJson(anFile(), list);
    note('annotations');
    return out;
  }
  const removeAnnotation = ({ id }) => mutate(String(id), (list, i) => list.splice(i, 1)[0]);
  const resolveAnnotation = ({ id, resolved = true }) => mutate(String(id), (list, i) => { list[i].resolved = resolved !== false; return list[i]; });

  return { bookmarks, addBookmark, removeBookmark, annotations, addAnnotation, removeAnnotation, resolveAnnotation, reanchor };
}
