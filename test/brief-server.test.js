// HTTP routes of the agent brief against a synthetic HOME (this file runs in its own process).
// One viewer-token test per route: no prompt text, titles, commands, tool output or Markdown for viewers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { makeHome } from './usage-fixtures.js';

const fx = makeHome();
process.env.HOME = fx.home;
process.env.USERPROFILE = fx.home;
const w = (rel, s) => { const f = path.join(fx.root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
w('CLAUDE.md', '# Project\n\n## Rules\n\n- Never edit `src/gen/` files.\n- Use pnpm, not npm.\n\n## Parser\n\nThe parser lives in src/a.js.\n');
w('package.json', JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }));
w('pnpm-lock.yaml', 'lockfileVersion: 9\n');

const { loadConfig } = await import('../src/core/config.js');
const { startServer } = await import('../src/server/app.js');
const { briefCtx, buildResume, saveBrief } = await import('../src/brief/index.js');
const { createStore } = await import('../src/core/store.js');

// a saved brief, built through the real code path before the server starts
const cfg0 = loadConfig(fx.root, {});
const st0 = createStore(fx.root, cfg0, { record: false });
await st0.init();
const saved = saveBrief(fx.root, 'resume', await buildResume(briefCtx({ root: fx.root, config: cfg0, store: st0, home: fx.home }), { session: 'S1' }));

const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) { try { await f(); } catch { /* ignore */ } } fs.rmSync(fx.base, { recursive: true, force: true }); });

const ADMIN = 'adm-brief-1234', VIEWER = 'view-brief-1234';
const srv = await startServer(loadConfig(fx.root, { port: 0, adminToken: ADMIN, token: VIEWER }));
cleanups.push(() => srv.close());
const port = srv.port;

