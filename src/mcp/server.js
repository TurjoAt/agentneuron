// agentneuron MCP server: read-only tools over stdio (JSON-RPC 2.0, newline-delimited).
// stdout carries ONLY protocol messages; diagnostics go to stderr when AGENTNEURON_DEBUG is set.
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig } from '../core/config.js';
import { createStore } from '../core/store.js';
import { VERSION } from '../server/version.js';
import { createWatcher } from '../core/watcher.js';
import { buildGraph } from '../analysis/graph.js';
import { effectiveContext, contextDirs } from '../analysis/context.js';
import { extractTasks } from '../analysis/tasks.js';
import { lint } from '../health/lint.js';
import { healthScore } from '../health/score.js';
import { maskSecretsInText } from '../health/secrets.js';
import { scanAgentSetup } from '../agentcenter/setup.js';
import { exportReport, rangeFromSpec } from '../reports/index.js';
import { createJsonl, filterRange } from '../persist/jsonl.js';

export const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
const MAX_TEXT = 200 * 1024;
const MAX_RESPONSE = 1024 * 1024; // hard cap on one tool result (serialized)
const MAX_LINE = 4 * 1024 * 1024; // longest accepted JSON-RPC line
const KNOWN_TOOLS = new Set(['claude', 'codex', 'cursor']);

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOLS = [
  { name: 'list_files', description: 'List tracked AI-context / markdown files with tool, kind, size and tokens.',
    inputSchema: obj({ tool: { type: 'string', description: 'Filter by tool (claude, codex, cursor, ...)' }, kind: { type: 'string', description: 'Filter by kind (context, rules, agent, skill, doc, ...)' } }) },
  { name: 'read_file', description: 'Read a tracked file by project-relative path (secrets masked).', inputSchema: obj({ path: { type: 'string' } }, ['path']) },
  { name: 'search', description: 'Case-insensitive text search across tracked files.', inputSchema: obj({ query: { type: 'string' }, limit: { type: 'number' } }, ['query']) },
  { name: 'get_health', description: 'Context health score, grade and top issues.', inputSchema: obj({ limit: { type: 'number' } }) },
  { name: 'get_context', description: 'Effective agent context (merged instruction files) for a directory and tool.',
    inputSchema: obj({ dir: { type: 'string', description: 'Project-relative directory, "" for root' }, tool: { type: 'string', enum: ['claude', 'codex', 'cursor'] } }) },
  { name: 'recent_changes', description: 'Files changed since a time (ISO date, epoch ms, or relative like "2h", "3d").', inputSchema: obj({ since: { type: 'string' }, limit: { type: 'number' } }) },
  { name: 'get_tasks', description: 'Open and done tasks (checkboxes, TODO/FIXME) found in markdown.', inputSchema: obj({ status: { type: 'string', enum: ['open', 'done', 'all'] }, limit: { type: 'number' } }) },
  { name: 'get_links', description: 'Incoming and outgoing links for a file.', inputSchema: obj({ path: { type: 'string' } }, ['path']) },
  { name: 'project_info', description: 'Project overview: root, file counts, tokens, detected AI tools.', inputSchema: obj() },
  { name: 'report_export', description: 'Activity/health report for a time range. format "ai" returns a compact Markdown context pack (KPIs, changes, ranked issues, open tasks, context budget, next actions); "json" returns the agentneuron.report/v1 object. Secrets masked.',
    inputSchema: obj({ range: { type: 'string', description: 'Relative range ending now, e.g. "24h", "7d", "30d" (default "7d")' }, format: { type: 'string', enum: ['ai', 'json'] },
      includeContent: { type: 'boolean', description: 'Append size-capped (~40k tokens) contents of the main context files' } }) },
];

