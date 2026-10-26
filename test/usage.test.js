import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeHome } from './usage-fixtures.js';
import { getUsage } from '../src/usage/index.js';
import { isDenied, safeRead } from '../src/usage/guard.js';
import { digestClaude, parseLines } from '../src/usage/digest.js';
import { readTranscriptUsage } from '../src/agentcenter/transcript.js';
import { cmdUsage } from '../src/commands/usage.js';

const fx = makeHome();
after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
const U = (config = {}, extra = {}) => getUsage({ root: fx.root, home: fx.home, config, usageBudgetMs: Infinity, ...extra });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('digest: tolerant parse, message dedupe, tools, errors, denials, interrupts, prompts', () => {
  const text = fs.readFileSync(path.join(fx.dir, 'S1.jsonl'), 'utf8');
  const d = digestClaude(parseLines(text), path.join(fx.dir, 'S1.jsonl'));
  assert.equal(d.sessionId, 'S1');
  assert.equal(d.title, 'Fixture session one');
  assert.equal(d.msgs.length, 7, 'm1 spans two lines but counts once');
  assert.equal(d.msgs[0][3], 1000);
  assert.deepEqual(d.tools.map((t) => t.name), ['Edit', 'Bash', 'Bash', 'Bash', 'mcp__github__create_issue', 'Agent', 'Skill', 'AskUserQuestion']);
  assert.equal(d.tools.filter((t) => t.err).length, 3);
  const mcp = d.tools.find((t) => t.kind === 'mcp');
  assert.equal(mcp.server, 'github');
  assert.equal(mcp.denied, 'user-rejected');
  assert.equal(mcp.err, false, 'a denial is not counted as an error');
  assert.equal(d.interrupts.length, 1);
  assert.equal(d.prompts.length, 2);
  assert.equal(d.prompts[1].rework, true);
  assert.equal(d.edits[0].added, 2);
  assert.equal(d.edits[0].removed, 1);
  assert.equal(d.edits[0].ok, true);
  assert.equal(d.spawns[0].agentId, 'a1');
  assert.equal(d.advisor.calls, 1);
  assert.equal(d.compactions.length, 1);
  assert.deepEqual(d.hooks[0].slice(1), [2, 1, 1]);
  assert.equal(d.fileHistory.length, 2);
  assert.equal(d.fileHistory[1].path, path.join(fx.root, 'src', 'a.js'), 'relative trackingPath resolved against cwd');
  assert.equal(d.permModes.bypassPermissions, 1);
  // garbage never throws
  assert.doesNotThrow(() => digestClaude(parseLines('{"type":"assistant","message":{"content":5,"usage":"x"}}\n{"type":"user","message":null}\n[1,2]\nnull\n'), 'x.jsonl'));
});

test('existing transcript reader keeps its behaviour on the shared primitives', () => {
  const u = readTranscriptUsage(path.join(fx.dir, 'S1.jsonl'));
  assert.equal(u.models['claude-sonnet-4-5'].input, 1000);
  assert.equal(u.models['claude-sonnet-4-5'].cacheRead, 5000);
});

test('summary: exact cost from cost-state, estimate otherwise, cache stats, coverage', async () => {
  const s = await U().summary({ range: '30d' });
  assert.equal(s.kpis.sessions, 3, 'S1, S2 and the Codex session (S9 is another project)');
  near(s.kpis.usdExact, 0.5, 1e-4);
  near(s.kpis.usd, 0.5 + 3 + 0.0029375, 1e-3);
  assert.equal(s.coverage.exactCostSessions, 1);
  assert.equal(s.coverage.sessions, 3);
  assert.equal(s.coverage.partial, false);
  assert.equal(s.coverage.totalTranscripts, 4, 'S1 + subagent + S2 + C1; the foreign Codex rollout is not read');
  assert.equal(s.kpis.tokens.cacheRead, 5000 + 500);
  // cache saved: sonnet input 3 - cache read 0.3 per 1M on 5000 tokens; gpt 1.25 - 0.125 on 500
  near(s.kpis.cacheSavedUsd, (5000 * 2.7 + 500 * 1.125) / 1e6, 1e-4);
  assert.ok(s.kpis.cacheHitRate > 0 && s.kpis.cacheHitRate < 1);
  assert.equal(s.kpis.toolErrors, 4, '3 Bash failures in S1 + 1 Codex command');
  assert.equal(s.kpis.linesAdded, 10, 'S1 lines from cost-state');
  assert.equal(s.kpis.medianTurnMs, 900000);
  assert.ok(s.series.length >= 30);
  assert.ok(s.series.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));
  near(s.series.reduce((a, d) => a + d.usd, 0), s.kpis.usd, 1e-2);
  assert.deepEqual(s.byAgent.map((a) => a.tool).sort(), ['claude', 'codex']);
  assert.deepEqual(s.byProject, [], 'byProject only with scope=all');
  assert.ok(s.byBranch.some((b) => b.branch === 'feature'));
  assert.ok(s.anomalies.some((a) => a.kind === 'error-loop' && a.session === 'S1' && /Bash failed 3 times/.test(a.message)));
  assert.equal(s.budget.dailyUsd, null);
  const b = await U({ usage: { dailyBudgetUsd: 0.0001 } }).summary({ range: '30d' });
  assert.equal(b.budget.dailyUsd, 0.0001);
  // tool filter
  const codex = await U().summary({ range: '30d', tool: 'codex' });
  assert.equal(codex.kpis.sessions, 1);
});

