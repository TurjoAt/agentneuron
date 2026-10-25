import fs from 'node:fs';
import path from 'node:path';
import { scanSecrets } from './secrets.js';
import { isIgnored } from '../core/classify.js';
import { falseClaimIssues } from '../verify/index.js';

const DAY = 86400000;
const CONTEXT_KINDS = new Set(['context', 'rules']);
const GENERATED_DIRS = /(^|\/)(node_modules|vendor|dist|build|\.next|storage|\.git|\.agentneuron|coverage|tmp|temp|cache|\.cache|logs?|out|target)(\/|$)/;
const PATH_EXTS = 'md|mdc|js|mjs|cjs|ts|tsx|jsx|json|yml|yaml|toml|py|php|rb|go|rs|java|sh|css|scss|html|vue|svelte|sql|txt|env|lock|xml|conf';
const PATH_RE = /^(?:\.{1,2}\/)*[A-Za-z0-9_@.\-\[\]()]+(?:\/[A-Za-z0-9_@.\-\[\]()]+)*\/?$/;
const EXT_RE = new RegExp(`\\.(?:${PATH_EXTS})$`, 'i');

/**
 * @param {{root:string, files:object[], contents:Map<string,string>, links:object[], now?:number}} input
 * @returns {object[]} Issue[]
 */
export function lint({ root, files = [], contents = new Map(), links = [], now = Date.now() }) {
  const issues = [];
  const byPath = new Map(files.map((f) => [f.path, f]));

  // broken-link
  for (const l of links) {
    if (!l.broken) continue;
    const label = { 'md-link': 'Link', wiki: 'Wiki link', import: '@import', ref: 'Reference', mention: 'Mention' }[l.type] || 'Link';
    issues.push({
      id: `broken-link:${l.from}:${l.line ?? 0}:${l.to}`,
      rule: 'broken-link',
      severity: l.type === 'mention' || l.type === 'ref' ? 'warn' : 'error',
      path: l.from,
      line: l.line,
      message: `${label} to "${l.to}" does not resolve to an existing file`,
      hint: `Fix the path${l.raw ? ` in "${l.raw}"` : ''}, create ${l.to}, or remove the reference so agents do not chase a missing file.`,
    });
  }

  // inbound link counts for orphan rule
  const inbound = new Map();
  for (const l of links) {
    if (l.broken || l.from === l.to) continue;
    inbound.set(l.to, (inbound.get(l.to) || 0) + 1);
  }

  for (const f of files) {
    const content = contents.get(f.path);
    const text = typeof content === 'string' ? content : '';

    // empty-file
    if ((typeof content === 'string' && content.trim() === '') || (content == null && f.size === 0)) {
      issues.push({
        id: `empty-file:${f.path}`,
        rule: 'empty-file',
        severity: CONTEXT_KINDS.has(f.kind) ? 'warn' : 'info',
        path: f.path,
        message: 'File is empty',
        hint: 'Fill it in or delete it; an empty context file gives the agent nothing.',
      });
      continue;
    }

    // large-context
    if (CONTEXT_KINDS.has(f.kind) && f.tokens > 5000) {
      const err = f.tokens > 10000;
      issues.push({
        id: `large-context:${f.path}`,
        rule: 'large-context',
        severity: err ? 'error' : 'warn',
        path: f.path,
        message: `${f.kind} file is ~${f.tokens.toLocaleString('en-US')} tokens (limit ${err ? '10,000' : '5,000'}) and is loaded into every session`,
        hint: 'Split rarely needed parts into separate docs and @import or link them on demand; keep always-loaded context short.',
      });
    }

    // stale-plan
    if ((f.kind === 'plan' || f.kind === 'todo') && f.mtime && now - f.mtime > 30 * DAY) {
      const days = Math.floor((now - f.mtime) / DAY);
      issues.push({
        id: `stale-plan:${f.path}`,
        rule: 'stale-plan',
        severity: 'warn',
        path: f.path,
        message: `${f.kind} not modified for ${days} days`,
        hint: 'Update it, archive it, or delete it so agents are not guided by an outdated plan.',
      });
    }

    // orphan
    if (['doc', 'plan', 'todo', 'decision', 'other'].includes(f.kind) && files.length > 1 && !inbound.get(f.path)) {
      issues.push({
        id: `orphan:${f.path}`,
        rule: 'orphan',
        severity: 'info',
        path: f.path,
        message: 'No other file links to this one',
        hint: 'Link it from README.md, CLAUDE.md or AGENTS.md so people and agents can find it, or remove it if obsolete.',
      });
    }

    // missing-path
    issues.push(...missingPaths(root, f, text, byPath));

    // secrets
    issues.push(...scanSecrets(f.path, text));
  }

  issues.push(...duplicateRules(files, contents));
  try { issues.push(...falseClaimIssues({ root, files, contents })); } catch { /* truth check is best-effort */ }
  return issues;
}

