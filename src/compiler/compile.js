// Compile source rules into every tool's native files, detect staleness / hand edits, merge edits back.
import { resolveSafe, readTextIfExists, FileError } from '../files/paths.js';
import { getOps } from '../files/ops.js';
import { lineDiff } from '../core/diff.js';
import { loadRules, TOOLS, normTool, byPriority } from './rules.js';
import { placements, toolOfPath, ALLOWED, HEADER, sourceOf, unrender, windsurfMode } from './emit.js';
import { parseRegions, joinParts, hashOf } from './markers.js';
import { writeRuleFile, cleanText, lf } from './safety.js';

const FM = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const splitFm = (t) => { const m = FM.exec(t); return m ? { fm: m[0].replace(/\n$/, ''), rest: t.slice(m[0].length) } : { fm: '', rest: t }; };
const isCrlf = (raw) => { const n = (raw.match(/\n/g) || []).length; return n > 0 && (raw.match(/\r\n/g) || []).length * 2 >= n; };
const regionHash = (kind, content, fm) => hashOf(kind === 'file' ? `${fm}\n${content}` : content);
const blank = (lines) => lines.every((l) => !l.trim());

/** Normalise a --tools list. Throws on unknown names. */
export function selectTools(v) {
  if (v == null || v === true || v === '' || (Array.isArray(v) && !v.length)) return [...TOOLS];
  const list = (Array.isArray(v) ? v : String(v).split(',')).map(normTool).filter(Boolean);
  if (list.includes('all')) return [...TOOLS];
  const bad = list.filter((t) => !TOOLS.includes(t));
  if (bad.length) throw new FileError(400, `unknown tool(s): ${bad.join(', ')} (valid: ${TOOLS.join(', ')})`);
  return TOOLS.filter((t) => list.includes(t));
}

function readOutput(root, rel, maxSize) {
  const { abs } = resolveSafe(root, rel);
  const r = readTextIfExists(abs, maxSize);
  return r ? { raw: r.content, hash: r.hash } : null;
}

/** Insert `region` among parts so the file follows `order` (sources) where possible. */
function insertRegion(parts, region, order) {
  const at = order.indexOf(region.source);
  const idx = (src) => parts.findIndex((p) => p.type === 'region' && p.source === src);
  for (const s of order.slice(at + 1)) { const i = idx(s); if (i >= 0) { parts.splice(i, 0, region, { type: 'text', lines: [''] }); return; } }
  for (const s of order.slice(0, at).reverse()) { const i = idx(s); if (i >= 0) { parts.splice(i + 1, 0, { type: 'text', lines: [''] }, region); return; } }
  const last = parts[parts.length - 1];
  while (last.lines.length && !last.lines[last.lines.length - 1].trim()) last.lines.pop();
  if (parts.some((p) => p.type === 'region') || last.lines.length) last.lines.push('');
  parts.push(region, { type: 'text', lines: [''] });
}

function removeRegion(parts, i) {
  const prev = parts[i - 1], next = parts[i + 1];
  parts.splice(i, 1);
  if (prev?.type === 'text' && next?.type === 'text') {
    if (prev.lines.length && !prev.lines[prev.lines.length - 1].trim() && next.lines.length && !next.lines[0].trim()) next.lines.shift();
    prev.lines.push(...next.lines);
    parts.splice(i, 1);
  }
}

/**
 * Plan a compile. Nothing is written.
 * -> { rulesDir, rules, invalid, tools, outputs: [{ path, tool, kind, exists, action, content?, baseHash, diff, regions, conflicts, error }], mergeBack, stale, ok }
 */
