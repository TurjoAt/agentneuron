// Source rules: .agentneuron/rules/<slug>.md with YAML frontmatter (title, scope, tools, priority, description, alwaysApply).
import { parseFrontmatter, toList } from '../agentcenter/frontmatter.js';
import { readRuleFiles, rulesDirRel, globError, cleanText, lf } from './safety.js';

export const TOOLS = ['claude', 'codex', 'gemini', 'cursor', 'copilot', 'windsurf'];
const ALIAS = { agents: 'codex', 'agents.md': 'codex', openai: 'codex', 'claude-code': 'claude', github: 'copilot', 'gemini-cli': 'gemini', cascade: 'windsurf' };
export const MARKER_RE = /<!--\s*agentneuron:(?:begin|end)\b/;

export const normTool = (t) => { const k = String(t || '').trim().toLowerCase(); return ALIAS[k] || k; };

/** Parse a tool list (array, comma string, "all"). Returns { tools, unknown }. */
export function parseTools(v) {
  const list = toList(v).map(normTool);
  if (!list.length || list.includes('all') || list.includes('*')) return { tools: [...TOOLS], unknown: [] };
  return { tools: TOOLS.filter((t) => list.includes(t)), unknown: list.filter((t) => !TOOLS.includes(t)) };
}

/** One rule file -> rule object. `errors` make the rule unusable; `warnings` don't. */
export function parseRule(slug, text, file) {
  const errors = [], warnings = [];
  const src = lf(text).replace(/^﻿/, '');
  const fm = parseFrontmatter(src);
  const d = fm.data || {};
  const body = fm.body.replace(/^\n+/, '').replace(/\s+$/, '');
  const scope = toList(d.scope ?? d.globs ?? d.paths ?? d.applyTo);
  const allScope = scope.length === 0 || scope.some((g) => g === '**' || g === '**/*' || g === 'all');
  for (const g of allScope ? [] : scope) { const e = globError(g); if (e) errors.push(`scope: ${e}`); }
  const { tools, unknown } = parseTools(d.tools);
  if (unknown.length) warnings.push(`unknown tools ignored: ${unknown.join(', ')}`);
  if (!tools.length) warnings.push('no known tools: this rule compiles to nothing');
  let priority = d.priority === undefined || d.priority === '' ? 0 : Number(d.priority);
  if (!Number.isFinite(priority)) { warnings.push('priority must be a number'); priority = 0; }
  priority = Math.max(-1e6, Math.min(1e6, Math.round(priority)));
  if (MARKER_RE.test(src)) errors.push('rule text must not contain agentneuron markers');
  if (!body.trim()) warnings.push('empty body');
  const alwaysApply = d.alwaysApply === undefined ? undefined : d.alwaysApply === true || d.alwaysApply === 'true';
  return {
    slug, file, title: cleanText(d.title, 120) || slug, description: cleanText(d.description, 300),
    scope: allScope ? [] : scope, tools, priority, alwaysApply, body, frontmatter: fm.has ? src.slice(0, src.length - fm.body.length) : '', errors, warnings,
  };
}

/** Load every rule. -> { dir, rules, invalid } (invalid: files that could not be parsed/used). */
export function loadRules(root, config) {
  const dir = rulesDirRel(config);
  const rules = [], invalid = [];
  for (const f of readRuleFiles(root, config)) {
    const file = `${dir}/${f.name}`;
    if (f.error) { invalid.push({ slug: f.slug, file, errors: [f.error] }); continue; }
    const r = parseRule(f.slug, f.text, file);
    r.hash = f.hash;
    r.text = f.text;
    if (r.errors.length) invalid.push({ slug: r.slug, file, errors: r.errors });
    rules.push(r);
  }
  rules.sort(byPriority);
  return { dir, rules, invalid };
}

export const byPriority = (a, b) => b.priority - a.priority || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** Serialize a rule back to text (used by import and the editor's "new rule"). */
export function serializeRule({ title, description, tools, scope, priority, alwaysApply, body }) {
  const q = (s) => JSON.stringify(String(s));
  const L = ['---', `title: ${q(cleanText(title, 120) || 'Untitled')}`];
  if (description) L.push(`description: ${q(cleanText(description, 300))}`);
  const t = tools && tools.length && tools.length < TOOLS.length ? tools : null;
  L.push(`tools: ${t ? `[${t.join(', ')}]` : 'all'}`);
  if (scope && scope.length) L.push(`scope: [${scope.map(q).join(', ')}]`);
  if (priority) L.push(`priority: ${Math.round(priority)}`);
  if (alwaysApply !== undefined) L.push(`alwaysApply: ${alwaysApply === true}`);
  L.push('---', '', lf(body).replace(/^\n+/, '').replace(/\s+$/, ''), '');
  return L.join('\n');
}
