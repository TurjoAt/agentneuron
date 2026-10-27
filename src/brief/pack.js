// Smart context builder (#11): a deterministic, task-specific context pack within a token budget.
// Signals: keyword/path match, files named on the task, import-graph neighbours, files co-edited in agent
// sessions and co-changed in git, related tests, context-file sections and verified repo facts. No model.
import path from 'node:path';
import { effectiveContext } from '../analysis/context.js';
import { estimateTokens } from '../core/tokens.js';
import { detectProject } from '../project/index.js';
import { verifyContext } from '../verify/index.js';
import { getUsage } from '../usage/index.js';
import { readRegularAsync } from '../files/safeio.js';
import { maskSecretsInText } from '../health/secrets.js';
import { tokens } from '../insights/text.js';
import { fileIndex, gitCommits, safeCall, validId, clipText } from './util.js';
import { packMarkdown } from './markdown.js';

export const DEFAULT_BUDGET = 8000;
const MIN_BUDGET = 500, MAX_BUDGET = 200000;
const SRC = /\.(?:[cm]?[jt]sx?|svelte|vue|astro|php|py|go|rs|rb|java|kt|cs|swift|scala|ex|exs|sql|graphql|proto|css|scss|html|md|mdx|ya?ml|toml|json|sh)$/i;
const SKIP = /(^|\/)(node_modules|vendor|dist|build|out|coverage|\.git|\.agentneuron)\/|\.min\.|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|poetry\.lock|Cargo\.lock|bun\.lockb?)$/;
const TEST = /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[\w]+$|_test\.(go|py)$|^test_.*\.py$/i;
const MAX_READ = 128 * 1024;
const MAX_FILE_TOKENS_SHARE = 0.6; // one file may take at most 60 % of the budget
const MAX_PARTIALS = 2; // large top-ranked files kept as pointers
const PARTIAL_SHARE = 0.1; // budget reserved for reading the relevant part of one

/** Lower-case identifier pieces of a path or word: "src/userAuth_service.ts" -> user, auth, service, ts, src. */
export function pieces(s) {
  return String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);

/** Relative imports of a source file (JS/TS/Svelte/Vue, Python, PHP require/include, Go is skipped). */
export function importsOf(file, text) {
  const out = new Set();
  const t = String(text || '').slice(0, MAX_READ);
  for (const m of t.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const s = m[1] || m[2] || m[3] || m[4];
    if (s && s.startsWith('.')) out.add(s);
  }
  if (/\.py$/.test(file)) for (const m of t.matchAll(/^\s*from\s+(\.+[\w.]*)\s+import/gm)) out.add(m[1]);
  if (/\.php$/.test(file)) for (const m of t.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+)['"]/g)) out.add(m[1].startsWith('.') || m[1].startsWith('/') ? `.${m[1].startsWith('/') ? '' : '/'}${m[1].replace(/^\.\//, '')}` : `./${m[1]}`);
  return [...out];
}

/** Resolve a relative import to an indexed project file. */
export function resolveImport(from, spec, has) {
  const dir = path.posix.dirname(from);
  let base;
  if (/^\.+[\w.]*$/.test(spec) && /\.py$/.test(from)) {
    const dots = /^\.+/.exec(spec)[0].length;
    let d = dir;
    for (let i = 1; i < dots; i++) d = path.posix.dirname(d);
    base = path.posix.join(d, spec.slice(dots).replace(/\./g, '/'));
    for (const c of [`${base}.py`, `${base}/__init__.py`]) if (has(c)) return c;
    return null;
  }
  base = path.posix.normalize(path.posix.join(dir, spec));
  if (base.startsWith('..')) return null;
  const exts = ['', '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.svelte', '.vue', '.php', '/index.js', '/index.ts', '/index.mjs'];
  for (const e of exts) if (has(base + e)) return base + e;
  if (/\.js$/.test(base) && has(base.replace(/\.js$/, '.ts'))) return base.replace(/\.js$/, '.ts');
  return null;
}

/** Split a context file into heading sections: [{ heading, text, line }]. */
export function sections(text) {
  const out = [];
  let cur = { heading: '', text: [], line: 1 };
  let fence = false;
  String(text || '').split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && /^(#{1,4})\s+(.+)$/.exec(l);
    if (h) { if (cur.text.join('').trim()) out.push(cur); cur = { heading: h[2].trim(), text: [], line: i + 1 }; } else cur.text.push(l);
  });
  if (cur.text.join('').trim()) out.push(cur);
  return out.map((s) => ({ heading: s.heading, line: s.line, text: s.text.join('\n').trim() }));
}

