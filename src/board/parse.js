// Markdown task parsing and line editing for the board.
import crypto from 'node:crypto';
import { scanLines, blankInlineCode } from '../analysis/links.js';

export const PRIORITIES = ['none', 'low', 'med', 'high', 'urgent'];
export const EXPORT_MARKER = '<!-- agentneuron:export -->';

const ITEM = /^(\s*)((?:[-*+]|\d+[.)])\s+\[)([ xX/])(\]\s+)(.*)$/;
const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const indentOf = (s) => s.replace(/\t/g, '    ').length;

export const charToStatus = (c) => (c === 'x' || c === 'X' ? 'done' : c === '/' ? 'doing' : 'todo');
export const statusToChar = (s) => (s === 'done' ? 'x' : s === 'backlog' || s === 'todo' ? ' ' : '/');

export const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const idFor = (path, title, k) => 'm' + crypto.createHash('sha1').update(`${path}\n${norm(title)}${k ? `#${k}` : ''}`).digest('hex').slice(0, 12);

/** Extract inline meta from a task line text. */
export function parseMeta(text) {
  const masked = blankInlineCode(text);
  const spans = [];
  let due = null; let priority = 'none'; let assignee = null;
  const labels = [];
  for (const m of masked.matchAll(/(^|\s)@due\((\d{4}-\d{2}-\d{2})\)/g)) {
    if (!due) due = m[2];
    spans.push([m.index + m[1].length, m.index + m[0].length]);
  }
  for (const m of masked.matchAll(/(^|\s)!(low|med|high|urgent)\b/gi)) {
    if (priority === 'none') priority = m[2].toLowerCase();
    spans.push([m.index + m[1].length, m.index + m[0].length]);
  }
  for (const m of masked.matchAll(/(^|\s)#([A-Za-z][\w/-]*)/g)) {
    if (!labels.includes(m[2])) labels.push(m[2]);
    spans.push([m.index + m[1].length, m.index + m[0].length]);
  }
  for (const m of masked.matchAll(/(^|\s)@([A-Za-z][\w.-]*?)(?=[.,;:]?(?:\s|$))(?!\()/g)) {
    if (m[2].toLowerCase() === 'due') continue;
    if (!assignee) assignee = m[2];
    spans.push([m.index + m[1].length, m.index + m[0].length]);
  }
  spans.sort((a, b) => b[0] - a[0]);
  let title = text;
  for (const [a, b] of spans) title = title.slice(0, a) + title.slice(b);
  title = title.replace(/\s+/g, ' ').trim();
  const files = [];
  for (const m of text.matchAll(/`([^`\s]*\/[^`\s]*|[^`\s/]+\.[A-Za-z0-9]{1,8})`/g)) if (!files.includes(m[1])) files.push(m[1]);
  return { title, priority, labels, due, assignee, files };
}

export function metaSuffix({ priority, labels, due, assignee }) {
  const parts = [];
  if (priority && priority !== 'none') parts.push(`!${priority}`);
  for (const l of labels || []) parts.push(`#${l}`);
  if (due) parts.push(`@due(${due})`);
  if (assignee) parts.push(`@${assignee}`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function parseMdTasks(path, content) {
  const raw = String(content);
  if (raw.includes(EXPORT_MARKER)) return [];
  const tasks = [];
  const seen = new Map();
  let section = null;
  let cur = null;
  const lines = scanLines(raw);
  for (const { n, text, inFence } of lines) {
    if (inFence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (h) { section = h[1]; cur = null; continue; }
    const m = ITEM.exec(text);
    if (m) {
      const ind = indentOf(m[1]);
      if (cur && ind > cur.indent) {
        cur.checklist.push({ text: m[5].trim(), done: m[3] !== ' ' && m[3] !== '/', line: n, char: m[3] });
        cur.endLine = n;
        continue;
      }
      const meta = parseMeta(m[5]);
      if (!meta.title) { cur = null; continue; }
      const key = norm(meta.title);
      const k = seen.get(key) || 0;
      seen.set(key, k + 1);
      cur = {
        id: idFor(path, meta.title, k), source: 'md', path, line: n, ...meta,
        description: '', mdChar: m[3] === 'X' ? 'x' : m[3], status: charToStatus(m[3]), checklist: [], section, indent: ind, endLine: n,
      };
      tasks.push(cur);
      continue;
    }
    if (cur) {
      if (text.trim() === '') continue;
      const ind = indentOf(/^\s*/.exec(text)[0]);
      if (ind > cur.indent) {
        const t = text.trim().replace(LIST, '');
        cur.description += (cur.description ? '\n' : '') + t;
        cur.endLine = n;
      } else cur = null;
    }
  }
  return tasks;
}

/** Rewrite one task line: new checkbox char and/or meta. Returns the new line. */
export function editLine(line, { char, title, priority, labels, due, assignee } = {}) {
  const m = ITEM.exec(line);
  if (!m) return line;
  const hasMeta = title !== undefined || priority !== undefined || labels !== undefined || due !== undefined || assignee !== undefined;
  let text = m[5];
  if (hasMeta) {
    const cur = parseMeta(text);
    text = (title ?? cur.title) + metaSuffix({
      priority: priority ?? cur.priority, labels: labels ?? cur.labels, due: due === undefined ? cur.due : due, assignee: assignee === undefined ? cur.assignee : assignee,
    });
  }
  return `${m[1]}${m[2]}${char ?? m[3]}${m[4]}${text}`;
}

export function buildTaskLines(t, { indent = '' } = {}) {
  const out = [`${indent}- [${statusToChar(t.status)}] ${t.title}${metaSuffix(t)}`];
  for (const c of t.checklist || []) out.push(`${indent}  - [${c.done ? 'x' : ' '}] ${c.text}`);
  return out;
}
