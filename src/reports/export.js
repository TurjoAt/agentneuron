// AI-oriented report exports: versioned JSON (agentneuron.report/v1) and a compact
// Markdown "context pack" (format "ai"/"llm"). Everything leaving this module is
// secret-masked and stripped of absolute paths.
import os from 'node:os';
import path from 'node:path';
import { detectProject, peekProject } from '../project/index.js';
import { maskSecretsInText } from '../health/secrets.js';
import { estimateTokens } from '../core/tokens.js';
import { DAY, getEvents } from './data.js';

export const SCHEMA = 'agentneuron.report/v1';
export const CONTENT_BUDGET = 40000; // tokens across all included files
const PER_FILE_BUDGET = 12000;
const CONTENT_KINDS = ['context', 'rules', 'agent', 'skill', 'memory', 'command'];
const SEV_RANK = { error: 0, warn: 1, info: 2 };

const withTimeout = (p, ms, fb) => new Promise((res) => {
  const t = setTimeout(() => res(fb), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fb); });
});
const iso = (t) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);
const day = (t) => new Date(t).toISOString().slice(0, 10);

/** "7d" | "24h" | "2w" | "30d" -> { from, to }. Throws on garbage. */
export function rangeFromSpec(spec = '7d', now = Date.now()) {
  const m = /^\s*(\d{1,4})\s*(h|d|w)\s*$/i.exec(String(spec ?? '7d') || '7d');
  if (!m || Number(m[1]) <= 0) throw new Error(`invalid range "${String(spec).slice(0, 40)}" (use e.g. 24h, 7d, 30d)`);
  const ms = Number(m[1]) * { h: 3600000, d: DAY, w: 7 * DAY }[m[2].toLowerCase()];
  return { from: now - Math.min(ms, 730 * DAY), to: now };
}

/** Filesystem-safe project slug for filenames. */
export function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/[-.]{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 40);
  return s || 'project';
}

export function exportFilename(project, range, ext) {
  return `agentneuron-report-${slugify(project)}-${day(range.from)}_${day(range.to)}.${ext}`;
}