test('summary: a time budget returns partial coverage and keeps warming', async () => {
  const { clearDigestCache } = await import('../src/usage/digest.js');
  clearDigestCache();
  const s = await getUsage({ root: fx.root, home: fx.home, config: {}, usageBudgetMs: 0 }).summary({ range: '30d' });
  assert.ok(s.coverage.transcripts <= s.coverage.totalTranscripts);
  await new Promise((r) => setTimeout(r, 200));
  const s2 = await getUsage({ root: fx.root, home: fx.home, config: {}, usageBudgetMs: 0 }).summary({ range: '30d' });
  assert.equal(s2.coverage.partial, false, 'background parse finished');
  assert.equal(s2.coverage.transcripts, s2.coverage.totalTranscripts);
});

test('scope: other projects only with scope=all', async () => {
  const p = await U().sessions({ range: '30d' });
  assert.ok(!p.sessions.some((s) => s.sessionId === 'S9'));
  const a = await U().sessions({ range: '30d', scope: 'all' });
  assert.ok(a.sessions.some((s) => s.sessionId === 'S9'));
  assert.ok(a.sessions.some((s) => s.sessionId === 'C2'), 'foreign Codex rollout with scope=all');
  assert.ok(!p.sessions.some((s) => s.sessionId === 'C2'));
  assert.equal((await U().session('S9')).session, null, 'replay lookup stays in the project');
  assert.equal((await U().session('S9', { scope: 'all' })).session.sessionId, 'S9');
  const all = await U().summary({ range: '30d', scope: 'all' });
  assert.ok(all.byProject.some((x) => x.project === '/somewhere/else'));
});

test('sessions: rows with subagents, files, titles and the q filter', async () => {
  const { sessions } = await U().sessions({ range: '30d' });
  const s1 = sessions.find((s) => s.sessionId === 'S1');
  assert.equal(s1.title, 'Fixture session one');
  assert.equal(s1.exact, true);
  near(s1.usd, 0.5, 1e-4);
  assert.equal(s1.subagents, 1);
  assert.deepEqual(s1.filesTouched, ['src/a.js']);
  assert.equal(s1.compactions, 1);
  assert.equal(s1.errors, 3);
  assert.equal(s1.branch, 'main');
  assert.ok(s1.models.includes('claude-haiku-4-5'), 'subagent model included');
  const s2 = sessions.find((s) => s.sessionId === 'S2');
  assert.equal(s2.exact, false);
  near(s2.usd, 3, 1e-6);
  const c1 = sessions.find((s) => s.tool === 'codex');
  assert.equal(c1.sessionId, 'C1');
  assert.equal((await U().sessions({ range: '30d', q: 'second' })).sessions.length, 1);
});

