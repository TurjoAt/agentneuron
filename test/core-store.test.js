import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { createHistory } from '../src/core/history.js';
import { createStore } from '../src/core/store.js';
import { createWatcher } from '../src/core/watcher.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mdctl-core-'));
const put = (root, rel, c) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), c); };

test('history: record, dedupe, list, get, latest, limit', () => {
  const r = tmp();
  const h = createHistory(r, loadConfig(r, { historyLimitPerFile: 3 }));
  const e1 = h.record('docs/a.md', 'one\n');
  assert.equal(e1.added, 1);
  assert.equal(h.record('docs/a.md', 'one\n'), null);
  const e2 = h.record('docs/a.md', 'one\ntwo\n');
  assert.deepEqual([e2.added, e2.removed], [1, 0]);
  assert.equal(h.latest('docs/a.md').id, e2.id);
  assert.deepEqual(h.list('docs/a.md').map((x) => x.id), [e2.id, e1.id]);
  assert.equal(h.get('docs/a.md', e1.id), 'one\n');
  assert.equal(h.get('docs/a.md', '../../x'), null);
  assert.equal(h.get('docs/a.md', 'nope'), null);
  h.record('docs/a.md', 'three\n');
  const e4 = h.record('docs/a.md', 'four\n');
  const l = h.list('docs/a.md');
  assert.equal(l.length, 3);
  assert.equal(l[0].id, e4.id);
  assert.equal(h.get('docs/a.md', e1.id), null);
  assert.deepEqual(h.list('missing.md'), []);
  assert.equal(h.latest('missing.md'), null);
  assert.ok(fs.existsSync(path.join(r, '.mdctl/history')));
});

test('history: restore writes file and records', () => {
  const r = tmp();
  put(r, 'sub/x.md', 'v1\n');
  const h = createHistory(r, loadConfig(r));
  const e1 = h.record('sub/x.md', 'v1\n');
  h.record('sub/x.md', 'v2\n');
  put(r, 'sub/x.md', 'v2\n');
  const res = h.restore('sub/x.md', e1.id);
  assert.equal(fs.readFileSync(path.join(r, 'sub/x.md'), 'utf8'), 'v1\n');
  assert.equal(res.hash, e1.hash);
  assert.equal(h.list('sub/x.md').length, 3);
  assert.throws(() => h.restore('sub/x.md', 'bogus'));
});

test('store: init, add/change/unlink events, ring buffer', async () => {
  const r = tmp();
  put(r, 'CLAUDE.md', '# A\nline\n');
  const cfg = loadConfig(r);
  const s = createStore(r, cfg);
  await s.init();
  assert.ok(s.files.has('CLAUDE.md'));
  assert.equal(s.contents.get('CLAUDE.md'), '# A\nline\n');
  assert.equal(s.history.list('CLAUDE.md').length, 1);

  const seen = [];
  s.on('event', (e) => seen.push(e));
  assert.equal(await s.handleFsEvent({ type: 'change', path: 'CLAUDE.md' }), null); // unchanged

  put(r, 'CLAUDE.md', '# A\nline\nmore\n');
  const ch = await s.handleFsEvent({ type: 'change', path: 'CLAUDE.md' });
  assert.equal(ch.type, 'change');
  assert.deepEqual(ch.stats, { added: 1, removed: 0 });
  assert.ok(ch.historyId);
  assert.equal(ch.file.lines, 3);

  put(r, 'new.md', 'x\n');
  const ad = await s.handleFsEvent({ type: 'add', path: 'new.md' });
  assert.equal(ad.type, 'add');
  assert.deepEqual(ad.stats, { added: 1, removed: 0 });

  assert.equal(await s.handleFsEvent({ type: 'add', path: 'src/x.js' }), null);

  fs.unlinkSync(path.join(r, 'new.md'));
  const un = await s.handleFsEvent({ type: 'unlink', path: 'new.md' });
  assert.equal(un.type, 'unlink');
  assert.equal(un.stats.removed, 1);
  assert.ok(!s.files.has('new.md'));
  assert.equal(await s.handleFsEvent({ type: 'unlink', path: 'new.md' }), null);

  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map((e) => e.id), [1, 2, 3]);
  assert.equal(s.events.length, 3);

  for (let i = 0; i < 520; i++) {
    put(r, 'loop.md', `v${i}\n`);
    await s.handleFsEvent({ type: 'change', path: 'loop.md' });
  }
  assert.equal(s.events.length, 500);
  assert.ok(s.events[s.events.length - 1].id > 500);
});

test('watcher: receives add, change, unlink for candidates only', async () => {
  const r = tmp();
  put(r, 'existing.md', 'a\n');
  const cfg = loadConfig(r);
  const got = [];
  const w = createWatcher(r, cfg, (e) => got.push(e));
  await w.ready;
  const waitFor = async (pred, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (got.some(pred)) return; await new Promise((x) => setTimeout(x, 50)); }
    assert.fail('timeout; got ' + JSON.stringify(got));
  };
  try {
    put(r, 'node_modules/x/ignored.md', 'x');
    put(r, 'code.js', 'x');
    put(r, 'docs/new.md', 'hello\n');
    await waitFor((e) => e.path === 'docs/new.md' && e.type === 'add');
    fs.writeFileSync(path.join(r, 'existing.md'), 'b\n');
    await waitFor((e) => e.path === 'existing.md' && e.type === 'change');
    fs.unlinkSync(path.join(r, 'docs/new.md'));
    await waitFor((e) => e.path === 'docs/new.md' && e.type === 'unlink');
    await new Promise((x) => setTimeout(x, 300));
    assert.ok(got.every((e) => !e.path.includes('node_modules') && e.path !== 'code.js'));
  } finally {
    await w.close();
  }
});

test('watcher + store integration', async () => {
  const r = tmp();
  put(r, 'AGENTS.md', '# x\n');
  const cfg = loadConfig(r);
  const s = createStore(r, cfg);
  await s.init();
  const w = createWatcher(r, cfg, (e) => { s.handleFsEvent(e); });
  await w.ready;
  try {
    const p = new Promise((res) => s.once('event', res));
    fs.writeFileSync(path.join(r, 'AGENTS.md'), '# x\nchanged\n');
    const ev = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    assert.equal(ev.path, 'AGENTS.md');
    assert.equal(ev.type, 'change');
    assert.equal(ev.stats.added, 1);
  } finally {
    await w.close();
  }
});