function parseSince(v) {
  if (v == null || v === '') return Date.now() - 24 * 3600 * 1000;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const rel = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i.exec(s);
  if (rel) return Date.now() - Number(rel[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[rel[2].toLowerCase()];
  if (/^\d{10,}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`invalid "since": ${s}`);
  return t;
}

function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('\0')) return null;
  const n = p.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return null;
  const r = n.replace(/^\.\//, '');
  return r.split('/').includes('..') ? null : r;
}

/** Defence in depth: mask secret-looking values in every string of a tool result. */
function maskDeep(v, depth = 0) {
  if (typeof v === 'string') return maskSecretsInText(v);
  if (depth > 8 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = maskDeep(x, depth + 1);
  return out;
}

const RAW_TEXT = Symbol('rawText');
const cap = (n, d = 50, max = 500) => Math.max(1, Math.min(max, Math.floor(Number(n)) || d));

export async function runMcpServer(root, config = {}, io = {}) {
  const input = io.input || process.stdin;
  const output = io.output || process.stdout;
  const absRoot = path.resolve(root);
  const cfg = loadConfig(absRoot, config || {});
  const store = createStore(absRoot, cfg);
  await store.init();
  let watcher = null;
  if (!io.noWatch) {
    try { watcher = createWatcher(absRoot, cfg, (e) => { store.handleFsEvent(e).catch(() => {}); }); } catch { /* optional */ }
  }

  let cache = null;
  store.on('changed', () => { cache = null; });
  function analysis() {
    if (cache) return cache;
    const files = [...store.files.values()];
    const graph = buildGraph(files, store.contents);
    const issues = lint({ root: absRoot, files, contents: store.contents, links: graph.edges }) || [];
    const health = healthScore(issues, files);
    const tasks = [];
    for (const f of files) { const c = store.contents.get(f.path); if (typeof c === 'string') tasks.push(...extractTasks(f.path, c)); }
    cache = { files, graph, issues, health, tasks };
    return cache;
  }

  // read-only report context: in-memory store plus persisted history written by `agentneuron serve` (never written here)
  const persisted = (name) => createJsonl(path.join(absRoot, '.agentneuron', `${name}.jsonl`));
  const reportCtx = {
    root: absRoot, config: cfg, store, allFiles: () => [...store.files.values()], analysis: async () => analysis(),
    persist: {
      events: { query: ({ from, to, limit } = {}) => filterRange([...persisted('events').readAll(), ...store.events].sort((a, b) => a.ts - b.ts), { from, to, limit }) },
      metrics: { query: ({ from, to } = {}) => filterRange(persisted('metrics').readAll(), { from, to }) },
    },
  };

  const tools = {
    list_files({ tool, kind } = {}) {
      return [...store.files.values()].filter((f) => (!tool || f.tool === tool) && (!kind || f.kind === kind)).slice(0, 5000)
        .map((f) => ({ path: f.path, tool: f.tool, kind: f.kind, size: f.size, tokens: f.tokens, lines: f.lines, mtime: f.mtime, title: maskSecretsInText(f.title) }));
    },
    read_file({ path: p } = {}) {
      const rel = safeRel(p);
      if (!rel || !store.contents.has(rel)) throw new Error(`file not tracked: ${p}`);
      let c = maskSecretsInText(store.contents.get(rel));
      let truncated = false;
      if (c.length > MAX_TEXT) { c = c.slice(0, MAX_TEXT); truncated = true; }
      return { path: rel, truncated, content: c };
    },
    search({ query, limit } = {}) {
      const q = String(query || '').toLowerCase().slice(0, 500);
      if (!q) throw new Error('query is required');
      const max = cap(limit, 50, 200);
      const hits = [];
      outer: for (const [p, c] of store.contents) {
        const lines = c.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].toLowerCase().includes(q)) continue;
          // mask first, then match: a query must not be able to confirm/probe a secret's value
          const masked = maskSecretsInText(lines[i].trim().slice(0, 2000));
          if (!masked.toLowerCase().includes(q)) continue;
          hits.push({ path: p, line: i + 1, text: masked.slice(0, 300) });
          if (hits.length >= max) break outer;
        }
      }
      return hits;
    },
    get_health({ limit } = {}) {
      const a = analysis();
      return { score: a.health.score, grade: a.health.grade, counts: a.health.counts, byRule: a.health.byRule,
        issues: a.issues.slice(0, cap(limit, 25, 200)).map((i) => ({ rule: i.rule, severity: i.severity, path: i.path, line: i.line, message: maskSecretsInText(i.message), hint: maskSecretsInText(i.hint) })) };
    },
    get_context({ dir = '', tool = 'claude' } = {}) {
      const d = String(dir || '');
      if (d.includes('\0') || d.split(/[\\/]/).includes('..') || d.startsWith('/') || /^[A-Za-z]:/.test(d)) throw new Error('invalid dir');
      if (!KNOWN_TOOLS.has(tool)) throw new Error('invalid tool');
      const files = [...store.files.values()];
      const r = effectiveContext(d, files, store.contents, tool);
      let text = maskSecretsInText(r.text);
      let truncated = false;
      if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); truncated = true; }
      return { dir: r.dir, tool: r.tool, tokens: r.tokens, chain: r.chain.slice(0, 500), truncated, text, dirs: contextDirs(files).slice(0, 2000) };
    },
    recent_changes({ since, limit } = {}) {
      const t = parseSince(since);
      const changed = [...store.files.values()].filter((f) => f.mtime >= t).sort((a, b) => b.mtime - a.mtime).slice(0, cap(limit, 50, 500))
        .map((f) => ({ path: f.path, tool: f.tool, kind: f.kind, mtime: f.mtime }));
      const events = store.events.filter((e) => e.ts >= t).slice(-100).map((e) => ({ type: e.type, path: e.path, ts: e.ts, added: e.stats?.added, removed: e.stats?.removed }));
      return { since: t, changed, events };
    },
    get_tasks({ status = 'open', limit } = {}) {
      const a = analysis();
      const list = a.tasks.filter((t) => status === 'all' || (status === 'done' ? t.done : !t.done));
      return { total: list.length, tasks: list.slice(0, cap(limit, 100, 1000)).map((t) => ({ ...t, text: maskSecretsInText(t.text) })) };
    },
    get_links({ path: p } = {}) {
      const rel = safeRel(p);
      if (!rel || !store.files.has(rel)) throw new Error(`file not tracked: ${p}`);
      const a = analysis();
      const slim = (e) => ({ from: maskSecretsInText(e.from), to: maskSecretsInText(e.to), type: e.type, line: e.line, broken: e.broken });
      return { path: rel, out: a.graph.edges.filter((e) => e.from === rel).slice(0, 1000).map(slim), in: a.graph.edges.filter((e) => e.to === rel).slice(0, 1000).map(slim) };
    },
    project_info() {
      const a = analysis();
      const byTool = {}; let tokens = 0;
      for (const f of a.files) { byTool[f.tool] = (byTool[f.tool] || 0) + 1; tokens += f.tokens || 0; }
      const setup = scanAgentSetup(absRoot, { includeGlobal: false });
      return { name: path.basename(absRoot), root: absRoot, files: a.files.length, tokens, byTool, health: { score: a.health.score, grade: a.health.grade },
        tools: setup.tools.filter((t) => t.detected).map((t) => t.id), setup: setup.totals };
    },
    async report_export({ range = '7d', format = 'ai', includeContent = false } = {}) {
      if (!['ai', 'json'].includes(format)) throw new Error('format must be "ai" or "json"');
      const out = await exportReport(reportCtx, rangeFromSpec(range), format, { includeContent: includeContent === true });
      // ai: raw Markdown (not JSON-encoded) so the model reads it directly; json: the v1 object
      return format === 'json' ? JSON.parse(out.body) : { [RAW_TEXT]: out.body };
    },
  };

  const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // responses from the client (result/error) are ignored; everything else malformed is an error
      if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.method === undefined && ('result' in msg || 'error' in msg)) return null;
      const id = msg && typeof msg === 'object' && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
      return rpcError(id, -32600, 'Invalid Request');
    }
    const isNote = msg.id === undefined || msg.id === null;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    switch (msg.method) {
      case 'initialize': {
        const want = params.protocolVersion;
        return rpcResult(msg.id, {
          protocolVersion: SUPPORTED.has(want) ? want : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'agentneuron', version: VERSION },
          instructions: 'agentneuron exposes the AI-context markdown of this project (CLAUDE.md, AGENTS.md, rules, skills, docs). Read-only.',
        });
      }
      case 'ping': return isNote ? null : rpcResult(msg.id, {});
      case 'tools/list': return rpcResult(msg.id, { tools: TOOLS });
      case 'tools/call': {
        const fn = typeof params.name === 'string' && Object.hasOwn(tools, params.name) ? tools[params.name] : null;
        if (!fn) return rpcError(msg.id, -32602, `Unknown tool: ${String(params.name).slice(0, 100)}`);
        try {
          const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
          const data = await fn(args);
          let text = data && typeof data[RAW_TEXT] === 'string' ? maskSecretsInText(data[RAW_TEXT]) : JSON.stringify(maskDeep(data), null, 2);
          if (text.length > MAX_RESPONSE) text = `${text.slice(0, MAX_RESPONSE)}\n… [output truncated at ${MAX_RESPONSE} bytes]`;
          return rpcResult(msg.id, { content: [{ type: 'text', text }], isError: false });
        } catch (e) {
          return rpcResult(msg.id, { content: [{ type: 'text', text: maskSecretsInText(String(e?.message || e)).slice(0, 2000) }], isError: true });
        }
      }
      case 'resources/list': return rpcResult(msg.id, { resources: [] });
      case 'prompts/list': return rpcResult(msg.id, { prompts: [] });
      default:
        if (isNote || msg.method.startsWith('notifications/')) return null;
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  const send = (m) => { try { output.write(`${JSON.stringify(m)}\n`); } catch { /* closed pipe */ } };
  // a closed client pipe must not crash the process with an unhandled 'error' event
  output.on?.('error', () => {});
  input.on?.('error', () => {});
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    if (line.length > MAX_LINE) { send(rpcError(null, -32600, 'Request too large')); return; }
    let msg;
    try { msg = JSON.parse(line); } catch { send(rpcError(null, -32700, 'Parse error')); return; }
    const p = (async () => {
      const items = Array.isArray(msg) ? msg : [msg];
      const outs = [];
      if (Array.isArray(msg) && !msg.length) { send(rpcError(null, -32600, 'Invalid Request')); return; }
      for (const m of items) {
        try { const r = await handle(m); if (r) outs.push(r); } catch (e) { outs.push(rpcError(typeof m?.id === 'string' || typeof m?.id === 'number' ? m.id : null, -32603, 'Internal error')); }
      }
      if (Array.isArray(msg)) { if (outs.length) send(outs); } else if (outs[0]) send(outs[0]);
    })().finally(() => pending.delete(p));
    pending.add(p);
  });
  await new Promise((resolve) => rl.once('close', resolve));
  await Promise.all([...pending]);
  try { await watcher?.close(); } catch { /* ignore */ }
}
