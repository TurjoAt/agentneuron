import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegex } from '../core/glob.js';
import { estimateTokens } from '../core/tokens.js';
import { readAgentConfig } from '../health/configview.js';
import { maskSecretsInText } from '../health/secrets.js';
import { parseFrontmatter, toList } from './frontmatter.js';
import { readRegular } from '../files/safeio.js';

export const TOOL_NAMES = {
  claude: 'Claude Code', codex: 'OpenAI Codex', cursor: 'Cursor', copilot: 'GitHub Copilot', windsurf: 'Windsurf',
  gemini: 'Gemini CLI', cline: 'Cline', roo: 'Roo Code', aider: 'Aider', continue: 'Continue', zed: 'Zed',
  junie: 'JetBrains Junie', amazonq: 'Amazon Q Developer',
};
export const CAPS = ['instructions', 'rules', 'mcp', 'hooks', 'permissions', 'agents', 'skills', 'commands', 'ignore'];

// [tool, capability|file-kind, glob, extra]
const S = [
  ['claude', 'instructions', '**/CLAUDE.md'],
  ['claude', 'instructions', '**/CLAUDE.local.md', { local: true }],
  ['claude', 'rules', '.claude/rules/**/*.md'],
  ['claude', 'agents', '.claude/agents/**/*.md'],
  ['claude', 'skills', '.claude/skills/*/SKILL.md'],
  ['claude', 'commands', '.claude/commands/**/*.md'],
  ['claude', 'settings', '.claude/settings.json'],
  ['claude', 'settings', '.claude/settings.local.json', { local: true }],
  ['claude', 'output-style', '.claude/output-styles/*.md'],
  ['claude', 'mcp', '.mcp.json'],
  ['codex', 'instructions', '**/AGENTS.md'],
  ['codex', 'instructions', '**/AGENTS.override.md', { local: true }],
  ['codex', 'config', '.codex/config.toml'],
  ['codex', 'commands', '.codex/prompts/*.md'],
  ['cursor', 'instructions', '.cursorrules'],
  ['cursor', 'rules', '**/.cursor/rules/**/*.mdc'],
  ['cursor', 'rules', '**/.cursor/rules/**/*.md'],
  ['cursor', 'commands', '.cursor/commands/*.md'],
  ['cursor', 'mcp', '.cursor/mcp.json'],
  ['cursor', 'ignore', '.cursorignore'],
  ['cursor', 'ignore', '.cursorindexingignore'],
  ['copilot', 'instructions', '.github/copilot-instructions.md'],
  ['copilot', 'rules', '.github/instructions/**/*.instructions.md'],
  ['copilot', 'commands', '.github/prompts/*.prompt.md'],
  ['copilot', 'agents', '.github/agents/*.md'],
  ['copilot', 'agents', '.github/chatmodes/*.chatmode.md'],
  ['copilot', 'mcp', '.vscode/mcp.json'],
  ['windsurf', 'instructions', '.windsurfrules'],
  ['windsurf', 'rules', '.windsurf/rules/**/*.md'],
  ['windsurf', 'commands', '.windsurf/workflows/*.md'],
  ['windsurf', 'ignore', '.codeiumignore'],
  ['gemini', 'instructions', '**/GEMINI.md'],
  ['gemini', 'commands', '.gemini/commands/**/*.toml'],
  ['gemini', 'mcp', '.gemini/settings.json'],
  ['gemini', 'ignore', '.geminiignore'],
  ['cline', 'instructions', '.clinerules'],
  ['cline', 'rules', '.clinerules/**/*.md'],
  ['cline', 'rules', '.clinerules/**/*.txt'],
  ['cline', 'ignore', '.clineignore'],
  ['roo', 'instructions', '.roorules'],
  ['roo', 'rules', '.roo/rules*/**/*.md'],
  ['roo', 'rules', '.roo/rules*/**/*.txt'],
  ['roo', 'agents', '.roomodes'],
  ['roo', 'mcp', '.roo/mcp.json'],
  ['roo', 'ignore', '.rooignore'],
  ['aider', 'instructions', 'CONVENTIONS.md'],
  ['aider', 'config', '.aider.conf.yml'],
  ['aider', 'ignore', '.aiderignore'],
  ['continue', 'config', '.continue/config.yaml'],
  ['continue', 'config', '.continue/config.json'],
  ['continue', 'rules', '.continue/rules/**/*.md'],
  ['continue', 'commands', '.continue/prompts/**/*.md'],
  ['continue', 'commands', '.continue/prompts/**/*.prompt'],
  ['continue', 'mcp', '.continue/mcpServers/*.json'],
  ['zed', 'instructions', '.rules'],
  ['zed', 'mcp', '.zed/settings.json'],
  ['junie', 'instructions', '.junie/guidelines.md'],
  ['junie', 'mcp', '.junie/mcp/mcp.json'],
  ['amazonq', 'rules', '.amazonq/rules/**/*.md'],
  ['amazonq', 'commands', '.amazonq/prompts/*.md'],
  ['amazonq', 'mcp', '.amazonq/mcp.json'],
].map(([tool, kind, glob, extra]) => ({ tool, kind, glob, re: globToRegex(glob), ...(extra || {}) }));

