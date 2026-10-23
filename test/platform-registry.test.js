import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, validateParams } from '../src/actions/registry.js';
import { loadConfig, parseEnable } from '../src/core/config.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mkCtx(actions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-reg-'));
  const config = loadConfig(root, { actions });
  const sse = [];
  const ctx = {
    root, config, broadcast: (n, d) => sse.push([n, d]), notify: () => {},
    can(level, role) {
      if (level === 'read') return true;
      if (role !== 'admin') return false;
      if (level === 'state') return true;
      return !!config.actions[level];
    },
    persist: { audit: { log() {} } },
  };
  return { ctx, sse, reg: createRegistry(ctx), root };
}

test('config: all action levels are off by default; --enable parsing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentneuron-cfg-'));
  const c = loadConfig(root);
  assert.deepEqual(c.actions, { edit: false, exec: false, danger: false, terminal: false });
  assert.equal(loadConfig(root, { actions: { exec: true } }).actions.exec, true);
  assert.equal(loadConfig(root, { allowWrite: true }).actions.edit, true);
  fs.mkdirSync(path.join(root, '.agentneuron'));
  fs.writeFileSync(path.join(root, '.agentneuron/config.json'), JSON.stringify({ actions: { edit: 'yes', exec: true } }));
  const c2 = loadConfig(root);
  assert.equal(c2.actions.edit, false); // only strict true enables
  assert.equal(c2.actions.exec, true);
  assert.deepEqual(parseEnable('edit, exec'), ['edit', 'exec']);
  assert.throws(() => parseEnable('root'));
});

test('registry validates definitions', () => {
  const { reg } = mkCtx();
  assert.throws(() => reg.register({ id: 'x', title: 't', level: 'exec' }), /run/);
  assert.throws(() => reg.register({ id: 'x.y', title: 't', level: 'read', run() {} }), /level/);
  assert.throws(() => reg.register({ id: 'x.y', title: 't', level: 'exec', params: { a: { type: 'bogus' } }, run() {} }), /type/);
  reg.register({ id: 'x.y', title: 't', level: 'exec', run() {} });
  assert.throws(() => reg.register({ id: 'x.y', title: 't', level: 'exec', run() {} }), /already/);
});

test('param validation', () => {
  const schema = {
    name: { type: 'string', required: true, pattern: '^[a-z]+$' },
    n: { type: 'number', min: 1, max: 5, default: 2 },
    flag: { type: 'boolean', default: false },
    mode: { type: 'enum', enum: ['a', 'b'] },
    file: { type: 'path' },
    list: { type: 'string[]' },
  };
  assert.deepEqual(validateParams(schema, { name: 'abc', extra: 1 }), { name: 'abc', n: 2, flag: false });
  assert.throws(() => validateParams(schema, {}), /required/);
  assert.throws(() => validateParams(schema, { name: 'ABC' }), /invalid format/);
  assert.throws(() => validateParams(schema, { name: 'a', n: 9 }), /<= 5/);
  assert.throws(() => validateParams(schema, { name: 'a', mode: 'c' }), /one of/);
  assert.throws(() => validateParams(schema, { name: 'a', file: '../x' }), /project-relative/);
  assert.throws(() => validateParams(schema, { name: 'a', file: '/etc/passwd' }), /project-relative/);
  assert.throws(() => validateParams(schema, { name: 'a', list: [1] }), /array of strings/);
  assert.equal(validateParams(schema, { name: 'a', file: 'docs/x.md' }).file, 'docs/x.md');
});

