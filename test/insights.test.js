import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/core/config.js';
import { createStore } from '../src/core/store.js';
import { createSessions } from '../src/agents/sessions.js';
import { startServer } from '../src/server/app.js';
import { createInsights, detectCorrection, toRule, classify, parseRules, effectiveness, joinFeatures } from '../src/insights/index.js';
import { cluster, coveredBy } from '../src/insights/lessons.js';
import { parseClaude, parseCodex, parsePatch } from '../src/insights/transcripts.js';
import { tokens } from '../src/insights/text.js';
import { makeProject, rmTemp, tmp, SECRET, T0 } from './insights-fixtures.js';

async function setup(opts = {}) {
  const { home, root } = makeProject();
  const config = loadConfig(root, opts);
  const store = createStore(root, config, { record: opts.record === true });
  await store.init();
  const ctx = { root, home, config, store, sessions: createSessions(root, { home }), can: () => true, invalidate() {}, broadcast() {} };
  return { home, root, ctx, ins: createInsights(ctx) };
}
const P = (text, after = 'edit', extra = {}) => ({ k: 'prompt', text, after, ts: 1, ...extra });

test('correction detection: precision on positives and negatives', () => {
  for (const t of ['no, we use pnpm not npm', "don't touch the generated files", 'stop editing dist/ please', 'wrong, use the logger instead of console.log',
    'never commit .env files', 'revert that and use the existing helper instead', 'We use tabs here, not spaces']) assert.ok(detectCorrection(P(t)), t);
  for (const t of ['No worries, looks great', 'now run it', 'I know', 'no problem, thanks', 'ok continue', 'never mind, carry on', "don't worry about it",
    'why does this fail?', 'yes', 'no']) assert.equal(detectCorrection(P(t)), null, t);
  // only right after an agent edit/command
  assert.equal(detectCorrection(P('no, we use pnpm not npm', null)), null);
  // rejected tool use with feedback is a correction even without markers
  assert.ok(detectCorrection(P('put it in lib/ please', 'edit', { rejected: true })));
  // long pastes and code blocks are not corrections
  assert.equal(detectCorrection(P('no ' + 'x '.repeat(400))), null);
  assert.equal(detectCorrection(P('```\nno, never do this\n```')), null);
});

test('toRule: concise imperative sentences', () => {
  assert.equal(toRule('no, we use pnpm not npm'), 'Use pnpm, not npm.');
  assert.equal(toRule("Nope. Don't touch the generated files"), "Don't touch the generated files.");
  assert.equal(toRule('you should not edit the lockfile by hand'), "Don't edit the lockfile by hand.");
  assert.equal(toRule('revert that'), null);
  assert.ok(toRule(`don't put ${SECRET} in code`).includes('****'));
  assert.ok(!toRule(`don't put ${SECRET} in code`).includes(SECRET.slice(12)));
});

test('clustering and alreadyCovered', () => {
  const items = ['Use pnpm, not npm.', 'Always use pnpm instead of npm.', "Don't edit dist/ files.", 'Use pnpm not npm'].map((rule) => ({ kind: 'correction', rule, evidence: [] }));
  const cs = cluster(items);
  assert.equal(cs.length, 2);
  assert.equal(cs.find((c) => c.items.length === 3).items[0].rule, 'Use pnpm, not npm.');
  const rules = [{ rule: 'Use pnpm for every package command, never npm.', file: 'CLAUDE.md', line: 3 }, { rule: 'Keep functions small.', file: 'AGENTS.md', line: 9 }];
  assert.equal(coveredBy(tokens('Use pnpm, not npm.'), rules)?.file, 'CLAUDE.md');
  assert.equal(coveredBy(tokens("Don't edit dist/ files."), rules), null);
});