test('session replay: timeline kinds, thinking text only when prompts are shown, agents, file versions', async () => {
  const r = await U({ live: { showPrompts: false } }).session('S1');
  const kinds = new Set(r.timeline.map((x) => x.kind));
  for (const k of ['prompt', 'thinking', 'text', 'tool', 'result', 'edit', 'compact', 'hook', 'interrupt', 'denied', 'subagent']) assert.ok(kinds.has(k), k);
  const th = r.timeline.find((x) => x.kind === 'thinking');
  assert.equal(th.durationMs, 1200);
  assert.equal(th.thinking, undefined);
  assert.ok(!JSON.stringify(r).includes('secret chain of thought'));
  const sub = r.timeline.find((x) => x.kind === 'subagent');
  assert.deepEqual([sub.agentId, sub.input, sub.title], ['a1', 'general-purpose', 'sub task']);
  const ask = r.timeline.find((x) => x.kind === 'result' && x.tool === 'AskUserQuestion');
  assert.match(ask.quote, /USER-ANSWER-POSTGRES/);
  assert.equal(ask.text, undefined, 'typed answers only under the redacted quote key');
  assert.equal(r.timeline.find((x) => x.kind === 'edit').path, 'src/a.js');
  const shown = await U({ live: { showPrompts: true } }).session('S1');
  assert.equal(shown.timeline.find((x) => x.kind === 'thinking').thinking, 'secret chain of thought');
  assert.equal(r.agents.length, 1);
  assert.equal(r.agents[0].agentId, 'a1');
  assert.equal(r.agents[0].name, 'general-purpose');
  assert.equal(r.agents[0].model, 'claude-haiku-4-5');
  assert.deepEqual(r.files, [{ path: 'src/a.js', versions: [{ backup: 'abc123@v1', version: 1, ts: r.files[0].versions[0].ts, messageId: 'm1' }, { backup: 'abc123@v2', version: 2, ts: r.files[0].versions[1].ts, messageId: 'm2' }] }]);
  assert.equal((await U().session('nope')).session, null);
  const c = await U().session('C1');
  assert.ok(c.timeline.some((x) => x.kind === 'prompt' && x.prompt === 'codex prompt'));
});

test('file versions: before/after from file-history, newest vs disk, unknown backups rejected', async () => {
  const v1 = await U().fileVersion({ session: 'S1', backup: 'abc123@v1', path: 'src/a.js' });
  assert.deepEqual([v1.before, v1.after, v1.truncated], ['x\n', 'y\nz\n', false]);
  const v2 = await U().fileVersion({ session: 'S1', backup: 'abc123@v2', path: 'src/a.js' });
  assert.equal(v2.after, 'y\nz\nnow\n', 'newest version compares with the file on disk');
  await assert.rejects(U().fileVersion({ session: 'S1', backup: 'zzz@v1', path: 'src/a.js' }), /version not found/);
  await assert.rejects(U().fileVersion({ session: 'S9', backup: 'abc123@v1' }), /session not found/);
});

test('tools: errors, loops, denials, MCP servers needing auth, skills, hooks', async () => {
  const t = await U().tools({ range: '30d' });
  const bash = t.tools.find((x) => x.name === 'Bash');
  assert.equal(bash.calls, 3);
  assert.equal(bash.errors, 3);
  assert.equal(bash.errorRate, 1);
  assert.equal(bash.kind, 'builtin');
  assert.ok(typeof bash.avgMs === 'number');
  assert.equal(t.tools.find((x) => x.name === 'mcp__github__create_issue').denied, 1);
  assert.deepEqual(t.mcpServers.find((x) => x.server === 'github'), { server: 'github', calls: 1, errors: 0, needsAuth: true });
  assert.deepEqual(t.skills, [{ name: 'review', calls: 1 }]);
  assert.deepEqual(t.hooks, { runs: 2, errors: 1, preventedStops: 1 });
  assert.equal(t.interrupts, 1);
  assert.equal(t.denials, 1);
  assert.equal(t.loops.length, 1);
  assert.deepEqual([t.loops[0].tool, t.loops[0].count, t.loops[0].session], ['Bash', 3, 'S1']);
  assert.match(t.loops[0].sample, /tests failed/);
});

test('prompts: outcome, rework, repeated prompts; pastedContents is counted, never returned', async () => {
  const p = await U().prompts({ range: '30d', limit: 100 });
  assert.ok(!JSON.stringify(p).includes('PASTED-SECRET-CONTENT'));
  const first = p.prompts.find((x) => x.session === 'S1' && x.prompt === 'please add the parser');
  assert.equal(first.pasted, 1);
  assert.equal(first.outcome.toolCalls, 8);
  assert.equal(first.outcome.errors, 3);
  assert.equal(first.outcome.interrupted, true);
  assert.equal(first.outcome.rework, true);
  assert.equal(first.outcome.durationMs, 900000);
  assert.ok(first.outcome.usd > 0);
  assert.ok(p.prompts.some((x) => x.session === 'S-gone' && x.outcome.toolCalls === null), 'history-only prompt');
  assert.ok(!p.prompts.some((x) => x.prompt === 'other project'));
  assert.ok(p.prompts.some((x) => x.tool === 'codex'));
  assert.equal(p.repeated[0].prompt, 'please add the parser');
  assert.equal(p.repeated[0].count, 4);
  assert.equal(p.repeated[0].sessions, 2);
  assert.equal(p.repeated[0].suggestion.kind, 'command');
  assert.ok(p.stats.total >= 5);
  assert.ok(p.stats.reworkRate > 0);
  assert.equal((await U().prompts({ range: '30d', q: 'codex' })).prompts.length, 1);
});

