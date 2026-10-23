// Task board: markdown tasks (two-way sync) + native tasks + overlay in .agentneuron/board.json.
import crypto from 'node:crypto';
import { FileError, agentneuronPath, readJson, atomicJson, cleanRel } from '../files/paths.js';
import { getOps } from '../files/ops.js';
import {
  parseMdTasks, editLine, statusToChar, charToStatus, buildTaskLines, metaSuffix, PRIORITIES, EXPORT_MARKER,
} from './parse.js';

export { parseMdTasks, parseMeta } from './parse.js';

export const DEFAULT_COLUMNS = [
  { id: 'backlog', title: 'Backlog', wip: null },
  { id: 'todo', title: 'Todo', wip: null },
  { id: 'doing', title: 'In progress', wip: null },
  { id: 'review', title: 'Review', wip: null },
  { id: 'done', title: 'Done', wip: null },
];
const RANK = { backlog: 0, todo: 1, doing: 2, review: 3, done: 99 };
const cache = new WeakMap();
export function getBoard(ctx) {
  if (!cache.has(ctx)) cache.set(ctx, createBoard(ctx));
  return cache.get(ctx);
}

const rid = (p) => p + crypto.randomBytes(5).toString('hex');
const SYNC_KEYS = ['title', 'priority', 'labels', 'due', 'assignee'];

function validatePatch(p, columns) {
  const out = {};
  if (p.title !== undefined) {
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500 || /[\r\n]/.test(p.title)) throw new FileError(400, 'invalid title');
    out.title = p.title.trim();
  }
  if (p.description !== undefined) { if (typeof p.description !== 'string') throw new FileError(400, 'invalid description'); out.description = p.description.slice(0, 20000); }
  if (p.status !== undefined) { if (!columns.some((c) => c.id === p.status)) throw new FileError(400, 'unknown status'); out.status = p.status; }
  if (p.priority !== undefined) { if (!PRIORITIES.includes(p.priority)) throw new FileError(400, 'invalid priority'); out.priority = p.priority; }
  if (p.labels !== undefined) {
    if (!Array.isArray(p.labels) || p.labels.some((l) => typeof l !== 'string' || !/^[A-Za-z][\w/-]{0,40}$/.test(l))) throw new FileError(400, 'invalid labels');
    out.labels = [...new Set(p.labels)];
  }
  if (p.due !== undefined) {
    if (p.due !== null && !(typeof p.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.due))) throw new FileError(400, 'invalid due date');
    out.due = p.due;
  }
  if (p.assignee !== undefined) {
    if (p.assignee !== null && !(typeof p.assignee === 'string' && /^[A-Za-z][\w.-]{0,40}$/.test(p.assignee))) throw new FileError(400, 'invalid assignee');
    out.assignee = p.assignee;
  }
  if (p.files !== undefined) {
    if (!Array.isArray(p.files) || p.files.some((f) => typeof f !== 'string' || f.length > 300)) throw new FileError(400, 'invalid files');
    out.files = p.files;
  }
  if (p.checklist !== undefined) {
    if (!Array.isArray(p.checklist) || p.checklist.some((c) => !c || typeof c.text !== 'string' || /[\r\n]/.test(c.text))) throw new FileError(400, 'invalid checklist');
    out.checklist = p.checklist.map((c) => ({ text: c.text.trim(), done: !!c.done }));
  }
  if (p.order !== undefined) { if (typeof p.order !== 'number' || !Number.isFinite(p.order)) throw new FileError(400, 'invalid order'); out.order = p.order; }
  return out;
}

