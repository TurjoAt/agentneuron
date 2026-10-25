// Bootstrap .agentneuron/rules/ from the context files a project already has (dedupes identical rules across tools).
import { parseFrontmatter, toList } from '../agentcenter/frontmatter.js';
import { similarity } from '../agentcenter/sync.js';
import { loadRules, serializeRule, TOOLS } from './rules.js';
import { stripRegions } from './markers.js';
import { slugify, validSlug, globError, cleanText, lf, writeRuleFile } from './safety.js';

// [pattern, tool, kind]: kind 'section' = split on ## headings, 'file' = one rule per file with native frontmatter.
const SOURCES = [
  [/^AGENTS\.md$/, 'codex', 'section'], [/^CLAUDE\.md$/, 'claude', 'section'], [/^GEMINI\.md$/, 'gemini', 'section'],
  [/^\.github\/copilot-instructions\.md$/, 'copilot', 'section'], [/^\.cursorrules$/, 'cursor', 'section'], [/^\.windsurfrules$/, 'windsurf', 'section'],
  [/^\.github\/instructions\/[^/]+\.instructions\.md$/, 'copilot', 'file'], [/^\.cursor\/rules\/(?:[^/]+\/)*[^/]+\.mdc?$/, 'cursor', 'file'], [/^\.windsurf\/rules\/[^/]+\.md$/, 'windsurf', 'file'],
  [/^(?:[^/.][^/]*\/)+AGENTS\.md$/, 'codex', 'nested'], [/^(?:[^/.][^/]*\/)+CLAUDE\.md$/, 'claude', 'nested'], [/^(?:[^/.][^/]*\/)+GEMINI\.md$/, 'gemini', 'nested'],
];
const norm = (s) => lf(s).split('\n').map((l) => l.trim().replace(/^[-*+]\s+/, '- ').replace(/\s+/g, ' ').toLowerCase()).filter(Boolean).join('\n');

/** Split markdown into H2 sections (fence-aware). -> [{ title, body, line }] */
export function splitSections(text) {
  const lines = lf(text).split('\n');
  const out = [];
  let cur = { title: null, lines: [], line: 1 }, h1 = null, fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(l);
    if (h && !l.startsWith('###')) { out.push(cur); cur = { title: cleanText(h[1], 120), lines: [], line: i + 1 }; return; }
    if (!fence && cur.title === null && !h1 && /^#\s+/.test(l)) { h1 = cleanText(l.replace(/^#\s+/, ''), 120); return; }
    cur.lines.push(l);
  });
  out.push(cur);
  return out.map((s) => ({ title: s.title ?? h1 ?? 'Overview', body: s.lines.join('\n').trim(), line: s.line, preamble: s.title === null })).filter((s) => s.body);
}

function scopeOf(v) {
  const list = toList(v).filter((g) => !['**', '**/*', '*'].includes(g));
  return list.every((g) => !globError(g)) ? list : null;
}

function candidatesOf(path, text, tool, kind) {
  const src = stripRegions(lf(text));
  if (kind !== 'file') {
    const scope = kind === 'nested' ? [`${path.slice(0, path.lastIndexOf('/'))}/**`] : [];
    if (scope.some(globError)) return [];
    return splitSections(parseFrontmatter(src).body).map((s) => ({ title: s.title, body: s.body, scope, tools: [tool], from: [{ path, line: s.line }] }));
  }
  const fm = parseFrontmatter(src);
  const d = fm.data;
  let body = fm.body.trim();
  const h1 = /^#\s+(.+)\n*/.exec(body);
  if (h1) body = body.slice(h1[0].length).trim();
  if (!body) return [];
  const scope = scopeOf(tool === 'copilot' ? d.applyTo : d.globs);
  if (!scope) return [];
  const name = path.split('/').pop().replace(/\.(instructions\.md|mdc|md)$/, '');
  const alwaysApply = tool === 'cursor' && d.alwaysApply !== undefined ? d.alwaysApply === true || d.alwaysApply === 'true'
    : tool === 'windsurf' && d.trigger ? d.trigger === 'always_on' : undefined;
  return [{ title: cleanText(d.title || (h1 && h1[1]) || name, 120), description: cleanText(d.description, 300), body, scope, tools: [tool], alwaysApply, from: [{ path, line: 1 }], name }];
}

const sameScope = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');

/**
 * Plan an import from the project's tracked context files. Nothing is written.
 * -> { dir, rules: [{ slug, title, tools, scope, from, content }], duplicates, skipped }
 */
export function planImport(ctx) {
  const contents = ctx.store?.contents || new Map();
  const files = [...contents.keys()].sort();
  const cands = [];
  for (const [re, tool, kind] of SOURCES) {
    for (const p of files.filter((f) => re.test(f))) {
      const t = contents.get(p);
      if (typeof t === 'string' && t.length <= 512 * 1024) cands.push(...candidatesOf(p, t, tool, kind));
    }
  }
  const { dir, rules: existing } = loadRules(ctx.root, ctx.config);
  const have = new Set(existing.map((r) => norm(r.body)));
  const merged = [], duplicates = [], skipped = [];
  for (const c of cands) {
    // a section that only @imports another context file: that file's rules apply to this tool too
    const refs = c.body.split('\n').map((l) => /^@([\w./-]+)$/.exec(l.trim())?.[1]);
    if (refs.every(Boolean)) {
      for (const m of merged.filter((x) => x.from.some((f) => refs.includes(f.path)))) if (!m.tools.some((t) => c.tools.includes(t))) m.tools.push(...c.tools);
      skipped.push({ from: c.from, title: c.title, reason: `imports ${refs.join(', ')}` });
      continue;
    }
    if (have.has(norm(c.body))) { skipped.push({ from: c.from, title: c.title, reason: 'already a source rule' }); continue; }
    const hit = merged.find((m) => sameScope(m.scope, c.scope) && (norm(m.body) === norm(c.body) || (Math.min(m.body.length, c.body.length) > 40 && similarity(m.body, c.body) >= 90)));
    if (hit) {
      for (const t of c.tools) if (!hit.tools.includes(t)) hit.tools.push(t);
      hit.from.push(...c.from);
      duplicates.push({ title: hit.title, from: c.from[0], into: hit.from[0], identical: norm(hit.body) === norm(c.body) });
      continue;
    }
    merged.push({ ...c, tools: [...c.tools], from: [...c.from] });
  }
  const used = new Set(existing.map((r) => r.slug));
  const out = merged.map((m, i) => {
    let base = slugify(m.name || m.title), slug = base, n = 2;
    while (used.has(slug) || !validSlug(slug)) slug = `${base.slice(0, 58)}-${n++}`;
    used.add(slug);
    const tools = TOOLS.filter((t) => m.tools.includes(t));
    const rule = { title: m.title, description: m.description || '', tools, scope: m.scope, priority: merged.length - i, alwaysApply: m.alwaysApply, body: m.body };
    return { slug, title: m.title, tools, scope: m.scope, from: m.from, content: serializeRule(rule) };
  });
  return { dir, rules: out, duplicates, skipped };
}

/** Create the planned rule files (never overwrites). */
export function applyImport(ctx, plan, { slugs = null } = {}) {
  const created = [], errors = [];
  for (const r of plan.rules) {
    if (slugs && !slugs.includes(r.slug)) continue;
    try { writeRuleFile(ctx.root, ctx.config, r.slug, r.content); created.push(r.slug); } catch (e) { errors.push({ slug: r.slug, error: e.message }); }
  }
  return { dir: plan.dir, created, errors };
}