const SKIP = new Set(['.git', 'node_modules', 'vendor', '.agentneuron', '.mdctl', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'storage', '__MACOSX',
  '__pycache__', 'venv', '.venv', 'target', '.cache', 'coverage', '.turbo', '.idea', '.gradle']);
const GLOBAL_SKIP = new Set(['projects', 'sessions', 'todos', 'shell-snapshots', 'statsig', 'ide', 'file-history', 'plugins', 'cache', 'history', 'log', 'logs', 'telemetry', 'archived_sessions', 'tmp']);
const MAX_FILE = 1024 * 1024;

function walk(base, { maxDepth = 6, cap = 40000, skip = SKIP, only = null } = {}) {
  const out = [];
  const stack = [['', 0]];
  while (stack.length && out.length < cap) {
    const [rel, depth] = stack.pop();
    let ents;
    try { ents = fs.readdirSync(path.join(base, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skip.has(e.name) || depth + 1 > maxDepth) continue;
        if (depth === 0 && only && !only.has(e.name)) continue;
        stack.push([r, depth + 1]);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (depth === 0 && only && !only.has(e.name)) continue;
        out.push(r);
      }
    }
  }
  return out.sort();
}

/** Read a small text file. With `confine` (a project root) symlinks that resolve outside it are refused. */
function readText(abs, confine = null) {
  const r = readRegular(abs, { maxBytes: MAX_FILE, follow: true, confine });
  return r ? r.buf.toString('utf8') : null;
}

