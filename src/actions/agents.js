import fs from 'node:fs';
import path from 'node:path';
import { renderTemplate } from '../agentcenter/templates.js';
import { syncPlan } from '../agentcenter/sync.js';
import { testMcpServer } from '../agentcenter/mcptest.js';

const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];
const MCP_FILE = '.mcp.json';
const NAME_RE = /^[A-Za-z0-9][\w.-]{0,63}$/;
const HOOK_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd']);

function rel(root, p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('invalid path');
  const r = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (r.startsWith('/') || r.split('/').includes('..')) throw new Error(`invalid path: ${p}`);
  const abs = path.resolve(root, r);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('path escapes project root');
  return { rel: r, abs };
}

function writeAtomic(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, abs);
}

function readJson(abs) {
  try { const v = JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, '')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`cannot parse ${path.basename(abs)}: ${e.message}`); }
}

async function touch(ctx, relPath) {
  try { await ctx.store?.handleFsEvent?.({ type: 'add', path: relPath }); } catch { /* watcher will catch up */ }
}

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split('\n') : []).map((x) => String(x).trim()).filter(Boolean);
const parseObj = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(String(v || '{}')); } catch { throw new Error('expected JSON'); } };

function validateHooks(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) throw new Error('hooks must be an object keyed by event');
  const out = {};
  for (const [ev, groups] of Object.entries(h)) {
    if (!HOOK_EVENTS.has(ev)) throw new Error(`unknown hook event: ${ev}`);
    if (!Array.isArray(groups)) throw new Error(`hooks.${ev} must be an array`);
    out[ev] = groups.map((g) => {
      if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) throw new Error(`hooks.${ev}[] needs a hooks array`);
      const grp = { hooks: g.hooks.map((x) => {
        if (!x || x.type !== 'command' || typeof x.command !== 'string' || !x.command.trim()) throw new Error('each hook needs type "command" and a command');
        const e = { type: 'command', command: x.command };
        if (Number.isFinite(x.timeout) && x.timeout > 0) e.timeout = x.timeout;
        return e;
      }) };
      if (typeof g.matcher === 'string' && g.matcher) grp.matcher = g.matcher;
      return grp;
    });
  }
  return out;
}

