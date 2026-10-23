import fs from 'node:fs';
import path from 'node:path';
import { lineDiff } from '../core/diff.js';
import { estimateTokens } from '../core/tokens.js';

// Root-level instruction files per tool, and the default sync target path per tool.
export const SYNC_FILES = [
  { tool: 'claude', path: 'CLAUDE.md' },
  { tool: 'codex', path: 'AGENTS.md' },
  { tool: 'gemini', path: 'GEMINI.md' },
  { tool: 'cursor', path: '.cursorrules' },
  { tool: 'copilot', path: '.github/copilot-instructions.md' },
  { tool: 'windsurf', path: '.windsurfrules' },
  { tool: 'aider', path: 'CONVENTIONS.md' },
  { tool: 'zed', path: '.rules' },
  { tool: 'junie', path: '.junie/guidelines.md' },
  { tool: 'cline', path: '.clinerules' },
];
const BY_TOOL = new Map(SYNC_FILES.map((f) => [f.tool, f.path]));

function normLines(text) {
  const set = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    let l = raw.trim().replace(/^[-*+]\s+(\[[ x/]\]\s+)?/, '').replace(/^#+\s+/, '').replace(/\s+/g, ' ').toLowerCase();
    if (l.length < 3 || /^(---|```|<!--)/.test(l)) continue;
    set.add(l);
  }
  return set;
}

export function similarity(a, b) {
  const A = normLines(a), B = normLines(b);
  if (!A.size && !B.size) return 100;
  let inter = 0;
  for (const l of A) if (B.has(l)) inter++;
  const union = A.size + B.size - inter;
  return union ? Math.round((inter / union) * 100) : 100;
}

const importsOf = (text) => new Set([...String(text || '').matchAll(/(?:^|\s)@([\w./-]+\.\w+)/g)].map((m) => m[1].replace(/^\.\//, '')));

/**
 * Compare instruction files of different tools.
 * @param {string} root
 * @param {{path:string}[]} files store files (FileEntry[])
 * @param {Map<string,string>} contents
 * @returns {{ files: object[], pairs: object[], missing: object[] }}
 */
export function syncStatus(root, files, contents) {
  const have = new Set((files || []).map((f) => f.path));
  const present = SYNC_FILES.filter((f) => have.has(f.path) && typeof contents.get(f.path) === 'string');
  const list = present.map((f) => ({ ...f, tokens: estimateTokens(contents.get(f.path)), lines: contents.get(f.path).split('\n').length }));
  const pairs = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i], b = present[j];
      const ca = contents.get(a.path), cb = contents.get(b.path);
      const link = importsOf(ca).has(b.path) ? { from: a.path, to: b.path } : importsOf(cb).has(a.path) ? { from: b.path, to: a.path } : null;
      const sim = similarity(ca, cb);
      const A = normLines(ca), B = normLines(cb);
      let onlyA = 0, onlyB = 0;
      for (const l of A) if (!B.has(l)) onlyA++;
      for (const l of B) if (!A.has(l)) onlyB++;
      const identical = ca.trim() === cb.trim();
      pairs.push({
        a: a.path, b: b.path, toolA: a.tool, toolB: b.tool, similarity: identical ? 100 : sim, onlyA, onlyB,
        status: identical ? 'identical' : link ? 'linked' : sim >= 80 ? 'similar' : sim >= 30 ? 'drifted' : 'diverged',
        ...(link ? { link } : {}),
      });
    }
  }
  const missing = SYNC_FILES.filter((f) => !have.has(f.path) && ['claude', 'codex', 'gemini', 'cursor', 'copilot'].includes(f.tool)).map((f) => ({ tool: f.tool, path: f.path }));
  return { files: list, pairs, missing };
}

function cleanRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('invalid path');
  const r = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (r.startsWith('/') || r.split('/').includes('..')) throw new Error(`invalid path: ${p}`);
  return r;
}

/**
 * Plan copying `source` into `targets` (paths or tool ids). Nothing is written.
 * `mode: 'import'` writes an `@source` import stub instead of a copy.
 */
export function syncPlan(root, { source, targets, mode = 'copy' } = {}) {
  const src = cleanRel(BY_TOOL.get(source) || source);
  const abs = path.resolve(root, src);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('source escapes project root');
  let content;
  try { content = fs.readFileSync(abs, 'utf8'); } catch { throw new Error(`source not readable: ${src}`); }
  const out = [];
  for (const t of Array.isArray(targets) ? targets : []) {
    const rel = cleanRel(BY_TOOL.get(t) || t);
    if (rel === src) continue;
    const tabs = path.resolve(root, rel);
    if (!tabs.startsWith(path.resolve(root) + path.sep)) throw new Error('target escapes project root');
    let existing = null;
    try { existing = fs.readFileSync(tabs, 'utf8'); } catch { /* new file */ }
    const next = mode === 'import' ? `@${src}\n` : content;
    const d = lineDiff(existing ?? '', next);
    out.push({ target: rel, exists: existing !== null, content: next, diff: { added: d.added, removed: d.removed, hunks: d.hunks }, unchanged: existing === next });
  }
  return out;
}