test('level gating: disabled by default with how-to-enable reason; roles', async () => {
  const { reg, ctx } = mkCtx();
  let ran = 0;
  reg.register({ id: 't.exec', title: 'E', category: 'a', level: 'exec', run() { ran++; } });
  reg.register({ id: 't.edit', title: 'Ed', category: 'a', level: 'edit', run() { ran++; } });
  reg.register({ id: 't.state', title: 'S', category: 'b', level: 'state', run() { ran++; return 1; } });
  reg.register({ id: 't.hidden', title: 'H', category: 'b', level: 'exec', available: async () => false, run() {} });
  const list = await reg.list('admin');
  assert.deepEqual(list.map((a) => a.id), ['t.edit', 't.exec', 't.state']);
  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.equal(byId['t.exec'].enabled, false);
  assert.match(byId['t.exec'].reason, /enable actions\.exec in \.agentneuron\/config\.json/);
  assert.equal(byId['t.state'].enabled, true);
  assert.equal((await reg.list('viewer')).find((a) => a.id === 't.state').enabled, false);
  await assert.rejects(reg.run('t.exec', {}, { role: 'admin' }), (e) => e.status === 403 && /actions\.exec/.test(e.message));
  await assert.rejects(reg.run('t.state', {}, { role: 'viewer' }), (e) => e.status === 403);
  await assert.rejects(reg.run('nope', {}), (e) => e.status === 404);
  assert.equal(ran, 0);
  const job = await reg.run('t.state', {}, { role: 'admin' });
  await job.done;
  assert.equal(job.status, 'ok'); assert.equal(job.result, 1);
  ctx.config.actions.exec = true;
  const j2 = await reg.run('t.exec', {}, { role: 'admin' });
  await j2.done;
  assert.equal(j2.status, 'ok');
});

test('job exec streams output, cancel kills process, failures reported', async () => {
  const { reg, ctx, sse } = mkCtx({ exec: true });
  reg.register({ id: 'j.echo', title: 'Echo', category: 'x', level: 'exec',
    async run(_p, _c, job) { const r = await job.exec(process.execPath, ['-e', 'console.log("hi"); console.error("err")']); return r; } });
  reg.register({ id: 'j.sleep', title: 'Sleep', category: 'y', level: 'exec',
    async run(_p, _c, job) { return job.exec(process.execPath, ['-e', 'setInterval(()=>{},1000)']); } });
  reg.register({ id: 'j.fail', title: 'Fail', category: 'z', level: 'exec', async run() { throw new Error('boom'); } });
  reg.register({ id: 'j.escape', title: 'Esc', category: 'w', level: 'exec', async run(_p, _c, job) { return job.exec('node', ['-v'], { cwd: '../' }); } });

  const j = await reg.run('j.echo', {}, { role: 'admin' });
  await j.done;
  assert.equal(j.status, 'ok');
  assert.equal(j.result.code, 0);
  assert.match(j.result.stdout, /hi/);
  assert.ok(j.logBuf.some((l) => l.stream === 'stderr' && /err/.test(l.text)));
  assert.ok(sse.some(([n, d]) => n === 'joblog' && d.id === j.id && /hi/.test(d.text)));
  assert.deepEqual(sse.filter(([n, d]) => n === 'job' && d.id === j.id).map(([, d]) => d.status), ['queued', 'running', 'ok']);
  assert.equal(JSON.stringify(reg.summary(j)).includes('logBuf'), false);

  const s = await reg.run('j.sleep', {}, { role: 'admin' });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.status, 'running');
  assert.equal(reg.cancel(s.id), true);
  await s.done;
  assert.equal(s.status, 'cancelled');

  const f = await reg.run('j.fail', {}, { role: 'admin' });
  await f.done;
  assert.equal(f.status, 'error'); assert.equal(f.error, 'boom');

  const e = await reg.run('j.escape', {}, { role: 'admin' });
  await e.done;
  assert.equal(e.status, 'error'); assert.match(e.error, /project-relative/);
  assert.ok(ctx);
});

test('one job per category at a time (queued), cancel queued job', async () => {
  const { reg } = mkCtx({ exec: true });
  const order = [];
  reg.register({ id: 'q.a', title: 'A', category: 'same', level: 'exec', async run() { order.push('a+'); await new Promise((r) => setTimeout(r, 150)); order.push('a-'); } });
  reg.register({ id: 'q.b', title: 'B', category: 'same', level: 'exec', async run() { order.push('b+'); order.push('b-'); } });
  const a = await reg.run('q.a', {}, { role: 'admin' });
  const b = await reg.run('q.b', {}, { role: 'admin' });
  assert.equal(b.status, 'queued');
  await Promise.all([a.done, b.done]);
  assert.deepEqual(order, ['a+', 'a-', 'b+', 'b-']);
  const a2 = await reg.run('q.a', {}, { role: 'admin' });
  const b2 = await reg.run('q.b', {}, { role: 'admin' });
  assert.equal(reg.cancel(b2.id), true);
  await b2.done; await a2.done;
  assert.equal(b2.status, 'cancelled');
});