function readJsonFile(abs, confine = null) {
  const t = readText(abs, confine);
  if (t == null) return null;
  try { const v = JSON.parse(t.replace(/^﻿/, '')); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** Directory a rule/instruction file scopes to: path up to its first dot-directory segment. */
export function baseOf(rel) {
  const segs = rel.split('/');
  segs.pop();
  const out = [];
  for (const s of segs) { if (s.startsWith('.')) break; out.push(s); }
  return out.join('/');
}

const str = (v) => (typeof v === 'string' ? maskSecretsInText(v) : undefined);
const trunc = (s, n = 300) => (typeof s === 'string' ? maskSecretsInText(s.replace(/\s+/g, ' ').trim().slice(0, n * 2)).slice(0, n) : undefined);

function mcpFromJson(j, source, scope) {
  const out = [];
  if (!j) return out;
  const map = j.mcpServers || j.servers || j.context_servers || null;
  if (map && typeof map === 'object') {
    for (const [name, def] of Object.entries(map)) {
      if (!def || typeof def !== 'object') continue;
      const s = { name, source, scope, type: typeof def.type === 'string' ? def.type : def.url ? 'http' : 'stdio' };
      if (def.command !== undefined) s.command = str([def.command, ...(Array.isArray(def.args) ? def.args : [])].filter((x) => typeof x === 'string').join(' '));
      if (def.url || def.serverUrl) s.url = str(def.url || def.serverUrl);
      out.push(s);
    }
  } else if (typeof j.name === 'string' && (j.command || j.url)) {
    out.push({ name: j.name, source, scope, type: j.url ? 'http' : 'stdio', command: str(j.command), url: str(j.url) });
  }
  return out;
}

function ruleMeta(tool, rel, text) {
  const { data } = parseFrontmatter(text);
  const item = { path: rel, name: path.posix.basename(rel).replace(/\.(instructions\.md|mdc|md|txt)$/i, ''), base: baseOf(rel) };
  if (typeof data.description === 'string' && data.description.trim()) item.description = trunc(data.description);
  const g = tool === 'copilot' ? data.applyTo : tool === 'claude' ? (data.paths ?? data.globs) : data.globs ?? data.glob ?? data.paths;
  const globs = splitGlobs(g);
  if (globs.length) item.globs = globs;
  if (data.alwaysApply !== undefined) item.alwaysApply = data.alwaysApply === true || data.alwaysApply === 'true';
  if (typeof data.trigger === 'string') item.trigger = data.trigger;
  return item;
}

/** Split a glob list on commas that are not inside {braces}. */
export function splitGlobs(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x) => splitGlobs(x));
  const s = String(v).trim().replace(/^["']|["']$/g, '');
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '{') depth++;
    if (c === '}') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((x) => x.replace(/^["']|["']$/g, ''));
}

function emptyCaps() {
  const c = {};
  for (const k of CAPS) c[k] = { count: 0, items: [] };
  return c;
}

function scanBase(base, scope, displayPrefix, tools, index) {
  const files = walk(base, scope === 'global'
    ? { maxDepth: 4, skip: new Set([...SKIP, ...GLOBAL_SKIP]), only: new Set(['.claude', '.codex', '.gemini', '.cursor', '.continue', '.claude.json', '.windsurf']) }
    : {});
  const set = new Set(files);
  const disp = (rel) => (displayPrefix ? `${displayPrefix}${rel}` : rel);
  for (const rel of files) {
    for (const spec of S) {
      if (!spec.re.test(rel)) continue;
      const t = tools[spec.tool];
      const abs = path.join(base, rel);
      const p = disp(rel);
      const fscope = scope === 'global' ? 'global' : spec.local ? 'local' : 'project';
      const kind = spec.kind === 'agents' ? 'agent' : spec.kind === 'skills' ? 'skill' : spec.kind === 'commands' ? 'command' : spec.kind;
      t.files.push({ path: p, kind, scope: fscope });
      index.push({ tool: spec.tool, rel, abs, p, scope: fscope, spec, set, confine: scope === 'global' ? null : base });
      break; // a file belongs to the first matching spec
    }
  }
}

function populate(tools, index) {
  for (const f of index) {
    const t = tools[f.tool];
    const cap = t.capabilities;
    const kind = f.spec.kind;
    const text = readText(f.abs, f.confine);
    const add = (c, item) => { cap[c].items.push(item); };
    if (kind === 'instructions') {
      add('instructions', { path: f.p, scope: f.scope, base: f.scope === 'global' ? '' : baseOf(f.rel), tokens: text ? estimateTokens(text) : 0, lines: text ? text.split('\n').length : 0 });
    } else if (kind === 'rules') {
      if (text == null) continue;
      const item = ruleMeta(f.tool, f.rel, text);
      item.path = f.p; item.scope = f.scope; item.tokens = estimateTokens(text);
      if (f.scope === 'global') item.base = '';
      add('rules', item);
    } else if (kind === 'agents') {
      if (path.posix.basename(f.rel) === '.roomodes') {
        const j = readJsonFile(f.abs, f.confine);
        for (const m of Array.isArray(j?.customModes) ? j.customModes : []) {
          add('agents', { path: f.p, scope: f.scope, name: String(m.slug || m.name || 'mode'), description: trunc(m.roleDefinition || m.description || m.name) });
        }
        continue;
      }
      if (text == null) continue;
      const { data } = parseFrontmatter(text);
      add('agents', {
        path: f.p, scope: f.scope, name: String(data.name || path.posix.basename(f.rel).replace(/\.(chatmode\.)?md$/, '')),
        description: trunc(data.description), tools: toList(data.tools), model: typeof data.model === 'string' ? data.model : undefined,
      });
    } else if (kind === 'skills') {
      if (text == null) continue;
      const { data } = parseFrontmatter(text);
      const dir = path.posix.dirname(f.rel);
      const siblings = [...f.set].filter((x) => x.startsWith(`${dir}/`) && x !== f.rel).slice(0, 50).map((x) => (f.scope === 'global' ? `~/${x}` : x));
      add('skills', { path: f.p, scope: f.scope, name: String(data.name || path.posix.basename(dir)), description: trunc(data.description), files: siblings, allowedTools: toList(data['allowed-tools']) });
    } else if (kind === 'commands') {
      const { data } = text ? parseFrontmatter(text) : { data: {} };
      const m = /\/(?:commands|prompts|workflows)\/(.+?)\.[a-z.]+$/i.exec(f.rel);
      let desc = data.description;
      if (!desc && text && /\.toml$/.test(f.rel)) { const d = /^description\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(text); if (d) desc = d[1]; }
      add('commands', {
        path: f.p, scope: f.scope, name: (m ? m[1] : path.posix.basename(f.rel)).replace(/\//g, ':'),
        description: trunc(desc), argumentHint: Array.isArray(data['argument-hint']) ? `[${data['argument-hint'].join(', ')}]` : typeof data['argument-hint'] === 'string' ? data['argument-hint'] : undefined,
      });
    } else if (kind === 'ignore') {
      const n = text ? text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).length : 0;
      add('ignore', { path: f.p, scope: f.scope, patterns: n });
    } else if (kind === 'mcp' && f.tool !== 'cursor' && !(f.tool === 'claude')) {
      for (const s of mcpFromJson(readJsonFile(f.abs, f.confine), f.p, f.scope)) add('mcp', s);
    }
  }
}

/**
 * Scan every supported AI tool's config footprint in a project (and optionally ~).
 * @returns {{ tools: Array, totals: object }}
 */
export function scanAgentSetup(root, { home = os.homedir(), includeGlobal = false } = {}) {
  const tools = {};
  for (const id of Object.keys(TOOL_NAMES)) tools[id] = { id, name: TOOL_NAMES[id], detected: false, files: [], capabilities: emptyCaps() };
  const index = [];
  scanBase(root, 'project', '', tools, index);
  if (includeGlobal && home) scanBase(home, 'global', '~/', tools, index);
  populate(tools, index);

  // MCP / hooks / permissions through the shared config reader (env values never leave it)
  const addCfg = (cfg, scope, prefix) => {
    const pfx = (s) => (prefix ? `${prefix}${s}` : s);
    for (const s of cfg.mcpServers) {
      const tool = s.source.startsWith('.cursor/') ? 'cursor' : s.source.startsWith('.codex/') ? 'codex' : 'claude';
      tools[tool].capabilities.mcp.items.push({ ...s, source: pfx(s.source), scope });
    }
    const c = tools.claude.capabilities;
    for (const h of cfg.hooks) c.hooks.items.push({ ...h, source: pfx(h.source), scope });
    for (const k of ['allow', 'deny', 'ask']) for (const rule of cfg.permissions[k]) c.permissions.items.push({ kind: k, rule, scope, source: cfg.permissions.source.split(', ').map(pfx).join(', ') });
  };
  addCfg(readAgentConfig(root), 'project', '');
  if (includeGlobal && home) {
    addCfg(readAgentConfig(home), 'global', '~/');
    const cj = readJsonFile(path.join(home, '.claude.json'));
    if (cj?.mcpServers) {
      tools.claude.files.push({ path: '~/.claude.json', kind: 'mcp', scope: 'global' });
      for (const s of mcpFromJson({ mcpServers: cj.mcpServers }, '~/.claude.json', 'global')) tools.claude.capabilities.mcp.items.push(s);
    }
  }
  // dedupe mcp items (same name+source)
  for (const t of Object.values(tools)) {
    const seen = new Set();
    t.capabilities.mcp.items = t.capabilities.mcp.items.filter((s) => { const k = `${s.name}|${s.source}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const totals = { toolsDetected: 0, files: 0 };
  for (const k of CAPS) totals[k] = 0;
  const list = Object.values(tools);
  for (const t of list) {
    for (const k of CAPS) t.capabilities[k].count = t.capabilities[k].items.length;
    t.detected = t.files.length > 0 || CAPS.some((k) => t.capabilities[k].count > 0);
    if (t.detected) totals.toolsDetected++;
    totals.files += t.files.length;
    for (const k of CAPS) totals[k] += t.capabilities[k].count;
  }
  return { tools: list, totals };
}

function matchGlob(glob, rel) {
  let g = glob.replace(/^\.\//, '');
  if (!g || g.startsWith('!')) return false;
  if (g.endsWith('/')) g += '**';
  if (!g.includes('/')) g = `**/${g}`;
  return globToRegex(g).test(rel);
}

function insideBase(base, rel) {
  return !base || rel === base || rel.startsWith(`${base}/`);
}

/**
 * Which instruction / rule files apply when an agent works on `filePath`?
 * @returns {{tool:string, path:string, reason:'always'|'glob'|'hierarchy'|'description', glob?:string}[]}
 */
export function rulesForFile(root, filePath, setup = scanAgentSetup(root)) {
  const rel = String(filePath || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
  if (!rel || rel.split('/').includes('..') || rel.includes('\0')) return [];
  const out = [];
  for (const t of setup.tools) {
    for (const it of t.capabilities.instructions.items) {
      if (it.scope === 'global') { out.push({ tool: t.id, path: it.path, reason: 'always' }); continue; }
      if (!insideBase(it.base, rel)) continue;
      out.push({ tool: t.id, path: it.path, reason: it.base ? 'hierarchy' : 'always' });
    }
    for (const r of t.capabilities.rules.items) {
      if (r.scope !== 'global' && !insideBase(r.base, rel)) continue;
      const local = r.base && r.scope !== 'global' ? rel.slice(r.base.length + 1) : rel;
      const globs = r.globs || [];
      const hit = globs.find((g) => matchGlob(g, local));
      let reason = null;
      if (t.id === 'cursor') {
        if (r.alwaysApply) reason = 'always';
        else if (hit) reason = 'glob';
        else if (r.description && !globs.length) reason = 'description';
      } else if (t.id === 'copilot') {
        if (hit) reason = 'glob';
        else if (!globs.length && r.description) reason = 'description';
      } else if (t.id === 'windsurf') {
        if (r.trigger === 'always_on') reason = 'always';
        else if (r.trigger === 'glob' && hit) reason = 'glob';
        else if (r.trigger === 'model_decision' && r.description) reason = 'description';
        else if (!r.trigger && hit) reason = 'glob';
      } else if (t.id === 'claude' || t.id === 'continue') {
        if (globs.length) { if (hit) reason = 'glob'; } else if (r.alwaysApply !== false) reason = 'always';
        else if (hit) reason = 'glob';
        if (!reason && r.alwaysApply && t.id === 'continue') reason = 'always';
      } else if (globs.length) { if (hit) reason = 'glob'; } else reason = 'always';
      if (!reason) continue;
      const e = { tool: t.id, path: r.path, reason };
      if (reason === 'glob') e.glob = hit;
      out.push(e);
    }
  }
  return out;
}