test('fleet, impact, activity', async () => {
  const f = await U().fleet({ range: '30d' });
  assert.equal(f.runs.length, 1);
  const run = f.runs[0];
  assert.deepEqual(run.nodes.map((n) => n.kind), ['main', 'subagent', 'advisor']);
  assert.equal(run.nodes[1].title, 'sub task description');
  assert.equal(run.nodes[2].model, 'claude-opus-4-5');
  assert.deepEqual(run.edges, [{ from: 'main', to: 'a1', kind: 'spawn' }, { from: 'main', to: 'advisor', kind: 'advice' }]);
  const im = await U().impact({ range: '30d' });
  const a = im.files.find((x) => x.path === 'src/a.js');
  assert.deepEqual([a.edits, a.linesAdded, a.linesRemoved, a.sessions], [1, 2, 1, 1]);
  assert.equal(im.exact, true, 'S1 lines are from cost-state; S2 made no edits');
  assert.ok(im.churn.length >= 1);
  const ac = await U().activity({ range: '30d' });
  assert.equal(ac.hourly.length, 24);
  assert.equal(ac.weekHour.length, 7);
  assert.equal(ac.turns.count, 1);
  assert.equal(ac.awayCount, 1);
  assert.ok(ac.focusMs > 0);
  assert.ok(ac.heatmap.some((h) => h.prompts > 0));
});

test('memory and plans: frontmatter, stale paths, plans only from this project', async () => {
  const m = await U().memory();
  assert.equal(m.memory.length, 1);
  const n = m.memory[0];
  assert.deepEqual([n.name, n.description, n.type, n.file], ['Build notes', 'How the build works', 'project', 'note.md']);
  assert.match(n.body, /parser lives/);
  assert.deepEqual(n.links, ['MEMORY.md']);
  assert.deepEqual(n.stale, [{ claim: 'src/missing.js', reason: 'path not found in the project' }]);
  assert.deepEqual(m.plans.map((p) => p.file), ['plan-slug-one.md']);
  assert.equal(m.plans[0].title, 'Plan one');
});

test('settings audit: bypass, broad allow, MCP auth, hook errors, permission modes', async () => {
  const s = await U().settings();
  const ids = s.findings.map((f) => f.id.split(':')[0]);
  for (const id of ['bypass-default', 'broad-allow', 'mcp-auth', 'bypass-used', 'hook-errors', 'no-deny']) assert.ok(ids.includes(id), id);
  assert.equal(s.findings[0].severity, 'high');
  assert.deepEqual(s.mcpNeedsAuth, ['github']);
  assert.equal(s.permissionModes.bypassPermissions, 1);
  assert.deepEqual(s.settings.permissions.allow, ['Bash(*)', 'Read']);
  assert.equal(s.settings.hooks.Stop[0].commands[0], 'echo done');
  const proj = await U().settings({ home: false });
  assert.ok(!JSON.stringify(proj).includes('echo done'), 'home settings left out');
  assert.ok(!proj.findings.some((f) => f.id.startsWith('bypass-default')));
});