export function planCompile(ctx, { tools, force = false } = {}) {
  const root = ctx.root, config = ctx.config || {};
  const sel = selectTools(tools);
  const { dir, rules, invalid } = loadRules(root, config);
  const usable = rules.filter((r) => !r.errors.length);
  const broken = new Set(rules.filter((r) => r.errors.length).map((r) => sourceOf(r.slug))); // keep their regions until fixed
  const env = { root, config, windsurf: windsurfMode(root, config) };
  const desired = new Map(); // path -> { tool, kind, entries: Map(source -> {rule, content, fm}) }
  for (const rule of usable.sort(byPriority)) {
    for (const tool of rule.tools.filter((t) => sel.includes(t))) {
      for (const p of placements(rule, tool, env)) {
        if (!ALLOWED[tool].test(p.path)) continue; // defence in depth: never leave the tool's own files
        if (!desired.has(p.path)) desired.set(p.path, { tool, kind: p.kind, entries: new Map() });
        desired.get(p.path).entries.set(sourceOf(rule.slug), { rule, content: p.content, fm: p.fm || '' });
      }
    }
  }
  // files that already carry generated regions (orphans after a rule was deleted / re-scoped)
  const paths = new Set(desired.keys());
  for (const [p, c] of ctx.store?.contents || []) {
    if (typeof c !== 'string' || !c.includes('agentneuron:begin')) continue;
    const t = toolOfPath(p);
    if (t && sel.includes(t)) paths.add(p);
  }
  const maxSize = config.maxFileSize ?? 1048576;
  const outputs = [];
  for (const p of [...paths].sort()) {
    const want = desired.get(p) || { tool: toolOfPath(p), kind: /\.(mdc|instructions\.md)$|^\.windsurf\/rules\//.test(p) ? 'file' : 'section', entries: new Map() };
    const out = { path: p, tool: want.tool, kind: want.kind, exists: false, action: 'none', baseHash: null, regions: [], conflicts: [] };
    outputs.push(out);
    let cur;
    try { cur = readOutput(root, p, maxSize); } catch (e) { out.error = e.message; out.action = 'skip'; continue; }
    const order = [...want.entries.keys()];
    const before = cur ? lf(cur.raw) : '';
    out.exists = !!cur;
    out.baseHash = cur?.hash || null;
    let parts;
    try { parts = cur ? parseRegions(before) : null; } catch (e) { out.error = `cannot parse markers: ${e.message}`; out.action = 'skip'; continue; }
    if (!cur) {
      if (!want.entries.size) continue;
      const blocks = order.map((s) => { const e = want.entries.get(s); out.regions.push({ source: s, slug: e.rule.slug, status: 'new' }); return { type: 'region', source: s, content: e.content, hash: regionHash(want.kind, e.content, e.fm) }; });
      const first = want.entries.get(order[0]);
      const head = want.kind === 'file' ? [first.fm] : [HEADER, ''];
      parts = [{ type: 'text', lines: head }];
      for (const b of blocks) parts.push(b, { type: 'text', lines: [''] });
      out.content = joinParts(parts);
      out.diff = diffOf('', out.content);
      out.action = 'create';
      continue;
    }
    const fileFm = want.kind === 'file' ? splitFm(before).fm : '';
    if (want.kind === 'file' && want.entries.size && !parts.some((x) => x.type === 'region')) {
      out.conflicts.push('a hand-written file already exists here; rename or delete it to let the compiler manage it');
      out.action = 'skip';
      continue;
    }
    let editedKept = false;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part.type !== 'region') continue;
      const e = want.entries.get(part.source);
      const edited = regionHash(want.kind, part.content, fileFm) !== part.hash;
      const slug = /^rules\/([a-z0-9-]+)\.md$/.exec(part.source)?.[1] || null;
      if (!e && broken.has(part.source)) { out.regions.push({ source: part.source, slug, status: 'invalid' }); editedKept = true; continue; }
      if (!e) {
        out.regions.push({ source: part.source, slug, status: edited ? 'orphan-edited' : 'orphan' });
        if (edited && !force) { editedKept = true; out.conflicts.push(`${part.source} was deleted but its region here was edited by hand`); continue; }
        removeRegion(parts, i);
        continue;
      }
      const same = part.content === e.content && (want.kind !== 'file' || fileFm === e.fm);
      const status = same ? (edited ? 'rehash' : 'ok') : edited ? 'edited' : 'stale';
      out.regions.push({ source: part.source, slug, status, ...(status === 'edited' ? { content: part.content } : {}) });
      if (status === 'ok') continue;
      if (status === 'edited' && !force) { editedKept = true; continue; }
      part.content = e.content;
      part.hash = regionHash(want.kind, e.content, e.fm);
    }
    out.regions.reverse();
    for (const s of order) {
      if (parts.some((x) => x.type === 'region' && x.source === s)) continue;
      const e = want.entries.get(s);
      out.regions.push({ source: s, slug: e.rule.slug, status: 'new' });
      insertRegion(parts, { type: 'region', source: s, content: e.content, hash: regionHash(want.kind, e.content, e.fm) }, order);
    }
    if (want.kind === 'file' && want.entries.size && !editedKept) {
      const e = want.entries.get(order[0]);
      const t = parts[0];
      const lead = t.lines.join('\n');
      const m = FM.exec(lead + '\n');
      const rest = m ? (lead + '\n').slice(m[0].length).replace(/\n$/, '') : lead;
      t.lines = [...e.fm.split('\n'), ...(rest ? rest.split('\n') : [])];
    }
    let next = joinParts(parts);
    const noRegions = !want.entries.size && !parts.some((x) => x.type === 'region');
    const onlyGenerated = noRegions && (want.kind === 'file' ? blank(splitFm(next).rest.split('\n')) : next.trim() === HEADER);
    if (onlyGenerated) { out.action = 'delete'; out.content = null; out.diff = diffOf(before, ''); continue; }
    out.diff = diffOf(before, next);
    if (next === before) { delete out.diff; continue; }
    if (isCrlf(cur.raw)) next = next.replace(/\n/g, '\r\n');
    out.content = next;
    out.action = 'update';
  }
  const mergeBack = mergeCandidates(outputs, rules);
  const stale = outputs.filter((o) => o.action !== 'none' && o.action !== 'skip').length;
  const edited = outputs.flatMap((o) => o.regions.filter((r) => r.status === 'edited' || r.status === 'orphan-edited').map((r) => ({ path: o.path, ...r })));
  return {
    rulesDir: dir, tools: sel, windsurf: env.windsurf,
    rules: rules.map(({ text, frontmatter, ...r }) => r), invalid, outputs, mergeBack, edited,
    stale, ok: stale === 0 && !edited.length && !invalid.length && outputs.every((o) => !o.error && !o.conflicts.length),
  };
}