async function readText(root, p) {
  try { const r = await readRegularAsync(path.join(root, p), { maxBytes: MAX_READ, confine: root }); return r ? r.buf.toString('utf8') : null; } catch { return null; }
}

/** Resolve the task: free text or a board task id. */
async function resolveTask(b, task) {
  const raw = String(task || '').trim().slice(0, 4000);
  if (!raw) return null;
  if (validId(raw)) {
    const t = b.tasks().find((x) => x.id === raw);
    if (t) {
      const scope = await safeCall(b.deps.taskScope, [b.root, raw], null);
      const crit = (scope?.criteria || []).map((c) => c.text).filter(Boolean);
      return { id: t.id, text: [t.title, t.description, ...crit, ...(t.checklist || []).map((c) => c.text)].filter(Boolean).join('\n').slice(0, 4000), files: (t.files || []).filter(Boolean), title: t.title };
    }
  }
  return { id: null, text: raw, files: [], title: null };
}

/**
 * Build a context pack. opts: { task (text or board task id), budget }. b: briefCtx(...).
 * Returns { task: { id, text }, budget, tokens, items: [{ kind, path, reason, score, tokens, ... }], skipped, markdown }.
 */
export async function buildPack(b, { task, budget = DEFAULT_BUDGET } = {}) {
  const T = await resolveTask(b, task);
  if (!T) throw Object.assign(new Error('task is required'), { status: 400 });
  const B = Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, Math.floor(Number(budget)) || DEFAULT_BUDGET));
  const tt = new Set([...tokens(T.text)].map(stem));
  for (const w of pieces(T.text)) if (w.length > 2) tt.add(stem(w));
  const idx = await fileIndex(b.root);
  const has = (p) => idx.paths.has(p);
  const sizeOf = new Map(idx.files.map((f) => [f.path, f.size]));
  const lowerText = T.text.toLowerCase();

  // 1. path / name match
  const cand = new Map(); // path -> { path, score, reasons: [], size }
  const bump = (p, s, why) => {
    if (!has(p) || SKIP.test(p)) return;
    const f = cand.get(p) || { path: p, score: 0, reasons: [], size: sizeOf.get(p) || 0 };
    f.score += s;
    if (why && !f.reasons.includes(why)) f.reasons.push(why);
    cand.set(p, f);
  };
  for (const f of idx.files) {
    if (SKIP.test(f.path) || !SRC.test(f.path) || f.size > 2 * 1024 * 1024) continue;
    const base = path.posix.basename(f.path).replace(/\.[^.]+$/, '');
    const bp = new Set(pieces(base).map(stem));
    const dp = new Set(pieces(path.posix.dirname(f.path)).map(stem));
    const hitB = [...bp].filter((w) => tt.has(w) && w.length > 2);
    const hitD = [...dp].filter((w) => tt.has(w) && w.length > 2 && !bp.has(w));
    let s = hitB.length * 3 + hitD.length * 1.5;
    const bn = path.posix.basename(f.path).toLowerCase();
    if (bn.length > 3 && new RegExp(`(^|[^\\w.-])${bn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(lowerText)) s += 6;
    if (f.path.length > 3 && lowerText.includes(f.path.toLowerCase())) s += 8;
    if (s > 0) bump(f.path, s, hitB.length || hitD.length ? `name matches ${[...hitB, ...hitD].slice(0, 4).map((w) => `"${w}"`).join(', ')}` : 'named in the task');
  }
  for (const p of T.files) bump(p, 10, 'listed on the task');

  // 2. content keywords + imports for the strongest candidates
  const byScore = () => [...cand.values()].sort((a, c) => c.score - a.score || (a.path < c.path ? -1 : 1));
  const imports = new Map();
  for (const f of byScore().slice(0, 40)) {
    const text = await readText(b.root, f.path);
    if (text == null) continue;
    const lower = text.toLowerCase();
    const words = [...tt].filter((w) => w.length > 3 && lower.includes(w));
    if (words.length) { f.score += Math.min(4, words.length * 0.75); f.reasons.push(`mentions ${words.slice(0, 3).map((w) => `"${w}"`).join(', ')}`); }
    imports.set(f.path, importsOf(f.path, text).map((s) => resolveImport(f.path, s, has)).filter(Boolean));
  }
  const top = byScore().slice(0, 12);
  for (const f of top) for (const dep of imports.get(f.path) || []) if (dep !== f.path) bump(dep, Math.min(3, f.score * 0.3), `imported by ${f.path}`);
  for (const [p, deps] of imports) for (const f of top) if (p !== f.path && deps.includes(f.path)) bump(p, Math.min(2, f.score * 0.2), `imports ${f.path}`);

  // 3. co-edited in agent sessions, co-changed in git
  const topSet = new Set(top.slice(0, 8).map((f) => f.path));
  if (topSet.size) {
    let sessions = [];
    try { sessions = (await getUsage({ root: b.root, config: b.config, home: b.home, store: b.store, usageBudgetMs: b.usageBudgetMs ?? 1500 }).sessions({ range: '30d' })).sessions || []; } catch { sessions = []; }
    const co = new Map();
    for (const s of sessions) {
      const ft = s.filesTouched || [];
      if (!ft.some((p) => topSet.has(p))) continue;
      for (const p of ft) if (!topSet.has(p)) co.set(p, (co.get(p) || 0) + 1);
    }
    for (const [p, n] of co) bump(p, Math.min(3, n), `edited together in ${n} agent session${n === 1 ? '' : 's'}`);
    const commits = await gitCommits(b.root, { limit: 60 });
    const cc = new Map();
    for (const c of commits) {
      if (c.files.length > 30 || !c.files.some((p) => topSet.has(p))) continue;
      for (const p of c.files) if (!topSet.has(p)) cc.set(p, (cc.get(p) || 0) + 1);
    }
    for (const [p, n] of cc) bump(p, Math.min(2, n * 0.5), `changed together in ${n} commit${n === 1 ? '' : 's'}`);
  }

  // 4. context sections (the effective context of the top files' directories); paths they mention get a boost
  const rules = [];
  const files = b.store ? [...b.store.files.values()] : [];
  if (b.store) {
    const dirs = new Set(['', ...byScore().slice(0, 6).map((f) => path.posix.dirname(f.path)).filter((d) => d !== '.')]);
    const chainFiles = new Set();
    for (const d of dirs) for (const tool of ['claude', 'codex']) for (const c of effectiveContext(d, files, b.store.contents, tool).chain) chainFiles.add(c.path);
    for (const p of [...chainFiles].sort()) {
      for (const s of sections(b.store.contents.get(p))) {
        const st = new Set([...tokens(`${s.heading} ${s.text}`)].map(stem));
        const hits = [...tt].filter((w) => st.has(w));
        const always = /\b(rules?|conventions?|important|must|never|always|commands?|testing|tests?)\b/i.test(s.heading);
        const score = hits.length * 1.5 + (always ? 1 : 0);
        if (score <= 0) continue;
        const text = maskSecretsInText(s.text).slice(0, 2400);
        if (hits.length) for (const m of s.text.matchAll(/[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z0-9]{1,6}|\b[\w-]+\.[a-z]{2,4}\b/g)) if (has(m[0])) bump(m[0], 2, `mentioned in ${p} § ${s.heading || 'top'}`);
        rules.push({ kind: 'rule', path: p, heading: s.heading, line: s.line, text, score, tokens: estimateTokens(text), reason: hits.length ? `section mentions ${hits.slice(0, 3).map((w) => `"${w}"`).join(', ')}` : 'project rules section' });
      }
    }
  }
  // 5. related tests
  const ranked = byScore().filter((f) => f.score >= 1);
  const tests = new Map();
  for (const f of ranked.filter((x) => !TEST.test(x.path)).slice(0, 10)) {
    const stemName = path.posix.basename(f.path).replace(/\.[^.]+$/, '').toLowerCase();
    if (stemName.length < 3 || stemName === 'index') continue;
    for (const t of idx.files) {
      if (!TEST.test(t.path) || SKIP.test(t.path)) continue;
      const tb = path.posix.basename(t.path).toLowerCase();
      if (tb.startsWith(`${stemName}.`) || tb.startsWith(`${stemName}_`) || tb.startsWith(`${stemName}-`) || tb.startsWith(`test_${stemName}`) || tb.includes(`.${stemName}.`)) {
        const prev = tests.get(t.path);
        if (!prev || prev.score < f.score * 0.6) tests.set(t.path, { path: t.path, score: Math.round(f.score * 0.6 * 100) / 100, reason: `tests ${f.path}`, size: t.size });
      }
    }
  }

  // 6. verified facts
  const facts = [];
  let proj = null;
  try { proj = await detectProject(b.root); } catch { proj = null; }
  const pm = (proj?.packageManagers || [])[0];
  if (pm) facts.push({ kind: 'fact', path: pm.lockfile || pm.manifest || null, text: `Package manager: ${pm.id}${pm.lockfile ? ` (lockfile ${pm.lockfile})` : ''}`, score: 5, reason: 'repo fact' });
  for (const s of (proj?.scripts || []).filter((x) => ['test', 'build', 'lint', 'typecheck', 'check', 'dev'].includes(x.name) && x.source === 'package.json').slice(0, 6)) {
    facts.push({ kind: 'fact', path: s.source, text: `\`${s.manager} ${s.name === 'test' ? 'test' : `run ${s.name}`}\` runs \`${clipText(s.command, 160)}\``, score: s.name === 'test' ? 4 : 3, reason: 'package script' });
  }
  if (b.store) {
    let claims = [];
    try { claims = verifyContext({ root: b.root, files, contents: b.store.contents }).claims.filter((c) => c.status === 'ok'); } catch { claims = []; }
    for (const c of claims) {
      const ct = new Set([...tokens(c.text), ...pieces(c.text)].map(stem));
      const hits = [...tt].filter((w) => ct.has(w));
      if (!hits.length) continue;
      facts.push({ kind: 'fact', path: `${c.file}:${c.line}`, text: `Verified ${c.kind}: \`${clipText(c.text, 160)}\`${c.evidence ? ` (${clipText(c.evidence, 120)})` : ''}`, score: 1 + hits.length, reason: 'verified claim in the context files' });
    }
  }

  // 7. fill the budget: facts first (tiny), then by score; deterministic ties by path
  const all = [
    ...facts.map((f) => ({ ...f, tokens: estimateTokens(f.text) })),
    ...ranked.slice(0, 60).map((f) => ({ kind: TEST.test(f.path) ? 'test' : 'file', path: f.path, reason: f.reasons.join('; '), score: Math.round(f.score * 100) / 100, tokens: Math.max(1, Math.ceil(f.size / 4)) })),
    ...[...tests.values()].filter((t) => !ranked.slice(0, 60).some((f) => f.path === t.path)).map((t) => ({ kind: 'test', path: t.path, reason: t.reason, score: t.score, tokens: Math.max(1, Math.ceil(t.size / 4)) })),
    ...rules,
  ];
  const order = { fact: 0, rule: 1, file: 2, test: 3 };
  all.sort((a, c) => (a.kind === 'fact') !== (c.kind === 'fact') ? (a.kind === 'fact' ? -1 : 1) : c.score - a.score || order[a.kind] - order[c.kind] || String(a.path).localeCompare(String(c.path)) || String(a.heading || '').localeCompare(String(c.heading || '')));
  const items = [], skipped = [];
  let used = 0;
  let partials = 0;
  for (const it of all) {
    // a highly ranked file that is too big to include whole is still the place to look: keep it as a pointer
    if ((it.kind === 'file' || it.kind === 'test') && it.tokens > B * MAX_FILE_TOKENS_SHARE && partials < MAX_PARTIALS && it.score >= (all.find((x) => x.kind === 'file')?.score || 0) * 0.5) {
      const share = Math.round(B * PARTIAL_SHARE);
      if (used + share <= B) {
        partials++;
        used += share;
        items.push({ ...it, partial: true, fullTokens: it.tokens, tokens: share, reason: `${it.reason}; large file (~${it.tokens} tokens): read only the parts about the task` });
        continue;
      }
    }
    if (it.tokens > B * MAX_FILE_TOKENS_SHARE || used + it.tokens > B) { skipped.push({ kind: it.kind, path: it.path, tokens: it.tokens, score: it.score, reason: it.tokens > B * MAX_FILE_TOKENS_SHARE ? 'too large for the budget' : 'budget full' }); continue; }
    used += it.tokens;
    items.push(it);
  }
  const out = { generatedAt: Date.now(), task: { id: T.id, text: clipText(T.text, 600) }, budget: B, tokens: used, items, skipped: skipped.slice(0, 50), truncatedIndex: !!idx.truncated };
  out.markdown = packMarkdown(out);
  return out;
}