export default function register(registry, ctx) {
  const root = ctx.root;

  registry.register({
    id: 'agents.create', title: 'Create agent file from template', category: 'agents', level: 'edit',
    description: 'Create a CLAUDE.md, skill, subagent, rule, ADR... from a built-in template. Never overwrites.',
    params: {
      template: { type: 'string', required: true, label: 'Template id' },
      vars: { type: 'text', label: 'Variables (JSON)' },
      path: { type: 'path', label: 'Path (optional, defaults to template path)' },
    },
    preview: (p) => { const r = renderTemplate(p.template, parseObj(p.vars)); return { summary: `Create ${p.path || r.path}`, command: null, path: p.path || r.path, content: r.content }; },
    run: async (p, c, job) => {
      const r = renderTemplate(p.template, parseObj(p.vars));
      const t = rel(root, p.path || r.path);
      if (fs.existsSync(t.abs)) throw new Error(`already exists: ${t.rel}`);
      writeAtomic(t.abs, r.content);
      job?.log?.('info', `created ${t.rel}`);
      await touch(ctx, t.rel);
      return { path: t.rel, bytes: Buffer.byteLength(r.content) };
    },
  });

  registry.register({
    id: 'agents.sync.apply', title: 'Sync instruction files', category: 'agents', level: 'edit',
    description: 'Copy one instruction file (e.g. AGENTS.md) into other tools\' files (CLAUDE.md, GEMINI.md, .cursorrules, copilot-instructions.md).',
    params: {
      source: { type: 'string', required: true, label: 'Source file or tool id' },
      targets: { type: 'string[]', required: true, label: 'Target files or tool ids' },
      mode: { type: 'enum', enum: ['copy', 'import'], default: 'copy', label: 'Mode' },
    },
    preview: (p) => ({ summary: `Sync ${p.source} -> ${strList(p.targets).join(', ')}`, command: null }),
    run: async (p, c, job) => {
      const plan = syncPlan(root, { source: p.source, targets: strList(p.targets), mode: p.mode });
      const written = [];
      for (const it of plan) {
        if (it.unchanged) continue;
        const t = rel(root, it.target);
        writeAtomic(t.abs, it.content);
        written.push(t.rel);
        job?.log?.('info', `wrote ${t.rel}`);
        await touch(ctx, t.rel);
      }
      return { written, skipped: plan.filter((i) => i.unchanged).map((i) => i.target) };
    },
  });

  registry.register({
    id: 'agents.permissions.update', title: 'Update Claude permissions', category: 'agents', level: 'edit',
    description: 'Replace permissions.allow / deny / ask in .claude/settings(.local).json, keeping every other key.',
    params: {
      file: { type: 'enum', enum: SETTINGS_FILES, required: true, label: 'Settings file' },
      allow: { type: 'string[]', label: 'Allow rules' }, deny: { type: 'string[]', label: 'Deny rules' }, ask: { type: 'string[]', label: 'Ask rules' },
    },
    preview: (p) => ({ summary: `Update permissions in ${p.file}`, command: null }),
    run: async (p) => {
      if (!SETTINGS_FILES.includes(p.file)) throw new Error('unsupported settings file');
      const t = rel(root, p.file);
      const j = readJson(t.abs);
      j.permissions = { ...(j.permissions && typeof j.permissions === 'object' ? j.permissions : {}) };
      for (const k of ['allow', 'deny', 'ask']) if (p[k] !== undefined) j.permissions[k] = strList(p[k]);
      writeAtomic(t.abs, `${JSON.stringify(j, null, 2)}\n`);
      await touch(ctx, t.rel);
      return { file: t.rel, counts: { allow: (j.permissions.allow || []).length, deny: (j.permissions.deny || []).length, ask: (j.permissions.ask || []).length } };
    },
  });

  registry.register({
    id: 'agents.hooks.update', title: 'Update Claude hooks', category: 'agents', level: 'edit',
    description: 'Replace the hooks block in .claude/settings(.local).json (validated).',
    params: {
      file: { type: 'enum', enum: SETTINGS_FILES, required: true, label: 'Settings file' },
      hooks: { type: 'text', required: true, label: 'Hooks (JSON object keyed by event)' },
    },
    preview: (p) => ({ summary: `Update hooks in ${p.file}`, command: null }),
    run: async (p) => {
      if (!SETTINGS_FILES.includes(p.file)) throw new Error('unsupported settings file');
      const hooks = validateHooks(parseObj(p.hooks));
      const t = rel(root, p.file);
      const j = readJson(t.abs);
      if (Object.keys(hooks).length) j.hooks = hooks; else delete j.hooks;
      writeAtomic(t.abs, `${JSON.stringify(j, null, 2)}\n`);
      await touch(ctx, t.rel);
      return { file: t.rel, events: Object.keys(hooks) };
    },
  });

  registry.register({
    id: 'agents.mcp.add', title: 'Add MCP server', category: 'agents', level: 'edit',
    description: 'Add a server to .mcp.json (stdio command or http/sse url).',
    params: {
      name: { type: 'string', required: true, pattern: NAME_RE.source, label: 'Name' },
      type: { type: 'enum', enum: ['stdio', 'http', 'sse'], required: true, label: 'Transport' },
      command: { type: 'string', label: 'Command (stdio)' }, args: { type: 'string[]', label: 'Arguments' },
      url: { type: 'string', label: 'URL (http/sse)' },
    },
    preview: (p) => ({ summary: `Add MCP server "${p.name}" to ${MCP_FILE}`, command: p.type === 'stdio' ? [p.command, ...strList(p.args)] : null }),
    run: async (p) => {
      if (!NAME_RE.test(p.name || '')) throw new Error('invalid server name');
      const def = {};
      if (p.type === 'stdio') {
        if (!p.command || /[\0\r\n]/.test(p.command)) throw new Error('command required for stdio');
        def.command = p.command;
        const args = strList(p.args);
        if (args.length) def.args = args;
      } else {
        let u; try { u = new URL(p.url); } catch { throw new Error('valid url required'); }
        if (!/^https?:$/.test(u.protocol)) throw new Error('url must be http(s)');
        def.type = p.type; def.url = p.url;
      }
      const t = rel(root, MCP_FILE);
      const j = readJson(t.abs);
      j.mcpServers = j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {};
      if (Object.prototype.hasOwnProperty.call(j.mcpServers, p.name)) throw new Error(`server "${p.name}" already exists`);
      j.mcpServers[p.name] = def;
      writeAtomic(t.abs, `${JSON.stringify(j, null, 2)}\n`);
      await touch(ctx, t.rel);
      return { file: t.rel, name: p.name };
    },
  });

  registry.register({
    id: 'agents.mcp.remove', title: 'Remove MCP server', category: 'agents', level: 'edit',
    description: 'Remove a server from .mcp.json.',
    params: { name: { type: 'string', required: true, pattern: NAME_RE.source, label: 'Name' } },
    preview: (p) => ({ summary: `Remove MCP server "${p.name}" from ${MCP_FILE}`, command: null }),
    run: async (p) => {
      const t = rel(root, MCP_FILE);
      const j = readJson(t.abs);
      if (!j.mcpServers || !Object.prototype.hasOwnProperty.call(j.mcpServers, p.name)) throw new Error(`server "${p.name}" not found`);
      delete j.mcpServers[p.name];
      writeAtomic(t.abs, `${JSON.stringify(j, null, 2)}\n`);
      await touch(ctx, t.rel);
      return { file: t.rel, name: p.name };
    },
  });

  registry.register({
    id: 'agents.mcp.test', title: 'Test MCP server', category: 'agents', level: 'exec',
    description: 'Start the server from .mcp.json, run initialize + tools/list (15 s timeout, process killed afterwards).',
    params: { name: { type: 'string', required: true, pattern: NAME_RE.source, label: 'Name' } },
    preview: (p) => {
      let def = null;
      try { def = readJson(rel(root, MCP_FILE).abs).mcpServers?.[p.name]; } catch { /* reported by run */ }
      return { summary: `Test MCP server "${p.name}"`, command: def?.command ? [def.command, ...(Array.isArray(def.args) ? def.args : [])] : def?.url ? ['POST', def.url] : null };
    },
    run: async (p, c, job) => {
      const def = readJson(rel(root, MCP_FILE).abs).mcpServers?.[p.name];
      if (!def) throw new Error(`server "${p.name}" not found in ${MCP_FILE}`);
      job?.log?.('info', `testing ${p.name}`);
      const res = await testMcpServer(def, { cwd: root, signal: job?.signal });
      job?.log?.(res.ok ? 'info' : 'stderr', res.ok ? `ok: ${res.tools.length} tools` : `failed: ${res.error}`);
      return res;
    },
  });
}