const req = (method, p, tok, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: p, method, agent: false,
    headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${tok}`, ...(data && { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }) } }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

// prompt words, titles, answers, commands, tool output and history-derived rule text from the fixture sessions
const SECRET_TEXT = ['please add the parser', 'Fixture session one', 'Second fixture session', 'revert it', 'USER-ANSWER-POSTGRES', 'Which database',
  '`npm test', '"npm test', 'Error: tests failed', 'Error: still failing', 'Error: boom', 'Working on it.', 'secret chain of thought', 'codex prompt'];

const ROUTES = [
  ['GET', '/api/brief/resume?session=S1'],
  ['GET', '/api/brief/resume'],
  ['GET', '/api/brief/sources'],
  ['GET', '/api/brief/briefs'],
  ['GET', `/api/brief/brief?id=${saved.id}`],
  ['GET', '/api/brief/warnings?command=npm%20install%20lodash&paths=src/gen/x.js'],
  ['GET', '/api/brief/rules'],
  ['GET', '/api/brief/pack?task=parser&budget=4000'],
  ['POST', '/api/brief/debug', { run: 'last' }],
];

for (const [method, route, body] of ROUTES) {
  test(`viewer token: ${method} ${route} answers without session text`, async () => {
    const v = await req(method, route, VIEWER, body);
    assert.ok(v.status === 200 || (route === '/api/brief/debug' && v.status === 400), `${v.status} ${v.body}`);
    for (const s of SECRET_TEXT) assert.ok(!v.body.includes(s), `${route} leaks "${s}"`);
    assert.ok(!v.body.includes('PASTED-SECRET-CONTENT'));
    // the pack holds project files, context sections and repo facts only, so its Markdown stays
    if (!route.startsWith('/api/brief/pack')) assert.ok(!v.body.includes('"markdown"'), 'no Markdown export for viewers');
    const a = await req(method, route, ADMIN, body);
    assert.ok(a.status === 200 || (route === '/api/brief/debug' && a.status === 400), `${a.status} ${a.body}`);
    for (const s of ['PASTED-SECRET-CONTENT', 'CREDENTIAL-SECRET', 'KEY-SECRET', 'PASTE-CACHE-SECRET', 'REMOTE-SECRET']) assert.ok(!a.body.includes(s), `never read: ${s}`);
  });
}

test('admin sees the session text the viewer checks look for (the viewer tests are not vacuous)', async () => {
  const a = await req('GET', '/api/brief/resume?session=S1', ADMIN);
  for (const s of ['please add the parser', 'Fixture session one', 'npm test', 'Error: still failing', 'revert it', 'USER-ANSWER-POSTGRES']) assert.ok(a.body.includes(s), `admin resume lacks "${s}"`);
  const r = JSON.parse(a.body);
  assert.match(r.markdown, /# Resume brief/);
  assert.ok((await req('GET', '/api/brief/sources', ADMIN)).body.includes('Fixture session one'));
  assert.ok((await req('GET', '/api/brief/briefs', ADMIN)).body.includes('Fixture session one'));
  assert.ok((await req('GET', `/api/brief/brief?id=${saved.id}`, ADMIN)).body.includes('please add the parser'));
  assert.ok((await req('GET', '/api/brief/rules', ADMIN)).body.includes('npm test'), 'admin rules include the failing-command history');
  assert.ok((await req('GET', '/api/brief/warnings?command=npm%20test', ADMIN)).body.includes('history'));
});

test('viewers keep the generated structure: labels, warning titles, files, counts', async () => {
  const v = JSON.parse((await req('GET', '/api/brief/resume?session=S1', VIEWER)).body);
  assert.equal(v.title, '');
  assert.equal(v.goal.prompt, '');
  assert.ok(v.done.some((d) => d.label === 'Edited src/a.js' && d.path === 'src/a.js'));
  const cmd = v.failed.find((f) => f.kind === 'command');
  assert.match(cmd.label, /Command failed 3×/);
  assert.equal(cmd.command, undefined);
  assert.equal(cmd.quote, undefined);
  assert.ok(v.decisions.every((d) => !d.quote));
  assert.equal(v.markdown, undefined);
  const warn = JSON.parse((await req('GET', '/api/brief/warnings?command=npm%20install%20lodash&paths=src/gen/x.js', VIEWER)).body);
  assert.ok(warn.warnings.length >= 2);
  assert.ok(warn.warnings.every((x) => x.title && x.title.length > 3), 'generated warning titles survive');
  assert.ok(warn.warnings.some((x) => x.id === 'pm-pnpm' && x.severity === 'block'));
  // a viewer cannot probe the failing-command history through the query
  const probe = JSON.parse((await req('GET', '/api/brief/warnings?command=npm%20test', VIEWER)).body);
  assert.ok(!probe.warnings.some((x) => x.source.kind === 'history'));
  const rules = JSON.parse((await req('GET', '/api/brief/rules', VIEWER)).body);
  assert.ok(rules.rules.length > 0 && rules.rules.every((r) => r.source.kind !== 'history' && r.title));
  const briefs = JSON.parse((await req('GET', '/api/brief/briefs', VIEWER)).body);
  assert.equal(briefs.briefs[0].id, saved.id);
  assert.equal(briefs.briefs[0].title, '');
  const pack = JSON.parse((await req('GET', '/api/brief/pack?task=parser&budget=4000', VIEWER)).body);
  assert.ok(pack.items.some((i) => i.path === 'src/a.js'));
});

test('debug: pasted error text is admin-only and bounded; admin gets a report with Markdown', async () => {
  const v = await req('POST', '/api/brief/debug', VIEWER, { error: 'TypeError: x is not a function' });
  assert.equal(v.status, 403);
  const a = await req('POST', '/api/brief/debug', ADMIN, { error: `TypeError: Cannot read properties of undefined\n    at parse (${fx.root}/src/a.js:2:3)` });
  assert.equal(a.status, 200, a.body);
  const r = JSON.parse(a.body);
  assert.equal(r.frames[0].path, 'src/a.js');
  assert.ok(r.hypotheses.length > 0);
  assert.match(r.markdown, /## Hypotheses/);
  assert.ok(!fs.readdirSync(path.join(fx.root, '.agentneuron', 'briefs')).some((f) => fs.readFileSync(path.join(fx.root, '.agentneuron', 'briefs', f), 'utf8').includes('Cannot read properties')), 'pasted text is not stored');
  assert.equal((await req('POST', '/api/brief/debug', ADMIN, { error: 'x'.repeat(70 * 1024) })).status, 413);
});

test('input validation: bad ids and missing task', async () => {
  assert.equal((await req('GET', '/api/brief/resume?session=../etc', ADMIN)).status, 400);
  assert.equal((await req('GET', '/api/brief/resume?session=nope', ADMIN)).status, 404);
  assert.equal((await req('GET', '/api/brief/pack', ADMIN)).status, 400);
  assert.equal((await req('GET', '/api/brief/brief?id=zzz', ADMIN)).status, 400);
});

test('brief.save action: admin only (state), stores the recomputed brief and a handoff note', async () => {
  const v = await req('POST', '/api/actions/run', VIEWER, { id: 'brief.save', params: { session: 'S1' } });
  assert.equal(v.status, 403);
  const a = await req('POST', '/api/actions/run', ADMIN, { id: 'brief.save', params: { session: 'S1' } });
  assert.equal(a.status, 200, a.body);
  let job = JSON.parse(a.body);
  for (let i = 0; i < 50 && !['ok', 'error'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 50));
    job = JSON.parse((await req('GET', `/api/job?id=${job.id}`, ADMIN)).body);
  }
  assert.equal(job.status, 'ok', JSON.stringify(job));
  assert.match(job.result.id, /^b[0-9a-f]{10}$/);
  const h = JSON.parse((await req('GET', '/api/live/handoffs', VIEWER)).body);
  const row = h.handoffs.find((x) => x.summary.includes(job.result.id));
  assert.ok(row, 'handoff note written');
  for (const s of SECRET_TEXT) assert.ok(!JSON.stringify(row).includes(s), `handoff leaks "${s}"`);
});
