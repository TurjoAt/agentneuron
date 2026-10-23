// Mock backend implementing the REST + SSE contract (docs/CONTRACT.md) in-memory.
// Enabled with ?mock=1, or automatically when /api/state is unreachable.
// It mutates its own state over time to simulate agents editing files.

import { SEED, PROJECT, sessions as seedSessions, gitInfo, AGENT_CONFIG, EDIT_LINES } from './mock-data.js';

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

export function createMock() {
  const now = Date.now();
  /** @type {Map<string, {entry:any, content:string, history:{entry:any, content:string}[], gitStatus?:string}>} */
  const db = new Map();
  let eventId = 0;
  const events = [];
  let sessions = seedSessions(now);
  const git = gitInfo(now);
  let conflicts = [];
  const startedAt = now - 3 * 3600_000;

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
  }
  const gitStatusSeed = { 'docs/plan.md': 'M', 'CLAUDE.md': 'M', 'TODO.md': 'M', 'CLAUDE.local.md': '?', 'memory/notes.md': '?', 'docs/adr/0003-search.md': 'A' };
  for (const [p, s] of Object.entries(gitStatusSeed)) if (db.has(p)) db.get(p).gitStatus = s;

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

  function healthIssues() {
    const issues = [];
    for (const l of allLinks()) {
      if (l.broken) issues.push({ id: `broken-link:${l.from}:${l.line}`, rule: 'broken-link', severity: 'error', path: l.from, line: l.line, message: `Link target does not exist: ${l.to}`, hint: `Fix or remove "${l.raw}"` });
    }
    const add = (rule, severity, path, line, message, hint) => db.has(path) && issues.push({ id: `${rule}:${path}:${line ?? 0}`, rule, severity, path, line, message, hint });
    const notes = db.get('memory/notes.md');
    if (notes && /sk-ant-/.test(notes.content)) {
      const line = notes.content.split('\n').findIndex((l) => l.includes('sk-ant-')) + 1;
      add('secret', 'error', 'memory/notes.md', line, 'Possible Anthropic API key: sk-a••••••••', 'Rotate the key and remove it from the file');
    }
    add('missing-path', 'warn', 'CLAUDE.md', 18, 'Path `scripts/seed.ts` does not exist', 'Update the command docs');
    add('duplicate-rule', 'warn', '.cursorrules', 3, 'Rule duplicated in CLAUDE.md, AGENTS.md: "Use TypeScript strict mode everywhere."', 'Keep one source of truth and link to it');
    add('duplicate-rule', 'info', '.windsurfrules', 3, 'Rule duplicated in CLAUDE.md: "Never commit secrets; read them from .env.local."');
    add('stale-plan', 'warn', 'ROADMAP.md', null, 'Plan not modified in 45 days', 'Review or archive it');
    add('orphan', 'info', 'docs/old-notes.md', null, 'No file links to this document');
    add('orphan', 'info', 'docs/glossary.md', null, 'No file links to this document');
    add('empty-file', 'warn', 'docs/glossary.md', null, 'File is empty');
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
        const m = l.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/);
        if (m) out.push({ path: p, line: k + 1, text: m[2], done: m[1] !== ' ', section });
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

  function fileLog(path) {
    return git.recent.filter((c) => c.files.includes(path)).map(({ files: _f, ...c }) => c);
  }

  function getVersion(path, id) {
    const f = db.get(path);
    if (!f) return null;
    if (!id || id === 'current') return f.content;
    if (id === 'git:HEAD') return f.history[f.history.length - 1]?.content ?? f.content;
    return f.history.find((h) => h.entry.id === id)?.content ?? null;
  }

  function filesList() {
    return [...db.values()].map((f) => ({ ...clone(f.entry), ...(f.gitStatus ? { gitStatus: f.gitStatus } : {}) }));
  }

  const routes = {
    '/api/state': () => {
      const h = health();
      return {
        project: PROJECT, version: '0.1.0-mock', startedAt, allowWrite: true, counts: counts(),
        health: { score: h.score, grade: h.grade, counts: h.counts },
        git: { available: true, branch: git.branch, dirty: Object.keys(gitStatusSeed).length },
      };
    },
    '/api/files': () => filesList(),
    '/api/file': ({ path }) => {
      const f = db.get(path);
      if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
      const links = allLinks();
      return {
        entry: { ...f.entry, ...(f.gitStatus ? { gitStatus: f.gitStatus } : {}) }, content: f.content,
        links: { out: links.filter((l) => l.from === path), in: links.filter((l) => l.to === path) },
        history: f.history.map((h) => h.entry),
        git: { log: fileLog(path), status: f.gitStatus || null },
      };
    },
    '/api/diff': ({ path, from, to }) => {
      const a = getVersion(path, from);
      const b = getVersion(path, to || 'current');
      if (a == null || b == null) throw Object.assign(new Error('Version not found'), { status: 404 });
      return { path, from, to: to || 'current', ...lineDiff(a, b) };
    },
    '/api/history': ({ path }) => db.get(path)?.history.map((h) => h.entry) ?? [],
    '/api/history/content': ({ path, id }) => ({ content: getVersion(path, id) }),
    '/api/events': ({ since }) => events.filter((e) => e.id > (+since || 0)),
    '/api/graph': () => graph(),
    '/api/context': ({ dir, tool }) => context(dir || '', tool || 'claude'),
    '/api/context/dirs': () => ['', 'apps', 'apps/api', 'apps/web', 'packages/ui', 'docs'],
    '/api/health': () => health(),
    '/api/tasks': () => tasks(),
    '/api/decisions': () => decisions(),
    '/api/git': () => clone(git),
    '/api/config': () => clone(AGENT_CONFIG),
    '/api/sessions': () => clone(sessions),
    '/api/conflicts': () => clone(conflicts),
    '/api/search': ({ q }) => search(q),
  };

  async function request(path, params = {}, init = {}) {
    await new Promise((r) => setTimeout(r, 40 + rand(120)));
    if (path === '/api/restore' && init.method === 'POST') {
      const err = new Error('Restore disabled: start mdctl with --write to enable');
      err.status = 403;
      throw err;
    }
    const fn = routes[path];
    if (!fn) throw Object.assign(new Error(`Mock: no route ${path}`), { status: 404 });
    return clone(fn(params || {}));
  }

  // ---------------------------------------------------------------- live stream
  function stream({ onEvent, onStatus }) {
    let closed = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!closed) fn(); }, ms); timers.add(t); };
    let tick = 0;
    const tmpFiles = [];

    const emit = (type, path, agent) => {
      const f = db.get(path);
      const ts = Date.now();
      let stats, historyId;
      if (f && type !== 'unlink') {
        f.entry = mkEntry(path, f.entry.tool, f.entry.kind, f.content, ts);
        const r = record(path, f.content, ts);
        stats = r.stats;
        historyId = r.entry.id;
        if (!f.gitStatus) f.gitStatus = type === 'add' ? '?' : 'M';
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
      onEvent('event', clone(ev));
      return ev;
    };

    const step = () => {
      tick++;
      const active = sessions.filter((s) => Date.now() - s.lastAt < 6 * 3600_000);
      const agent = Math.random() < 0.8 ? pick(active.length ? active : sessions) : null;
      const r = Math.random();
      if (r < 0.12 && tmpFiles.length < 3) {
        const d = new Date();
        const path = `docs/notes/${d.toISOString().slice(0, 10)}-${(tick % 97).toString().padStart(2, '0')}.md`;
        const content = `# Session notes ${d.toLocaleTimeString()}\n\n- Context: [plan](../plan.md)\n- [ ] Follow up on ${pick(['3DS', 'refunds', 'webhooks', 'rate limits'])}\n`;
        db.set(path, { entry: mkEntry(path, 'generic', 'doc', content, Date.now()), content, history: [], gitStatus: '?' });
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
        if (!f) return;
        const lines = f.content.replace(/\n+$/, '').split('\n');
        const op = Math.random();
        if (op < 0.55 || lines.length < 6) lines.push(pick(EDIT_LINES));
        else if (op < 0.8) {
          const k = lines.findIndex((l) => /- \[ \]/.test(l));
          if (k >= 0) lines[k] = lines[k].replace('- [ ]', '- [x]');
          else lines.push(pick(EDIT_LINES));
        } else {
          const k = 3 + rand(lines.length - 3);
          if (!/^#/.test(lines[k])) lines.splice(k, 1);
        }
        f.content = lines.join('\n') + '\n';
        emit('change', path, agent);
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
    later(step, 1800);
    const ping = setInterval(() => !closed && onEvent('ping', { ts: Date.now() }), 20_000);
    return {
      close() { closed = true; clearInterval(ping); timers.forEach(clearTimeout); },
      reconnect() { onStatus('live'); },
    };
  }

  return { request, stream };
}