test('entity: session, file, tool, model, agent, task, commit', async () => {
  const s = await U().entity('session', 'S1');
  assert.equal(s.title, 'Fixture session one');
  assert.deepEqual(s.related.files, [{ path: 'src/a.js', edits: 1 }]);
  assert.ok(s.related.tools.some((t) => t.name === 'Bash' && t.calls === 3));
  assert.deepEqual(s.links, [{ label: 'Open replay', href: '#/sessions?id=S1' }]);
  const f = await U().entity('file', 'src/a.js');
  assert.ok(f.related.sessions.some((x) => x.sessionId === 'S1'));
  assert.equal(f.links[0].href, '#/files?path=src%2Fa.js');
  const t = await U().entity('tool', 'Bash');
  assert.equal(t.stats.find((x) => x.label === 'Errors').value, 3);
  assert.equal(t.links[0].href, '#/usage?tab=tools&tool=Bash');
  const m = await U().entity('model', 'claude-sonnet-4-5');
  assert.ok(m.related.sessions.length >= 1);
  const a = await U().entity('agent', 'codex');
  assert.equal(a.stats[0].value, 1);
  for (const [k, id] of [['task', 'nope'], ['commit', 'deadbeef']]) {
    const e = await U().entity(k, id);
    assert.deepEqual(Object.keys(e.related).sort(), ['commits', 'files', 'sessions', 'tasks', 'tools']);
    assert.ok(e.links.length === 1);
  }
});

test('denylist: credentials, session keys, remote, state and paste-cache are never read', async () => {
  const c = path.join(fx.home, '.claude');
  for (const p of ['.credentials.json', 'sessions/x.key', 'remote/r.jsonl', 'state/s.json', 'paste-cache/p.txt']) {
    assert.equal(isDenied(path.join(c, p), fx.home), true, p);
    assert.equal(await safeRead(path.join(c, p), fx.home), null, p);
  }
  assert.equal(isDenied(path.join(c, 'projects', 'x', 'S1.jsonl'), fx.home), false);
  assert.equal(isDenied(path.join(fx.home, '.codex', 'auth.json'), fx.home), true);
  // a transcript symlinked to the credentials file is not read
  if (fs.existsSync(path.join(fx.dir, 'S-link.jsonl'))) assert.equal(await safeRead(path.join(fx.dir, 'S-link.jsonl'), fx.home), null);
  const U2 = U();
  const everything = JSON.stringify(await Promise.all([U2.summary({ range: 'all', scope: 'all' }), U2.sessions({ range: 'all', scope: 'all' }), U2.prompts({ range: 'all', scope: 'all' }), U2.memory(), U2.settings(), U2.tools({ range: 'all', scope: 'all' })]));
  for (const s of ['CREDENTIAL-SECRET', 'KEY-SECRET', 'REMOTE-SECRET', 'STATE-SECRET', 'PASTE-CACHE-SECRET', 'PASTED-SECRET-CONTENT']) assert.ok(!everything.includes(s), s);
});

test('CLI: usage --json emits agentneuron.usage/v1 and the text summary is readable', async () => {
  const out = [];
  const log = { log: (s) => out.push(s), error: (s) => out.push(s) };
  assert.equal(await cmdUsage(fx.root, { json: true, range: '30d' }, { log, home: fx.home }), 0);
  const j = JSON.parse(out.join('\n'));
  assert.equal(j.schema, 'agentneuron.usage/v1');
  assert.equal(j.kpis.sessions, 3);
  out.length = 0;
  assert.equal(await cmdUsage(fx.root, { range: '30d' }, { log, home: fx.home }), 0);
  const text = out.join('\n');
  assert.match(text, /Cost/);
  assert.match(text, /Top models/);
  assert.match(text, /Top tools/);
  assert.match(text, /Anomalies/);
  out.length = 0;
  assert.equal(await cmdUsage(fx.root, { range: '5y' }, { log, home: fx.home }), 2);
});

test('MCP: get_usage, get_session_replay and get_tool_health read the same data', async () => {
  const server = fileURLToPath(new URL('../src/mcp/server.js', import.meta.url));
  const child = spawn(process.execPath, ['-e', `import(${JSON.stringify('file://' + server)}).then(m => m.runMcpServer(${JSON.stringify(fx.root)}, {}))`],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: fx.home, USERPROFILE: fx.home } });
  let buf = '';
  const waiters = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(m.id)?.(m); }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const my = ++id;
    const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 15000);
    waiters.set(my, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
  });
  const call = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).result.content[0].text);
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const u = await call('get_usage', { range: '30d' });
    assert.equal(u.kpis.sessions, 3);
    assert.ok(!JSON.stringify(u).includes('Fixture session one'), 'get_usage carries no titles or prompts');
    const r = await call('get_session_replay', { id: 'S1', limit: 5 });
    assert.equal(r.timeline.length, 5);
    assert.equal(r.session.sessionId, 'S1');
    const t = await call('get_tool_health', { range: '30d' });
    assert.equal(t.tools.find((x) => x.name === 'Bash').errors, 3);
  } finally { child.kill(); }
});