export function createBoard(ctx) {
  const { root, store } = ctx;
  const file = () => agentneuronPath(root, 'board.json');
  let timer = null;
  let watched = false;

  function load() {
    const d = readJson(file(), null);
    const s = d && typeof d === 'object' ? d : {};
    return {
      version: 1,
      columns: Array.isArray(s.columns) && s.columns.length ? s.columns : DEFAULT_COLUMNS.map((c) => ({ ...c })),
      overlay: s.overlay && typeof s.overlay === 'object' ? s.overlay : {},
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
    };
  }
  const save = (s) => atomicJson(file(), s);
  const changed = () => { try { ctx.broadcast?.('board', { changed: true }); } catch { /* ignore */ } };

  function normStatus(status, columns) {
    if (columns.some((c) => c.id === status)) return status;
    const r = RANK[status] ?? 2;
    return columns[r === 99 ? columns.length - 1 : Math.min(r, columns.length - 1)].id;
  }

  /** Build the full task list from md + native + overlay. */
  function collect(state = load()) {
    const { columns, overlay } = state;
    const out = [];
    const paths = [...store.contents.keys()].sort();
    for (const p of paths) {
      const c = store.contents.get(p);
      if (typeof c !== 'string' || !/\[[ xX/]\]/.test(c)) continue;
      const mtime = store.files.get(p)?.mtime || 0;
      for (const t of parseMdTasks(p, c)) {
        const ov = overlay[t.id] || {};
        if (ov.hidden) continue;
        const f = ov.fields || {};
        let status = ov.status && ov.mdBase === t.mdChar ? ov.status : t.status;
        status = normStatus(status, columns);
        out.push({
          id: t.id, source: 'md', path: p, line: t.line,
          title: f.title ?? t.title, description: f.description ?? t.description, status,
          priority: f.priority ?? t.priority, labels: f.labels ?? t.labels, due: f.due !== undefined ? f.due : t.due,
          assignee: f.assignee !== undefined ? f.assignee : t.assignee, files: f.files ?? t.files,
          checklist: (f.checklist ?? t.checklist).map((x) => ({ text: x.text, done: x.done })),
          comments: ov.comments || [], createdAt: ov.createdAt || mtime, updatedAt: ov.updatedAt || mtime,
          order: ov.order ?? null, section: t.section,
        });
      }
    }
    for (const n of state.tasks) {
      out.push({
        id: n.id, source: 'native', path: null, line: null, title: n.title, description: n.description || '',
        status: normStatus(n.status, columns), priority: n.priority || 'none', labels: n.labels || [], due: n.due || null,
        assignee: n.assignee || null, files: n.files || [], checklist: n.checklist || [], comments: n.comments || [],
        createdAt: n.createdAt, updatedAt: n.updatedAt, order: n.order ?? null, section: null,
      });
    }
    out.forEach((t, i) => { if (t.order == null) t.order = (i + 1) * 1000; });
    return out;
  }

  function get(role) {
    const state = load();
    const tasks = collect(state);
    const labels = [...new Set(tasks.flatMap((t) => t.labels))].sort();
    const assignees = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort();
    return { columns: state.columns, tasks, labels, assignees, mdWritable: !!ctx.can?.('edit', role) };
  }

  const findTask = (id) => collect().find((t) => t.id === id) || null;
  const bump = (ov) => { ov.updatedAt = Date.now(); if (!ov.createdAt) ov.createdAt = ov.updatedAt; };

  /** Find a task in the freshly-read file by id (falls back to the cached line). */
  function freshMd(task) {
    const ops = getOps(ctx);
    const content = ops.readFresh(task.path);
    if (content == null) return null;
    const lines = content.split('\n');
    const t = parseMdTasks(task.path, content).find((x) => x.id === task.id);
    if (!t) return null;
    return { content, lines, t };
  }

  async function mdWrite(task, patch, role) {
    // returns {ok, reason?, newId?}
    if (!ctx.can?.('edit', role)) return { ok: false, reason: 'markdown write-back is disabled: enable actions.edit in .agentneuron/config.json' };
    const fm = freshMd(task);
    if (!fm) return { ok: false, reason: 'task line not found in file (changed on disk?)' };
    const { lines, t } = fm;
    const li = t.line - 1;
    const cr = lines[li].endsWith('\r');
    const base = cr ? lines[li].slice(0, -1) : lines[li];
    const opts = {};
    if (patch.status !== undefined) opts.char = statusToChar(patch.status);
    for (const k of SYNC_KEYS) if (patch[k] !== undefined) opts[k] = patch[k];
    lines[li] = editLine(base, opts) + (cr ? '\r' : '');
    if (patch.checklist && patch.checklist.length === t.checklist.length) {
      patch.checklist.forEach((c, i) => {
        const ci = t.checklist[i].line - 1;
        const ccr = lines[ci].endsWith('\r');
        const cb = ccr ? lines[ci].slice(0, -1) : lines[ci];
        lines[ci] = editLine(cb, { char: c.done ? 'x' : ' ', title: c.text !== t.checklist[i].text ? c.text : undefined }) + (ccr ? '\r' : '');
      });
    }
    const next = lines.join('\n');
    if (next !== fm.content) {
      try { await getOps(ctx).writeTracked(task.path, next); } catch (e) { return { ok: false, reason: String(e.message || e) }; }
    }
    const after = parseMdTasks(task.path, next).find((x) => x.line === t.line);
    return { ok: true, newId: after?.id || task.id, newChar: after?.mdChar };
  }

  async function update(id, rawPatch, role) {
    const state0 = load();
    const task = collect(state0).find((t) => t.id === id);
    if (!task) throw new FileError(404, 'task not found');
    const patch = validatePatch(rawPatch || {}, state0.columns);

    if (task.source === 'native') {
      const s = load();
      const n = s.tasks.find((x) => x.id === id);
      Object.assign(n, patch);
      n.updatedAt = Date.now();
      save(s);
      changed();
      return { task: collect(s).find((t) => t.id === id) };
    }

    // md task
    const syncable = {};
    for (const k of [...SYNC_KEYS, 'status']) if (patch[k] !== undefined) syncable[k] = patch[k];
    if (patch.checklist) syncable.checklist = patch.checklist;
    let res = null;
    if (Object.keys(syncable).length) res = await mdWrite(task, syncable, role);

    const s = load();
    let key = id;
    let ov = s.overlay[id] || {};
    if (res?.ok && res.newId !== id) { delete s.overlay[id]; key = res.newId; }
    ov.fields = ov.fields || {};
    if (res?.ok) {
      for (const k of [...SYNC_KEYS, 'checklist']) delete ov.fields[k];
      if (patch.status !== undefined) {
        const plain = charToStatus(res.newChar);
        if (patch.status === plain) { delete ov.status; delete ov.mdBase; } else { ov.status = patch.status; ov.mdBase = res.newChar; }
      } else if (ov.status && ov.mdBase !== res.newChar) { delete ov.status; delete ov.mdBase; }
    } else {
      for (const k of SYNC_KEYS) if (patch[k] !== undefined) ov.fields[k] = patch[k];
      if (patch.checklist) ov.fields.checklist = patch.checklist;
      if (patch.status !== undefined) { ov.status = patch.status; ov.mdBase = task.source === 'md' ? (freshMd(task)?.t.mdChar ?? statusToChar(task.status)) : undefined; }
    }
    if (patch.description !== undefined) ov.fields.description = patch.description;
    if (patch.files !== undefined) ov.fields.files = patch.files;
    if (patch.order !== undefined) ov.order = patch.order;
    bump(ov);
    s.overlay[key] = ov;
    save(s);
    changed();
    const out = { task: collect(s).find((t) => t.id === key) };
    if (res) { out.mdSynced = res.ok; if (!res.ok) out.reason = res.reason; }
    return out;
  }

  const move = (id, { status, order }, role) => update(id, { ...(status !== undefined ? { status } : {}), ...(order !== undefined ? { order } : {}) }, role);

  async function create({ task: input = {}, path: mdPath }, role) {
    const s0 = load();
    const patch = validatePatch(input, s0.columns);
    const defStatus = s0.columns.some((c) => c.id === 'todo') ? 'todo' : s0.columns[0].id;
    if (!patch.title) throw new FileError(400, 'title required');
    const now = Date.now();
    if (!mdPath) {
      const s = load();
      const n = {
        id: rid('n'), title: patch.title, description: patch.description || '', status: patch.status || defStatus,
        priority: patch.priority || 'none', labels: patch.labels || [], due: patch.due || null, assignee: patch.assignee || null,
        files: patch.files || [], checklist: patch.checklist || [], comments: [], createdAt: now, updatedAt: now,
        order: patch.order ?? (Math.max(0, ...collect(s).map((t) => t.order)) + 1000),
      };
      s.tasks.push(n);
      save(s);
      changed();
      return { task: collect(s).find((t) => t.id === n.id) };
    }
    if (!ctx.can?.('edit', role)) throw new FileError(403, 'creating markdown tasks needs the edit level (enable actions.edit in .agentneuron/config.json)');
    const ops = getOps(ctx);
    const rel = cleanRel(mdPath);
    const content = ops.readFresh(rel);
    if (content == null) throw new FileError(404, 'file not found');
    const lines = content.split('\n');
    const newLines = buildTaskLines({ ...patch, status: patch.status || 'todo', checklist: patch.checklist || [] });
    const sec = typeof input.section === 'string' ? input.section.trim() : '';
    let at = -1;
    if (sec) {
      for (let i = 0; i < lines.length; i++) {
        const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(lines[i]);
        if (h && h[1] === sec) {
          let j = i + 1; let last = i;
          while (j < lines.length && !/^\s{0,3}#{1,6}\s/.test(lines[j])) { if (lines[j].trim()) last = j; j++; }
          at = last + 1;
          break;
        }
      }
    }
    if (at < 0) { while (lines.length && lines[lines.length - 1] === '') lines.pop(); at = lines.length; }
    lines.splice(at, 0, ...newLines);
    let next = lines.join('\n');
    if (!next.endsWith('\n')) next += '\n';
    await ops.writeTracked(rel, next);
    const created = parseMdTasks(rel, next).find((t) => t.line === at + 1);
    const s = load();
    if (created) {
      const ov = {};
      const plain = charToStatus(statusToChar(patch.status || 'todo'));
      if ((patch.status || 'todo') !== plain) { ov.status = patch.status; ov.mdBase = statusToChar(patch.status); }
      if (patch.description) ov.fields = { description: patch.description };
      if (patch.files) ov.fields = { ...(ov.fields || {}), files: patch.files };
      bump(ov);
      s.overlay[created.id] = ov;
      save(s);
    }
    changed();
    return { task: created ? collect(s).find((t) => t.id === created.id) : null, mdSynced: true };
  }

  async function remove(id, role) {
    const task = findTask(id);
    if (!task) throw new FileError(404, 'task not found');
    const s = load();
    if (task.source === 'native') {
      s.tasks = s.tasks.filter((t) => t.id !== id);
      delete s.overlay[id];
      save(s); changed();
      return { deleted: true };
    }
    let res = { ok: false, reason: 'markdown write-back is disabled: enable actions.edit in .agentneuron/config.json' };
    if (ctx.can?.('edit', role)) {
      const fm = freshMd(task);
      if (fm) {
        const { lines, t } = fm;
        lines.splice(t.line - 1, t.endLine - t.line + 1);
        try { await getOps(ctx).writeTracked(task.path, lines.join('\n')); res = { ok: true }; } catch (e) { res = { ok: false, reason: String(e.message || e) }; }
      } else res = { ok: false, reason: 'task line not found in file' };
    }
    const s2 = load();
    if (res.ok) delete s2.overlay[id]; else s2.overlay[id] = { ...(s2.overlay[id] || {}), hidden: true };
    save(s2); changed();
    return res.ok ? { deleted: true, mdSynced: true } : { deleted: true, mdSynced: false, reason: res.reason };
  }

  function comment(id, text, role) {
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new FileError(400, 'invalid comment');
    const task = findTask(id);
    if (!task) throw new FileError(404, 'task not found');
    const c = { id: rid('c'), ts: Date.now(), author: role || 'admin', text: text.trim() };
    const s = load();
    if (task.source === 'native') { const n = s.tasks.find((t) => t.id === id); n.comments = [...(n.comments || []), c]; n.updatedAt = c.ts; } else {
      const ov = s.overlay[id] || {};
      ov.comments = [...(ov.comments || []), c];
      bump(ov);
      s.overlay[id] = ov;
    }
    save(s); changed();
    return { comment: c, task: collect(s).find((t) => t.id === id) };
  }

  function setColumns(columns) {
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > 12) throw new FileError(400, 'columns must be an array of 1-12 items');
    const seen = new Set();
    const cols = columns.map((c) => {
      if (!c || typeof c.id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(c.id) || seen.has(c.id)) throw new FileError(400, 'invalid or duplicate column id');
      seen.add(c.id);
      const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 60) : c.id;
      const wip = c.wip == null || c.wip === '' ? null : Number(c.wip);
      if (wip !== null && (!Number.isInteger(wip) || wip < 0 || wip > 999)) throw new FileError(400, 'invalid wip');
      return { id: c.id, title, wip };
    });
    const s = load();
    s.columns = cols;
    save(s); changed();
    return { columns: cols };
  }

  /** Export native tasks to a markdown file (default TASKS.md). */
  async function exportMd(p = 'TASKS.md') {
    const s = load();
    const rel = cleanRel(p);
    const parts = [EXPORT_MARKER, '# Tasks', ''];
    for (const col of s.columns) {
      const items = s.tasks.filter((t) => normStatus(t.status, s.columns) === col.id);
      if (!items.length) continue;
      parts.push(`## ${col.title}`, '');
      for (const t of items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        const [first, ...rest] = buildTaskLines({ ...t, status: col.id === 'done' ? 'done' : t.status });
        parts.push(first, ...rest);
        if (t.description) for (const l of t.description.split('\n')) parts.push(`  ${l}`);
      }
      parts.push('');
    }
    const content = parts.join('\n').replace(/\n+$/, '\n');
    const ops = getOps(ctx);
    await ops.writeTracked(rel, content);
    return { path: rel, tasks: s.tasks.length };
  }

  // md edits (agents, editor) change tasks too: tell the UI
  function watch() {
    if (watched) return;
    watched = true;
    store.on?.('changed', (ev) => {
      if (!ev || !/\.(md|mdc|markdown|mdx)$/i.test(ev.path || '')) return;
      clearTimeout(timer);
      timer = setTimeout(changed, 200);
      timer.unref?.();
    });
  }

  return { get, update, move, create, remove, comment, setColumns, exportMd, watch, load, collect };
}