function stripFences(text) {
  // keep line numbers: blank out fenced lines, return array of {line, text}
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((t, i) => {
    const m = /^\s*(```+|~~~+)/.exec(t);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return;
    }
    if (!fence) out.push({ line: i + 1, text: t });
  });
  return out;
}

function missingPaths(root, f, text, byPath) {
  const out = [];
  if (!root) return out;
  const seen = new Set();
  const dir = f.dir || '';
  for (const { line, text: t } of stripFences(text)) {
    const re = /`([^`\n]{3,200})`/g;
    let m;
    while ((m = re.exec(t))) {
      let cand = m[1].trim();
      if (/\s/.test(cand) || /[*?<>{}$|;:=,!]/.test(cand) || /^(?:[a-z]+:)?\/\//i.test(cand)) continue;
      if (/^[~/]/.test(cand) || cand.startsWith('#')) continue;
      if (!cand.includes('/') || !PATH_RE.test(cand) || !(EXT_RE.test(cand) || cand.endsWith('/'))) continue;
      cand = cand.replace(/\/$/, '');
      if (GENERATED_DIRS.test(cand)) continue;
      if (/^\d+(\.\d+)+/.test(cand)) continue; // version-like
      const key = cand;
      if (seen.has(key)) continue;
      seen.add(key);
      const rel = path.posix.normalize(cand);
      const fromDir = path.posix.normalize(path.posix.join(dir, cand));
      if (rel.startsWith('..')) continue;
      if (byPath.has(rel) || byPath.has(fromDir)) continue;
      if (existsInside(root, rel) || existsInside(root, fromDir)) continue;
      // Docs often shorten paths (`layouts/app.blade.php` for resources/views/layouts/app.blade.php).
      if (projectSuffixes(root).has(rel)) continue;
      out.push({
        id: `missing-path:${f.path}:${line}:${cand}`,
        rule: 'missing-path',
        severity: 'warn',
        path: f.path,
        line,
        message: `\`${cand}\` is mentioned but does not exist in the project`,
        hint: 'The file was probably moved or deleted. Update the path or remove the mention so agents do not look for it.',
      });
    }
  }
  return out;
}

const suffixCache = new Map(); // root -> { ts, set }
const SUFFIX_TTL = 15000;
const SUFFIX_MAX_FILES = 50000;

/** Every trailing path fragment of every project file/dir ("c.php", "b/c.php", ...), cached briefly. */
function projectSuffixes(root) {
  const hit = suffixCache.get(root);
  if (hit && Date.now() - hit.ts < SUFFIX_TTL) return hit.set;
  const set = new Set();
  let count = 0;
  const add = (rel) => {
    const segs = rel.split('/');
    for (let i = segs.length - 1; i >= 0; i--) set.add(segs.slice(i).join('/'));
  };
  const walk = (relDir) => {
    if (count > SUFFIX_MAX_FILES) return;
    let ents;
    try { ents = fs.readdirSync(path.join(root, relDir), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (isIgnored(rel)) continue;
      count++;
      add(rel);
      if (e.isDirectory()) walk(rel);
    }
  };
  walk('');
  suffixCache.set(root, { ts: Date.now(), set });
  return set;
}

function existsInside(root, rel) {
  try {
    const abs = path.resolve(root, rel);
    if (abs !== path.resolve(root) && !abs.startsWith(path.resolve(root) + path.sep)) return false;
    return fs.existsSync(abs);
  } catch {
    return false;
  }
}

function normalizeRule(line) {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
  if (!m) return null;
  const n = m[1]
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return n.length >= 20 && n.split(' ').length >= 4 ? n : null;
}

function duplicateRules(files, contents) {
  const index = new Map(); // norm -> [{path, tool, line}]
  for (const f of files) {
    if (!CONTEXT_KINDS.has(f.kind)) continue;
    const text = contents.get(f.path);
    if (typeof text !== 'string') continue;
    for (const { line, text: t } of stripFences(text)) {
      const n = normalizeRule(t);
      if (!n) continue;
      if (!index.has(n)) index.set(n, []);
      const arr = index.get(n);
      if (!arr.some((x) => x.path === f.path)) arr.push({ path: f.path, tool: f.tool, line });
    }
  }
  const out = [];
  for (const [, occ] of index) {
    if (occ.length < 2 || new Set(occ.map((o) => o.tool)).size < 2) continue;
    for (const o of occ) {
      const others = occ.filter((x) => x !== o && x.tool !== o.tool).map((x) => `${x.path}:${x.line}`);
      if (!others.length) continue;
      out.push({
        id: `duplicate-rule:${o.path}:${o.line}`,
        rule: 'duplicate-rule',
        severity: 'info',
        path: o.path,
        line: o.line,
        message: `Same rule also appears in ${others.join(', ')}`,
        hint: 'Keep one source of truth (e.g. AGENTS.md) and have the other tools import or reference it, so the copies cannot drift apart.',
      });
    }
  }
  return out;
}