/** Mask secrets and remove absolute project/home paths from free text. */
export function makeScrubber(root) {
  const needles = [];
  const add = (p, rep) => {
    if (!p || p.length < 4) return;
    for (const v of new Set([p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')])) needles.push([v, rep]);
  };
  if (root) add(path.resolve(String(root)), '.');
  try { add(os.homedir(), '~'); } catch { /* no home */ }
  needles.sort((a, b) => b[0].length - a[0].length);
  // only whole absolute paths: not preceded by a path character, and followed by a separator or a delimiter,
  // so relative paths such as docs/project-plan.md survive a root of /project
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const res = needles.map(([n, rep]) => [n, new RegExp(`(?<![\\w.\\-/\\\\])${esc(n)}(?=$|[\\\\/\\s"'\`)\\],;:])`, 'g'), rep]);
  return (text) => {
    if (typeof text !== 'string') return text;
    let out = maskSecretsInText(text);
    for (const [n, re, rep] of res) if (out.includes(n)) out = out.replace(re, rep);
    return out;
  };
}

export function scrubDeep(v, scrub, depth = 0) {
  if (typeof v === 'string') return scrub(v);
  if (depth > 10 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, scrub, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = scrubDeep(x, scrub, depth + 1);
  return out;
}

async function projectInfo(ctx) {
  const root = ctx.root ? path.resolve(String(ctx.root)) : process.cwd();
  let p = null;
  try { p = peekProject(root) || await withTimeout(detectProject(root), 3000, null); } catch { p = null; }
  return {
    name: String(p?.name || path.basename(root) || 'project'),
    // only names and versions — never env, scripts or manifests (may hold values/paths)
    stack: (p?.stacks || []).slice(0, 12).map((s) => ({ id: String(s.id), version: s.version ? String(s.version) : null })),
  };
}

const KPI_KEYS = ['changes', 'filesTouched', 'linesAdded', 'linesRemoved', 'commits', 'agentEdits', 'activeSessions',
  'tokensNow', 'tokensDelta', 'healthNow', 'healthDelta', 'tasksOpened', 'tasksClosed'];

/** Build the agentneuron.report/v1 object from a buildReport() result. */
export async function buildReportV1(ctx, rep, { includeContent = false, now = Date.now() } = {}) {
  const scrub = makeScrubber(ctx.root);
  const [project, a, events] = await Promise.all([
    projectInfo(ctx),
    Promise.resolve().then(() => ctx.analysis?.()).catch(() => null),
    getEvents(ctx, rep.range.from, rep.range.to).catch(() => []),
  ]);
  const files = (ctx.allFiles ? ctx.allFiles() : []) || [];
  const kpis = {};
  for (const k of KPI_KEYS) {
    const v = rep.kpis?.[k] ?? null, p = rep.prev?.[k] ?? null;
    kpis[k] = { value: v, previous: p, delta: typeof v === 'number' && typeof p === 'number' ? v - p : null };
  }
  const issues = (a?.issues || []).slice()
    .sort((x, y) => (SEV_RANK[x.severity] ?? 3) - (SEV_RANK[y.severity] ?? 3) || String(x.path).localeCompare(String(y.path)))
    .slice(0, 100)
    .map((i) => ({ rule: i.rule || null, severity: i.severity || 'info', path: i.path || null, line: i.line ?? null, message: i.message || '', hint: i.hint || null }));
  const tasksAll = a?.tasks || [];
  const open = tasksAll.filter((t) => !t.done);
  const added = new Set(), removed = new Set();
  for (const e of events) {
    if (e.type === 'add') { added.add(e.path); removed.delete(e.path); }
    else if (e.type === 'unlink') { removed.add(e.path); added.delete(e.path); }
  }
  const out = {
    schema: SCHEMA,
    generatedAt: iso(now),
    project,
    range: { from: iso(rep.range.from), to: iso(rep.range.to) },
    prevRange: { from: iso(rep.prevRange.from), to: iso(rep.prevRange.to) },
    kpis,
    series: (rep.daily || []).map((d) => ({ date: d.date, changes: d.changes, lines: d.lines, commits: d.commits, agentEdits: d.agents })),
    top: (rep.top || []).slice(0, 20).map((r) => ({ path: r.path, changes: r.changes, added: r.added, removed: r.removed, lastChangedAt: iso(r.lastTs) })),
    fileChanges: { added: [...added].sort().slice(0, 200), removed: [...removed].sort().slice(0, 200) },
    health: {
      score: a?.health?.score ?? rep.kpis?.healthNow ?? null, grade: a?.health?.grade ?? null,
      counts: { error: a?.health?.counts?.error ?? 0, warn: a?.health?.counts?.warn ?? 0, info: a?.health?.counts?.info ?? 0 },
    },
    tasks: {
      open: open.length, done: tasksAll.length - open.length,
      items: open.slice(0, 50).map((t) => ({ path: t.path, line: t.line ?? null, text: t.text, section: t.section || null })),
    },
    contextFiles: files.slice().sort((x, y) => String(x.path).localeCompare(String(y.path))).slice(0, 2000)
      .map((f) => ({ path: f.path, tool: f.tool || 'generic', kind: f.kind || 'other', tokens: f.tokens || 0, updatedAt: iso(f.mtime) })),
    issues,
  };
  if (includeContent) out.contents = collectContents(ctx, files, scrub);
  return scrubDeep(out, scrub);
}

/** Pick the main context files and cap them to CONTENT_BUDGET tokens in total. */
export function collectContents(ctx, files, scrub = makeScrubber(ctx.root)) {
  const contents = ctx.store?.contents;
  if (!contents || typeof contents.get !== 'function') return { budget: CONTENT_BUDGET, tokens: 0, files: [], omitted: [] };
  const rank = (f) => { const i = CONTENT_KINDS.indexOf(f.kind); return i < 0 ? 99 : i; };
  const picked = files.filter((f) => rank(f) < 99 && typeof contents.get(f.path) === 'string')
    .sort((x, y) => rank(x) - rank(y) || String(x.path).split('/').length - String(y.path).split('/').length || String(x.path).localeCompare(String(y.path)));
  let left = CONTENT_BUDGET; let used = 0;
  const outFiles = [], omitted = [];
  for (const f of picked) {
    if (left < 200) { omitted.push(f.path); continue; }
    const text = scrub(contents.get(f.path));
    const tokens = estimateTokens(text);
    const allow = Math.min(left, PER_FILE_BUDGET);
    let body = text; let truncated = false;
    if (tokens > allow) {
      let cut = Math.floor(text.length * (allow / tokens));
      const nl = text.lastIndexOf('\n', cut);
      if (nl > cut * 0.8) cut = nl;
      body = `${text.slice(0, cut)}\n… [truncated: showing ~${allow} of ${tokens} tokens]`;
      truncated = true;
    }
    const t = estimateTokens(body);
    left -= t; used += t;
    outFiles.push({ path: f.path, tool: f.tool || 'generic', kind: f.kind || 'other', tokens, truncated, content: body });
  }
  return { budget: CONTENT_BUDGET, tokens: used, files: outFiles, omitted: omitted.slice(0, 200) };
}

// ------------------------------------------------------------------ AI context pack
const fmtN = (n) => (n === null || n === undefined ? '-' : typeof n === 'number' ? (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n)) : String(n));
const sign = (n) => (typeof n !== 'number' ? '-' : n > 0 ? `+${fmtN(n)}` : n < 0 ? `−${fmtN(-n)}` : '0');
const cell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const yq = (s) => JSON.stringify(String(s ?? ''));
const AI_KPIS = [
  ['changes', 'Changes'], ['filesTouched', 'Files touched'], ['linesAdded', 'Lines added'], ['linesRemoved', 'Lines removed'],
  ['commits', 'Commits'], ['agentEdits', 'Agent edits'], ['activeSessions', 'Agent sessions'], ['tokensNow', 'Context tokens'],
  ['healthNow', 'Health score'], ['tasksOpened', 'Tasks opened'], ['tasksClosed', 'Tasks closed'],
];

function rangeDays(r) { return Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / DAY)); }

export function toolBudgets(contextFiles) {
  const m = new Map();
  for (const f of contextFiles) {
    const b = m.get(f.tool) || { tool: f.tool, files: 0, tokens: 0, largest: null };
    b.files++; b.tokens += f.tokens || 0;
    if (!b.largest || (f.tokens || 0) > b.largest.tokens) b.largest = { path: f.path, tokens: f.tokens || 0 };
    m.set(f.tool, b);
  }
  return [...m.values()].sort((a, b) => b.tokens - a.tokens);
}

export function suggestActions(r, budgets, now = Date.parse(r.generatedAt) || Date.now()) {
  const out = [];
  const errs = r.issues.filter((i) => i.severity === 'error');
  const secrets = r.issues.filter((i) => i.rule === 'secret');
  if (secrets.length) out.push(`Remove and rotate ${secrets.length} hard-coded secret(s) (first: \`${secrets[0].path}\`).`);
  if (errs.length > secrets.length) {
    const e = errs.find((i) => i.rule !== 'secret');
    out.push(`Fix ${errs.length - secrets.length} error-level issue(s), starting with \`${e.rule}\` in \`${e.path}\`.`);
  }
  const hd = r.kpis.healthNow?.delta ?? null;
  if (typeof r.kpis.healthDelta?.value === 'number' && r.kpis.healthDelta.value < 0) out.push(`Health fell by ${-r.kpis.healthDelta.value} points this period; review recent edits${r.top[0] ? ` to \`${r.top[0].path}\`` : ''}.`);
  else if (typeof hd === 'number' && hd < 0 && !out.length) out.push('Health is below the previous period; review the ranked issues above.');
  for (const b of budgets) {
    if (b.tool !== 'generic' && b.tokens > 20000) out.push(`Trim ${b.tool} context (${fmtN(b.tokens)} tokens); largest file \`${b.largest.path}\` (${fmtN(b.largest.tokens)}).`);
  }
  const stale = r.contextFiles.filter((f) => ['context', 'rules'].includes(f.kind) && f.updatedAt && now - Date.parse(f.updatedAt) > 90 * DAY);
  if (stale.length) out.push(`Review ${stale.length} context/rules file(s) untouched for 90+ days (e.g. \`${stale[0].path}\`).`);
  if (r.tasks.open) out.push(`Triage ${r.tasks.open} open task(s)${r.tasks.items[0] ? `, e.g. "${r.tasks.items[0].text.slice(0, 80)}" (\`${r.tasks.items[0].path}\`)` : ''}.`);
  const warns = r.health.counts.warn;
  if (warns && out.length < 6) out.push(`Address ${warns} warning(s) to raise the health score.`);
  if (!out.length) out.push('No action needed: context is healthy and no tasks are open.');
  return out.slice(0, 8);
}

/** Render the v1 object as a compact Markdown context pack. Returns { body, tokens }. */
export function renderAi(r) {
  const k = r.kpis;
  const budgets = toolBudgets(r.contextFiles);
  const totalTokens = r.contextFiles.reduce((s, f) => s + (f.tokens || 0), 0);
  const days = rangeDays(r.range);
  const L = [];
  L.push(`# AgentNeuron context pack: ${r.project.name}`, '');
  const stack = r.project.stack.map((s) => (s.version ? `${s.id} ${s.version}` : s.id)).join(', ');
  L.push(`Period: ${r.range.from.slice(0, 10)} → ${r.range.to.slice(0, 10)} (${days} day${days === 1 ? '' : 's'}), compared with the previous ${days} day${days === 1 ? '' : 's'}.${stack ? ` Stack: ${stack}.` : ''}`, '');

  L.push('## Summary', '');
  const ch = k.changes.value || 0;
  const s1 = ch
    ? `${ch} change${ch === 1 ? '' : 's'} touched ${k.filesTouched.value} file${k.filesTouched.value === 1 ? '' : 's'} (+${k.linesAdded.value || 0}/−${k.linesRemoved.value || 0} lines)${k.agentEdits.value ? `, ${k.agentEdits.value} by AI agents` : ''}; ${sign(k.changes.delta)} vs previous period.`
    : 'No tracked context files changed in this period.';
  const hs = r.health.score;
  const s2 = hs !== null ? `Health is ${hs}${r.health.grade ? ` (${r.health.grade})` : ''}${typeof k.healthDelta.value === 'number' && k.healthDelta.value ? `, ${sign(k.healthDelta.value)} over the period` : ''}, with ${r.health.counts.error} error(s), ${r.health.counts.warn} warning(s).` : '';
  const s3 = `Context totals ${fmtN(totalTokens)} tokens across ${r.contextFiles.length} file(s); ${r.tasks.open} open task(s).`;
  L.push([s1, s2, s3].filter(Boolean).join(' '), '');

  L.push('## KPIs', '', '| KPI | Value | Previous | Δ |', '|---|---:|---:|---:|');
  for (const [key, label] of AI_KPIS) L.push(`| ${label} | ${fmtN(k[key].value)} | ${fmtN(k[key].previous)} | ${sign(k[key].delta)} |`);
  L.push('');

  L.push('## What changed', '');
  if (r.top.length) {
    L.push('Most churned files:', '');
    for (const t of r.top.slice(0, 10)) L.push(`- \`${t.path}\`: ${t.changes} change(s), +${t.added}/−${t.removed}`);
    L.push('');
  } else L.push('No file changes recorded.', '');
  if (r.fileChanges.added.length) L.push(`New files: ${r.fileChanges.added.slice(0, 20).map((p) => `\`${p}\``).join(', ')}`, '');
  if (r.fileChanges.removed.length) L.push(`Removed files: ${r.fileChanges.removed.slice(0, 20).map((p) => `\`${p}\``).join(', ')}`, '');

  L.push('## Health issues', '');
  if (r.issues.length) {
    r.issues.slice(0, 15).forEach((i, n) => L.push(`${n + 1}. **${i.severity}** \`${i.rule}\` ${i.path ? `\`${i.path}${i.line ? `:${i.line}` : ''}\`` : ''}: ${cell(i.message)}`));
    if (r.issues.length > 15) L.push('', `…and ${r.issues.length - 15} more.`);
  } else L.push('No issues.');
  L.push('');

  L.push('## Open tasks', '');
  if (r.tasks.items.length) {
    for (const t of r.tasks.items.slice(0, 15)) L.push(`- [ ] ${cell(t.text).slice(0, 200)} (\`${t.path}${t.line ? `:${t.line}` : ''}\`)`);
    if (r.tasks.open > 15) L.push(`- …and ${r.tasks.open - 15} more`);
  } else L.push('None.');
  L.push('');

  L.push('## Context budget by tool', '', '| Tool | Files | Tokens | Share | Largest file |', '|---|---:|---:|---:|---|');
  for (const b of budgets) L.push(`| ${cell(b.tool)} | ${b.files} | ${fmtN(b.tokens)} | ${totalTokens ? Math.round((b.tokens / totalTokens) * 100) : 0}% | ${b.largest ? `\`${cell(b.largest.path)}\` (${fmtN(b.largest.tokens)})` : '-'} |`);
  L.push('');

  L.push('## Suggested next actions', '');
  suggestActions(r, budgets).forEach((a, n) => L.push(`${n + 1}. ${a}`));
  L.push('');

  if (r.contents) {
    L.push(`## File contents`, '', `Main context files, capped at ~${fmtN(r.contents.budget)} tokens in total.`, '');
    for (const f of r.contents.files) {
      const runs = f.content.match(/`{3,}/g) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map((x) => x.length + 1)));
      L.push(`### ${f.path}`, '', `${f.tool} · ${f.kind} · ${fmtN(f.tokens)} tokens${f.truncated ? ' · truncated' : ''}`, '', `${fence}markdown`, f.content, fence, '');
    }
    if (r.contents.omitted.length) L.push(`Omitted (budget reached): ${r.contents.omitted.map((p) => `\`${p}\``).join(', ')}`, '');
  }

  const body = L.join('\n');
  const tokens = estimateTokens(body);
  const fm = ['---', `schema: ${yq(r.schema)}`, `format: "ai"`, `generatedAt: ${yq(r.generatedAt)}`,
    `project: ${yq(r.project.name)}`, `range: { from: ${yq(r.range.from)}, to: ${yq(r.range.to)} }`,
    `tokenEstimate: ${tokens}`, `includesContent: ${r.contents ? 'true' : 'false'}`, '---', ''];
  const out = fm.join('\n') + body;
  return { body: out, tokens: estimateTokens(out) };
}
