// Mock backend implementing the REST + SSE contract (docs/CONTRACT.md + CONTRACT-v0.2.md) in-memory.
// Query flags: ?mock=1 · &role=viewer · &off=edit,exec,danger · &login (show login screen) · &quiet (no live edits)
// Enabled with ?mock=1, or automatically when /api/state is unreachable.
// It mutates its own state over time to simulate agents editing files.

import { SEED, PROJECT, sessions as seedSessions, gitInfo, AGENT_CONFIG, EDIT_LINES, GIT_SEED, NATIVE_TASKS, MOCK_ACTIONS } from './mock-data.js';
import { insightRoutes } from './mock-insight.js';

const MIN = 60_000;
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const hashOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'.slice(0, 32);
};
const tokensOf = (s) => Math.ceil(s.length / 4);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

function resolve(fromDir, target) {
  const parts = target.startsWith('/') ? [] : fromDir ? fromDir.split('/') : [];
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Simple LCS line diff (fine for small mock files). */
export function lineDiff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = [];
  let i = 0, j = 0, added = 0, removed = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { hunks.push({ type: 'ctx', line: j + 1, text: B[j] }); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { hunks.push({ type: 'add', line: j + 1, text: B[j] }); j++; added++; }
    else { hunks.push({ type: 'del', line: i + 1, text: A[i] }); i++; removed++; }
  }
  return { added, removed, hunks };
}

