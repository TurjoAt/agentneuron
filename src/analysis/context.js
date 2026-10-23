import { posix } from 'node:path';
import { estimateTokens } from '../core/tokens.js';
import { extractLinks } from './links.js';

const MAX_DEPTH = 5;
const CTX_NAMES = ['CLAUDE.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md', 'CLAUDE.local.md'];

function normDir(dir) {
  let d = String(dir || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (d === '.') d = '';
  return d;
}

function ancestors(dir) {
  const d = normDir(dir);
  const out = [''];
  if (!d) return out;
  const parts = d.split('/');
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : '';
}

export function effectiveContext(dir, files, contents, tool = 'claude') {
  const d = normDir(dir);
  const allPaths = new Set(files.map((f) => f.path));
  const entryOf = new Map(files.map((f) => [f.path, f]));
  const chain = [];
  const parts = [];
  const seen = new Set();

  const push = (path, reason) => {
    const c = contents.get(path);
    if (typeof c !== 'string') return null;
    chain.push({ path, reason, tokens: entryOf.get(path)?.tokens ?? estimateTokens(c) });
    parts.push(`<!-- from: ${path} -->\n${c}`);
    return c;
  };

  const expand = (path, content, depth) => {
    if (depth >= MAX_DEPTH) return;
    for (const l of extractLinks(path, content, allPaths)) {
      if (l.type !== 'import' || l.broken || seen.has(l.to)) continue;
      seen.add(l.to);
      const c = push(l.to, 'import');
      if (c !== null) expand(l.to, c, depth + 1);
    }
  };

  const join = (p, n) => (p ? `${p}/${n}` : n);

  if (tool === 'claude') {
    for (const a of ancestors(d)) {
      for (const n of ['CLAUDE.md', 'CLAUDE.local.md']) {
        const p = join(a, n);
        if (seen.has(p) || !contents.has(p)) continue;
        seen.add(p);
        const c = push(p, a === '' ? 'root' : 'ancestor');
        if (c !== null) expand(p, c, 0);
      }
    }
  } else if (tool === 'codex') {
    for (const a of ancestors(d)) {
      for (const n of ['AGENTS.md', 'AGENTS.override.md']) {
        const p = join(a, n);
        if (seen.has(p) || !contents.has(p)) continue;
        seen.add(p);
        push(p, a === '' ? 'root' : 'ancestor');
      }
    }
  } else if (tool === 'cursor') {
    if (contents.has('.cursorrules')) { seen.add('.cursorrules'); push('.cursorrules', 'rule'); }
    for (const a of ancestors(d)) {
      const prefix = join(a, '.cursor/rules/');
      const rules = files.map((f) => f.path).filter((p) => p.startsWith(prefix) && p.endsWith('.mdc')).sort();
      for (const p of rules) {
        const c = contents.get(p);
        if (typeof c !== 'string' || seen.has(p)) continue;
        if (!/^\s*alwaysApply\s*:\s*true\s*$/m.test(frontmatter(c))) continue;
        seen.add(p);
        push(p, 'rule');
      }
    }
  }

  const text = parts.join('\n\n');
  return { dir: d, tool, chain, text, tokens: estimateTokens(text) };
}

export function contextDirs(files) {
  const dirs = new Set(['']);
  for (const f of files) {
    if (CTX_NAMES.includes(f.name)) dirs.add(normDir(f.dir));
    else if (/(^|\/)\.cursor\/rules\//.test(f.path)) {
      dirs.add(normDir(f.path.split('/.cursor/rules/')[0].replace(/^\.cursor\/rules\/.*/, '')));
    }
  }
  return [...dirs].sort();
}