test('transcript parsing: claude sidechains skipped, tool results paired; codex commands, exit codes and patches', () => {
  const s = parseClaude([
    { type: 'user', timestamp: '2026-10-01T10:00:00Z', isSidechain: true, message: { content: 'no, never do that' } },
    { type: 'assistant', timestamp: '2026-10-01T10:00:01Z', gitBranch: 'feat/x', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', timestamp: '2026-10-01T10:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Exit code 1\nError: boom', is_error: true }] } },
    { type: 'user', timestamp: '2026-10-01T10:00:03Z', message: { content: '[Request interrupted by user]' } },
    { type: 'user', timestamp: '2026-10-01T10:00:04Z', message: { content: 'use pnpm test instead' } },
  ], '/x/s1.jsonl');
  assert.equal(s.branch, 'feat/x');
  assert.deepEqual(s.events.map((e) => e.k), ['cmd', 'prompt']);
  assert.equal(s.events[0].ok, false);
  assert.match(s.events[0].err, /boom/);
  assert.equal(s.events[1].after, 'command');
  assert.equal(s.events[1].interrupted, true);
  const c = parseCodex([
    { timestamp: '2026-10-01T10:00:00Z', type: 'session_meta', payload: { id: 'cx', cwd: '/proj', git: { branch: 'feat/y' } } },
    { timestamp: '2026-10-01T10:00:01Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'a', arguments: '{"cmd":"make build"}' } },
    { timestamp: '2026-10-01T10:00:02Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'a', output: 'Process exited with code 2\nOutput:\nmake: *** No rule to make target' } },
  ], '/x/rollout-cx.jsonl');
  assert.equal(c.sessionId, 'cx');
  assert.equal(c.branch, 'feat/y');
  assert.equal(c.events[0].cmd, 'make build');
  assert.equal(c.events[0].ok, false);
  assert.deepEqual(parsePatch('*** Begin Patch\n*** Update File: a.js\n@@\n-x\n+y\n*** End Patch'), [{ path: 'a.js', removed: 'x', added: 'y' }]);
});

test('lessons from synthetic Claude + Codex sessions: clusters, fixes, reverts, masking, coverage', async () => {
  const { home, root, ins } = await setup();
  try {
    const { lessons, sessions } = await ins.lessons();
    assert.equal(sessions, 4);
    const pnpm = lessons.find((l) => /pnpm/.test(l.rule));
    assert.equal(pnpm.rule, 'Use pnpm, not npm.');
    assert.ok(pnpm.kinds.includes('correction') && pnpm.kinds.includes('fix'));
    assert.ok(pnpm.sessions >= 3, 'claude + codex sessions');
    assert.deepEqual(new Set(pnpm.evidence.map((e) => e.tool)), new Set(['claude', 'codex']));
    assert.equal(pnpm.alreadyCovered.file, 'CLAUDE.md');
    assert.equal(pnpm.alreadyCovered.line, 4);
    assert.ok(pnpm.confidence > 0.8);
    assert.ok(lessons.find((l) => l.kind === 'revert' && /src\/app\.js/.test(l.rule)));
    assert.ok(lessons.find((l) => /migrations/.test(l.rule)).alreadyCovered);
    assert.ok(lessons.find((l) => /linter/.test(l.rule) && l.kind === 'repeated' && l.sessions === 2));
    const cx = lessons.find((l) => /src\/b\.js/.test(l.rule));
    assert.equal(cx.target, 'AGENTS.md'); // codex-only evidence
    assert.ok(!lessons.some((l) => /worries|run it|never do that/i.test(l.rule)), 'negatives and sidechain stay out');
    const all = JSON.stringify(lessons);
    assert.ok(!all.includes(SECRET.slice(12)), 'secret masked');
    for (const l of lessons) for (const e of l.evidence) assert.ok(e.quote.length <= 200);
    // stable ids
    assert.deepEqual(lessons.map((l) => l.id), (await ins.lessons()).lessons.map((l) => l.id));
  } finally { rmTemp(root); rmTemp(home); }
});

test('rule effectiveness: followed / violated / never relevant / diet', async () => {
  assert.deepEqual(classify('Use pnpm, not npm.'), { type: 'command-preference', prefer: 'pnpm', avoid: ['npm'] });
  assert.equal(classify('Never edit `dist/` files.').type, 'path-prohibition');
  assert.deepEqual(classify('Never touch the migrations folder.').targets, ['migrations/']);
  assert.equal(classify('Run tests before committing.').type, 'run-before');
  assert.equal(classify("Don't run `git push --force`.").type, 'command-prohibition');
  assert.equal(classify('Use tabs, not spaces.'), null);
  assert.equal(classify('Write clear commit messages.'), null);
  const { home, root, ins } = await setup();
  try {
    const r = await ins.rules();
    const by = (re) => r.rules.find((x) => re.test(x.rule));
    assert.deepEqual([by(/pnpm/).followed, by(/pnpm/).violated], [3, 3]); // pnpm install x2 + pnpm test; npm install x3
    assert.deepEqual([by(/dist/).appliesTimes, by(/dist/).violated], [1, 1]);
    assert.deepEqual([by(/Run tests/).followed, by(/Run tests/).violated], [1, 1]);
    assert.equal(by(/migrations/).violated, 1); // the (rejected) write attempt
    assert.ok(by(/pnpm/).tokenCost > 0);
    assert.ok(r.neverRelevant.some((x) => /FancyWidget/.test(x.rule)));
    assert.ok(r.ignored.some((x) => /dist/.test(x.rule)));
    assert.ok(r.diet.cut.some((x) => /FancyWidget/.test(x.rule)));
    assert.equal(r.diet.tokensSaved, r.diet.cut.reduce((a, x) => a + x.tokenCost, 0));
    assert.ok(r.diet.tighten[0].suggestion);
  } finally { rmTemp(root); rmTemp(home); }
  // too few sessions: nothing to cut
  const rules = parseRules([{ path: 'CLAUDE.md', kind: 'context' }], new Map([['CLAUDE.md', '- Never edit `gen/` files.\n']]));
  assert.equal(effectiveness(rules, []).diet.cut.length, 0);
});

test('cost by feature: task id, branch, files and time window; each session counted once', () => {
  const H = 36e5;
  const r = joinFeatures({
    tasks: [{ id: 'm1a2b3c4d5e6', title: 'Login form', files: ['src/login.js'] }, { id: 'tbeef01', title: 'Billing export' }],
    commits: [
      { hash: 'a'.repeat(40), ts: T0 + H, subject: 'feat: login form (m1a2b3c4d5e6)', files: ['src/login.js', 'src/auth.js'], branch: 'feat/login' },
      { hash: 'b'.repeat(40), ts: T0 + 5 * H, subject: 'feat(search): index', files: ['src/search.js'], branch: null },
      { hash: 'c'.repeat(40), ts: T0 + 6 * H, subject: 'wip', files: ['src/billing.js'], branch: 'billing-export' },
    ],
    sessions: [
      { sessionId: 's1', tool: 'claude', startedAt: T0, lastAt: T0 + H, branch: 'feat/login', files: ['src/login.js'], tokens: 1000, usd: 1 },
      { sessionId: 's2', tool: 'codex', startedAt: T0 + 2 * H, lastAt: T0 + 3 * H, branch: null, files: ['src/auth.js'], tokens: 500, usd: 0.5 },
      { sessionId: 's3', tool: 'claude', startedAt: T0 + 6 * H, lastAt: T0 + 7 * H, branch: null, prompts: ['work on tbeef01'], files: [], tokens: 300, usd: 0.3 },
      { sessionId: 's4', tool: 'claude', startedAt: T0, lastAt: T0 + H, branch: null, files: ['README.md'], tokens: 10, usd: 0.01 },
    ],
  });
  const f = (n) => r.features.find((x) => x.feature === n);
  assert.equal(f('Login form').sessions, 2);
  assert.equal(f('Login form').commits, 1);
  assert.equal(f('Login form').cost, 1.5);
  assert.equal(f('Billing export').sessions, 1); // task id in the prompt
  assert.equal(f('Billing export').commits, 1); // branch name ~ task title
  assert.equal(f('search').kind, 'scope');
  assert.equal(f('Unattributed').sessions, 1);
  assert.equal(r.total.sessions, 4);
  assert.equal(r.total.cost, 1.81);
});

test('replay: context versions at the time of a change + preceding prompts', async () => {
  const { home, root, ctx, ins } = await setup({ record: true });
  try {
    // a later CLAUDE.md version must not leak into the replay of an earlier change
    await new Promise((r) => setTimeout(r, 20));
    const before = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Rules\n- brand new rule after the change\n');
    await ctx.store.handleFsEvent({ type: 'change', path: 'CLAUDE.md' });
    const r = await ins.replay({ path: 'src/app.js', session: 'sess-a', ts: before });
    assert.equal(r.session.sessionId, 'sess-a');
    assert.equal(r.context.chain[0].path, 'CLAUDE.md');
    assert.equal(r.context.chain[0].version.source, 'history');
    assert.equal(r.context.chain[0].changedSince, true);
    assert.match(r.context.text, /Use pnpm, not npm/);
    assert.ok(!/brand new rule/.test(r.context.text));
    assert.ok(r.prompts.some((p) => /login form/.test(p.text)));
    assert.ok(r.timeline.some((e) => e.kind === 'prompt') && r.timeline.some((e) => e.kind === 'change'));
    assert.ok(!JSON.stringify(r).includes(SECRET.slice(12)));
    const recent = await ins.recent();
    assert.ok(recent.some((c) => c.path === 'src/app.js' && c.agent.sessionId));
  } finally { rmTemp(root); rmTemp(home); }
});

test('HTTP routes: lessons, rules, replay, costs; accept gated at edit, dismiss persisted', async () => {
  const { home, root } = makeProject();
  const run = async (actions, fn) => {
    const srv = await startServer(loadConfig(root, { port: 0, actions }));
    srv.ctx.sessions = createSessions(root, { home });
    srv.ctx.home = home;
    const base = `http://127.0.0.1:${srv.port}`;
    const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
    const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
    try { await fn(get, post); } finally { await srv.close(); }
  };
  try {
    await run({}, async (get, post) => {
      const l = await get('/api/insights/lessons');
      assert.equal(l.status, 200);
      assert.equal(l.body.canAccept, false);
      const lesson = l.body.lessons.find((x) => /linter/.test(x.rule));
      assert.ok(!JSON.stringify(l.body).includes(SECRET.slice(12)));
      assert.equal((await post('/api/insights/lessons/accept', { id: lesson.id })).status, 403); // edit is off by default
      assert.equal((await get('/api/insights/rules')).status, 200);
      assert.equal((await get('/api/insights/costs-by-feature')).status, 200);
      assert.equal((await get('/api/insights/replay?path=../etc/passwd')).status, 400);
      assert.equal((await get('/api/insights/replay?session=bad%20id')).status, 400);
      assert.ok(Array.isArray((await get('/api/insights/replay')).body.changes));
      assert.equal((await get('/api/insights/replay?session=sess-a&ts=' + (T0 + 5 * 60000))).body.session.sessionId, 'sess-a');
      // dismiss (state level: local admin) persists and hides
      const rev = l.body.lessons.find((x) => x.kind === 'revert');
      assert.equal((await post('/api/insights/lessons/dismiss', { id: rev.id })).status, 200);
      assert.ok(!(await get('/api/insights/lessons')).body.lessons.some((x) => x.id === rev.id));
      assert.ok(fs.readFileSync(path.join(root, '.agentneuron', 'insights.json'), 'utf8').includes(rev.id));
      assert.equal((await post('/api/insights/lessons/dismiss', { id: 'nope' })).status, 400);
    });
    await run({ edit: true }, async (get, post) => {
      const l = await get('/api/insights/lessons');
      assert.equal(l.body.canAccept, true);
      assert.ok(!l.body.lessons.some((x) => x.kind === 'revert'), 'dismissal survives restarts');
      const lesson = l.body.lessons.find((x) => /linter/.test(x.rule));
      assert.equal((await post('/api/insights/lessons/accept', { id: lesson.id, target: '../evil.md' })).status, 400);
      assert.equal((await post('/api/insights/lessons/accept', { id: lesson.id, target: 'src/app.js' })).status, 400);
      assert.equal((await post('/api/insights/lessons/accept', { id: lesson.id, target: '.claude/settings.json' })).status, 400);
      assert.equal((await post('/api/insights/lessons/accept', { id: lesson.id, rule: 'two\nlines' })).status, 400);
      const ok = await post('/api/insights/lessons/accept', { id: lesson.id });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.path, 'CLAUDE.md');
      const md = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
      assert.match(md, /## Lessons learned\n\n- Run the linter before you push changes\.\n$/);
      assert.match(md, /^# Rules/);
      assert.ok(!(await get('/api/insights/lessons')).body.lessons.some((x) => x.id === lesson.id));
      // a scoped .cursor/rules target can be created
      const cx = (await get('/api/insights/lessons')).body.lessons.find((x) => /src\/b\.js/.test(x.rule));
      const ok2 = await post('/api/insights/lessons/accept', { id: cx.id, target: 'AGENTS.md', rule: "Don't edit src/b.js by hand." });
      assert.equal(ok2.status, 200);
      assert.equal(ok2.body.created, true);
      assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /- Don't edit src\/b\.js by hand\./);
    });
  } finally { rmTemp(root); rmTemp(home); }
});

test('MCP suggest_rules: read-only, masked, uncovered lessons only by default', async () => {
  const { home, root } = makeProject();
  const server = fileURLToPath(new URL('../src/mcp/server.js', import.meta.url));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(new URL('file://' + server.replace(/\\/g, '/')).href)}).then(m => m.runMcpServer(${JSON.stringify(root)}, {}, { noWatch: true }))`],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: home, USERPROFILE: home } });
  let buf = '';
  const waiters = new Map();
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(m.id)?.(m); } });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const my = ++id; const t = setTimeout(() => reject(new Error('timeout')), 15000);
    waiters.set(my, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.ok((await rpc('tools/list', {})).result.tools.some((t) => t.name === 'suggest_rules'));
    const r = await rpc('tools/call', { name: 'suggest_rules', arguments: {} });
    assert.equal(r.result.isError, false);
    const text = r.result.content[0].text;
    assert.ok(!text.includes(SECRET.slice(12)));
    const data = JSON.parse(text);
    assert.ok(data.lessons.length >= 3);
    assert.ok(!data.lessons.some((l) => l.alreadyCovered));
    const all = JSON.parse((await rpc('tools/call', { name: 'suggest_rules', arguments: { includeCovered: true } })).result.content[0].text);
    assert.ok(all.lessons.some((l) => l.alreadyCovered));
    assert.ok(!fs.existsSync(path.join(root, '.agentneuron', 'insights.json')), 'never writes');
  } finally { child.kill(); rmTemp(root); rmTemp(home); }
});

test('huge transcripts are tail-capped; unreadable lines ignored', async () => {
  const { readSession } = await import('../src/insights/transcripts.js');
  const d = tmp();
  assert.equal(readSession(path.join(d, 'missing.jsonl'), 'claude'), null);
  const line = (t, i) => JSON.stringify({ type: 'user', timestamp: new Date(T0 + i * 1000).toISOString(), message: { content: t } });
  const old = Array.from({ length: 200 }, (_, i) => line(`old prompt number ${i} ${'pad '.repeat(20)}`, i));
  fs.writeFileSync(path.join(d, 'big.jsonl'), [...old, '{broken', line('the newest prompt', 999)].join('\n') + '\n');
  const s = readSession(path.join(d, 'big.jsonl'), 'claude', 4096);
  assert.ok(s.events.length > 0 && s.events.length < 60, `only the tail is parsed (${s.events.length})`);
  assert.equal(s.events[s.events.length - 1].text, 'the newest prompt');
  assert.ok(s.events.every((e) => /^(old prompt|the newest)/.test(e.text)), 'the partial first line is dropped');
  rmTemp(d);
});

test('secrets crossing clip boundaries never leak (prompt, rule, command, revert)', async () => {
  const { home, root, ins } = await setup();
  try {
    const dir = path.join(home, '.claude', 'projects', (await import('../src/agents/sessions.js')).projectDirName(root));
    const L = (o) => JSON.stringify({ sessionId: 'sess-z', cwd: root, ...o });
    const at = (m) => new Date(T0 + 500 * 60000 + m * 60000).toISOString();
    const long = 'x'.repeat(1990) + SECRET; // straddles the 2000-char parse clip
    fs.writeFileSync(path.join(dir, 'sess-z.jsonl'), [
      L({ type: 'assistant', timestamp: at(0), message: { content: [{ type: 'tool_use', id: 'z1', name: 'Edit', input: { file_path: path.join(root, 'src/z.js'), old_string: 'y'.repeat(34) + ' ' + SECRET, new_string: 'abc' } }] } }),
      L({ type: 'user', timestamp: at(1), message: { content: `no, never paste ${'w '.repeat(61)}${SECRET} in code` } }),
      L({ type: 'user', timestamp: at(2), message: { content: long } }),
      ...Array.from({ length: 14 }, (_, k) => L({ type: 'user', timestamp: at(2), message: { content: 'x'.repeat(1975 + k) + SECRET } })),
      ...Array.from({ length: 14 }, (_, k) => L({ type: 'assistant', timestamp: at(2), message: { content: [{ type: 'tool_use', id: `e${k}`, name: 'Edit', input: { file_path: path.join(root, 'src/q.js'), old_string: 'q', new_string: 'y'.repeat(975 + k) + SECRET } }] } })),
      L({ type: 'assistant', timestamp: at(3), message: { content: [{ type: 'tool_use', id: 'z2', name: 'Bash', input: { command: `curl${' '.repeat(60)}${SECRET}` } }] } }),
      L({ type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 'z2', content: `Exit code 1\nerror: bad key ${SECRET}`, is_error: true }] } }),
      L({ type: 'assistant', timestamp: at(4), message: { content: [{ type: 'tool_use', id: 'z3', name: 'Bash', input: { command: `curl${' '.repeat(60)}${SECRET}` } }] } }),
      L({ type: 'user', timestamp: at(4), message: { content: [{ type: 'tool_result', tool_use_id: 'z3', content: `Exit code 1\nerror: bad key ${SECRET}`, is_error: true }] } }),
      L({ type: 'assistant', timestamp: at(5), message: { content: [{ type: 'tool_use', id: 'z4', name: 'Edit', input: { file_path: path.join(root, 'src/z.js'), old_string: 'abc', new_string: 'y'.repeat(34) + ' ' + SECRET } }] } }),
    ].join('\n') + '\n');
    const out = JSON.stringify([await ins.lessons({ all: true }), await ins.rules(), await ins.replay({ session: 'sess-z', ts: T0 + 600 * 60000 })]);
    assert.ok(out.includes('in src/z.js'), 'the revert lesson exists');
    const rnd = SECRET.slice(13);
    for (let i = 0; i + 8 <= rnd.length; i++) { const j = out.indexOf(rnd.slice(i, i + 8)); assert.ok(j < 0, `secret fragment leaked: ${out.slice(Math.max(0, j - 120), j + 40)}`); }
  } finally { rmTemp(root); rmTemp(home); }
});