function extractLinks(path, content, all) {
  const out = [];
  const dir = dirOf(path);
  const lines = content.split('\n');
  let fence = false;
  const byBase = new Map();
  for (const p of all) byBase.set(baseOf(p).replace(/\.\w+$/, '').toLowerCase(), p);
  lines.forEach((l, k) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const line = k + 1;
    for (const m of l.matchAll(/\[[^\]]+\]\(([^)\s#]+)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      const to = resolve(dir, m[1]);
      out.push({ from: path, to, type: 'md-link', line, broken: !all.has(to), raw: m[0] });
    }
    for (const m of l.matchAll(/\[\[([^\]|#]+)/g)) {
      const to = byBase.get(m[1].trim().toLowerCase()) || m[1].trim() + '.md';
      out.push({ from: path, to, type: 'wiki', line, broken: !all.has(to), raw: m[0] });
    }
    for (const m of l.matchAll(/(?:^|\s)@((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+)/g)) {
      const to = resolve(dir, m[1]);
      out.push({ from: path, to, type: 'import', line, broken: !all.has(to), raw: '@' + m[1] });
    }
  });
  // hierarchy: nested CLAUDE.md / AGENTS.md → nearest ancestor
  const name = baseOf(path);
  if (['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'].includes(name) && dir) {
    let d = dirOf(dir);
    for (;;) {
      const cand = d ? `${d}/${name}` : name;
      if (all.has(cand)) { out.push({ from: path, to: cand, type: 'hierarchy', line: 0, broken: false, raw: '' }); break; }
      if (!d) break;
      d = dirOf(d);
    }
  }
  // agents → skills references
  if (path.startsWith('.claude/agents/') && /release skill/i.test(content) && !out.some((x) => x.to.includes('skills/release'))) {
    out.push({ from: path, to: '.claude/skills/release/SKILL.md', type: 'ref', line: 0, broken: false, raw: 'release skill' });
  }
  return out;
}

const httpErr = (status, message, body) => Object.assign(new Error(message), { status, body: body ? { error: message, ...body } : null });
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

// ---------------------------------------------------------------- board md parsing (mirrors src/board/parse.js)
const TASK_RE = /^(\s*)[-*+]\s+\[( |x|X|\/)\]\s+(.*)$/;
const PRIOS = ['none', 'low', 'med', 'high', 'urgent'];
function parseMeta(text) {
  let t = ` ${text} `;
  let due = null;
  let priority = 'none';
  let assignee = null;
  const labels = [];
  t = t.replace(/\s@due\((\d{4}-\d{2}-\d{2})\)/g, (_, d) => ((due = d), ' '));
  t = t.replace(/\s!(low|med|high|urgent)\b/g, (_, p) => ((priority = p), ' '));
  t = t.replace(/\s#([A-Za-z][\w/-]{0,40})\b/g, (_, l) => (labels.push(l), ' '));
  t = t.replace(/\s@([A-Za-z][\w.-]{0,40})(?![\w(/.])/g, (_, a) => ((assignee = assignee || a), ' '));
  return { title: t.replace(/\s+/g, ' ').trim(), due, priority, labels, assignee };
}
function metaSuffix({ priority, labels, assignee, due }) {
  const p = [];
  if (priority && priority !== 'none') p.push(`!${priority}`);
  for (const l of labels || []) p.push(`#${l}`);
  if (assignee) p.push(`@${assignee}`);
  if (due) p.push(`@due(${due})`);
  return p.length ? ' ' + p.join(' ') : '';
}
const charOf = (status) => (status === 'done' ? 'x' : status === 'doing' ? '/' : ' ');
const statusOf = (c) => (c === 'x' || c === 'X' ? 'done' : c === '/' ? 'doing' : 'todo');

function parseMdTasks(path, content) {
  const out = [];
  let section = null;
  let fence = false;
  let cur = null;
  content.split('\n').forEach((l, k) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const h = l.match(/^#{1,6}\s+(.*)/);
    if (h) {
      section = h[1].trim();
      cur = null;
      return;
    }
    const m = l.match(TASK_RE);
    if (!m) {
      if (l.trim() && !/^\s/.test(l)) cur = null;
      return;
    }
    const indent = m[1].replace(/\t/g, '    ').length;
    if (indent >= 2 && cur) {
      cur.checklist.push({ text: m[3].trim(), done: m[2] !== ' ' && m[2] !== '/', line: k + 1 });
      return;
    }
    const meta = parseMeta(m[3]);
    cur = { id: 'md' + hashOf(path + '|' + meta.title.toLowerCase()).slice(0, 10), path, line: k + 1, mdChar: m[2], status: statusOf(m[2]), section, checklist: [], ...meta };
    out.push(cur);
  });
  return out;
}

export function createMock() {
  const now = Date.now();
  const qs = new URLSearchParams(location.search);
  /** @type {Map<string, {entry:any, content:string, history:{entry:any, content:string}[], gitStatus?:string, head?:string}>} */
  const db = new Map();
  let eventId = 0;
  const events = [];
  let sessions = seedSessions(now);
  const git = gitInfo(now);
  let conflicts = [];
  const startedAt = now - 3 * 3600_000;

  // ------------------------------------------------------------ auth / roles
  const offLevels = new Set((qs.get('off') || '').split(',').filter(Boolean));
  const config = { actions: { edit: true, exec: true, danger: true, terminal: false } };
  for (const l of offLevels) if (l in config.actions) config.actions[l] = false;
  let role = qs.get('role') === 'viewer' ? 'viewer' : 'admin';
  let loggedIn = !qs.has('login');
  const tokenRequired = qs.has('login') || role === 'viewer';
  const can = (level) => {
    if (!level || level === 'read') return true;
    if (role !== 'admin') return false;
    if (level === 'state') return !offLevels.has('state');
    return !!config.actions[level];
  };
  const levels = () => ({ read: true, state: can('state'), edit: can('edit'), exec: can('exec'), danger: can('danger'), terminal: can('terminal') });
  const howTo = (level) =>
    level === 'state' ? 'requires the admin role' : role !== 'admin' ? `requires the admin role (you are ${role})` : `enable actions.${level} in .agentneuron/config.json (or start with --enable ${level})`;
  const need = (level) => {
    if (!can(level)) throw httpErr(403, howTo(level));
  };

  // ------------------------------------------------------------ live bus
  const bus = new Set();
  const broadcast = (name, data) => {
    for (const fn of bus) {
      try {
        fn(name, clone(data));
      } catch {
        /* ignore */
      }
    }
  };

  const mkEntry = (path, tool, kind, content, mtime) => {
    const name = baseOf(path);
    const title = (content.match(/^#\s+(.+)$/m) || [])[1] || null;
    return {
      path, name, dir: dirOf(path), tool, kind,
      ext: name.includes('.') ? name.slice(name.lastIndexOf('.')) : '',
      size: new TextEncoder().encode(content).length, mtime, hash: hashOf(content),
      tokens: tokensOf(content), lines: content ? content.split('\n').length : 0, title,
    };
  };

  const record = (path, content, ts) => {
    const f = db.get(path);
    const prev = f.history[0];
    const d = prev ? lineDiff(prev.content, content) : { added: content.split('\n').length, removed: 0 };
    const id = `${ts}-${hashOf(content).slice(0, 6)}`;
    const entry = { id, path, ts, hash: hashOf(content), size: content.length, added: d.added, removed: d.removed };
    f.history.unshift({ entry, content });
    if (f.history.length > 200) f.history.pop();
    return { entry, stats: { added: d.added, removed: d.removed } };
  };

  // seed files + synthetic history (older versions = content with some lines removed)
  for (const [path, tool, kind, age, content] of SEED) {
    const mtime = now - age * MIN;
    db.set(path, { entry: mkEntry(path, tool, kind, content, mtime), content, history: [] });
    const lines = content.split('\n');
    const versions = Math.min(6, Math.max(1, Math.floor(lines.length / 5)));
    for (let v = versions; v >= 1; v--) {
      const keep = lines.filter((_, k) => k < 3 || (k * 7 + v * 3) % (v + 4) !== 0 || v === 0);
      const text = v === 1 ? content : keep.slice(0, Math.max(3, lines.length - v * 2)).join('\n');
      record(path, text, mtime - (v - 1) * (age * MIN * 0.6 + 40 * MIN));
    }
    const f = db.get(path);
    f.head = f.history[Math.min(1, f.history.length - 1)].content; // committed version
  }
  const gitStatusSeed = { 'docs/plan.md': 'M', 'CLAUDE.md': 'M', 'TODO.md': 'M', 'CLAUDE.local.md': '?', 'memory/notes.md': '?', 'docs/adr/0003-search.md': 'A' };
  for (const [p, s] of Object.entries(gitStatusSeed)) if (db.has(p)) db.get(p).gitStatus = s;
  for (const [p, f] of db) if (!f.gitStatus) f.head = f.content;
  for (const p of ['CLAUDE.local.md', 'memory/notes.md']) if (db.has(p)) db.get(p).head = null;
  const staged = new Set(['docs/adr/0003-search.md']);

  const allPaths = () => new Set(db.keys());
  const allLinks = () => {
    const all = allPaths();
    return [...db.entries()].flatMap(([p, f]) => extractLinks(p, f.content, all));
  };

  const agentRef = (s) => (s ? { tool: s.tool, sessionId: s.sessionId, title: s.title, lastPrompt: s.lastPrompt, ts: s.lastAt } : null);

  // seed a few historical events
  const seedEvents = [
    ['docs/plan.md', 'change', 0, 5], ['TODO.md', 'change', 0, 8], ['AGENTS.md', 'change', 2, 12],
    ['memory/notes.md', 'change', 0, 15], ['apps/api/CLAUDE.md', 'change', 0, 22], ['docs/api.md', 'change', 2, 35],
    ['CLAUDE.local.md', 'change', null, 47], ['.claude/agents/reviewer.md', 'add', 1, 95],
  ];
  for (const [p, type, si, ago] of seedEvents.reverse()) {
    const f = db.get(p);
    events.push({
      id: ++eventId, type, path: p, ts: now - ago * MIN, file: clone(f.entry),
      stats: { added: 2 + rand(12), removed: rand(5) }, historyId: f.history[0].entry.id,
      agent: si == null ? null : agentRef(sessions[si]),
    });
  }

  /** Emit a file event (add/change/unlink) to the live stream. */
  const emit = (type, path, agent = null) => {
    const f = db.get(path);
    const ts = Date.now();
    let stats, historyId;
    if (f && type !== 'unlink') {
      f.entry = mkEntry(path, f.entry.tool, f.entry.kind, f.content, ts);
      const r = record(path, f.content, ts);
      stats = r.stats;
      historyId = r.entry.id;
      if (!f.gitStatus) f.gitStatus = f.head == null ? '?' : 'M';
      if (f.head != null && f.head === f.content && f.gitStatus === 'M' && !staged.has(path)) delete f.gitStatus;
    }
    const ev = { id: ++eventId, type, path, ts, file: f ? clone({ ...f.entry, ...(f.gitStatus ? { gitStatus: f.gitStatus } : {}) }) : undefined, stats, historyId, agent: agentRef(agent) };
    events.push(ev);
    if (events.length > 500) events.shift();
    if (agent) {
      agent.lastAt = ts;
      agent.messages += 1 + rand(4);
      agent.tokens.input += 2000 + rand(9000);
      agent.tokens.output += 200 + rand(1500);
      agent.tokens.cacheRead += 10000 + rand(40000);
      if (!agent.filesTouched.includes(path)) agent.filesTouched.unshift(path);
    }
    broadcast('event', ev);
    return ev;
  };

  const kindOf = (p) => {
    const b = baseOf(p);
    if (/^(CLAUDE|AGENTS|GEMINI)(\.local)?\.md$/.test(b)) return 'context';
    if (p.includes('/agents/')) return 'agent';
    if (b === 'SKILL.md') return 'skill';
    if (p.includes('/commands/')) return 'command';
    if (/adr|decision/i.test(p)) return 'decision';
    if (/todo|tasks/i.test(b)) return 'todo';
    if (/plan|roadmap/i.test(b)) return 'plan';
    if (/readme/i.test(b)) return 'readme';
    if (b.endsWith('.mdc') || /rules/.test(b)) return 'rules';
    return 'doc';
  };
  const toolFor = (p) => (/CLAUDE|^\.claude\//.test(p) ? 'claude' : /AGENTS/.test(p) ? 'codex' : /^\.cursor/.test(p) ? 'cursor' : /GEMINI/.test(p) ? 'gemini' : /copilot|\.github\/instructions/.test(p) ? 'copilot' : 'generic');

  function writeFile(path, content, { create = false } = {}) {
    const f = db.get(path);
    if (!f) {
      db.set(path, { entry: mkEntry(path, toolFor(path), kindOf(path), content, Date.now()), content, history: [], gitStatus: '?', head: null });
      emit('add', path);
      broadcast('graph', { changed: true });
      return;
    }
    if (create) throw httpErr(409, 'file already exists');
    f.content = content;
    emit('change', path);
  }

  // ------------------------------------------------------------ health
  function healthIssues() {
    const issues = [];
    for (const l of allLinks()) {
      if (l.broken) issues.push({ id: `broken-link:${l.from}:${l.line}`, rule: 'broken-link', severity: 'error', path: l.from, line: l.line, message: `Link target does not exist: ${l.to}`, hint: `Fix or remove "${l.raw}"`, target: l.to, raw: l.raw });
    }
    const add = (rule, severity, path, line, message, hint) => db.has(path) && issues.push({ id: `${rule}:${path}:${line ?? 0}`, rule, severity, path, line, message, hint });
    const notes = db.get('memory/notes.md');
    if (notes && /sk-ant-/.test(notes.content)) {
      const line = notes.content.split('\n').findIndex((l) => l.includes('sk-ant-')) + 1;
      add('secret', 'error', 'memory/notes.md', line, 'Possible Anthropic API key: sk-a••••••••', 'Rotate the key and remove it from the file');
    }
    if (db.get('CLAUDE.md')?.content.includes('scripts/seed.ts')) add('missing-path', 'warn', 'CLAUDE.md', 18, 'Path `scripts/seed.ts` does not exist', 'Update the command docs');
    add('duplicate-rule', 'warn', '.cursorrules', 3, 'Rule duplicated in CLAUDE.md, AGENTS.md: "Use TypeScript strict mode everywhere."', 'Keep one source of truth and link to it');
    add('duplicate-rule', 'info', '.windsurfrules', 3, 'Rule duplicated in CLAUDE.md: "Never commit secrets; read them from .env.local."');
    add('stale-plan', 'warn', 'ROADMAP.md', null, 'Plan not modified in 45 days', 'Review or archive it');
    if (!allLinks().some((l) => l.to === 'docs/old-notes.md')) add('orphan', 'info', 'docs/old-notes.md', null, 'No file links to this document');
    if (db.get('docs/glossary.md') && !db.get('docs/glossary.md').content.trim()) {
      add('orphan', 'info', 'docs/glossary.md', null, 'No file links to this document');
      add('empty-file', 'warn', 'docs/glossary.md', null, 'File is empty');
    }
    const agents = db.get('AGENTS.md');
    if (agents && agents.entry.tokens > 600) add('large-context', 'warn', 'AGENTS.md', null, `Context file is ${agents.entry.tokens} tokens`, 'Split into nested AGENTS.md files');
    add('large-context', 'info', 'CLAUDE.md', null, 'Context chain for apps/api loads 2.1k tokens before any prompt');
    return issues;
  }

  function health() {
    const issues = healthIssues();
    const counts = { error: 0, warn: 0, info: 0 };
    const byRule = {};
    for (const i of issues) { counts[i.severity]++; byRule[i.rule] = (byRule[i.rule] || 0) + 1; }
    const score = Math.max(0, Math.min(100, Math.round(100 - counts.error * 4 - counts.warn * 2 - counts.info * 0.5)));
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : score >= 50 ? 'E' : 'F';
    return { score, grade, counts, byRule, issues };
  }

  function counts() {
    const byTool = {}, byKind = {};
    let tokens = 0;
    for (const { entry } of db.values()) {
      byTool[entry.tool] = (byTool[entry.tool] || 0) + 1;
      byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
      tokens += entry.tokens;
    }
    return { files: db.size, tokens, byTool, byKind };
  }

  function graph() {
    const edges = allLinks();
    const deg = new Map();
    for (const e of edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
    const nodes = [...db.values()].map(({ entry: e }) => ({ id: e.path, tool: e.tool, kind: e.kind, tokens: e.tokens, size: e.size, mtime: e.mtime, degree: deg.get(e.path) || 0 }));
    return { nodes, edges };
  }

  function context(dir = '', tool = 'claude') {
    const chain = [];
    const seen = new Set();
    const pushFile = (p, reason, depth = 0) => {
      if (!db.has(p) || seen.has(p) || depth > 5) return;
      seen.add(p);
      chain.push({ path: p, reason, tokens: db.get(p).entry.tokens });
      if (tool === 'claude') {
        for (const m of db.get(p).content.matchAll(/(?:^|\s)@((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+)/g)) {
          pushFile(resolve(dirOf(p), m[1]), 'import', depth + 1);
        }
      }
    };
    const dirs = [''];
    if (dir) dir.split('/').reduce((acc, seg) => { const d = acc ? `${acc}/${seg}` : seg; dirs.push(d); return d; }, '');
    const names = { claude: ['CLAUDE.md', 'CLAUDE.local.md'], codex: ['AGENTS.override.md', 'AGENTS.md'], gemini: ['GEMINI.md'] }[tool];
    if (names) {
      for (const d of dirs) for (const nm of names) pushFile(d ? `${d}/${nm}` : nm, d ? 'ancestor' : 'root');
    } else if (tool === 'cursor') {
      for (const [p, f] of db) if (p.startsWith('.cursor/rules/') && /alwaysApply:\s*true/.test(f.content)) pushFile(p, 'rule');
      pushFile('.cursorrules', 'rule');
    } else if (tool === 'copilot') {
      pushFile('.github/copilot-instructions.md', 'root');
      for (const [p, f] of db) if (p.startsWith('.github/instructions/') && dir && f.content.includes(dir.split('/')[0] + '/' + (dir.split('/')[1] || ''))) pushFile(p, 'rule');
    } else if (tool === 'windsurf') {
      pushFile('.windsurfrules', 'rule');
    }
    const text = chain.map((c) => `<!-- ${c.path} (${c.reason}) -->\n${db.get(c.path).content.trim()}`).join('\n\n');
    return { dir, tool, chain, text, tokens: chain.reduce((a, c) => a + c.tokens, 0) };
  }

  function tasks() {
    const out = [];
    for (const [p, f] of db) {
      let section = null;
      let fence = false;
      f.content.split('\n').forEach((l, k) => {
        if (/^\s*```/.test(l)) fence = !fence;
        if (fence) return;
        const h = l.match(/^#{1,6}\s+(.*)/);
        if (h) section = h[1];
        const m = l.match(/^\s*[-*]\s+\[( |x|X|\/)\]\s+(.*)/);
        if (m) out.push({ path: p, line: k + 1, text: m[2], done: m[1] === 'x' || m[1] === 'X', section });
        const t = l.match(/\b(TODO|FIXME):\s*(.*)/);
        if (t && !m) out.push({ path: p, line: k + 1, text: `${t[1]}: ${t[2]}`, done: false, section });
      });
    }
    return out;
  }

  function decisions() {
    const out = [];
    for (const [p, f] of db) {
      if (f.entry.kind !== 'decision') continue;
      const lines = f.content.split('\n');
      if (p.includes('/adr/')) {
        const title = (f.content.match(/^#\s+(.+)$/m) || [])[1] || p;
        const status = (f.content.match(/Status:\s*(\w+)/i) || [])[1];
        const date = (f.content.match(/Date:\s*([\d-]+)/i) || [])[1];
        out.push({ path: p, title, status, date, line: 1 });
      } else {
        lines.forEach((l, k) => {
          const m = l.match(/^##\s+Decision:\s*(.+?)(?:\s*\((\d{4}-\d\d-\d\d)\))?$/);
          if (m) {
            const status = ((lines[k + 1] || '').match(/Status:\s*(\w+)/i) || [])[1];
            out.push({ path: p, title: m[1], status, date: m[2], line: k + 1 });
          }
        });
      }
    }
    return out;
  }

  function search(q) {
    const res = [];
    const needle = (q || '').toLowerCase();
    if (!needle) return res;
    for (const [p, f] of db) {
      f.content.split('\n').forEach((l, k) => {
        if (res.length < 200 && l.toLowerCase().includes(needle)) res.push({ path: p, line: k + 1, text: l.trim().slice(0, 240) });
      });
    }
    return res;
  }

  function getVersion(path, id) {
    const f = db.get(path);
    if (!f) return null;
    if (!id || id === 'current') return f.content;
    if (id === 'git:HEAD') return f.head ?? '';
    return f.history.find((h) => h.entry.id === id)?.content ?? null;
  }

  function filesList() {
    return [...db.values()].map((f) => ({ ...clone(f.entry), ...(f.gitStatus ? { gitStatus: f.gitStatus } : {}) }));
  }

  // ------------------------------------------------------------ git (2.0)
  const fullHash = (k) => hashOf('commit:' + k).slice(0, 8) + hashOf('c2:' + k).slice(0, 8) + hashOf('c3:' + k).slice(0, 8) + hashOf('c4:' + k).slice(0, 8) + hashOf('c5:' + k).slice(0, 8);
  let commits = GIT_SEED.map(([k, parents, author, mins, subject, files, refs]) => ({
    key: k, hash: fullHash(k), parents: parents.map(fullHash), refs: [...refs], author,
    email: author.toLowerCase().replace(/\s+/g, '.') + '@acme.dev', date: new Date(now - mins * MIN).toISOString(), subject, files,
  }));
  commits.forEach((c) => (c.short = c.hash.slice(0, 7)));
  let currentBranch = 'feat/checkout-v2';
  let branches = [
    { name: 'feat/checkout-v2', upstream: 'origin/feat/checkout-v2', ahead: 1, behind: 0, tip: commits[0].hash },
    { name: 'main', upstream: 'origin/main', ahead: 0, behind: 0, tip: commits.find((c) => c.key === 'm2').hash },
    { name: 'feat/search', upstream: null, ahead: 0, behind: 0, tip: commits.find((c) => c.key === 's1').hash },
    { name: 'fix/webhook-retries', upstream: 'origin/fix/webhook-retries', ahead: 0, behind: 0, tip: commits.find((c) => c.key === 'w2').hash },
  ];
  let stashes = [
    { message: 'WIP on feat/checkout-v2: try klarna widget', hash: fullHash('st1'), date: new Date(now - 5 * 3600_000).toISOString() },
    { message: 'On main: scratch notes', hash: fullHash('st2'), date: new Date(now - 3 * 86400_000).toISOString() },
  ];
  const remotes = [
    { name: 'origin', fetch: 'git@github.com:acme/commerce.git', push: 'git@github.com:acme/commerce.git' },
    { name: 'upstream', fetch: 'https://github.com/acme-oss/commerce.git', push: 'https://github.com/acme-oss/commerce.git' },
  ];
  const commitBy = (h) => commits.find((c) => c.hash === h || c.short === h || c.hash.startsWith(h));
  const pub = ({ key: _k, files: _f, ...c }) => clone(c);

  function refsFor(c) {
    const out = [];
    for (const b of branches) if (b.tip === c.hash) out.push(b.name === currentBranch ? `HEAD -> ${b.name}` : b.name);
    for (const r of c.refs) if (r.startsWith('tag: ') || r.startsWith('origin/')) out.push(r);
    return out;
  }

  function gitLog({ branch, path, author, limit = 100, skip = 0 } = {}) {
    let list = commits;
    if (branch && branch !== 'all') {
      const b = branches.find((x) => x.name === branch);
      if (!b) return [];
      const seen = new Set();
      const stack = [b.tip];
      while (stack.length) {
        const h = stack.pop();
        if (seen.has(h)) continue;
        seen.add(h);
        const c = commitBy(h);
        if (c) stack.push(...c.parents);
      }
      list = list.filter((c) => seen.has(c.hash));
    }
    if (path) list = list.filter((c) => c.files.includes(path));
    if (author) list = list.filter((c) => c.author.toLowerCase().includes(author.toLowerCase()));
    return list.slice(+skip || 0, (+skip || 0) + (+limit || 100)).map((c) => ({ ...pub(c), refs: refsFor(c) }));
  }

  function patchFor(path, a, b) {
    const d = lineDiff(a ?? '', b ?? '');
    const lines = [];
    let ctxRun = [];
    let o = 0;
    let n = 0;
    const out = [`diff --git a/${path} b/${path}`, a == null ? 'new file mode 100644' : `index ${hashOf(a || '').slice(0, 7)}..${hashOf(b || '').slice(0, 7)} 100644`, `--- ${a == null ? '/dev/null' : 'a/' + path}`, `+++ b/${path}`];
    // single hunk with up to 3 lines of context around changes
    const rows = d.hunks;
    const changed = rows.map((r) => r.type !== 'ctx');
    const keep = rows.map((_, i) => changed.slice(Math.max(0, i - 3), i + 4).some(Boolean));
    let hunk = null;
    rows.forEach((r, i) => {
      if (r.type !== 'add') o++;
      if (r.type !== 'del') n++;
      if (!keep[i]) {
        if (hunk) {
          lines.push(hunk);
          hunk = null;
        }
        return;
      }
      if (!hunk) hunk = { os: r.type === 'add' ? o + 1 : o, ns: r.type === 'del' ? n + 1 : n, ol: 0, nl: 0, body: [] };
      if (r.type !== 'add') hunk.ol++;
      if (r.type !== 'del') hunk.nl++;
      hunk.body.push((r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ') + r.text);
    });
    if (hunk) lines.push(hunk);
    void ctxRun;
    for (const h of lines) out.push(`@@ -${h.os},${h.ol} +${h.ns},${h.nl} @@`, ...h.body);
    return { patch: out.join('\n') + '\n', added: d.added, removed: d.removed };
  }

  function gitChanges() {
    const res = { available: true, staged: [], unstaged: [], untracked: [], conflicted: [] };
    for (const [p, f] of db) {
      if (!f.gitStatus) continue;
      if (f.gitStatus === '?' && !staged.has(p)) {
        res.untracked.push(p);
        continue;
      }
      const d = lineDiff(f.head ?? '', f.content);
      if (staged.has(p)) res.staged.push({ path: p, status: f.head == null ? 'A' : f.gitStatus === 'D' ? 'D' : 'M', added: d.added, removed: d.removed });
      else res.unstaged.push({ path: p, status: f.gitStatus === 'A' ? 'M' : f.gitStatus, added: d.added, removed: d.removed });
    }
    return res;
  }

  function commitDetail(h) {
    const c = commitBy(h);
    if (!c) throw httpErr(400, 'not found');
    const files = c.files.map((p, i) => {
      const cur = db.get(p)?.content || '';
      const lines = cur.split('\n');
      const cut = Math.max(2, Math.floor(lines.length * (0.55 + ((i * 13 + c.short.charCodeAt(0)) % 30) / 100)));
      const before = lines.filter((_, k) => k < cut || k % 4 !== 1).slice(0, lines.length - 1).join('\n');
      const p2 = patchFor(p, c.parents.length ? before : null, cur);
      return { path: p, status: c.parents.length ? 'M' : 'A', added: p2.added, removed: p2.removed, patch: p2.patch };
    });
    return {
      ...pub(c), refs: refsFor(c),
      body: c.parents.length > 1 ? '' : `${c.subject.includes(':') ? 'Details' : 'Notes'}: ${c.subject.split(':').pop().trim()}.\n\nCo-Authored-By: ${c.author} <${c.email}>`,
      files: files.map(({ patch: _p, ...f }) => f), patch: files.map((f) => f.patch).join(''), truncated: false,
    };
  }

  function blame(path) {
    const f = db.get(path);
    if (!f) throw httpErr(400, 'no such path');
    const touching = commits.filter((c) => c.files.includes(path));
    const pool = touching.length ? touching : commits.slice(-3);
    const cur = f.content.split('\n');
    const headLines = new Set((f.head || '').split('\n'));
    return cur.map((l, k) => {
      if (!headLines.has(l)) return { line: k + 1, hash: '0'.repeat(40), short: '0000000', author: 'Not Committed Yet', date: new Date().toISOString(), summary: 'Working tree change' };
      const c = pool[Math.min(pool.length - 1, Math.floor((((k * 2654435761) >>> 0) % 1000) / 1000 * Math.min(pool.length, 4 + (k % 3))))];
      return { line: k + 1, hash: c.hash, short: c.short, author: c.author, date: c.date, summary: c.subject };
    });
  }

  // ------------------------------------------------------------ board
  const board = {
    columns: [
      { id: 'backlog', title: 'Backlog', wip: null },
      { id: 'todo', title: 'Todo', wip: null },
      { id: 'doing', title: 'In progress', wip: 3 },
      { id: 'review', title: 'Review', wip: 2 },
      { id: 'done', title: 'Done', wip: null },
    ],
    overlay: {},
    native: NATIVE_TASKS(now),
  };
  board.native.forEach((t, i) => (t.order = (i + 1) * 1000 + 500));

  function collectTasks() {
    const out = [];
    for (const [p, f] of [...db.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!/\[[ xX/]\]/.test(f.content)) continue;
      for (const t of parseMdTasks(p, f.content)) {
        const ov = board.overlay[t.id] || {};
        if (ov.hidden) continue;
        const fl = ov.fields || {};
        const status = ov.status && ov.mdBase === t.mdChar ? ov.status : t.status;
        out.push({
          id: t.id, source: 'md', path: p, line: t.line, title: fl.title ?? t.title, description: fl.description ?? '',
          status, priority: fl.priority ?? t.priority, labels: fl.labels ?? t.labels, due: fl.due !== undefined ? fl.due : t.due,
          assignee: fl.assignee !== undefined ? fl.assignee : t.assignee, files: fl.files ?? [p],
          checklist: (fl.checklist ?? t.checklist).map((x) => ({ text: x.text, done: x.done })), comments: ov.comments || [],
          createdAt: ov.createdAt || f.entry.mtime - 3 * 86400_000, updatedAt: ov.updatedAt || f.entry.mtime, order: ov.order ?? null, section: t.section,
        });
      }
    }
    for (const n of board.native) out.push({ ...clone(n), source: 'native', path: null, line: null, section: null });
    out.forEach((t, i) => { if (t.order == null) t.order = (i + 1) * 1000; });
    return out;
  }
  function boardGet() {
    const ts = collectTasks();
    return { columns: clone(board.columns), tasks: ts, labels: [...new Set(ts.flatMap((t) => t.labels))].sort(), assignees: [...new Set(ts.map((t) => t.assignee).filter(Boolean))].sort(), mdWritable: can('edit') };
  }
  const boardChanged = () => setTimeout(() => broadcast('board', { changed: true }), 30);

  function mdWrite(task, patch) {
    if (!can('edit')) return { ok: false, reason: 'markdown write-back is disabled: enable actions.edit in .agentneuron/config.json' };
    const f = db.get(task.path);
    const lines = f.content.split('\n');
    const t = parseMdTasks(task.path, f.content).find((x) => x.id === task.id);
    if (!t) return { ok: false, reason: 'task line not found in file (changed on disk?)' };
    const m = lines[t.line - 1].match(TASK_RE);
    const meta = { ...t, ...Object.fromEntries(['title', 'priority', 'labels', 'assignee', 'due'].filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]])) };
    const ch = patch.status !== undefined ? (['todo', 'doing', 'done'].includes(patch.status) ? charOf(patch.status) : t.mdChar) : t.mdChar;
    lines[t.line - 1] = `${m[1]}- [${ch}] ${meta.title}${metaSuffix(meta)}`;
    if (patch.checklist && patch.checklist.length === t.checklist.length) {
      patch.checklist.forEach((c, i) => {
        const li = t.checklist[i].line - 1;
        lines[li] = lines[li].replace(/\[( |x|X|\/)\]\s+.*$/, `[${c.done ? 'x' : ' '}] ${c.text}`);
      });
    }
    const next = lines.join('\n');
    if (next !== f.content) writeFile(task.path, next);
    const after = parseMdTasks(task.path, next).find((x) => x.line === t.line);
    return { ok: true, newId: after?.id || task.id, newChar: after?.mdChar };
  }

  function boardUpdate(id, patch = {}) {
    need('state');
    const task = collectTasks().find((t) => t.id === id);
    if (!task) throw httpErr(404, 'task not found');
    if (patch.status && !board.columns.some((c) => c.id === patch.status)) throw httpErr(400, 'unknown status');
    if (task.source === 'native') {
      const n = board.native.find((x) => x.id === id);
      Object.assign(n, clone(patch), { updatedAt: Date.now() });
      boardChanged();
      return { task: collectTasks().find((t) => t.id === id) };
    }
    const sync = {};
    for (const k of ['title', 'priority', 'labels', 'due', 'assignee', 'status', 'checklist']) if (patch[k] !== undefined) sync[k] = patch[k];
    const res = Object.keys(sync).length ? mdWrite(task, sync) : null;
    let key = id;
    const ov = board.overlay[id] || {};
    if (res?.ok && res.newId !== id) {
      delete board.overlay[id];
      key = res.newId;
    }
    ov.fields = ov.fields || {};
    if (res?.ok) {
      for (const k of ['title', 'priority', 'labels', 'due', 'assignee', 'checklist']) delete ov.fields[k];
      if (patch.status !== undefined) {
        if (patch.status === statusOf(res.newChar)) { delete ov.status; delete ov.mdBase; } else { ov.status = patch.status; ov.mdBase = res.newChar; }
      }
    } else {
      for (const k of ['title', 'priority', 'labels', 'due', 'assignee', 'checklist']) if (patch[k] !== undefined) ov.fields[k] = patch[k];
      if (patch.status !== undefined) { ov.status = patch.status; ov.mdBase = parseMdTasks(task.path, db.get(task.path).content).find((x) => x.id === id)?.mdChar; }
    }
    if (patch.description !== undefined) ov.fields.description = patch.description;
    if (patch.files !== undefined) ov.fields.files = patch.files;
    if (patch.order !== undefined) ov.order = patch.order;
    ov.updatedAt = Date.now();
    board.overlay[key] = ov;
    boardChanged();
    const out = { task: collectTasks().find((t) => t.id === key) };
    if (res) { out.mdSynced = res.ok; if (!res.ok) out.reason = res.reason; }
    return out;
  }

  function boardCreate({ task = {}, path }) {
    need('state');
    if (!task.title?.trim()) throw httpErr(400, 'title required');
    if (path) {
      need('edit');
      const f = db.get(path);
      if (!f) throw httpErr(404, 'file not found');
      const line = `- [${charOf(task.status || 'todo')}] ${task.title.trim()}${metaSuffix(task)}`;
      writeFile(path, f.content.replace(/\n*$/, '\n') + line + '\n');
      boardChanged();
      return { task: collectTasks().find((t) => t.path === path && t.title === task.title.trim()) };
    }
    const n = {
      id: 'n' + hashOf(String(Math.random())).slice(0, 10), title: task.title.trim(), description: task.description || '', status: task.status || 'todo',
      priority: task.priority || 'none', labels: task.labels || [], due: task.due || null, assignee: task.assignee || null, files: task.files || [],
      checklist: task.checklist || [], comments: [], createdAt: Date.now(), updatedAt: Date.now(), order: task.order ?? Math.max(0, ...collectTasks().map((t) => t.order)) + 1000,
    };
    board.native.push(n);
    boardChanged();
    return { task: collectTasks().find((t) => t.id === n.id) };
  }

  // ------------------------------------------------------------ files: trash, annotations, bookmarks
  const trash = [];
  let bookmarks = [
    { path: 'docs/plan.md', label: 'Checkout plan', ts: now - 86400_000 },
    { path: 'CLAUDE.md', label: null, ts: now - 2 * 86400_000 },
  ];
  let annotations = [
    { id: 'a1', path: 'docs/plan.md', line: 12, anchor: '', text: 'Confirm with payments team whether 3DS fallback needs its own flag.', author: 'admin', ts: now - 5 * 3600_000, resolved: false },
    { id: 'a2', path: 'CLAUDE.md', line: 3, anchor: '', text: 'Keep this section under 20 lines — it is loaded in every session.', author: 'admin', ts: now - 30 * 3600_000, resolved: false },
  ];
  for (const a of annotations) a.anchor = (db.get(a.path)?.content.split('\n')[a.line - 1] || '').trim();
  const audit = [];
  const logAudit = (entry) => audit.unshift({ ts: Date.now(), role, ip: '127.0.0.1', status: 'ok', ...entry });
  logAudit({ route: 'POST /api/bookmarks', params: { path: 'docs/plan.md' }, ts: now - 86400_000 });
  logAudit({ action: 'git.fetch', params: {}, ts: now - 7 * 3600_000 });
  logAudit({ action: 'packages.outdated', params: { manager: 'pnpm' }, ts: now - 3 * 3600_000 });
  logAudit({ route: 'POST /api/auth/login', params: {}, status: 401, role: null, ip: '10.0.0.23', ts: now - 2 * 3600_000 });

  function renameRefs(from, to) {
    const rewritten = [];
    const fromBase = baseOf(from);
    for (const [p, f] of db) {
      if (p === from) continue;
      let count = 0;
      const dir = dirOf(p);
      const next = f.content
        .replace(/\]\(([^)\s#]+)(#[^)]*)?\)/g, (m, t, frag) => {
          if (resolve(dir, t) !== from) return m;
          count++;
          const rel = relPath(dir, to);
          return `](${rel}${frag || ''})`;
        })
        .replace(/@((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+)/g, (m, t) => (resolve(dir, t) === from ? (count++, '@' + relPath(dir, to)) : m))
        .replace(/`([^`\s]+)`/g, (m, t) => (t === from ? (count++, '`' + to + '`') : m))
        .replace(/\[\[([^\]|#]+)/g, (m, t) => (t.trim().toLowerCase() === fromBase.replace(/\.md$/, '').toLowerCase() ? (count++, '[[' + baseOf(to).replace(/\.md$/, '')) : m));
      if (count) rewritten.push({ path: p, count, next });
    }
    return rewritten;
  }
  function relPath(fromDir, to) {
    const a = fromDir ? fromDir.split('/') : [];
    const b = to.split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || to;
  }

  function buildRe({ q, regex, case: cs, word }) {
    if (!q) throw httpErr(400, 'q required');
    let src = regex === '1' || regex === true ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (word === '1' || word === true) src = `\\b${src}\\b`;
    try {
      return new RegExp(src, cs === '1' || cs === true ? 'g' : 'gi');
    } catch (e) {
      throw httpErr(400, `invalid regex: ${e.message}`);
    }
  }
  function replaceRun(o, apply) {
    const re = buildRe(o);
    const paths = typeof o.paths === 'string' ? o.paths.split(',').filter(Boolean) : Array.isArray(o.paths) ? o.paths : null;
    const rep = o.replace ?? '';
    const results = [];
    const changed = [];
    for (const [p, f] of db) {
      if (paths && paths.length && !paths.includes(p)) continue;
      let count = 0;
      const lines = f.content.split('\n').map((l, k) => {
        re.lastIndex = 0;
        let n = 0;
        const after = l.replace(re, (...a) => (n++, o.regex === '1' || o.regex === true ? rep.replace(/\$(\d)/g, (_, d) => a[+d] ?? '') : rep));
        if (n && after !== l) {
          count += n;
          if (!apply && results.length < 2000) results.push({ path: p, line: k + 1, before: l, after });
        }
        return after;
      });
      if (apply && count) {
        writeFile(p, lines.join('\n'));
        changed.push({ path: p, count });
      }
    }
    return apply ? { changed } : results;
  }

  function fixesFor(issueId) {
    const issue = healthIssues().find((i) => i.id === issueId);
    if (!issue) throw httpErr(404, 'issue not found');
    const f = db.get(issue.path);
    const lines = f?.content.split('\n') || [];
    const fixes = [];
    if (issue.rule === 'broken-link') {
      const base = baseOf(issue.target || '').replace(/\.\w+$/, '').toLowerCase();
      const cands = [...db.keys()].map((p) => ({ p, s: (baseOf(p).toLowerCase().includes(base.slice(0, 4)) ? 2 : 0) + (dirOf(p) === dirOf(issue.target || '') ? 1 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
      for (const c of cands) {
        const before = lines[issue.line - 1] || '';
        const after = before.replace(issue.raw?.match(/\(([^)]+)\)/)?.[1] || issue.target, relPath(dirOf(issue.path), c.p));
        fixes.push({ id: `relink:${c.p}`, title: `Point link at ${c.p}`, description: 'Closest existing file by name and folder.', edits: [{ path: issue.path, line: issue.line, before, after }] });
      }
      const before = lines[issue.line - 1] || '';
      fixes.push({ id: 'unlink', title: 'Remove the link, keep the text', description: 'Turns the link into plain text.', edits: [{ path: issue.path, line: issue.line, before, after: before.replace(/\[([^\]]+)\]\([^)]+\)/, '$1') }] });
    } else if (issue.rule === 'secret') {
      const before = lines[issue.line - 1] || '';
      fixes.push({ id: 'env', title: 'Replace value with ${ANTHROPIC_API_KEY}', description: 'Keeps the line, removes the secret. Remember to rotate the key.', edits: [{ path: issue.path, line: issue.line, before, after: before.replace(/sk-ant-[\w-]+/, '${ANTHROPIC_API_KEY}') }] });
    } else if (issue.rule === 'empty-file') {
      fixes.push({ id: 'trash', title: `Move ${issue.path} to trash`, description: 'Deletes the empty file (restorable from Settings → Trash).', edits: [] });
    } else if (issue.rule === 'orphan') {
      const idx = db.get('README.md').content.split('\n');
      fixes.push({ id: 'index', title: 'Link it from README.md', description: 'Adds a bullet under the “Docs” section of the nearest index file.', edits: [{ path: 'README.md', line: idx.length, before: '', after: `- [${baseOf(issue.path).replace(/\.md$/, '')}](${issue.path})` }] });
    } else if (issue.rule === 'missing-path') {
      const before = lines[issue.line - 1] || '';
      fixes.push({ id: 'path', title: 'Replace with scripts/seed.mjs', description: 'Closest existing path.', edits: [{ path: issue.path, line: issue.line, before, after: before.replace('scripts/seed.ts', 'scripts/seed.mjs') }] });
    } else if (issue.rule === 'duplicate-rule') {
      const before = lines[issue.line - 1] || '';
      fixes.push({ id: 'dedupe', title: `Remove the duplicate from ${issue.path}`, description: 'Keeps the rule in CLAUDE.md as the single source of truth.', edits: [{ path: issue.path, line: issue.line, before, after: '' }] });
    }
    return { issue, fixes };
  }

  // ------------------------------------------------------------ actions + jobs
  const jobs = [];
  const jobLogs = new Map();
  const jobTimers = new Map();
  let jobSeq = 0;
  const actionList = () =>
    MOCK_ACTIONS.map((a) => {
      const lvl = a.flag === 'terminal' ? 'terminal' : a.level;
      const enabled = can(lvl) && (a.level !== 'danger' || can('danger'));
      return { id: a.id, title: a.title, category: a.category, level: a.level, description: a.description, params: clone(a.params), enabled, ...(enabled ? {} : { reason: howTo(lvl) }) };
    });
  const shq = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
  function preview(id, p = {}) {
    const m = p.manager || 'pnpm';
    const map = {
      'agentneuron.rescan': [null, 'Re-index all tracked files'],
      'agentneuron.snapshot': [null, 'Append a metrics snapshot'],
      'agentneuron.history.clear': [null, 'Delete every local history snapshot'],
      'agentneuron.terminal': [String(p.command || '').split(/\s+/).filter(Boolean), 'Runs without a shell'],
      'git.stage': [['git', 'add', '--', ...(p.paths || [])], `Stage ${(p.paths || []).length} path(s)`],
      'git.unstage': [['git', 'restore', '--staged', '--', ...(p.paths || [])], `Unstage ${(p.paths || []).length} path(s)`],
      'git.commit': [['git', 'commit', ...(p.amend ? ['--amend'] : []), ...(p.message ? ['-m', p.message] : ['--no-edit'])], p.amend ? 'Amend last commit' : `Commit ${staged.size} staged file(s)`],
      'git.branch.create': [['git', 'switch', '-c', p.name || '<name>', ...(p.from ? [p.from] : [])], `Create branch ${p.name || ''}`],
      'git.branch.switch': [['git', 'switch', p.name || '<name>'], `Switch to ${p.name || ''}`],
      'git.branch.delete': [['git', 'branch', p.force ? '-D' : '-d', p.name || '<name>'], `Delete branch ${p.name || ''}`],
      'git.stash.push': [['git', 'stash', 'push', ...(p.message ? ['-m', p.message] : [])], 'Stash changes'],
      'git.stash.pop': [['git', 'stash', 'pop', `stash@{${p.index ?? 0}}`], 'Pop stash'],
      'git.stash.drop': [['git', 'stash', 'drop', `stash@{${p.index ?? 0}}`], 'Drop stash'],
      'git.tag.create': [['git', 'tag', ...(p.message ? ['-a', '-m', p.message] : []), p.name || '<tag>'], `Tag ${p.name || ''}`],
      'git.fetch': [['git', 'fetch', p.remote || '--all'], 'Fetch'],
      'git.pull': [['git', 'pull', '--ff-only'], 'Pull (ff-only)'],
      'git.push': [['git', 'push', ...(p.setUpstream ? ['-u', 'origin', 'HEAD'] : [])], 'Push'],
      'git.discard': [['git', 'restore|clean', '--', ...(p.paths || [])], 'Irreversibly discards working-tree changes'],
      'git.changelog.write': [null, 'Prepends a changelog section to CHANGELOG.md'],
      'packages.install': [[m, 'install'], 'Install from lockfile'],
      'packages.add': [[m, m === 'composer' ? 'require' : 'add', ...(p.dev ? ['-D'] : []), `${p.name || '<pkg>'}${p.version ? '@' + p.version : ''}`], `Add ${p.name || 'a package'}`],
      'packages.remove': [[m, 'remove', p.name || '<pkg>'], `Remove ${p.name || ''}`],
      'packages.update': [[m, 'update', ...(p.name ? [p.name] : [])], 'Update'],
      'packages.outdated': [[m, 'outdated', '--format', 'json'], 'List outdated'],
      'packages.audit': [[m, 'audit', '--json'], 'Audit'],
      'scripts.run': [[m, 'run', p.name || '<script>'], `Run script ${p.name || ''}`],
      'agents.mcp.test': [['npx', '-y', `@modelcontextprotocol/server-${p.name || 'x'}`], 'initialize + tools/list'],
      'workspace.open': [['node', 'agentneuron', 'start', p.path || '<path>', '--port', '0'], 'Start another instance'],
    };
    const [command, summary] = map[id] || [null, MOCK_ACTIONS.find((a) => a.id === id)?.description || ''];
    return { command, summary };
  }

  function scriptFor(id, p) {
    const m = p.manager || 'pnpm';
    const L = (stream, text, ms = 120) => ({ stream, text, ms });
    switch (id) {
      case 'packages.install':
      case 'packages.add':
      case 'packages.update':
        return [
          L('stdout', `Lockfile is up to date, resolution step is skipped`, 300),
          L('stdout', `Progress: resolved 1, reused 0, downloaded 0, added 0`, 250),
          L('stdout', `Progress: resolved 412, reused 398, downloaded 14, added 0`, 500),
          L('stderr', ` WARN  deprecated inflight@1.0.6: This module is not supported`, 250),
          L('stdout', `Progress: resolved 1123, reused 1101, downloaded 22, added 1123, done`, 700),
          ...(id === 'packages.add' ? [L('stdout', `\ndependencies:\n+ ${p.name}${p.version ? ' ' + p.version : ' 4.2.1'}`, 200)] : []),
          L('stdout', `\nDone in 4.1s`, 200),
        ];
      case 'packages.outdated':
        return [L('stdout', `┌──────────────────┬─────────┬────────┬────────┐`, 400), L('stdout', `│ Package          │ Current │ Wanted │ Latest │`), L('stdout', `│ next             │ 15.0.3  │ 15.0.4 │ 15.1.0 │`, 200), L('stdout', `│ fastify          │ 5.0.0   │ 5.1.0  │ 5.1.0  │`, 150), L('stdout', `│ zod (dev)        │ 3.23.8  │ 3.23.8 │ 4.0.1  │`, 150), L('stdout', `└──────────────────┴─────────┴────────┴────────┘`)];
      case 'packages.audit':
        return [L('stdout', `┌─────────────────────┬────────────────────────────────────────┐`, 500), L('stdout', `│ moderate            │ cookie accepts cookie name, path, and  │`), L('stdout', `│ Package             │ cookie                                 │`), L('stdout', `└─────────────────────┴────────────────────────────────────────┘`, 200), L('stderr', `1 vulnerabilities found\nSeverity: 1 moderate`, 300)];
      case 'scripts.run':
        if (p.name === 'test')
          return [L('stdout', `> acme@2.14.0 test`, 200), L('stdout', `> vitest run\n`, 200), L('stdout', ` ✓ apps/api/src/modules/checkout/intent.test.ts (12 tests) 84ms`, 600), L('stdout', ` ✓ apps/api/src/webhooks/retry.test.ts (7 tests) 31ms`, 400), L('stderr', ` ✗ apps/web/e2e/checkout.e2e.ts > 3DS challenge (flaky)`, 500), L('stdout', `\n Test Files  1 failed | 41 passed (42)\n      Tests  1 failed | 318 passed (319)`, 400)];
        return [L('stdout', `> acme@2.14.0 ${p.name}`, 200), L('stdout', `> turbo run ${p.name}\n`, 250), L('stdout', `• Packages in scope: @acme/api, @acme/web, @acme/ui`, 400), L('stdout', `• Running ${p.name} in 3 packages`, 300), L('stdout', `@acme/ui:${p.name}: cache hit, replaying logs`, 500), L('stdout', `@acme/api:${p.name}: ✓ done in 2.3s`, 700), L('stdout', `@acme/web:${p.name}: ✓ done in 3.1s`, 800), L('stdout', `\n Tasks:    3 successful, 3 total\nCached:    1 cached, 3 total\n  Time:    4.82s`, 300)];
      case 'git.fetch':
        return [L('stderr', `From github.com:acme/commerce`, 600), L('stderr', `   5be2a8f..e3b9a1c  main       -> origin/main`, 400), L('stderr', ` * [new branch]      feat/b2b   -> origin/feat/b2b`, 300)];
      case 'git.pull':
        return [L('stdout', `Already up to date.`, 700)];
      case 'git.push':
        return [L('stderr', `Enumerating objects: 9, done.`, 400), L('stderr', `Writing objects: 100% (5/5), 1.21 KiB | 1.21 MiB/s, done.`, 500), L('stderr', `To github.com:acme/commerce.git\n   9a0f44b..${commits[0].short}  ${currentBranch} -> ${currentBranch}`, 400)];
      case 'agents.mcp.test':
        return [L('info', `spawn npx -y @modelcontextprotocol/server-${p.name}`, 300), L('stdout', `→ initialize (protocol 2025-06-18)`, 600), L('stdout', `← serverInfo: ${p.name}-mcp 0.6.2`, 300), L('stdout', `→ tools/list`, 300), L('stdout', `← 14 tools: search_repositories, get_file_contents, create_issue, …`, 400)];
      case 'agentneuron.terminal':
        return [L('stdout', `$ ${p.command}`, 200), L('stdout', `ok`, 300)];
      default:
        return [L('info', `${preview(id, p).summary || id}`, 250), L('stdout', 'done', 350)];
    }
  }

  function applyEffects(id, p) {
    switch (id) {
      case 'git.stage': for (const x of p.paths || []) if (db.get(x)?.gitStatus) staged.add(x); return { staged: p.paths };
      case 'git.unstage': for (const x of p.paths || []) staged.delete(x); return { unstaged: p.paths };
      case 'git.commit': {
        if (!staged.size && !p.amend) throw new Error('nothing to commit (use git.stage first)');
        if (!p.message && !p.amend) throw new Error('commit message required');
        const files = [...staged];
        const c = { key: 'u' + jobSeq, hash: fullHash('user' + Date.now()), parents: [commits[0].hash], refs: [], author: 'You', email: 'you@acme.dev', date: new Date().toISOString(), subject: String(p.message || commits[0].subject).split('\n')[0], files };
        c.short = c.hash.slice(0, 7);
        if (p.amend) commits[0] = { ...commits[0], subject: c.subject, files: [...new Set([...commits[0].files, ...files])] };
        else commits.unshift(c);
        const b = branches.find((x) => x.name === currentBranch);
        if (b) { b.tip = commits[0].hash; b.ahead++; }
        for (const x of files) { const f = db.get(x); if (f) { f.head = f.content; delete f.gitStatus; emit('change', x); } }
        staged.clear();
        return { output: `[${currentBranch} ${commits[0].short}] ${commits[0].subject}\n ${files.length} file(s) changed` };
      }
      case 'git.discard': for (const x of p.paths || []) { const f = db.get(x); if (!f) continue; if (f.head == null) { db.delete(x); emit('unlink', x); } else { f.content = f.head; delete f.gitStatus; emit('change', x); } } return {};
      case 'git.branch.create': if (branches.some((b) => b.name === p.name)) throw new Error(`fatal: a branch named '${p.name}' already exists`); branches.push({ name: p.name, upstream: null, ahead: 0, behind: 0, tip: commits[0].hash }); currentBranch = p.name; return {};
      case 'git.branch.switch': if (!branches.some((b) => b.name === p.name)) throw new Error(`fatal: invalid reference: ${p.name}`); currentBranch = p.name; return {};
      case 'git.branch.delete': if (p.name === currentBranch) throw new Error(`error: cannot delete branch '${p.name}' checked out`); branches = branches.filter((b) => b.name !== p.name); return {};
      case 'git.stash.push': stashes.unshift({ message: `On ${currentBranch}: ${p.message || 'WIP'}`, hash: fullHash('st' + Date.now()), date: new Date().toISOString() }); return {};
      case 'git.stash.pop': case 'git.stash.drop': stashes.splice(+p.index || 0, 1); return {};
      case 'git.tag.create': commits[0].refs.push(`tag: ${p.name}`); return {};
      case 'files.create': writeFile(p.path, p.content || '', { create: true }); return { path: p.path };
      case 'files.delete': return fileDelete(p.path);
      case 'agentneuron.rescan': broadcast('graph', { changed: true }); return { files: db.size };
      case 'tasks.export': { const lines = ['# Tasks', '', '<!-- agentneuron:export -->', ...board.native.map((t) => `- [${charOf(t.status)}] ${t.title}${metaSuffix(t)}`), '']; if (db.has(p.path || 'TASKS.md')) writeFile(p.path || 'TASKS.md', lines.join('\n')); else writeFile(p.path || 'TASKS.md', lines.join('\n')); return { path: p.path || 'TASKS.md', tasks: board.native.length }; }
      case 'workspace.open': return { url: location.href };
      default: return { ok: true };
    }
  }

  function jobSummary(j) {
    const { _cancel: _c, ...s } = j;
    return clone(s);
  }
  function runJob(id, params) {
    const def = MOCK_ACTIONS.find((a) => a.id === id);
    if (!def) throw httpErr(404, `unknown action ${id}`);
    const lvl = def.flag === 'terminal' ? 'terminal' : def.level;
    need(lvl);
    for (const [k, s] of Object.entries(def.params || {})) {
      if (s.required && (params[k] === undefined || params[k] === '' || (Array.isArray(params[k]) && !params[k].length))) throw httpErr(400, `param ${k} is required`);
    }
    const pv = preview(id, params);
    const job = { id: `j${Date.now().toString(36)}${++jobSeq}`, actionId: id, title: def.title, params: clone(params), level: def.level, status: 'queued', startedAt: Date.now(), endedAt: null, exitCode: null, result: null, error: null, command: pv.command };
    jobs.unshift(job);
    jobLogs.set(job.id, []);
    logAudit({ action: id, params });
    const log = (stream, text) => {
      const l = { ts: Date.now(), stream, text: text.endsWith('\n') ? text : text + '\n' };
      jobLogs.get(job.id).push(l);
      broadcast('joblog', { id: job.id, stream, text: l.text });
    };
    const steps = scriptFor(id, params);
    let t = 300;
    const timers = [];
    timers.push(setTimeout(() => { job.status = 'running'; broadcast('job', jobSummary(job)); if (pv.command) log('info', `$ ${pv.command.map(shq).join(' ')}`); }, 250));
    for (const s of steps) { t += s.ms + rand(160); timers.push(setTimeout(() => job.status === 'running' && log(s.stream, s.text), t)); }
    timers.push(setTimeout(() => {
      if (job.status !== 'running') return;
      try {
        job.result = applyEffects(id, params);
        const failed = id === 'scripts.run' && params.name === 'test';
        job.status = failed ? 'error' : 'ok';
        job.exitCode = failed ? 1 : 0;
        if (failed) job.error = 'Process exited with code 1';
      } catch (e) {
        job.status = 'error';
        job.exitCode = 1;
        job.error = e.message;
        log('stderr', e.message);
      }
      job.endedAt = Date.now();
      broadcast('job', jobSummary(job));
      broadcast('notify', job.status === 'ok'
        ? { type: 'job-done', title: `${job.title} finished`, body: `${id} · ${((job.endedAt - job.startedAt) / 1000).toFixed(1)}s`, level: 'ok', ts: Date.now() }
        : { type: 'job-failed', title: `${job.title} failed`, body: job.error || '', level: 'error', ts: Date.now() });
    }, t + 400));
    job._cancel = () => { timers.forEach(clearTimeout); job.status = 'cancelled'; job.endedAt = Date.now(); job.exitCode = null; log('info', 'cancelled by user'); broadcast('job', jobSummary(job)); };
    jobTimers.set(job.id, timers);
    setTimeout(() => broadcast('job', jobSummary(job)), 20);
    return jobSummary(job);
  }

  function fileDelete(path) {
    const f = db.get(path);
    if (!f) throw httpErr(404, 'not found');
    const id = `${Date.now().toString(36)}-${hashOf(path).slice(0, 6)}`;
    trash.unshift({ id, path, type: 'file', ts: Date.now(), size: f.entry.size, data: f });
    db.delete(path);
    emit('unlink', path);
    broadcast('graph', { changed: true });
    return { id, path };
  }

  // ------------------------------------------------------------ routes
  const B = (b) => b || {};
  const routes = {
    '/api/state': () => {
      const h = health();
      return {
        project: PROJECT, version: '0.3.0-mock', startedAt, allowWrite: can('edit'), actions: clone(config.actions), counts: counts(),
        health: { score: h.score, grade: h.grade, counts: h.counts },
        git: { available: true, branch: currentBranch, dirty: [...db.values()].filter((f) => f.gitStatus).length },
      };
    },
    '/api/files': () => filesList(),
    '/api/file': ({ path }) => {
      const f = db.get(path);
      if (!f) throw httpErr(404, 'Not found');
      const links = allLinks();
      return {
        entry: { ...f.entry, ...(f.gitStatus ? { gitStatus: f.gitStatus } : {}) }, content: f.content,
        links: { out: links.filter((l) => l.from === path), in: links.filter((l) => l.to === path) },
        history: f.history.map((h) => h.entry),
        git: { log: gitLog({ path }).map((c) => ({ ...c })), status: f.gitStatus || null },
      };
    },
    '/api/diff': ({ path, from, to }) => {
      const a = getVersion(path, from);
      const b = getVersion(path, to || 'current');
      if (a == null || b == null) throw httpErr(404, 'Version not found');
      return { path, from, to: to || 'current', ...lineDiff(a, b) };
    },
    '/api/history': ({ path }) => db.get(path)?.history.map((h) => h.entry) ?? [],
    '/api/history/content': ({ path, id }) => ({ content: getVersion(path, id) }),
    '/api/restore': (_q, b) => {
      need('edit');
      const c = getVersion(b.path, b.id);
      if (c == null) throw httpErr(404, 'version not found');
      writeFile(b.path, c);
      return { ok: true };
    },
    '/api/events': ({ since }) => events.filter((e) => e.id > (+since || 0)),
    '/api/graph': () => graph(),
    '/api/context': ({ dir, tool }) => context(dir || '', tool || 'claude'),
    '/api/context/dirs': () => ['', 'apps', 'apps/api', 'apps/web', 'packages/ui', 'docs'],
    '/api/health': () => health(),
    '/api/tasks': () => tasks(),
    '/api/decisions': () => decisions(),
    '/api/git': () => ({ ...clone(git), branch: currentBranch, recent: gitLog({ limit: 8 }).map((c) => ({ ...c, files: commitBy(c.hash)?.files || [] })) }),
    '/api/config': () => clone(AGENT_CONFIG),
    '/api/sessions': () => clone(sessions),
    '/api/conflicts': () => clone(conflicts),
    '/api/search': ({ q }) => search(q),

    // auth
    '/api/auth/me': () => (loggedIn ? { role, levels: levels(), tokenRequired } : { role: null, levels: { read: false, state: false, edit: false, exec: false, danger: false, terminal: false }, tokenRequired: true }),
    '/api/auth/login': (_q, b) => {
      if (!b.token || b.token === 'wrong') throw httpErr(401, 'invalid token');
      loggedIn = true;
      role = b.token === 'viewer' ? 'viewer' : 'admin';
      return { role, levels: levels(), tokenRequired };
    },
    '/api/auth/logout': () => ((loggedIn = false), { ok: true }),

    // actions + jobs
    '/api/actions': () => actionList(),
    '/api/actions/preview': (_q, b) => preview(b.id, b.params || {}),
    '/api/actions/run': (_q, b) => runJob(b.id, b.params || {}),
    '/api/jobs': () => jobs.map(jobSummary),
    '/api/job': ({ id }) => {
      const j = jobs.find((x) => x.id === id);
      if (!j) throw httpErr(404, 'job not found');
      return { ...jobSummary(j), log: clone(jobLogs.get(id) || []) };
    },
    '/api/jobs/cancel': (_q, b) => {
      need('state');
      const j = jobs.find((x) => x.id === b.id);
      if (!j || ['ok', 'error', 'cancelled'].includes(j.status)) throw httpErr(404, 'job not found or already finished');
      j._cancel();
      return { ok: true };
    },
    '/api/audit': ({ limit }) => (need('state'), audit.slice(0, +limit || 200)),
    '/api/settings': () => ({
      actions: clone(config.actions),
      roles: { you: role, tokenRequired, adminToken: tokenRequired, viewerToken: tokenRequired },
      notifications: { browser: true, webhooks: [{ url: 'https://hooks.slack.com/services/T0***/B0***/***', events: ['secret', 'conflict', 'job-failed'] }, { url: 'https://discord.com/api/webhooks/12***/***', events: ['health-drop'] }] },
      paths: { root: PROJECT.root, data: '.agentneuron', config: '.agentneuron/config.json', audit: '.agentneuron/audit.jsonl', events: '.agentneuron/events.jsonl', metrics: '.agentneuron/metrics.jsonl' },
      version: '0.3.0-mock',
      howToEnable: 'Actions beyond read are OFF by default. Enable them in .agentneuron/config.json, e.g. {"actions":{"edit":true,"exec":true}}, or start agentneuron with --enable edit,exec[,danger,terminal]. Use --admin-token to separate admin from read-only viewers.',
    }),

    // files
    '/api/file/raw': ({ path }) => {
      const f = db.get(path);
      if (!f) throw httpErr(404, 'file not found');
      return { path, content: f.content, hash: hashOf(f.content), mtime: f.entry.mtime };
    },
    '/api/file/save': (_q, b) => {
      need('edit');
      const f = db.get(b.path);
      if (!f) {
        if (b.baseHash) throw httpErr(409, 'file was deleted on disk', { conflict: true, current: null, currentHash: null });
        writeFile(b.path, b.content);
        return { entry: db.get(b.path).entry, hash: hashOf(b.content) };
      }
      const cur = hashOf(f.content);
      if (b.baseHash !== cur) throw httpErr(409, 'file changed on disk', { conflict: true, current: f.content, currentHash: cur });
      if (f.content === b.content) return { entry: f.entry, hash: cur, unchanged: true };
      writeFile(b.path, b.content);
      logAudit({ route: 'POST /api/file/save', params: { path: b.path } });
      return { entry: clone(db.get(b.path).entry), hash: hashOf(b.content) };
    },
    '/api/file/create': (_q, b) => {
      need('edit');
      let content = b.content || '';
      let path = b.path;
      if (b.template) {
        const r = routes['/api/agents/template/render']({ id: b.template, vars: JSON.stringify(b.vars || {}) });
        content = r?.content ?? '';
        path = path || r?.path;
      }
      if (!path) throw httpErr(400, 'path required');
      if (db.has(path)) throw httpErr(409, 'file already exists');
      writeFile(path, content);
      return { path, entry: clone(db.get(path).entry), hash: hashOf(content) };
    },
    '/api/file/rename': (_q, b) => {
      need('edit');
      if (!db.has(b.from)) throw httpErr(404, 'source not found');
      if (db.has(b.to)) throw httpErr(409, 'destination already exists');
      if (b.from === b.to) throw httpErr(400, 'source and destination are the same');
      const rw = b.rewriteLinks === false ? [] : renameRefs(b.from, b.to);
      const result = { from: b.from, to: b.to, rewritten: rw.map((r) => ({ path: r.path, count: r.count })), moved: 1 };
      if (b.dryRun) return { ...result, dryRun: true };
      const f = db.get(b.from);
      db.delete(b.from);
      emit('unlink', b.from);
      db.set(b.to, { ...f, entry: mkEntry(b.to, f.entry.tool, f.entry.kind, f.content, Date.now()), gitStatus: 'A' });
      emit('add', b.to);
      for (const r of rw) writeFile(r.path, r.next);
      for (const a of annotations) if (a.path === b.from) a.path = b.to;
      for (const bm of bookmarks) if (bm.path === b.from) bm.path = b.to;
      broadcast('graph', { changed: true });
      return result;
    },
    '/api/file/delete': (_q, b) => (need('edit'), fileDelete(b.path)),
    '/api/trash': () => trash.map(({ data: _d, ...t }) => clone(t)),
    '/api/trash/restore': (_q, b) => {
      need('edit');
      const i = trash.findIndex((t) => t.id === b.id);
      if (i < 0) throw httpErr(404, 'trash entry not found');
      const t = trash[i];
      if (db.has(t.path)) throw httpErr(409, 'a file already exists at the original path');
      trash.splice(i, 1);
      db.set(t.path, t.data);
      emit('add', t.path);
      broadcast('graph', { changed: true });
      return { id: t.id, path: t.path };
    },
    '/api/trash/purge': (_q, b) => {
      need('danger');
      const i = trash.findIndex((t) => t.id === b.id);
      if (i < 0) throw httpErr(404, 'trash entry not found');
      trash.splice(i, 1);
      return { id: b.id };
    },
    '/api/links/resolve': ({ from, target }) => {
      let t = String(target || '').replace(/^@/, '').replace(/^\[\[|\]\]$/g, '').split('#')[0];
      const r1 = resolve(dirOf(from || ''), t);
      const hit = db.has(r1) ? r1 : db.has(t) ? t : db.has(t + '.md') ? t + '.md' : [...db.keys()].find((p) => baseOf(p).replace(/\.md$/, '').toLowerCase() === t.toLowerCase()) || null;
      const base = baseOf(t).replace(/\.\w+$/, '').toLowerCase();
      return { path: hit, exists: !!hit, candidates: hit ? [] : [...db.keys()].filter((p) => baseOf(p).toLowerCase().includes(base.slice(0, 4))).slice(0, 5) };
    },
    '/api/backlinks': ({ path }) => allLinks().filter((l) => l.to === path && !l.broken && l.from !== path),
    '/api/replace/preview': (q) => replaceRun(q, false),
    '/api/replace/apply': (_q, b) => (need('edit'), replaceRun(b, true)),
    '/api/fixes': ({ issue }) => fixesFor(issue).fixes,
    '/api/fixes/apply': (_q, b) => {
      need('edit');
      const { issue, fixes } = fixesFor(b.issue);
      const fx = fixes.find((x) => x.id === b.fix);
      if (!fx) throw httpErr(404, 'fix not found');
      if (fx.id === 'trash') { const r = fileDelete(issue.path); return { applied: true, changed: [issue.path], trash: r.id }; }
      const changed = [];
      for (const e of fx.edits) {
        const f = db.get(e.path);
        const lines = f.content.split('\n');
        if (e.before === '' && e.line >= lines.length) lines.push(e.after);
        else if (e.after === '') lines.splice(e.line - 1, 1);
        else lines[e.line - 1] = e.after;
        writeFile(e.path, lines.join('\n'));
        changed.push(e.path);
      }
      setTimeout(() => { const h = health(); broadcast('health', { score: h.score, grade: h.grade, counts: h.counts }); }, 200);
      return { applied: true, changed };
    },
    '/api/bookmarks': (_q, b, init) => {
      if (init?.method === 'POST') {
        need('state');
        if (!bookmarks.some((x) => x.path === b.path)) bookmarks.push({ path: b.path, label: b.label || null, ts: Date.now() });
        setTimeout(() => broadcast('files', { changed: 'bookmarks' }), 20);
      }
      return clone(bookmarks);
    },
    '/api/bookmarks/remove': (_q, b) => {
      need('state');
      bookmarks = bookmarks.filter((x) => x.path !== b.path);
      setTimeout(() => broadcast('files', { changed: 'bookmarks' }), 20);
      return clone(bookmarks);
    },
    '/api/annotations': ({ path }, b, init) => {
      if (init?.method === 'POST') {
        need('state');
        const f = db.get(b.path);
        if (!f) throw httpErr(404, 'file not found');
        const a = { id: hashOf(String(Math.random())).slice(0, 10), path: b.path, line: +b.line, anchor: (f.content.split('\n')[b.line - 1] || '').trim(), text: String(b.text).trim(), author: role, ts: Date.now(), resolved: false };
        annotations.push(a);
        setTimeout(() => broadcast('files', { changed: 'annotations' }), 20);
        return clone(a);
      }
      return clone(path ? annotations.filter((a) => a.path === path) : annotations);
    },
    '/api/annotations/remove': (_q, b) => {
      need('state');
      annotations = annotations.filter((a) => a.id !== b.id);
      setTimeout(() => broadcast('files', { changed: 'annotations' }), 20);
      return { ok: true };
    },
    '/api/annotations/resolve': (_q, b) => {
      need('state');
      const a = annotations.find((x) => x.id === b.id);
      if (!a) throw httpErr(404, 'annotation not found');
      a.resolved = b.resolved !== false;
      setTimeout(() => broadcast('files', { changed: 'annotations' }), 20);
      return clone(a);
    },

    // board
    '/api/board': () => boardGet(),
    '/api/board/task': (_q, b) => boardCreate(B(b)),
    '/api/board/update': (_q, b) => boardUpdate(b.id, b.patch || {}),
    '/api/board/move': (_q, b) => boardUpdate(b.id, { ...(b.status !== undefined ? { status: b.status } : {}), ...(b.order !== undefined ? { order: b.order } : {}) }),
    '/api/board/delete': (_q, b) => {
      need('state');
      const t = collectTasks().find((x) => x.id === b.id);
      if (!t) throw httpErr(404, 'task not found');
      if (t.source === 'native') board.native = board.native.filter((x) => x.id !== b.id);
      else board.overlay[b.id] = { ...(board.overlay[b.id] || {}), hidden: true };
      boardChanged();
      return { deleted: true };
    },
    '/api/board/comment': (_q, b) => {
      need('state');
      const t = collectTasks().find((x) => x.id === b.id);
      if (!t) throw httpErr(404, 'task not found');
      const c = { id: hashOf(String(Math.random())).slice(0, 8), ts: Date.now(), author: role, text: String(b.text || '').trim() };
      if (t.source === 'native') board.native.find((x) => x.id === b.id).comments.push(c);
      else (board.overlay[b.id] = board.overlay[b.id] || {}).comments = [...(board.overlay[b.id].comments || []), c];
      boardChanged();
      return { comment: c, task: collectTasks().find((x) => x.id === b.id) };
    },
    '/api/board/columns': (_q, b) => {
      need('state');
      board.columns = b.columns.map((c) => ({ id: c.id, title: c.title, wip: c.wip ? +c.wip : null }));
      boardChanged();
      return { columns: clone(board.columns) };
    },

    // git 2.0
    '/api/git/branches': () => ({
      available: true, current: currentBranch,
      local: branches.map((b) => { const c = commitBy(b.tip); return { name: b.name, upstream: b.upstream, ahead: b.ahead, behind: b.behind, gone: false, current: b.name === currentBranch, last: { hash: c.hash, date: c.date, subject: c.subject } }; }),
      remote: branches.filter((b) => b.upstream).map((b) => { const c = commitBy(b.tip); return { name: b.upstream, last: { hash: c.hash, date: c.date, subject: c.subject } }; }),
    }),
    '/api/git/log': (q) => gitLog(q),
    '/api/git/commit': ({ hash }) => commitDetail(hash),
    '/api/git/changes': () => gitChanges(),
    '/api/git/diff': ({ path, staged: st }) => {
      const f = db.get(path);
      if (!f) throw httpErr(400, 'bad path');
      const { patch } = patchFor(path, f.head, f.content);
      const show = st === '1' ? staged.has(path) : !staged.has(path);
      return { path, staged: st === '1', patch: show ? patch : '', hunks: [], truncated: false };
    },
    '/api/git/tags': () => commits.flatMap((c) => c.refs.filter((r) => r.startsWith('tag: ')).map((r) => ({ name: r.slice(5), hash: c.hash, annotated: r !== 'tag: v2.0.0', date: c.date, subject: c.subject }))),
    '/api/git/stash': () => stashes.map((s, i) => ({ index: i, ref: `stash@{${i}}`, hash: s.hash, message: s.message, date: s.date })),
    '/api/git/remotes': () => clone(remotes),
    '/api/git/blame': ({ path }) => blame(path),
    '/api/changelog': () => ({ markdown: '## Unreleased\n\n### Features\n- PaymentIntent state machine notes\n\n### Docs\n- update checkout v2 plan\n- webhook retries with jitter\n', groups: [{ type: 'feat', items: [commits[7]?.subject] }, { type: 'docs', items: [commits[0].subject, commits[4].subject] }] }),
  };

  // UI-B insight routes (reports, project, agents, workspace, git stats…) — called as fn(q, init)
  const insight = insightRoutes({ graph, files: filesList, sessions: () => sessions, health });
  for (const [k, fn] of Object.entries(insight)) if (!routes[k]) routes[k] = (q, _b, init) => fn(q, init);
  routes['/api/reports/export'] = (q) => reportExport(q || {});

  // ---------------------------------------------------------------- truth & safety (feat/truth) >>>
  // GET /api/verify, GET /api/audit/config, POST /api/verify/fix over the mock files.
  const CLAIMS = [
    ['CLAUDE.md', 'command', 'pnpm db:migrate', 'pnpm db:migrate', 'false', 'no "db:migrate" script in package.json (has: dev, build, test, lint, db:push, db:seed)', 'pnpm db:push'],
    ['CLAUDE.md', 'command', 'pnpm test --filter api', 'pnpm test --filter api', 'ok', '"test" defined in apps/api/package.json'],
    ['CLAUDE.md', 'command', 'pnpm dev', 'pnpm dev', 'ok', '"dev" is defined in package.json: turbo run dev'],
    ['CLAUDE.md', 'command', 'pnpm lint --fix', 'pnpm lint --fix', 'ok', '"lint" is defined in package.json: turbo run lint'],
    ['CLAUDE.md', 'path', 'scripts/seed.ts', 'scripts/seed.ts', 'false', 'scripts/seed.ts does not exist', 'scripts/seed.mjs'],
    ['AGENTS.md', 'command', 'pnpm install', 'pnpm install', 'ok', 'pnpm install'],
    ['AGENTS.md', 'command', 'pnpm test', 'pnpm test', 'ok', '"test" is defined in package.json: turbo run test'],
    ['apps/api/AGENTS.md', 'command', 'pnpm --filter api test', 'pnpm --filter api test', 'ok', '"test" defined in apps/api/package.json'],
    ['apps/api/CLAUDE.md', 'path', 'src/schemas', 'src/schemas', 'false', 'src/schemas does not exist', 'src/schema'],
  ].map(([file, kind, needle, text, status, evidence, to], i) => {
    const lines = (db.get(file)?.content || '').split('\n');
    const at = lines.findIndex((l) => l.includes(needle.replace(/`/g, '')));
    return { id: `${kind}:${file}:${at + 1 || 1}:${(0x1f2e3d4c5b + i).toString(16).slice(0, 10)}`, file, line: at + 1 || 1, kind, text, status, evidence,
      suggestion: status === 'false' ? (to ? `replace \`${text}\` with \`${to}\`` : 'remove this instruction or add the missing target') : null, fixable: status === 'false' && !!to && at >= 0, to };
  });
  const verifySummary = () => {
    const s = { files: new Set(CLAIMS.map((c) => c.file)).size, total: CLAIMS.length, ok: 0, false: 0, unknown: 0, byKind: {} };
    for (const c of CLAIMS) { s[c.status]++; const k = (s.byKind[c.kind] ??= { ok: 0, false: 0, unknown: 0 }); k[c.status]++; }
    return s;
  };
  routes['/api/verify'] = (q) => ({ generatedAt: Date.now(), summary: verifySummary(), claims: CLAIMS.filter((c) => (!q.status || c.status === q.status) && (!q.file || c.file === q.file)).map(({ to: _t, ...c }) => c) });
  routes['/api/verify/fix'] = (_q, b) => {
    if (!can('edit')) throw httpErr(403, 'action level "edit" is disabled');
    const c = CLAIMS.find((x) => x.id === b.id);
    if (!c || !c.fixable) throw httpErr(404, 'no automatic fix for this claim (already fixed, changed, or not fixable)');
    const f = db.get(c.file);
    const lines = f.content.split('\n');
    lines[c.line - 1] = lines[c.line - 1].replace(c.text, c.to);
    f.content = lines.join('\n');
    emit('change', c.file, null);
    const from = c.text;
    Object.assign(c, { status: 'ok', evidence: 'fixed', suggestion: null, fixable: false, text: c.to });
    return { applied: true, path: c.file, line: c.line, from, to: c.to };
  };
  routes['/api/audit/config'] = () => {
    const F = [
      ['high', 'inline-secret', '.mcp.json', 3, 'MCP server "github" has an inline env value for GITHUB_TOKEN (ghp_****)', 'The credential is committed with the config and visible to every agent and collaborator.', 'Use a reference instead, e.g. "GITHUB_TOKEN": "${env:GITHUB_TOKEN}".'],
      ['medium', 'unpinned-mcp', '.mcp.json', 3, 'MCP server "github" runs unpinned @modelcontextprotocol/server-github', 'Every start downloads whatever version is newest: a compromised release runs with your permissions.', 'Pin an exact version, e.g. "@modelcontextprotocol/server-github@1.2.3".'],
      ['medium', 'unpinned-mcp', '.mcp.json', 4, 'MCP server "postgres" runs unpinned @modelcontextprotocol/server-postgres', 'Every start downloads whatever version is newest.', 'Pin an exact version.'],
      ['low', 'broad-allow', '.claude/settings.json', 3, '"Read(**)" is a blanket allow rule', 'Broad allow rules remove the review step for a whole tool.', 'Scope it to the directories agents need.'],
    ].map(([severity, rule, file, line, title, why, fix], i) => ({ id: `${rule}:${file}:${line}:${i}`, severity, rule, file, line, title, why, fix }));
    const counts = { high: 0, medium: 0, low: 0, info: 0 };
    for (const f of F) counts[f.severity]++;
    return { generatedAt: Date.now(), score: 42, level: 'high', counts, findings: F, scanned: ['.mcp.json', '.claude/settings.json'] };
  };
  // ---------------------------------------------------------------- <<< truth & safety (feat/truth)

  // reports export: csv/md/html from the insight stub; json (agentneuron.report/v1) and ai context pack here
  function reportExport(q) {
    const fmt = q.format === 'llm' ? 'ai' : q.format || 'md';
    const sm = insight['/api/reports/summary'](q);
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    const ext = { csv: 'csv', md: 'md', html: 'html', json: 'json', ai: 'ai.md' }[fmt];
    if (!ext) throw httpErr(400, 'bad format');
    const filename = `agentneuron-report-${PROJECT.name}-${day(sm.range.from)}_${day(sm.range.to)}.${ext}`;
    const mask = (t) => String(t).replace(/\bsk-ant-[A-Za-z0-9_-]{20,}/g, (m) => m.slice(0, 4) + '****');
    const est = (t) => Math.ceil((t.length / 4 + (t.match(/\S+/g) || []).length * 1.3) / 2);
    if (!['json', 'ai'].includes(fmt)) { const r = insight['/api/reports/export'](q); return { ...r, filename, content: mask(r.content), tokens: est(r.content) }; }
    const h = health();
    const files = filesList();
    const open = tasks().filter((t) => !t.done);
    const kpis = Object.fromEntries(Object.keys(sm.kpis).map((k) => [k, { value: sm.kpis[k], previous: sm.prev[k] ?? null, delta: typeof sm.kpis[k] === 'number' && typeof sm.prev[k] === 'number' ? sm.kpis[k] - sm.prev[k] : null }]));
    const top = insight['/api/reports/top']({ ...q, by: 'churn' }).slice(0, 10);
    const iso = (t) => new Date(t).toISOString();
    const rep = {
      schema: 'agentneuron.report/v1', generatedAt: iso(Date.now()), project: { name: PROJECT.name, stack: [{ id: 'node', version: '20' }, { id: 'typescript', version: null }] },
      range: { from: iso(sm.range.from), to: iso(sm.range.to) }, prevRange: { from: iso(sm.prevRange.from), to: iso(sm.prevRange.to) }, kpis, series: [],
      top: top.map((r) => ({ path: r.path, changes: r.changes, added: r.added, removed: r.removed, lastChangedAt: iso(r.last) })), fileChanges: { added: [], removed: [] },
      health: { score: h.score, grade: h.grade, counts: h.counts }, tasks: { open: open.length, done: tasks().length - open.length, items: open.slice(0, 50).map((t) => ({ path: t.path, line: t.line, text: t.text, section: t.section || null })) },
      contextFiles: files.map((f) => ({ path: f.path, tool: f.tool, kind: f.kind, tokens: f.tokens || 0, updatedAt: iso(f.mtime || Date.now()) })),
      issues: h.issues.slice().sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a.severity] - ({ error: 0, warn: 1, info: 2 })[b.severity]).map((i) => ({ rule: i.rule, severity: i.severity, path: i.path, line: i.line ?? null, message: i.message, hint: i.hint || null })),
    };
    if (fmt === 'json') { const content = mask(JSON.stringify(rep, null, 2)); return { filename, mime: 'application/json', content, tokens: est(content) }; }
    const byTool = {};
    for (const f of rep.contextFiles) byTool[f.tool] = (byTool[f.tool] || 0) + f.tokens;
    const total = Object.values(byTool).reduce((a, b) => a + b, 0);
    const sg = (n) => (typeof n !== 'number' ? '-' : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
    const L = [`# AgentNeuron context pack: ${PROJECT.name}`, '', `Period: ${day(sm.range.from)} → ${day(sm.range.to)} (demo data).`, '', '## Summary', '',
      `${sm.kpis.changes} changes touched ${sm.kpis.filesTouched} files. Health is ${h.score} (${h.grade}) with ${h.counts.error} error(s), ${h.counts.warn} warning(s). Context totals ${total} tokens; ${open.length} open task(s).`, '',
      '## KPIs', '', '| KPI | Value | Previous | Δ |', '|---|---:|---:|---:|', ...Object.entries(kpis).map(([k, v]) => `| ${k} | ${v.value ?? '-'} | ${v.previous ?? '-'} | ${sg(v.delta)} |`), '',
      '## What changed', '', ...top.map((t) => `- \`${t.path}\`: ${t.changes} change(s), +${t.added}/−${t.removed}`), '',
      '## Health issues', '', ...rep.issues.slice(0, 15).map((i, n) => `${n + 1}. **${i.severity}** \`${i.rule}\` \`${i.path}${i.line ? `:${i.line}` : ''}\`: ${i.message}`), '',
      '## Open tasks', '', ...open.slice(0, 15).map((t) => `- [ ] ${t.text} (\`${t.path}:${t.line}\`)`), '',
      '## Context budget by tool', '', '| Tool | Tokens |', '|---|---:|', ...Object.entries(byTool).sort((a, b) => b[1] - a[1]).map(([t, n]) => `| ${t} | ${n} |`), '',
      '## Suggested next actions', '', `1. Fix ${h.counts.error} error-level issue(s).`, `2. Triage ${open.length} open task(s).`, ''];
    if (q.include === 'content') {
      L.push('## File contents', '');
      for (const f of files.filter((x) => ['context', 'rules', 'agent', 'skill', 'memory'].includes(x.kind))) L.push(`### ${f.path}`, '', '```markdown', db.get(f.path)?.content || '', '```', '');
    }
    const body = mask(L.join('\n'));
    const fm = `---\nschema: "agentneuron.report/v1"\nformat: "ai"\ngeneratedAt: "${rep.generatedAt}"\nproject: "${PROJECT.name}"\nrange: { from: "${rep.range.from}", to: "${rep.range.to}" }\ntokenEstimate: ${est(body)}\nincludesContent: ${q.include === 'content'}\n---\n`;
    return { filename, mime: 'text/markdown', content: fm + body, tokens: est(fm + body) };
  }

  const STATE_POSTS = new Set(['/api/bookmarks', '/api/annotations']);
  async function request(path, params = {}, init = {}) {
    await new Promise((r) => setTimeout(r, 30 + rand(90)));
    if (!loggedIn && path !== '/api/auth/me' && path !== '/api/auth/login') throw httpErr(401, 'unauthorized');
    const fn = routes[path];
    if (!fn) throw httpErr(404, `Mock: no route ${path}`);
    let body = {};
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }
    void STATE_POSTS;
    return clone(fn(params || {}, body, init));
  }

  // ---------------------------------------------------------------- live stream
  function stream({ onEvent, onStatus }) {
    let closed = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!closed) fn(); }, ms); timers.add(t); };
    let tick = 0;
    const tmpFiles = [];
    const listener = (name, data) => !closed && onEvent(name, data);
    bus.add(listener);
    const quiet = qs.has('quiet');

    const step = () => {
      tick++;
      const active = sessions.filter((s) => Date.now() - s.lastAt < 6 * 3600_000);
      const agent = Math.random() < 0.8 ? pick(active.length ? active : sessions) : null;
      const r = Math.random();
      if (r < 0.12 && tmpFiles.length < 3) {
        const d = new Date();
        const path = `docs/notes/${d.toISOString().slice(0, 10)}-${(tick % 97).toString().padStart(2, '0')}.md`;
        const content = `# Session notes ${d.toLocaleTimeString()}\n\n- Context: [plan](../plan.md)\n- [ ] Follow up on ${pick(['3DS', 'refunds', 'webhooks', 'rate limits'])}\n`;
        db.set(path, { entry: mkEntry(path, 'generic', 'doc', content, Date.now()), content, history: [], gitStatus: '?', head: null });
        tmpFiles.push(path);
        emit('add', path, agent);
        later(() => onEvent('graph', { changed: true }), 400);
      } else if (r < 0.18 && tmpFiles.length) {
        const path = tmpFiles.shift();
        db.delete(path);
        emit('unlink', path, agent);
        later(() => onEvent('graph', { changed: true }), 400);
      } else {
        const hot = ['docs/plan.md', 'TODO.md', 'CLAUDE.md', 'AGENTS.md', 'docs/api.md', 'apps/api/CLAUDE.md', 'memory/notes.md', '.cursor/rules/frontend.mdc'];
        const path = agent && Math.random() < 0.6 ? pick(agent.filesTouched.filter((p) => db.has(p)).concat(hot)) : pick(hot);
        const f = db.get(path);
        if (!f) return later(step, 2400);
        const lines = f.content.replace(/\n+$/, '').split('\n');
        const op = Math.random();
        if (op < 0.55 || lines.length < 6) lines.push(pick(EDIT_LINES));
        else if (op < 0.8) {
          const k = lines.findIndex((l) => /- \[ \]/.test(l));
          if (k >= 0) lines[k] = lines[k].replace('- [ ]', '- [x]');
          else lines.push(pick(EDIT_LINES));
        } else {
          const k = 3 + rand(lines.length - 3);
          if (!/^#/.test(lines[k]) && !TASK_RE.test(lines[k])) lines.splice(k, 1);
        }
        f.content = lines.join('\n') + '\n';
        emit('change', path, agent);
        if (/- \[/.test(lines[lines.length - 1])) later(() => onEvent('board', { changed: true }), 200);
        if (/\]\(|@/.test(lines[lines.length - 1])) later(() => onEvent('graph', { changed: true }), 400);
      }
      if (tick % 3 === 0) {
        const h = health();
        later(() => onEvent('health', { score: h.score, grade: h.grade, counts: h.counts }), 300);
      }
      if (tick % 7 === 0) {
        const [a, b] = [sessions[0], sessions[2]];
        const path = pick(['docs/api.md', 'AGENTS.md', 'docs/plan.md']);
        conflicts = [{ path, agents: [agentRef(a), agentRef(b)], lastTs: Date.now() }];
        onEvent('conflict', clone(conflicts));
        later(() => { conflicts = []; onEvent('conflict', []); }, 18_000);
      }
      later(step, 2200 + rand(3200));
    };

    later(() => onStatus('live'), 350);
    if (!quiet) {
      later(step, 1800);
      later(() => onEvent('notify', { type: 'secret', title: 'Possible secret detected', body: 'Anthropic API key in memory/notes.md', level: 'error', ts: Date.now(), path: 'memory/notes.md' }), 5200);
    }
    const ping = setInterval(() => !closed && onEvent('ping', { ts: Date.now() }), 20_000);
    return {
      close() { closed = true; bus.delete(listener); clearInterval(ping); timers.forEach(clearTimeout); },
      reconnect() { onStatus('live'); },
    };
  }

  // test hooks for headless demos: simulate an agent editing a file on disk
  try {
    window.__agentneuronMock = {
      touch(path, line = '\nEdited on disk by an agent.\n') {
        const f = db.get(path);
        if (!f) return false;
        f.content = f.content.replace(/\n*$/, '\n') + line.replace(/^\n/, '');
        emit('change', path, sessions[0]);
        return true;
      },
      db,
    };
  } catch {
    /* no window */
  }

  void day;
  return { request, stream };
}