function diffOf(a, b) {
  const d = lineDiff(a, b);
  return { added: d.added, removed: d.removed, hunks: d.hunks };
}

/** Edited regions grouped per source rule: what merge-back would write. */
function mergeCandidates(outputs, rules) {
  const by = new Map();
  for (const o of outputs) {
    for (const r of o.regions) {
      if (r.status !== 'edited') continue;
      const rule = rules.find((x) => x.slug === r.slug);
      if (!rule) continue;
      const u = unrender(r.content, o.kind);
      if (!by.has(rule.slug)) by.set(rule.slug, { slug: rule.slug, file: rule.file, rule, copies: [] });
      by.get(rule.slug).copies.push({ path: o.path, title: u.title, body: u.body });
    }
  }
  const out = [];
  for (const { rule, copies, ...m } of by.values()) {
    const variants = new Set(copies.map((c) => `${c.title}\n${c.body}`));
    const c = copies[0];
    const next = composeRule(rule, c.title, c.body);
    if (variants.size === 1 && next === lf(rule.text)) continue; // nothing to pull back (e.g. only frontmatter was touched)
    out.push({ ...m, paths: copies.map((x) => x.path), conflict: variants.size > 1, title: c.title, body: c.body, baseHash: rule.hash, frontmatter: rule.frontmatter, ruleTitle: rule.title,
      content: next, diff: diffOf(lf(rule.text), next), copies });
  }
  return out;
}

/** Source rule text with a new body (and title, if the heading was edited). Frontmatter is kept verbatim. */
export function composeRule(rule, title, body) {
  let fm = rule.frontmatter || '';
  const t = title && title !== rule.title ? cleanText(title, 120) : null;
  if (t) {
    if (!fm) fm = '---\n---\n';
    fm = /^title:.*$/m.test(fm) ? fm.replace(/^title:.*$/m, `title: ${JSON.stringify(t)}`) : fm.replace(/^---\n/, `---\ntitle: ${JSON.stringify(t)}\n`);
  }
  return `${fm}${fm ? '\n' : ''}${body.replace(/\s+$/, '')}\n`;
}

/** Write a plan through the safe file ops (history, conflict check via baseHash, trash for deletes). */
export async function applyCompile(ctx, plan) {
  const ops = getOps(ctx);
  const written = [], deleted = [], errors = [];
  for (const o of plan.outputs) {
    try {
      if (o.action === 'create') { await ops.create({ path: o.path, content: o.content }); written.push(o.path); }
      else if (o.action === 'update') { await ops.save({ path: o.path, content: o.content, baseHash: o.baseHash }); written.push(o.path); }
      else if (o.action === 'delete') { await ops.remove({ path: o.path }); deleted.push(o.path); }
    } catch (e) { errors.push({ path: o.path, error: e.message, status: e.status || 500 }); }
  }
  return { written, deleted, errors };
}

/**
 * Pull hand edits made inside generated regions back into the source rules.
 * `pick`: { [slug]: path } chooses the copy when several tools were edited differently.
 */
export function applyMergeBack(ctx, plan, { slugs = null, pick = {} } = {}) {
  const merged = [], skipped = [];
  for (const m of plan.mergeBack) {
    if (slugs && !slugs.includes(m.slug)) continue;
    let { content } = m;
    if (m.conflict) {
      const c = m.copies.find((x) => x.path === pick?.[m.slug]);
      if (!c) { skipped.push({ slug: m.slug, reason: `edited differently in ${m.paths.join(', ')}; choose one copy` }); continue; }
      content = composeRule({ frontmatter: m.frontmatter, title: m.ruleTitle }, c.title, c.body);
    }
    try { writeRuleFile(ctx.root, ctx.config, m.slug, content, { baseHash: m.baseHash }); merged.push({ slug: m.slug, file: m.file, from: m.paths }); }
    catch (e) { skipped.push({ slug: m.slug, reason: e.message }); }
  }
  return { merged, skipped };
}
